import "server-only";
import { recordAdmission } from "../publication/admission.ts";
import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.ts";
import type { BragAuth } from "../auth/config.ts";
import type { createDatabase } from "../database/client.ts";
import { withUser } from "../auth/access.ts";
import { uuid } from "../events/validation.ts";
import {
  CAPTURE_CONTRACT,
  admission,
  lockTarget,
  mutationReceipt,
  now,
  owned,
  requireContract,
  saveClass,
  unusedUploadsRevoke,
  writeReceipt,
  type Tx,
} from "../sharing/admission.ts";
import { emptyProject, type DraftView, type ProjectFields } from "../../projects/model.ts";
import { fields, object, ProjectError } from "./validation.ts";
import type { PitchConfig } from "./providers.ts";
import { draftView } from "./view.ts";
import { pitchView } from "./view.ts";

type Source =
  | { method: "typed" }
  | { method: "voice"; pitch_id: string; attempt: number }
  | { method: "agent"; proposal_id: string };
function source(value: unknown): Source {
  const d = object(value, ["method", "pitch_id", "attempt", "proposal_id"]);
  if (d.method === "typed" && Object.keys(d).length === 1) return { method: "typed" };
  if (
    d.method === "voice" &&
    uuid(d.pitch_id) &&
    Number.isInteger(d.attempt) &&
    Number(d.attempt) > 0 &&
    Object.keys(d).length === 3
  )
    return { method: "voice", pitch_id: d.pitch_id, attempt: Number(d.attempt) };
  if (d.method === "agent" && uuid(d.proposal_id) && Object.keys(d).length === 2)
    return { method: "agent", proposal_id: d.proposal_id };
  throw new ProjectError(400, "invalid_request");
}
export async function validateSource(
  tx: Tx,
  owner: string,
  id: string,
  version: number,
  s: Source,
) {
  if (s.method === "typed") return;
  const at = await now(tx);
  if (s.method === "voice") {
    const latest = await tx.voicePitch.findFirst({
      where: { draftId: id, ownerId: owner },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (!latest || latest.id !== s.pitch_id) throw new ProjectError(409, "version_conflict");
    await tx.$queryRaw`SELECT id FROM brag.voice_pitch WHERE id=${latest.id}::uuid FOR UPDATE`;
    const pitch = await tx.voicePitch.findUniqueOrThrow({ where: { id: latest.id } });
    if (
      pitch.attempts !== s.attempt ||
      pitch.baseVersion !== version ||
      pitchView(pitch, at).status !== "ready" ||
      !pitch.proposal ||
      (!pitch.admittedAt && !pitch.legacyReceived)
    )
      throw new ProjectError(409, "version_conflict");
    return;
  }
  await tx.$queryRaw`SELECT id FROM brag.agent_proposal WHERE id=${s.proposal_id}::uuid AND draft_id=${id}::uuid FOR UPDATE`;
  const proposal = await tx.agentProposal.findFirst({
    where: { id: s.proposal_id, draftId: id, ownerId: owner },
  });
  if (
    !proposal ||
    proposal.baseVersion !== version ||
    proposal.acceptedVersion !== null ||
    proposal.clearedAt ||
    !proposal.fields ||
    proposal.retentionDeadline <= at
  )
    throw new ProjectError(409, "version_conflict");
}
export function draftOperations(
  auth: BragAuth,
  db: ReturnType<typeof createDatabase>,
  origin: string,
  voiceAvailable: boolean,
  pitchConfig: PitchConfig | null = null,
) {
  const view = (tx: Tx, owner: string, id: string) =>
    draftView(tx, owner, id, origin, voiceAvailable, pitchConfig);
  return {
    create(headers: Headers, key: string | null, input: unknown) {
      return withUser(auth, db, headers, async (tx, owner) => {
        const data = object(input, ["event_id"]);
        if (data.event_id !== null && !uuid(data.event_id))
          throw new ProjectError(400, "invalid_request");
        const current = headers.get("x-capture-contract") === CAPTURE_CONTRACT;
        const receipt = await mutationReceipt(
          tx,
          owner,
          key,
          current ? [CAPTURE_CONTRACT, "create", data.event_id] : ["create", data.event_id],
        );
        if (receipt.previous) {
          const result = receipt.previous.result as {
            draft_id?: string;
            draft?: { id: string };
            receipt?: Prisma.JsonValue;
          };
          const id = result.draft_id ?? result.draft?.id;
          if (!id) throw new ProjectError(409, "receipt_unavailable");
          return { draft: await view(tx, owner, id), receipt: result.receipt ?? { key } };
        }
        requireContract(headers);
        const check = await admission(tx, owner, data.event_id, "new_submission");
        const draft = await tx.projectDraft.create({
          data: { id: randomUUID(), ownerId: owner, eventId: data.event_id, fields: emptyProject },
        });
        const at = await check();
        const saved = {
          key,
          operation_class: "new_submission",
          draft_id: draft.id,
          version: draft.version,
          committed_at: at.toISOString(),
        };
        await writeReceipt(tx, owner, receipt, { draft_id: draft.id, receipt: saved });
        const result = { draft: await view(tx, owner, draft.id), receipt: saved };
        await check();
        return result;
      });
    },
    read(headers: Headers, id: string) {
      return withUser(auth, db, headers, async (tx, owner) => ({
        draft: await view(tx, owner, id),
        voice_available: voiceAvailable,
      }));
    },
    save(headers: Headers, id: string, key: string | null, input: unknown) {
      return withUser(auth, db, headers, async (tx, owner) => {
        await owned(tx, owner, id);
        const current = headers.get("x-capture-contract") === CAPTURE_CONTRACT;
        const data = object(
          input,
          current
            ? ["expected_version", "fields", "review_source"]
            : ["expected_version", "fields", "source_pitch_id", "source_pitch_attempt"],
        );
        const values = fields(data.fields);
        const s = current ? source(data.review_source) : null;
        const intent = current
          ? [CAPTURE_CONTRACT, "save", id, data.expected_version, values, s]
          : [
              "save",
              id,
              data.expected_version,
              values,
              data.source_pitch_id ?? null,
              ...(data.source_pitch_attempt !== undefined ? [data.source_pitch_attempt] : []),
            ];
        const receipt = await mutationReceipt(tx, owner, key, intent);
        if (receipt.previous)
          return {
            draft: await view(tx, owner, id),
            receipt: (receipt.previous.result as { receipt?: Prisma.JsonValue }).receipt ?? { key },
          };
        requireContract(headers);
        if (!s || !Object.hasOwn(values, "language")) throw new ProjectError(422, "invalid_fields");
        const draft = await lockTarget(tx, owner, id);
        if (draft.version !== data.expected_version)
          throw new ProjectError(409, "version_conflict");
        if (
          s.method === "agent" &&
          (
            await tx.$queryRaw<
              { id: string }[]
            >`SELECT project_id AS id FROM brag.project_public_state WHERE project_id=${id}::uuid AND visibility='published'`
          ).length
        )
          throw new ProjectError(409, "published_project");
        await validateSource(tx, owner, id, draft.version, s);
        const kind = saveClass(draft, s.method !== "typed"),
          check = await admission(tx, owner, draft.eventId, kind);
        const at = await now(tx),
          version = draft.version + 1;
        const approved = (draft.lastEdit as DraftView["last_edit"])?.approved_pitch;
        await tx.projectDraft.update({
          where: { id },
          data: {
            fields: values,
            version,
            confirmedVersion: version,
            confirmedAt: at,
            updatedAt: at,
            lastEdit: {
              method: s.method,
              ...(s.method === "voice"
                ? { pitch_id: s.pitch_id, approved_pitch: { id: s.pitch_id, attempt: s.attempt } }
                : approved
                  ? { approved_pitch: approved }
                  : {}),
            },
          },
        });
        if (s.method === "agent")
          await tx.agentProposal.update({
            where: { id: s.proposal_id },
            data: { acceptedVersion: version },
          });
        await unusedUploadsRevoke(tx, id);
        const committed = await check();
        const saved = {
          key,
          operation_class: kind,
          draft_id: id,
          version,
          committed_at: committed.toISOString(),
        };
        await writeReceipt(tx, owner, receipt, { draft_id: id, receipt: saved });
        if (kind === "new_submission") await recordAdmission(tx, id, owner, "typed", receipt.key);
        const result = { draft: await view(tx, owner, id), receipt: saved };
        // Locks fence cleanup; time can still expire a result during this transaction.
        if (s.method === "voice") await validateSource(tx, owner, id, draft.version, s);
        if (s.method === "agent") {
          const retained = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM brag.agent_proposal WHERE id=${s.proposal_id}::uuid AND retention_deadline>clock_timestamp()`;
          if (!retained.length) throw new ProjectError(409, "version_conflict");
        }
        await check();
        return result;
      });
    },
    discard(headers: Headers, id: string, key: string | null, input: unknown) {
      return withUser(auth, db, headers, async (tx, owner) => {
        await owned(tx, owner, id, true);
        requireContract(headers);
        const data = object(input, ["expected_version"]);
        const receipt = await mutationReceipt(tx, owner, key, [
          CAPTURE_CONTRACT,
          "discard",
          id,
          data.expected_version,
        ]);
        if (receipt.previous) return receipt.previous.result;
        const draft = await lockTarget(tx, owner, id);
        if (draft.confirmedVersion !== null || draft.legacyRecord)
          throw new ProjectError(409, "saved_project");
        if (draft.version !== data.expected_version)
          throw new ProjectError(409, "version_conflict");
        await tx.projectDraft.update({ where: { id }, data: { discardedAt: await now(tx) } });
        await unusedUploadsRevoke(tx, id);
        await tx.$executeRaw`UPDATE brag.voice_pitch SET status='cancelled',original=NULL,corrected=NULL,transcript='',proposal=NULL,lease_until=NULL,cleanup_pending=(provider_id IS NOT NULL) WHERE draft_id=${id}::uuid`;
        const result = { draft_id: id, discarded: true, receipt: key };
        await writeReceipt(tx, owner, receipt, result);
        return result;
      });
    },
    forEvent(headers: Headers, eventId: string, cursor: string | null = null) {
      return withUser(auth, db, headers, async (tx, owner) => {
        if (!uuid(eventId) || (cursor !== null && !uuid(cursor)))
          throw new ProjectError(400, "invalid_request");
        if (
          cursor &&
          !(await tx.projectDraft.findFirst({
            where: { id: cursor, ownerId: owner, eventId, discardedAt: null },
          }))
        )
          throw new ProjectError(400, "invalid_request");
        const rows = await tx.projectDraft.findMany({
          where: { ownerId: owner, eventId, discardedAt: null },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 51,
        });
        return {
          drafts: rows.slice(0, 50).map((d) => ({
            id: d.id,
            title: (d.fields as ProjectFields).title || "Untitled project",
            updated_at: d.updatedAt.toISOString(),
            pitch_status: null,
          })),
          next_cursor: rows.length > 50 ? rows[49].id : null,
          voice_available: voiceAvailable,
        };
      });
    },
  };
}
