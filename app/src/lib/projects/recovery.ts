import "server-only";
import type { VoicePitch } from "../../generated/prisma/client.ts";
import type { PitchConfig } from "./providers.ts";
import type { Tx } from "../sharing/admission.ts";
import { audioStore } from "./storage.ts";

export const retainedFailure = (error: string | null) =>
  ["transcription_rejected", "transcription_configuration", "configuration_unavailable"].includes(
    error ?? "",
  );

export async function recoveryInfo(
  tx: Tx,
  pitch: VoicePitch,
  at: Date,
  config: PitchConfig | null,
) {
  const expiry = new Date(pitch.createdAt.getTime() + 86400000);
  const directory = config?.audioDirectory || process.env.BRAG_PITCH_AUDIO_DIR;
  const audio =
    !pitch.audioRemovedAt &&
    !["cancelled", "ready"].includes(pitch.status) &&
    !pitch.transcript &&
    at < expiry &&
    !!directory &&
    (await audioStore(directory).exists(pitch.id));
  const current =
    config?.revision === undefined
      ? null
      : await tx.processorConfig.findFirst({ orderBy: { version: "desc" } });
  const configurationRequired =
    !config ||
    (config?.revision !== undefined &&
      (!current?.enabled || current.version !== config.revision)) ||
    (pitch.error === "transcription_configuration" &&
      (pitch.recoveryConfigVersion ?? pitch.configVersion) === (config?.revision ?? null));
  return {
    audio_available: audio,
    expires_at: expiry.toISOString(),
    can_retry:
      audio &&
      pitch.status === "failed" &&
      retainedFailure(pitch.error) &&
      !pitch.providerId &&
      !configurationRequired &&
      pitch.transcriptionAttempt < 4,
    configuration_required: configurationRequired,
    transcription_attempt: pitch.transcriptionAttempt,
  };
}
