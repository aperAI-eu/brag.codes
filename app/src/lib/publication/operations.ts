import "server-only";
import { randomUUID } from "node:crypto";
import type { BragAuth } from "../auth/config.ts";
import type { createDatabase } from "../database/client.ts";
import { withUser } from "../auth/access.ts";
import { admission, intentHash, lockTarget, now, owned, type Tx } from "../sharing/admission.ts";
import { fields, object, ProjectError } from "../projects/validation.ts";
import { uuid } from "../events/validation.ts";
import { selection, lifecycleVersion } from "./validation.ts";
import { projectionHash } from "./hash.ts";
import { publicProjection } from "./projection.ts";
import { recordAdmission } from "./admission.ts";
import type {
  PublicProjectContent,
  PublicationReceipt,
  PublicationReview,
  OwnerPublication,
  WithdrawalReceipt,
} from "../../publication/model.ts";

type ReviewRow = {
  id: string;
  project_id: string;
  owner_id: string;
  event_id: string | null;
  draft_version: number;
  base_revision: number;
  publication_version: number;
  projection: PublicProjectContent;
  projection_hash: string;
  expires_at: Date;
};
type Mutation = {
  project_id: string;
  operation: string;
  intent_hash: string;
  result: { review_id?: string; receipt?: PublicationReceipt; withdrawal?: WithdrawalReceipt };
};
const reviewView = (row: ReviewRow): PublicationReview => ({
  review_id: row.id,
  draft_version: row.draft_version,
  publication_version: row.publication_version,
  expires_at: row.expires_at.toISOString(),
  publication_revision: row.base_revision,
  projection_hash: row.projection_hash,
  public_project: row.projection,
});
async function mutation(
  tx: Tx,
  owner: string,
  id: string,
  key: string | null,
  operation: string,
  intent: unknown,
) {
  if (!uuid(key)) throw new ProjectError(400, "idempotency_key_required");
  const hash = intentHash([operation, id, intent]);
  const [previous] = await tx.$queryRaw<
    Mutation[]
  >`SELECT project_id,operation,intent_hash,result FROM brag.publication_mutation WHERE actor_id=${owner} AND key=${key}::uuid`;
  if (
    previous &&
    (previous.intent_hash !== hash ||
      previous.project_id !== id ||
      previous.operation !== operation)
  )
    throw new ProjectError(409, "idempotency_conflict");
  if (!previous) {
    const [count] = await tx.$queryRaw<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM brag.publication_mutation WHERE actor_id=${owner} AND operation=${operation} AND created_at>clock_timestamp()-interval '1 minute'`;
    if (count.n >= (operation === "review" ? 30 : 10)) throw new ProjectError(429, "rate_limited");
  }
  return { key, hash, previous };
}
async function write(
  tx: Tx,
  owner: string,
  id: string,
  m: { key: string; hash: string },
  operation: string,
  result: unknown,
) {
  await tx.$executeRaw`INSERT INTO brag.publication_mutation(actor_id,key,project_id,operation,intent_hash,result) VALUES (${owner},${m.key}::uuid,${id}::uuid,${operation},${m.hash},${JSON.stringify(result)}::jsonb)`;
}
async function reviewRow(tx: Tx, owner: string, id: string, review: string) {
  const [row] = await tx.$queryRaw<
    ReviewRow[]
  >`SELECT * FROM brag.publication_review WHERE id=${review}::uuid AND owner_id=${owner} AND project_id=${id}::uuid`;
  if (!row) throw new ProjectError(409, "review_expired");
  return row;
}
async function current(tx: Tx, id: string): Promise<OwnerPublication | null> {
  const [row] = await tx.$queryRaw<
    OwnerPublication[]
  >`SELECT s.revision,s.visibility,s.owner_withdrawn,
    p.version AS publication_version,p.projection AS public_project,r.selection
    FROM brag.project_public_state s JOIN brag.project_publication p ON p.id=s.publication_id
    JOIN brag.publication_review r ON r.id=p.review_id WHERE s.project_id=${id}::uuid`;
  return row ?? null;
}
export function publicationOperations(
  auth: BragAuth,
  db: ReturnType<typeof createDatabase>,
  origin: string,
) {
  return {
    state(headers: Headers, id: string) {
      return withUser(auth, db, headers, async (tx, owner) => {
        await owned(tx, owner, id);
        return { publication: await current(tx, id) };
      });
    },
    withdraw(headers: Headers, id: string, key: string | null, input: unknown) {
      return withUser(auth, db, headers, async (tx, owner) => {
        await owned(tx, owner, id);
        const raw = object(input, ["expected_version", "expected_publication_revision"]);
        const version = lifecycleVersion(raw.expected_version, 1),
          revision = lifecycleVersion(raw.expected_publication_revision, 1);
        const data = { expected_version: version, expected_publication_revision: revision };
        const m = await mutation(tx, owner, id, key, "withdraw", data);
        if (m.previous?.result.withdrawal) return m.previous.result.withdrawal;
        const d = await lockTarget(tx, owner, id),
          state = await current(tx, id);
        if (!state || d.version !== version || state.revision !== revision)
          throw new ProjectError(409, "version_conflict");
        if (state.owner_withdrawn || state.visibility === "withdrawn")
          throw new ProjectError(409, "already_withdrawn");
        await tx.$queryRaw`SELECT brag.withdraw_publication(${id}::uuid,${owner},${version}::integer,${revision}::integer)`;
        const receipt: WithdrawalReceipt = {
          project_id: id,
          withdrawn: true,
          publication_revision: revision + 1,
          committed_at: (await now(tx)).toISOString(),
        };
        await write(tx, owner, id, m, "withdraw", { withdrawal: receipt });
        return receipt;
      });
    },
    withdrawalReceipt(headers: Headers, id: string, key: string) {
      return withUser(auth, db, headers, async (tx, owner) => {
        await owned(tx, owner, id);
        if (!uuid(key)) throw new ProjectError(404, "receipt_unavailable");
        const [row] = await tx.$queryRaw<
          Mutation[]
        >`SELECT result FROM brag.publication_mutation WHERE actor_id=${owner} AND project_id=${id}::uuid AND key=${key}::uuid AND operation='withdraw'`;
        if (!row?.result.withdrawal) throw new ProjectError(404, "receipt_unavailable");
        return row.result.withdrawal;
      });
    },
    prepare(headers: Headers, id: string, key: string | null, input: unknown) {
      return withUser(auth, db, headers, async (tx, owner) => {
        await owned(tx, owner, id);
        const data = selection(input);
        // Preserve schema-12 review idempotency hashes when the default base is zero.
        const { expected_publication_revision, ...firstIntent } = data;
        const m = await mutation(
          tx,
          owner,
          id,
          key,
          "review",
          expected_publication_revision === 0 ? firstIntent : data,
        );
        if (m.previous) {
          if (!m.previous.result.review_id) throw new ProjectError(409, "review_expired");
          const row = await reviewRow(tx, owner, id, m.previous.result.review_id);
          if (row.expires_at <= (await now(tx))) throw new ProjectError(409, "review_expired");
          return reviewView(row);
        }
        const d = await lockTarget(tx, owner, id);
        const check = await admission(tx, owner, d.eventId, "saved_edit");
        if (d.version !== data.expected_version) throw new ProjectError(409, "version_conflict");
        if (d.confirmedVersion !== d.version) throw new ProjectError(409, "project_not_confirmed");
        const state = await current(tx, id);
        if ((state?.revision ?? 0) !== data.expected_publication_revision)
          throw new ProjectError(409, "version_conflict");
        if (state?.visibility === "hidden") throw new ProjectError(409, "publication_restricted");
        const e = d.eventId ? await tx.event.findUniqueOrThrow({ where: { id: d.eventId } }) : null;
        const projection = publicProjection(fields(d.fields), data, e?.title ?? null);
        const proof = await tx.$queryRaw<
          { project_id: string }[]
        >`SELECT project_id FROM brag.project_admission WHERE project_id=${id}::uuid`;
        if (!proof.length) {
          try {
            await admission(tx, owner, d.eventId, "new_submission");
          } catch (error) {
            if (error instanceof ProjectError && error.code === "submissions_closed")
              throw new ProjectError(409, "admission_unverified");
            throw error;
          }
          await recordAdmission(tx, id, owner, "publication_review", id);
        }
        const reviewId = randomUUID(),
          hash = projectionHash(projection);
        // One DB clock value, with full microsecond precision for expiry constraints.
        await tx.$executeRaw`INSERT INTO brag.publication_review(id,project_id,owner_id,event_id,draft_version,publication_version,base_revision,projection,projection_hash,selection,created_at,expires_at)
          SELECT ${reviewId}::uuid,${id}::uuid,${owner},${d.eventId}::uuid,${d.version},${(state?.publication_version ?? 0) + 1},${state?.revision ?? 0},${JSON.stringify(projection)}::jsonb,${hash},${JSON.stringify(data)}::jsonb,t.at,t.at+interval '15 minutes' FROM (SELECT clock_timestamp() AS at) t`;
        await write(tx, owner, id, m, "review", { review_id: reviewId });
        await tx.$queryRaw`SELECT brag.cleanup_publication_reviews()`;
        const result = reviewView(await reviewRow(tx, owner, id, reviewId));
        await check();
        return result;
      });
    },
    publish(headers: Headers, id: string, key: string | null, input: unknown) {
      return withUser(auth, db, headers, async (tx, owner) => {
        await owned(tx, owner, id);
        const data = object(input, ["review_id"]);
        if (!uuid(data.review_id)) throw new ProjectError(400, "invalid_request");
        const m = await mutation(tx, owner, id, key, "publish", data);
        // Receipt replay is authorized but never re-executes a public write.
        if (m.previous?.result.receipt) return m.previous.result.receipt;
        const d = await lockTarget(tx, owner, id),
          check = await admission(tx, owner, d.eventId, "saved_edit");
        // Project lock serializes consumption. Reviews are immutable and cleanup only
        // removes reviews expired for 24 hours, never a publishable review.
        const row = await reviewRow(tx, owner, id, data.review_id);
        const consumed = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM brag.project_publication WHERE review_id=${row.id}::uuid`;
        if (consumed.length) throw new ProjectError(409, "review_consumed");
        const state = await current(tx, id);
        if (state?.visibility === "hidden") throw new ProjectError(409, "publication_restricted");
        if ((state?.revision ?? 0) !== row.base_revision)
          throw new ProjectError(409, "version_conflict");
        if (row.expires_at <= (await now(tx))) throw new ProjectError(409, "review_expired");
        if (d.version !== row.draft_version) throw new ProjectError(409, "version_conflict");
        if (d.confirmedVersion !== d.version) throw new ProjectError(409, "project_not_confirmed");
        if (row.event_id !== d.eventId || row.projection_hash !== projectionHash(row.projection))
          throw new ProjectError(409, "version_conflict");
        const publicationId = randomUUID();
        const [result] = await tx.$queryRaw<
          { published_at: Date }[]
        >`INSERT INTO brag.project_publication(id,project_id,owner_id,event_id,version,draft_version,review_id,projection,projection_hash)
          VALUES (${publicationId}::uuid,${id}::uuid,${owner},${d.eventId}::uuid,${row.publication_version},${d.version},${row.id}::uuid,${JSON.stringify(row.projection)}::jsonb,${row.projection_hash}) RETURNING published_at`;
        await tx.$queryRaw`SELECT brag.activate_publication(${id}::uuid,${owner},${publicationId}::uuid)`;
        const receipt: PublicationReceipt = {
          project_id: id,
          publication_version: row.publication_version,
          publication_revision: row.base_revision + 1,
          public_url: origin + "/projects/" + id,
          event_url: d.eventId ? origin + "/events/" + d.eventId : null,
          committed_at: result.published_at.toISOString(),
        };
        await write(tx, owner, id, m, "publish", { receipt });
        if (row.expires_at <= (await now(tx))) throw new ProjectError(409, "review_expired");
        await check();
        return receipt;
      });
    },
    receipt(headers: Headers, id: string, key: string) {
      return withUser(auth, db, headers, async (tx, owner) => {
        await owned(tx, owner, id);
        if (!uuid(key)) throw new ProjectError(404, "receipt_unavailable");
        const [row] = await tx.$queryRaw<
          Mutation[]
        >`SELECT project_id,operation,intent_hash,result FROM brag.publication_mutation WHERE actor_id=${owner} AND key=${key}::uuid AND project_id=${id}::uuid AND operation='publish'`;
        if (!row?.result.receipt) throw new ProjectError(404, "receipt_unavailable");
        return row.result.receipt;
      });
    },
  };
}
