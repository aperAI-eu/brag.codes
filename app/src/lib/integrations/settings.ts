import "server-only";
import { isAbsolute } from "node:path";
import { isIP } from "node:net";
import type { ProcessorConfig, Prisma } from "../../generated/prisma/client.ts";
import type { IntegrationView, IntegrationInput } from "../../integrations/model.ts";
import type { createDatabase } from "../database/client.ts";
import type { BragAuth } from "../auth/config.ts";
import { withAdmin } from "../auth/access.ts";
import { readCredentialVault, type CredentialVault } from "../config/vault.ts";
import type { PitchConfig } from "../config/pitch.ts";
import { uuid } from "../events/validation.ts";

type DB = ReturnType<typeof createDatabase>;
type Secrets = { distill_token: string | null; anthropic_key: string | null };
export class SettingsError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function settingsInput(input: unknown): IntegrationInput {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new SettingsError(400, "invalid_settings");
  const x = input as Record<string, unknown>;
  if (
    Object.keys(x).some(
      (k) =>
        ![
          "expected_version",
          "enabled",
          "distill_origin",
          "claude_model",
          "distill_token",
          "anthropic_key",
        ].includes(k),
    ) ||
    !Number.isSafeInteger(x.expected_version) ||
    Number(x.expected_version) < 0 ||
    typeof x.enabled !== "boolean"
  )
    throw new SettingsError(400, "invalid_settings");
  if (
    typeof x.distill_origin !== "string" ||
    x.distill_origin.length > 2048 ||
    typeof x.claude_model !== "string"
  )
    throw new SettingsError(400, "invalid_settings");
  let origin = x.distill_origin.trim();
  if (origin) {
    try {
      const url = new URL(origin);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        url.port ||
        isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
        !url.hostname.includes(".") ||
        /\.(localhost|local|internal)$/.test(url.hostname)
      )
        throw new Error();
      origin = url.origin;
    } catch {
      throw new SettingsError(422, "invalid_distill_origin");
    }
  }
  const model = x.claude_model.trim();
  if (model && (!/^claude-[a-z0-9-]{3,80}$/.test(model) || model.endsWith("latest")))
    throw new SettingsError(422, "invalid_claude_model");
  const result: IntegrationInput = {
    expected_version: Number(x.expected_version),
    enabled: x.enabled,
    distill_origin: origin,
    claude_model: model,
  };
  for (const field of ["distill_token", "anthropic_key"] as const) {
    const value = x[field];
    if (value === undefined) continue;
    if (value !== null && (typeof value !== "string" || !/^[\x21-\x7e]{16,8192}$/.test(value)))
      throw new SettingsError(422, "invalid_credential");
    result[field] = value as string | null;
  }
  return result;
}
export const configContext = (
  row: Pick<ProcessorConfig, "version" | "actorId" | "distillOrigin" | "claudeModel" | "enabled">,
) => JSON.stringify([row.version, row.actorId, row.distillOrigin, row.claudeModel, row.enabled]);
export function configSecrets(row: ProcessorConfig, vault: CredentialVault): Secrets {
  const secrets = vault.unseal(row.sealed, configContext(row)) as Secrets;
  if (
    !secrets ||
    typeof secrets !== "object" ||
    Object.keys(secrets).sort().join() !== "anthropic_key,distill_token"
  )
    throw new Error("Credential storage unavailable");
  for (const key of ["distill_token", "anthropic_key"] as const) {
    if (
      secrets[key] !== null &&
      (typeof secrets[key] !== "string" || !/^[\x21-\x7e]{16,8192}$/.test(secrets[key]!))
    )
      throw new Error("Credential storage unavailable");
  }
  return secrets;
}
function summary(row: ProcessorConfig | null, ready: boolean): IntegrationView {
  return {
    version: row?.version ?? 0,
    storage_ready: ready,
    enabled: row?.enabled ?? false,
    distill_origin: row?.distillOrigin ?? "",
    claude_model: row?.claudeModel ?? "",
    distill_token_saved: row?.hasDistill ?? false,
    anthropic_key_saved: row?.hasClaude ?? false,
    updated_at: row?.createdAt.toISOString() ?? null,
    updated_by: row?.actorId ?? null,
  };
}
export function integrationOperations(auth: BragAuth, db: DB, vault: CredentialVault | null) {
  const latest = (tx: Prisma.TransactionClient) =>
    tx.processorConfig.findFirst({ orderBy: { version: "desc" } });
  return {
    read(headers: Headers) {
      return withAdmin(auth, db, headers, async (tx) => {
        const row = await latest(tx);
        let ready = !!vault;
        if (row && vault) {
          try {
            configSecrets(row, vault);
          } catch {
            ready = false;
          }
        }
        return { settings: summary(row, ready) };
      });
    },
    save(headers: Headers, requestId: string | null, input: unknown) {
      return withAdmin(auth, db, headers, async (tx, actorId) => {
        if (!vault) throw new SettingsError(503, "credential_storage_unavailable");
        if (!uuid(requestId)) throw new SettingsError(400, "idempotency_key_required");
        const data = settingsInput(input);
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(914706)::text`;
        const current = await latest(tx),
          intentHmac = vault.intent(data);
        const saved = await tx.processorConfig.findUnique({
          where: { actorId_requestId: { actorId, requestId } },
        });
        if (saved) {
          if (saved.intentHmac !== intentHmac) throw new SettingsError(409, "idempotency_conflict");
          return { settings: summary(current, true) };
        }
        if (data.expected_version !== (current?.version ?? 0))
          throw new SettingsError(409, "version_conflict");
        const secrets = current
          ? configSecrets(current, vault)
          : { distill_token: null, anthropic_key: null };
        // Changing the recipient requires deliberately re-entering its token.
        if (
          current?.hasDistill &&
          data.distill_origin !== current.distillOrigin &&
          data.distill_token === undefined
        )
          throw new SettingsError(422, "distill_token_required_for_origin_change");
        for (const field of ["distill_token", "anthropic_key"] as const)
          if (data[field] !== undefined) secrets[field] = data[field]!;
        if (
          data.enabled &&
          (!secrets.distill_token ||
            !secrets.anthropic_key ||
            !data.distill_origin ||
            !data.claude_model)
        )
          throw new SettingsError(422, "configuration_incomplete");
        const version = (current?.version ?? 0) + 1;
        const context = {
          version,
          actorId,
          distillOrigin: data.distill_origin,
          claudeModel: data.claude_model,
          enabled: data.enabled,
        };
        const row = await tx.processorConfig.create({
          data: {
            ...context,
            requestId,
            intentHmac,
            enabled: data.enabled,
            hasDistill: !!secrets.distill_token,
            hasClaude: !!secrets.anthropic_key,
            sealed: vault.seal(secrets, configContext(context)),
            changedFields: Object.keys(data).filter((k) => k !== "expected_version"),
          },
        });
        return { settings: summary(row, true) };
      });
    },
  };
}
export function pitchConfigFor(
  row: ProcessorConfig,
  vault: CredentialVault,
  audioDirectory: string,
): PitchConfig {
  if (!isAbsolute(audioDirectory)) throw new Error("Private pitch directory unavailable");
  const secrets = configSecrets(row, vault);
  if (!secrets.distill_token || !secrets.anthropic_key || !row.distillOrigin || !row.claudeModel)
    throw new Error("Processor configuration incomplete");
  return {
    revision: row.version,
    distillOrigin: row.distillOrigin,
    model: row.claudeModel,
    distillToken: secrets.distill_token,
    anthropicKey: secrets.anthropic_key,
    audioDirectory,
  };
}
export async function activePitchConfig(db: DB): Promise<PitchConfig | null> {
  try {
    const row = await db.processorConfig.findFirst({ orderBy: { version: "desc" } });
    if (!row?.enabled) return null;
    const vault = await readCredentialVault();
    return vault ? pitchConfigFor(row, vault, process.env.BRAG_PITCH_AUDIO_DIR || "") : null;
  } catch {
    return null;
  }
}
