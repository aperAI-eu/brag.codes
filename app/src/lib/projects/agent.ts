import "server-only";
import { recordAdmission } from "../publication/admission.ts";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import type { createDatabase } from "../database/client.ts";
import type { BragAuth } from "../auth/config.ts";
import type { RuntimeConfig } from "../config/runtime.ts";
import type { AgentProposalUpload, ProjectDraft } from "../../generated/prisma/client.ts";
import { AccessError, withUser } from "../auth/access.ts";
import { consume, mutationBody, privateHeaders } from "../auth/handler.ts";
import { fields, object, ProjectError } from "./validation.ts";
import { uuid } from "../events/validation.ts";
import {
  admission,
  intentHash,
  lockTarget,
  mutationReceipt,
  now,
  owned,
  requireContract,
  saveClass,
  unusedUploadsRevoke,
  writeReceipt,
  type Tx,
  CAPTURE_CONTRACT,
} from "../sharing/admission.ts";
import { pitchView } from "./view.ts";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function available(tx: Tx, draft: ProjectDraft, refinement: boolean) {
  if (!refinement && (draft.confirmedVersion !== null || draft.legacyRecord))
    throw new ProjectError(409, "saved_project");
  if (
    refinement &&
    (
      await tx.$queryRaw<
        { id: string }[]
      >`SELECT project_id AS id FROM brag.project_public_state WHERE project_id=${draft.id}::uuid AND visibility='published'`
    ).length
  )
    throw new ProjectError(409, "published_project");
  if (
    await tx.agentProposal.findFirst({
      where: {
        draftId: draft.id,
        baseVersion: draft.version,
        acceptedVersion: null,
        clearedAt: null,
        retentionDeadline: { gt: await now(tx) },
      },
    })
  )
    throw new ProjectError(409, "proposal_already_received");
  const pitch = await tx.voicePitch.findFirst({
    where: { draftId: draft.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (
    pitch &&
    pitch.baseVersion === draft.version &&
    [
      "queued",
      "dispatching",
      "transcribing",
      "structure_queued",
      "structuring",
      "uncertain",
      ...(!refinement ? ["ready"] : []),
    ].includes(pitchView(pitch, await now(tx)).status)
  )
    throw new ProjectError(409, "capture_conflict");
}
const latestProposal = (tx: Tx, id: string) =>
  tx.agentProposal.findFirst({
    where: { draftId: id },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
  });
async function metadata(tx: Tx, owner: string, id: string) {
  await owned(tx, owner, id);
  const upload = await tx.agentProposalUpload.findFirst({
    where: { draftId: id, ownerId: owner },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (!upload) return { upload: null };
  const at = await now(tx);
  return {
    upload: {
      id: upload.id,
      status: upload.consumedProposalId
        ? "received"
        : upload.revokedAt
          ? "cancelled"
          : upload.expiresAt <= at
            ? "expired"
            : "waiting",
      expires_at: upload.expiresAt.toISOString(),
      proposal_id: upload.consumedProposalId,
    },
  };
}
async function validCredential(tx: Tx, upload: AgentProposalUpload) {
  const [row] = await tx.$queryRaw<
    { active: boolean; expired: boolean; revoked: boolean }[]
  >`SELECT u.active,x.expires_at<=clock_timestamp() AS expired,x.revoked_at IS NOT NULL AS revoked FROM brag.agent_proposal_upload x JOIN brag.auth_user u ON u.id=x.owner_id WHERE x.id=${upload.id}::uuid FOR SHARE OF u`;
  if (!row?.active) throw new AccessError(403);
  if (row.revoked) throw new ProjectError(403, "upload_revoked");
  if (row.expired) throw new ProjectError(403, "upload_expired");
}
export function agentOperations(
  auth: BragAuth,
  db: ReturnType<typeof createDatabase>,
  origin: string,
) {
  const retired = () => {
    throw new ProjectError(409, "capture_upgrade_required");
  };
  return {
    // Explicitly retire every legacy direct-operation entry point as well as HTTP.
    handoff: async (_h: Headers, _id: string, _revoke = false) => retired(),
    link: async (_input: unknown) => retired(),
    approve: async (_h: Headers, _id: string, _input: unknown) => retired(),
    access: async (_token: string | null, _input?: unknown, _key?: string | null) => retired(),
    status(headers: Headers, id: string) {
      return withUser(auth, db, headers, (tx, owner) => metadata(tx, owner, id));
    },
    issue(headers: Headers, id: string, key: string | null, input: unknown) {
      return withUser(auth, db, headers, async (tx, owner) => {
        await owned(tx, owner, id);
        const data = object(input, ["replace", "expected_version"]);
        if (data.replace !== undefined && data.replace !== true)
          throw new ProjectError(400, "invalid_request");
        const refinement = data.expected_version !== undefined;
        if (
          refinement &&
          (!Number.isSafeInteger(data.expected_version) || Number(data.expected_version) < 1)
        )
          throw new ProjectError(400, "invalid_request");
        const receipt = await mutationReceipt(tx, owner, key, [
          CAPTURE_CONTRACT,
          "agent-upload",
          id,
          data.replace === true,
          ...(refinement ? [data.expected_version] : []),
        ]);
        if (receipt.previous)
          return { ...(await metadata(tx, owner, id)), instructions_unavailable: true };
        requireContract(headers);
        const draft = await lockTarget(tx, owner, id);
        if (refinement && data.expected_version !== draft.version)
          throw new ProjectError(409, "version_conflict");
        await available(tx, draft, refinement);
        const check = await admission(
          tx,
          owner,
          draft.eventId,
          refinement ? saveClass(draft, false) : "new_submission",
        );
        const previous = await tx.agentProposalUpload.findFirst({
          where: { draftId: id, revokedAt: null, consumedProposalId: null },
        });
        if (previous && data.replace !== true)
          throw new ProjectError(409, "instructions_unavailable");
        await unusedUploadsRevoke(tx, id);
        const secret = randomBytes(32).toString("base64url");
        const upload = await tx.agentProposalUpload.create({
          data: {
            id: randomUUID(),
            draftId: id,
            ownerId: owner,
            eventId: draft.eventId,
            baseVersion: draft.version,
            secretHash: hash(secret),
          },
        });
        await writeReceipt(tx, owner, receipt, { upload_id: upload.id });
        const result = {
          ...(await metadata(tx, owner, id)),
          credential: secret,
          skill_url: origin + "/skill.md",
        };
        await check();
        return result;
      });
    },
    cancel(headers: Headers, id: string, key: string | null) {
      return withUser(auth, db, headers, async (tx, owner) => {
        await owned(tx, owner, id);
        const receipt = await mutationReceipt(tx, owner, key, [
          CAPTURE_CONTRACT,
          "agent-cancel",
          id,
        ]);
        if (receipt.previous) return receipt.previous.result;
        await lockTarget(tx, owner, id);
        const latest = await tx.agentProposalUpload.findFirst({
          where: { draftId: id },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
        const proposal = latest?.consumedProposalId
          ? await tx.agentProposal.findUnique({ where: { id: latest.consumedProposalId } })
          : null;
        await unusedUploadsRevoke(tx, id);
        const result = proposal
          ? { status: "proposal_received", proposal_id: proposal.id }
          : { status: "cancelled" };
        await writeReceipt(tx, owner, receipt, result);
        return result;
      });
    },
    proposal(headers: Headers, id: string) {
      return withUser(auth, db, headers, async (tx, owner) => {
        await owned(tx, owner, id);
        const p = await latestProposal(tx, id);
        if (!p) return { proposal: null };
        return {
          proposal: {
            id: p.id,
            base_version: p.baseVersion,
            received_at: p.receivedAt.toISOString(),
            retention_deadline: p.retentionDeadline.toISOString(),
            accepted_version: p.acceptedVersion,
            fields: !p.clearedAt && p.retentionDeadline > (await now(tx)) ? p.fields : null,
          },
        };
      });
    },
    reject(headers: Headers, id: string, key: string | null, input: unknown) {
      return withUser(auth, db, headers, async (tx, owner) => {
        await owned(tx, owner, id);
        requireContract(headers);
        const data = object(input, ["expected_version", "proposal_id"]);
        if (!uuid(data.proposal_id) || !Number.isSafeInteger(data.expected_version))
          throw new ProjectError(400, "invalid_request");
        const receipt = await mutationReceipt(tx, owner, key, [
          CAPTURE_CONTRACT,
          "agent-reject",
          id,
          data.expected_version,
          data.proposal_id,
        ]);
        if (receipt.previous) return receipt.previous.result;
        const draft = await lockTarget(tx, owner, id);
        if (draft.version !== data.expected_version)
          throw new ProjectError(409, "version_conflict");
        const p = await tx.agentProposal.findFirst({
          where: { id: data.proposal_id, draftId: id, ownerId: owner },
        });
        if (!p || p.baseVersion !== draft.version || p.acceptedVersion !== null || p.clearedAt)
          throw new ProjectError(409, "version_conflict");
        const check = await admission(tx, owner, draft.eventId, saveClass(draft, true));
        await tx.$executeRaw`UPDATE brag.agent_proposal SET fields=NULL,cleared_at=clock_timestamp() WHERE id=${p.id}::uuid`;
        const result = { status: "rejected", proposal_id: p.id };
        await writeReceipt(tx, owner, receipt, result);
        await check();
        return result;
      });
    },
    async upload(token: string | null, key: string | null, input: unknown) {
      if (!token || !/^Bearer [A-Za-z0-9_-]{43}$/.test(token)) throw new AccessError(401);
      const secretHash = hash(token.slice(7));
      const locator = await db.agentProposalUpload.findUnique({ where: { secretHash } });
      if (!locator) throw new AccessError(401);
      if (!(await consume(db, "agent-access", 120))) throw new ProjectError(429, "rate_limited");
      if (!(await consume(db, "agent-upload:" + locator.id, 10)))
        throw new ProjectError(429, "rate_limited");
      const data = object(input, ["fields"]),
        values = fields(data.fields);
      if (!Object.hasOwn(values, "language")) throw new ProjectError(422, "invalid_fields");
      if (!uuid(key)) throw new ProjectError(400, "idempotency_key_required");
      const intent = intentHash(values);
      return db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${locator.ownerId},1789))::text`;
        await validCredential(tx, locator);
        const draft = await lockTarget(tx, locator.ownerId, locator.draftId);
        await tx.$queryRaw`SELECT id FROM brag.agent_proposal_upload WHERE id=${locator.id}::uuid FOR UPDATE`;
        const upload = await tx.agentProposalUpload.findUniqueOrThrow({
          where: { id: locator.id },
        });
        await validCredential(tx, upload);
        const existing = await tx.agentProposal.findUnique({ where: { uploadId: upload.id } });
        const result = (id: string) => ({
          status: "received",
          proposal_id: id,
          review_url:
            origin +
            (draft.eventId ? `/events/${draft.eventId}/submit/${draft.id}` : `/submit/${draft.id}`),
        });
        if (existing) {
          if (existing.requestKey !== key || existing.intentHash !== intent)
            throw new ProjectError(409, "proposal_already_received");
          return result(existing.id);
        }
        await available(tx, draft, true);
        if (draft.version !== upload.baseVersion) throw new ProjectError(409, "version_conflict");
        const check = await admission(tx, upload.ownerId, upload.eventId, saveClass(draft, false));
        const proposal = await tx.agentProposal.create({
          data: {
            id: randomUUID(),
            uploadId: upload.id,
            draftId: draft.id,
            ownerId: upload.ownerId,
            eventId: upload.eventId,
            baseVersion: upload.baseVersion,
            requestKey: key,
            intentHash: intent,
            fields: values,
          },
        });
        // Copy the exact PostgreSQL timestamp, including microseconds, for reciprocal receipt FKs.
        await tx.$executeRaw`UPDATE brag.agent_proposal_upload u SET consumed_proposal_id=p.id,consumed_at=p.received_at FROM brag.agent_proposal p WHERE u.id=${upload.id}::uuid AND p.id=${proposal.id}::uuid`;
        if (saveClass(draft, false) === "new_submission")
          await recordAdmission(tx, draft.id, upload.ownerId, "agent", proposal.id);
        await validCredential(tx, upload);
        await check();
        return result(proposal.id);
      });
    },
  };
}
export function agentHandler(
  auth: BragAuth,
  db: ReturnType<typeof createDatabase>,
  config: RuntimeConfig,
) {
  const ops = agentOperations(auth, db, config.origin);
  return async (request: Request) => {
    const json = (data: unknown, status = 200) =>
      Response.json(data, {
        status,
        headers: { ...privateHeaders, ...(status === 429 ? { "Retry-After": "60" } : {}) },
      });
    try {
      const path = new URL(request.url).pathname,
        method = request.method,
        key = request.headers.get("idempotency-key");
      if (path === "/api/v1/agent/proposals" && method === "POST") {
        if (request.headers.has("cookie")) throw new AccessError(403);
        return json(
          await ops.upload(
            request.headers.get("authorization"),
            key,
            await mutationBody(request, config.origin, 65536, true),
          ),
          201,
        );
      }
      if (
        path.startsWith("/api/v1/agent/") ||
        path.startsWith("/api/v1/agent-requests/") ||
        path.endsWith("/handoff")
      )
        throw new ProjectError(409, "capture_upgrade_required");
      const actor = await withUser(auth, db, request.headers, async (_tx, id) => id);
      if (!(await consume(db, "agent-owner:" + actor, 120)))
        throw new ProjectError(429, "rate_limited");
      const match = path.match(
        /^\/api\/v1\/drafts\/([a-f0-9-]{36})\/(agent-upload|agent-proposal)$/,
      );
      if (!match) throw new ProjectError(404, "not_found");
      if (method === "GET")
        return json(
          match[2] === "agent-upload"
            ? await ops.status(request.headers, match[1])
            : await ops.proposal(request.headers, match[1]),
        );
      const body = await mutationBody(request, config.origin, 4096);
      if (match[2] === "agent-upload" && method === "POST") {
        if (!(await consume(db, "agent-link", 60))) throw new ProjectError(429, "rate_limited");
        return json(await ops.issue(request.headers, match[1], key, body), 201);
      }
      if (match[2] === "agent-proposal" && method === "DELETE")
        return json(await ops.reject(request.headers, match[1], key, body));
      if (match[2] === "agent-upload" && method === "DELETE") {
        object(body, []);
        return json(await ops.cancel(request.headers, match[1], key));
      }
      throw new ProjectError(404, "not_found");
    } catch (error) {
      return json(
        { error: { code: error instanceof ProjectError ? error.code : "access_unavailable" } },
        error instanceof ProjectError || error instanceof AccessError ? error.status : 503,
      );
    }
  };
}
