import "server-only";
import { recordAdmission } from "../publication/admission.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import { createHash, randomUUID } from "node:crypto";
import type { BragAuth } from "../auth/config.ts";
import type { createDatabase } from "../database/client.ts";
import { withUser } from "../auth/access.ts";
import { uuid } from "../events/validation.ts";
import {
  admission,
  lockTarget,
  now,
  owned,
  requireContract,
  CAPTURE_CONTRACT,
  mutationReceipt,
  writeReceipt,
  type Tx,
} from "../sharing/admission.ts";
import {
  AUDIO_RATE,
  PITCH_POLICY,
  LEGACY_AUTO_PITCH_POLICY,
  LEGACY_PITCH_POLICY,
} from "../../projects/model.ts";
import { object, ProjectError, validateAudio } from "./validation.ts";
import { recoveryInfo } from "./recovery.ts";
import { pitchView } from "./view.ts";
import { audioStore } from "./storage.ts";
import type { PitchConfig } from "./providers.ts";

async function latest(tx: Tx, owner: string, draftId: string, id: string) {
  const row = await tx.voicePitch.findFirst({
    where: { draftId, ownerId: owner },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (row?.id !== id) throw new ProjectError(409, "version_conflict");
}
export function voiceOperations(
  auth: BragAuth,
  db: ReturnType<typeof createDatabase>,
  config: PitchConfig | null,
) {
  return {
    preflight(headers: Headers, id: string, key: string | null, version: number, policy: string) {
      return withUser(auth, db, headers, async (tx, owner) => {
        const draft = await owned(tx, owner, id);
        if (
          !uuid(key) ||
          !Number.isInteger(version) ||
          ![PITCH_POLICY, LEGACY_PITCH_POLICY, LEGACY_AUTO_PITCH_POLICY].includes(policy)
        )
          throw new ProjectError(400, "invalid_request");
        const receipt = await tx.voicePitch.findUnique({
          where: { ownerId_key: { ownerId: owner, key } },
        });
        if (receipt) return;
        requireContract(headers);
        if (policy !== PITCH_POLICY) throw new ProjectError(409, "capture_upgrade_required");
        const check = await admission(tx, owner, draft.eventId, "new_submission");
        if (draft.version !== version) throw new ProjectError(409, "version_conflict");
        if (
          await tx.agentProposal.count({
            where: {
              draftId: id,
              baseVersion: draft.version,
              acceptedVersion: null,
              clearedAt: null,
              retentionDeadline: { gt: await now(tx) },
            },
          })
        )
          throw new ProjectError(409, "capture_conflict");
        if (!config) throw new ProjectError(503, "voice_unavailable");
        await check();
      });
    },
    async upload(
      headers: Headers,
      id: string,
      key: string | null,
      version: number,
      policy: string,
      bytes: Buffer,
    ) {
      await this.preflight(headers, id, key, version, policy);
      const seconds = validateAudio(bytes, policy === PITCH_POLICY ? 30 : 20),
        mediaHash = createHash("sha256").update(bytes).digest("hex");
      const replay = await withUser(auth, db, headers, async (tx, owner) => {
        await owned(tx, owner, id);
        const row = await tx.voicePitch.findUnique({
          where: { ownerId_key: { ownerId: owner, key: key! } },
        });
        if (!row) return null;
        if (
          row.draftId !== id ||
          row.baseVersion !== version ||
          row.policy !== policy ||
          row.mediaHash !== mediaHash
        )
          throw new ProjectError(409, "idempotency_conflict");
        const at = await now(tx);
        return {
          pitch: { ...pitchView(row, at), recovery: await recoveryInfo(tx, row, at, config) },
        };
      });
      if (replay) return replay;
      if (!config) throw new ProjectError(503, "voice_unavailable");
      const pitchId = randomUUID(),
        store = audioStore(config.audioDirectory);
      let retained = false;
      await store.put(pitchId, bytes);
      try {
        const result = await withUser(auth, db, headers, async (tx, owner) => {
          await owned(tx, owner, id);
          const existing = await tx.voicePitch.findUnique({
            where: { ownerId_key: { ownerId: owner, key: key! } },
          });
          if (existing) {
            if (
              existing.draftId !== id ||
              existing.mediaHash !== mediaHash ||
              existing.baseVersion !== version ||
              existing.policy !== policy
            )
              throw new ProjectError(409, "idempotency_conflict");
            return { pitch: pitchView(existing, await now(tx)) };
          }
          requireContract(headers);
          if (config.revision !== undefined) {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(914706)::text`;
            const current = await tx.processorConfig.findFirst({ orderBy: { version: "desc" } });
            if (!current?.enabled || current.version !== config.revision)
              throw new ProjectError(409, "voice_configuration_changed");
          }
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(914705)::text`;
          const draft = await lockTarget(tx, owner, id);
          const check = await admission(tx, owner, draft.eventId, "new_submission");
          if (draft.version !== version) throw new ProjectError(409, "version_conflict");
          if (
            await tx.agentProposal.count({
              where: {
                draftId: id,
                baseVersion: draft.version,
                acceptedVersion: null,
                clearedAt: null,
                retentionDeadline: { gt: await now(tx) },
              },
            })
          )
            throw new ProjectError(409, "capture_conflict");
          const at = await now(tx),
            day = new Date(at.getTime() - 86400000);
          if (
            (await tx.voicePitch.count({ where: { ownerId: owner, createdAt: { gte: day } } })) >=
              10 ||
            (await tx.voicePitch.count({ where: { createdAt: { gte: day } } })) >= 200
          )
            throw new ProjectError(429, "pitch_limit");
          const recent = await tx.voicePitch.findFirst({
            where: { draftId: id },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          });
          if (
            recent &&
            [
              "queued",
              "dispatching",
              "transcribing",
              "structure_queued",
              "structuring",
              "uncertain",
            ].includes(pitchView(recent, at).status)
          )
            throw new ProjectError(409, "pitch_in_progress");
          const row = await tx.voicePitch.create({
            data: {
              id: pitchId,
              draftId: id,
              ownerId: owner,
              key: key!,
              mediaHash,
              baseVersion: version,
              policy,
              configVersion: config.revision ?? null,
              status: "queued",
              admittedAt: at,
              sampleCount: Math.round(seconds * AUDIO_RATE),
            },
          });
          await recordAdmission(tx, id, owner, "voice", row.id);
          await check();
          return { pitch: pitchView(row, at) };
        });
        retained = result.pitch.id === pitchId;
        return result;
      } finally {
        if (!retained) await store.remove(pitchId);
      }
    },
    pitch(headers: Headers, id: string) {
      return withUser(auth, db, headers, async (tx, owner) => {
        if (!uuid(id)) throw new ProjectError(404, "draft_unavailable");
        const row = await tx.voicePitch.findFirst({ where: { id, ownerId: owner } });
        if (!row) throw new ProjectError(404, "draft_unavailable");
        await owned(tx, owner, row.draftId);
        const at = await now(tx);
        return {
          pitch: { ...pitchView(row, at), recovery: await recoveryInfo(tx, row, at, config) },
        };
      });
    },
    changePitch(headers: Headers, id: string, key: string | null, input: unknown, cancel = false) {
      return withUser(auth, db, headers, async (tx, owner) => {
        if (!uuid(id)) throw new ProjectError(404, "draft_unavailable");
        const before = await tx.voicePitch.findFirst({ where: { id, ownerId: owner } });
        if (!before) throw new ProjectError(404, "draft_unavailable");
        const draft = await lockTarget(tx, owner, before.draftId);
        await tx.$queryRaw`SELECT id FROM brag.voice_pitch WHERE id=${id}::uuid FOR UPDATE`;
        const pitch = await tx.voicePitch.findUniqueOrThrow({ where: { id } }),
          data = object(input, cancel ? [] : ["transcript"]);
        const current = headers.get("x-capture-contract") === CAPTURE_CONTRACT;
        const intent = [cancel ? "cancel" : "structure", id, data.transcript ?? null];
        const receipt = await mutationReceipt(
          tx,
          owner,
          key,
          !cancel && current ? [CAPTURE_CONTRACT, ...intent] : intent,
        );
        if (!receipt.previous) {
          let check: (() => Promise<Date>) | null = null;
          if (!cancel) {
            requireContract(headers);
            await latest(tx, owner, draft.id, id);
            if (
              !config ||
              typeof data.transcript !== "string" ||
              !data.transcript.trim() ||
              data.transcript.length > 12000
            )
              throw new ProjectError(422, "invalid_transcript");
            const effective = pitchView(pitch, await now(tx));
            if (draft.version !== pitch.baseVersion)
              throw new ProjectError(409, "version_conflict");
            if (
              !effective.transcript ||
              !["ready", "failed"].includes(effective.status) ||
              pitch.attempts >= 4
            )
              throw new ProjectError(409, "pitch_in_progress");
            check = await admission(tx, owner, draft.eventId, "new_submission");
          }
          if (cancel)
            await tx.$executeRaw`UPDATE brag.voice_pitch SET status='cancelled',transcript='',original=NULL,corrected=NULL,proposal=NULL,lease_until=NULL,cleanup_pending=(provider_id IS NOT NULL),updated_at=clock_timestamp() WHERE id=${id}::uuid`;
          else
            await tx.voicePitch.update({
              where: { id },
              data: {
                status: "structure_queued",
                transcript: (data.transcript as string).trim(),
                proposal: Prisma.DbNull,
                leaseUntil: null,
                error: null,
                nextAttempt: await now(tx),
                updatedAt: await now(tx),
              },
            });
          const at = check ? await check() : await now(tx);
          await writeReceipt(tx, owner, receipt, {
            pitch_id: id,
            ...(!cancel ? { admitted_at: at.toISOString() } : {}),
          });
          if (check) await check();
        }
        return {
          pitch: pitchView(await tx.voicePitch.findUniqueOrThrow({ where: { id } }), await now(tx)),
        };
      });
    },
  };
}
