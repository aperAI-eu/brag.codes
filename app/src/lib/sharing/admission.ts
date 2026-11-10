import "server-only";
import { createHash } from "node:crypto";
import type { Prisma, ProjectDraft } from "../../generated/prisma/client.ts";
import { uuid } from "../events/validation.ts";
import { ProjectError } from "../projects/validation.ts";

export const CAPTURE_CONTRACT = "share-work-v1";
export type Tx = Prisma.TransactionClient;
export type AdmissionClass = "new_submission" | "saved_edit" | "received_completion";
export const intentHash = (intent: unknown) =>
  createHash("sha256").update(JSON.stringify(intent)).digest("hex");
export function requireContract(headers: Headers) {
  if (headers.get("x-capture-contract") !== CAPTURE_CONTRACT)
    throw new ProjectError(409, "capture_upgrade_required");
}
export async function now(tx: Tx) {
  return (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0].now;
}
export async function owned(tx: Tx, owner: string, id: string, includeDiscarded = false) {
  if (!uuid(id)) throw new ProjectError(404, "draft_unavailable");
  const row = await tx.projectDraft.findFirst({
    where: { id, ownerId: owner, ...(!includeDiscarded ? { discardedAt: null } : {}) },
  });
  if (!row) throw new ProjectError(404, "draft_unavailable");
  return row;
}
/** Caller has acquired the actual owner authority lock. All writes use event then draft. */
export async function lockTarget(tx: Tx, owner: string, id: string) {
  const before = await owned(tx, owner, id);
  await tx.$queryRaw`SELECT id FROM brag.event WHERE id=${before.eventId}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM brag.project_draft WHERE id=${id}::uuid FOR UPDATE`;
  return owned(tx, owner, id);
}
export async function admission(
  tx: Tx,
  owner: string,
  eventId: string | null,
  kind: AdmissionClass,
) {
  if (eventId === null) return () => now(tx);
  await tx.$queryRaw`SELECT id FROM brag.event WHERE id=${eventId}::uuid FOR SHARE`;
  if (
    !(await tx.authorEvent.findUnique({ where: { ownerId_eventId: { ownerId: owner, eventId } } }))
  )
    throw new ProjectError(409, "event_link_required");
  const check = async () => {
    const [row] = await tx.$queryRaw<{ approved: boolean; live: boolean; at: Date }[]>`
      SELECT approval='approved' AS approved, NOT manually_closed AND submissions_open_at<=clock_timestamp()
        AND clock_timestamp()<submissions_close_at AS live, clock_timestamp() AS at FROM brag.event WHERE id=${eventId}::uuid`;
    if (!row?.approved) throw new ProjectError(409, "event_suspended");
    if (kind === "new_submission" && !row.live) throw new ProjectError(409, "submissions_closed");
    return row.at;
  };
  await check();
  return check;
}
export function saveClass(draft: ProjectDraft, received: boolean): AdmissionClass {
  return draft.confirmedVersion !== null || draft.legacyRecord
    ? "saved_edit"
    : received
      ? "received_completion"
      : "new_submission";
}
export async function mutationReceipt(tx: Tx, owner: string, key: unknown, intent: unknown) {
  if (!uuid(key)) throw new ProjectError(400, "idempotency_key_required");
  const hash = intentHash(intent);
  const previous = await tx.draftMutation.findUnique({
    where: { actorId_key: { actorId: owner, key } },
  });
  if (previous && previous.intentHash !== hash) throw new ProjectError(409, "idempotency_conflict");
  return { key, hash, previous };
}
export async function writeReceipt(
  tx: Tx,
  owner: string,
  receipt: { key: string; hash: string },
  result: Prisma.InputJsonValue,
) {
  await tx.draftMutation.create({
    data: { actorId: owner, key: receipt.key, intentHash: receipt.hash, result },
  });
}
export async function unusedUploadsRevoke(tx: Tx, draftId: string) {
  await tx.$executeRaw`UPDATE brag.agent_proposal_upload SET revoked_at=clock_timestamp()
    WHERE draft_id=${draftId}::uuid AND revoked_at IS NULL AND consumed_proposal_id IS NULL`;
}
