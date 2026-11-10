import "server-only";
import type { BragAuth } from "../auth/config.ts";
import type { createDatabase } from "../database/client.ts";
import type { PitchConfig } from "./providers.ts";
import { recordingRecoveryOperations } from "./retry-recording.ts";
import { draftOperations } from "./drafts.ts";
import { voiceOperations } from "./voice.ts";
export { pitchView } from "./view.ts";

export function projectOperations(
  auth: BragAuth,
  db: ReturnType<typeof createDatabase>,
  config: PitchConfig | null,
  origin = process.env.APP_ORIGIN || "http://localhost:3200",
) {
  return {
    ...draftOperations(auth, db, origin, !!config, config),
    ...voiceOperations(auth, db, config),
    ...recordingRecoveryOperations(auth, db, config),
  };
}
