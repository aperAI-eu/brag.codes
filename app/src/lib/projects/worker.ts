import "server-only";
import { createHash } from "node:crypto";
import type { createDatabase } from "../database/client.ts";
import { audioStore } from "./storage.ts";
import {
  pitchProviders,
  transcriptText,
  type PitchProviders,
  type PitchConfig,
} from "./providers.ts";
import { readCredentialVault } from "../config/vault.ts";
import { pitchConfigFor } from "../integrations/settings.ts";
import { isAbsolute } from "node:path";
import { validateAudio } from "./validation.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import { now } from "../sharing/admission.ts";
import { isDatabaseReady } from "../runtime/health.ts";
export function pitchWorker(
  db: ReturnType<typeof createDatabase>,
  config: Pick<PitchConfig, "audioDirectory">,
  providers?: PitchProviders,
  resolve?: (version: number | null) => Promise<PitchProviders>,
) {
  const store = audioStore(config.audioDirectory);
  return async function tick() {
    // An expired submission lease is ambiguous: Distill has no idempotent create API.
    await db.$executeRaw`UPDATE brag.voice_pitch SET status=CASE WHEN status='dispatching' THEN 'uncertain' ELSE 'failed' END, error=CASE WHEN status='dispatching' THEN 'dispatch_uncertain' ELSE 'structure_interrupted' END, lease_until=NULL WHERE status IN ('dispatching','structuring') AND lease_until < clock_timestamp()`;
    await db.$executeRaw`UPDATE brag.voice_pitch p SET status='cancelled',transcript='',original=NULL,corrected=NULL,proposal=NULL,cleanup_pending=(provider_id IS NOT NULL),lease_until=NULL FROM brag.auth_user u WHERE u.id=p.owner_id AND (NOT u.active OR p.created_at < clock_timestamp()-interval '30 days') AND p.status <> 'cancelled'`;
    await db.$executeRaw`UPDATE brag.voice_pitch SET status='failed',error='transcription_timeout',lease_until=NULL,cleanup_pending=(provider_id IS NOT NULL) WHERE status IN ('queued','transcribing') AND COALESCE(transcription_started_at,created_at) < clock_timestamp()-interval '15 minutes'`;
    await db.$executeRaw`UPDATE brag.agent_proposal SET fields=NULL,cleared_at=clock_timestamp() WHERE fields IS NOT NULL AND retention_deadline<=clock_timestamp()`;
    const cleanup = await db.voicePitch.findFirst({
      where: { cleanupPending: true, providerId: { not: null }, nextAttempt: { lte: new Date() } },
      orderBy: { updatedAt: "asc" },
    });
    if (cleanup) {
      try {
        const selected = resolve
          ? await resolve(cleanup.recoveryConfigVersion ?? cleanup.configVersion)
          : providers!;
        await selected.remove(cleanup.providerId!);
        await db.voicePitch.update({ where: { id: cleanup.id }, data: { cleanupPending: false } });
      } catch {
        await db.voicePitch.update({
          where: { id: cleanup.id },
          data: { nextAttempt: new Date(Date.now() + 60000) },
        });
      }
    }
    // Mark successful local deletion so old rows cannot starve later cleanup batches.
    const due = await db.$queryRaw<
      { id: string }[]
    >`SELECT id FROM brag.voice_pitch WHERE audio_removed_at IS NULL
      AND (status IN ('cancelled','ready') OR transcript<>'' OR created_at+interval '24 hours'<=clock_timestamp()) ORDER BY created_at LIMIT 200`;
    for (const item of due)
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM brag.voice_pitch WHERE id=${item.id}::uuid FOR UPDATE`;
        const row = await tx.voicePitch.findUniqueOrThrow({ where: { id: item.id } });
        if (row.audioRemovedAt) return;
        const at = await now(tx);
        if (
          !["cancelled", "ready"].includes(row.status) &&
          !row.transcript &&
          row.createdAt.getTime() + 86400000 > at.getTime()
        )
          return;
        await store.remove(row.id);
        await tx.voicePitch.update({ where: { id: row.id }, data: { audioRemovedAt: at } });
      });
    await store.expire(
      async (id) => !(await db.voicePitch.findUnique({ where: { id }, select: { id: true } })),
    );
    const candidate = await db.voicePitch.findFirst({
      where: {
        status: { in: ["queued", "transcribing", "structure_queued"] },
        nextAttempt: { lte: new Date() },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!candidate) return;
    const pitch = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${candidate.ownerId},1789))::text`;
      const active = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM brag.auth_user WHERE id=${candidate.ownerId} AND active FOR SHARE`;
      if (!active.length) return null;
      await tx.$queryRaw`SELECT id FROM brag.project_draft WHERE id=${candidate.draftId}::uuid FOR UPDATE`;
      const claimed = await tx.$queryRaw<
        { id: string }[]
      >`UPDATE brag.voice_pitch p SET lease_until=date_trunc('milliseconds',clock_timestamp())+interval '90 seconds',status=CASE WHEN status='queued' THEN 'dispatching' WHEN status='structure_queued' THEN 'structuring' ELSE status END,updated_at=clock_timestamp()
       WHERE p.id=${candidate.id}::uuid AND p.status IN ('queued','transcribing','structure_queued') AND p.next_attempt<=clock_timestamp() AND (p.lease_until IS NULL OR p.lease_until<clock_timestamp())
       AND p.created_at+interval '30 days'>clock_timestamp() AND (p.status='structure_queued' OR COALESCE(p.transcription_started_at,p.created_at)+interval '15 minutes'>clock_timestamp())
       AND (p.status<>'queued' OR (p.audio_removed_at IS NULL AND p.created_at+interval '24 hours'>clock_timestamp()))
       AND EXISTS(SELECT 1 FROM brag.project_draft d WHERE d.id=p.draft_id AND d.discarded_at IS NULL) RETURNING p.id`;
      return claimed.length
        ? tx.voicePitch.findUniqueOrThrow({ where: { id: claimed[0].id } })
        : null;
    });
    if (!pitch) return;
    // Recheck authority, lease, attempt and database-time deadlines under the same
    // draft-before-pitch lock order used by owner cancellation and confirmation.
    const transition = async (data: Prisma.VoicePitchUpdateManyMutationInput) =>
      db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${pitch.ownerId},1789))::text`;
        const active = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM brag.auth_user WHERE id=${pitch.ownerId} AND active FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM brag.project_draft WHERE id=${pitch.draftId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM brag.voice_pitch WHERE id=${pitch.id}::uuid FOR UPDATE`;
        const current = await tx.voicePitch.findUniqueOrThrow({ where: { id: pitch.id } }),
          at = await now(tx);
        const draft = await tx.projectDraft.findUniqueOrThrow({ where: { id: pitch.draftId } });
        if (
          !active.length ||
          draft.discardedAt ||
          current.createdAt.getTime() + 30 * 86400000 <= at.getTime()
        ) {
          await tx.$executeRaw`UPDATE brag.voice_pitch SET status='cancelled',transcript='',original=NULL,corrected=NULL,proposal=NULL,lease_until=NULL,cleanup_pending=(provider_id IS NOT NULL) WHERE id=${pitch.id}::uuid`;
          return { count: 0 };
        }
        if (
          current.status !== pitch.status ||
          current.attempts !== pitch.attempts ||
          current.transcriptionAttempt !== pitch.transcriptionAttempt
        )
          return { count: 0 };
        const expired =
          !current.leaseUntil ||
          current.leaseUntil <= at ||
          (["dispatching", "transcribing"].includes(current.status) &&
            (current.transcriptionStartedAt ?? current.createdAt).getTime() + 900000 <=
              at.getTime());
        if (expired) {
          await tx.voicePitch.update({
            where: { id: pitch.id },
            data: {
              status: current.status === "dispatching" ? "uncertain" : "failed",
              error: "processing_deadline",
              leaseUntil: null,
              cleanupPending: !!current.providerId,
            },
          });
          return { count: 0 };
        }
        if (current.leaseUntil?.getTime() !== pitch.leaseUntil?.getTime()) return { count: 0 };
        return tx.voicePitch.updateMany({ where: { id: pitch.id }, data });
      });
    let dispatchStarted = false;
    let configured = false;
    try {
      const selected = resolve
        ? await resolve(pitch.recoveryConfigVersion ?? pitch.configVersion)
        : providers!;
      configured = true;
      if (pitch.status === "dispatching") {
        const bytes = await store.read(pitch.id);
        if (createHash("sha256").update(bytes).digest("hex") !== pitch.mediaHash)
          throw new Error("audio_unavailable");
        validateAudio(bytes, pitch.policy === "pitch-30s-pause-auto-distill-claude-v3" ? 30 : 20);
        dispatchStarted = true;
        const result = await selected.submit(bytes);
        if (result.state === "accepted") {
          const saved = await transition({
            providerId: result.id,
            status: "transcribing",
            leaseUntil: null,
            nextAttempt: new Date(Date.now() + 2000),
          });
          if (!saved.count) {
            await db.voicePitch.updateMany({
              where: { id: pitch.id, providerId: null },
              data: { providerId: result.id, cleanupPending: true },
            });
          }
        } else
          await transition({
            status: result.state === "uncertain" ? "uncertain" : "failed",
            error:
              result.state === "uncertain"
                ? "dispatch_uncertain"
                : result.configuration
                  ? "transcription_configuration"
                  : "transcription_rejected",
            leaseUntil: null,
          });
      } else if (pitch.status === "transcribing") {
        const result = await selected.poll(pitch.providerId!);
        if (result.status === "completed") {
          const original = await selected.artifact(pitch.providerId!, "transcript");
          let corrected: typeof original = [];
          try {
            corrected = await selected.artifact(pitch.providerId!, "corrected");
          } catch {
            /* Preserve the raw transcript when correction is unavailable. */
          }
          const text = transcriptText(corrected) || transcriptText(original);
          if (!text.trim()) throw new Error("empty_transcript");
          const saved = await transition({
            original,
            corrected,
            transcript: text,
            status: "structure_queued",
            cleanupPending: true,
            leaseUntil: null,
            nextAttempt: new Date(),
          });
          if (saved.count) {
            await store.remove(pitch.id);
            await db.voicePitch.update({
              where: { id: pitch.id },
              data: { audioRemovedAt: new Date() },
            });
          }
        } else if (result.status === "failed") {
          await transition({
            status: "failed",
            error: "transcription_failed",
            cleanupPending: true,
            leaseUntil: null,
          });
        } else await transition({ leaseUntil: null, nextAttempt: new Date(Date.now() + 3000) });
      } else {
        if (!(await transition({ attempts: { increment: 1 }, model: selected.model })).count)
          return;
        pitch.attempts++;
        const proposal = await selected.structure(pitch.transcript);
        await transition({
          proposal,
          status: "ready",
          error: null,
          leaseUntil: null,
          updatedAt: new Date(),
        });
      }
    } catch {
      // Polling can retry; paid creates/Claude calls do not automatically repeat after uncertainty.
      await transition(
        pitch.status === "transcribing"
          ? { leaseUntil: null, nextAttempt: new Date(Date.now() + 5000) }
          : {
              status: pitch.status === "dispatching" && dispatchStarted ? "uncertain" : "failed",
              error:
                pitch.status === "dispatching"
                  ? dispatchStarted
                    ? "dispatch_uncertain"
                    : configured
                      ? "audio_unavailable"
                      : "configuration_unavailable"
                  : "structure_failed",
              leaseUntil: null,
            },
      );
    }
  };
}
const state = globalThis as unknown as { bragPitchWorker?: boolean };
export async function startPitchWorker() {
  if (state.bragPitchWorker || process.env.BRAG_PITCH_WORKER_PAUSED === "1") return;
  const vault = await readCredentialVault();
  const audioDirectory = process.env.BRAG_PITCH_AUDIO_DIR || "";
  if (!vault || !isAbsolute(audioDirectory)) return;
  const { database } = await import("../database/client.ts");
  const db = await database();
  const tick = pitchWorker(db, { audioDirectory }, undefined, async (version) => {
    if (!version) throw new Error("Pitch configuration binding unavailable");
    const row = await db.processorConfig.findUniqueOrThrow({ where: { version } });
    return pitchProviders(pitchConfigFor(row, vault, audioDirectory));
  });
  let busy = false;
  state.bragPitchWorker = true;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      if (await isDatabaseReady(db)) await tick();
    } catch {
      /* Keep provider payloads, recordings and credentials out of logs. */
    } finally {
      busy = false;
    }
  };
  setInterval(() => void run(), 2000).unref();
  void run();
}
