import "server-only";
import type { BragAuth } from "../auth/config.ts";
import type { createDatabase } from "../database/client.ts";
import type { PitchConfig } from "./providers.ts";
import { withUser } from "../auth/access.ts";
import { uuid } from "../events/validation.ts";
import {
  admission,
  lockTarget,
  mutationReceipt,
  now,
  requireContract,
  writeReceipt,
  CAPTURE_CONTRACT,
} from "../sharing/admission.ts";
import { object, ProjectError } from "./validation.ts";
import { pitchView } from "./view.ts";
import { recoveryInfo } from "./recovery.ts";

export function recordingRecoveryOperations(
  auth: BragAuth,
  db: ReturnType<typeof createDatabase>,
  config: PitchConfig | null,
) {
  return {
    retryRecording(headers: Headers, id: string, key: string | null, input: unknown) {
      return withUser(auth, db, headers, async (tx, owner) => {
        if (!uuid(id)) throw new ProjectError(404, "draft_unavailable");
        const before = await tx.voicePitch.findFirst({ where: { id, ownerId: owner } });
        if (!before) throw new ProjectError(404, "draft_unavailable");
        const data = object(input, ["expected_version", "transcription_attempt"]);
        if (
          !Number.isInteger(data.expected_version) ||
          !Number.isInteger(data.transcription_attempt)
        )
          throw new ProjectError(400, "invalid_request");
        // Same config/global-budget/event/draft/pitch order as intake and settings writers.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(914706)::text`;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(914705)::text`;
        const draft = await lockTarget(tx, owner, before.draftId);
        await tx.$queryRaw`SELECT id FROM brag.voice_pitch WHERE id=${id}::uuid FOR UPDATE`;
        let pitch = await tx.voicePitch.findUniqueOrThrow({ where: { id } });
        const receipt = await mutationReceipt(tx, owner, key, [
          CAPTURE_CONTRACT,
          "retry-recording",
          id,
          data.expected_version,
          data.transcription_attempt,
        ]);
        if (!receipt.previous) {
          requireContract(headers);
          const latest = await tx.voicePitch.findFirst({
            where: { draftId: draft.id, ownerId: owner },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          });
          if (
            latest?.id !== id ||
            draft.version !== data.expected_version ||
            draft.version !== pitch.baseVersion ||
            pitch.transcriptionAttempt !== data.transcription_attempt
          )
            throw new ProjectError(409, "version_conflict");
          if (
            await tx.agentProposal.count({
              where: {
                draftId: draft.id,
                baseVersion: draft.version,
                acceptedVersion: null,
                clearedAt: null,
                retentionDeadline: { gt: await now(tx) },
              },
            })
          )
            throw new ProjectError(409, "capture_conflict");
          const check = await admission(tx, owner, draft.eventId, "new_submission");
          const at = await now(tx),
            info = await recoveryInfo(tx, pitch, at, config);
          if (!info.audio_available) throw new ProjectError(409, "recording_unavailable");
          if (info.configuration_required) throw new ProjectError(503, "voice_unavailable");
          if (!info.can_retry) throw new ProjectError(409, "recording_retry_unavailable");
          const day = new Date(at.getTime() - 86400000);
          const daily = await tx.draftMutation.count({
            where: {
              actorId: owner,
              createdAt: { gte: day },
              result: { path: ["operation"], equals: "retry-recording" },
            },
          });
          const global = await tx.draftMutation.count({
            where: {
              createdAt: { gte: day },
              result: { path: ["operation"], equals: "retry-recording" },
            },
          });
          if (daily >= 30 || global >= 600) throw new ProjectError(429, "pitch_limit");
          pitch = await tx.voicePitch.update({
            where: { id },
            data: {
              status: "queued",
              recoveryConfigVersion: config?.revision ?? null,
              transcriptionAttempt: { increment: 1 },
              transcriptionStartedAt: at,
              nextAttempt: at,
              leaseUntil: null,
              error: null,
            },
          });
          await writeReceipt(tx, owner, receipt, {
            operation: "retry-recording",
            pitch_id: id,
            transcription_attempt: pitch.transcriptionAttempt,
            config_version: config?.revision ?? null,
            admitted_at: at.toISOString(),
          });
          await check();
          if (new Date(info.expires_at) <= (await now(tx)))
            throw new ProjectError(409, "recording_unavailable");
        }
        const at = await now(tx);
        return {
          pitch: { ...pitchView(pitch, at), recovery: await recoveryInfo(tx, pitch, at, config) },
        };
      });
    },
  };
}
