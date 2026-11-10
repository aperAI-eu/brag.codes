import { createHash } from "node:crypto";
import type { createDatabase } from "../database/client.ts";
import { AccessError } from "../auth/access.ts";

export type RoleCommand = {
  requestId: string;
  environment: "local" | "test" | "production";
  action: "bootstrap" | "grant" | "revoke";
  userId: string;
  expectedVersion: number;
  operator: string;
  reason: string;
  evidence: string;
} & (
  | { googleSubject: string; providerId?: never; providerSubject?: never }
  | { googleSubject?: never; providerId: "google" | "github"; providerSubject: string }
);
export function parseRoleCommand(input: unknown): RoleCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AccessError(400);
  const value = input as Record<string, unknown>;
  const legacy = "googleSubject" in value;
  const identityKeys = legacy ? ["googleSubject"] : ["providerId", "providerSubject"];
  const keys = [
    "requestId",
    "environment",
    "action",
    "userId",
    "expectedVersion",
    "operator",
    "reason",
    "evidence",
    ...identityKeys,
  ];
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !(key in value)) ||
    !["local", "test", "production"].includes(String(value.environment)) ||
    !["bootstrap", "grant", "revoke"].includes(String(value.action)) ||
    !Number.isSafeInteger(value.expectedVersion) ||
    Number(value.expectedVersion) < 0 ||
    !/^[0-9a-f-]{36}$/i.test(String(value.requestId)) ||
    !/^[0-9a-f-]{36}$/i.test(String(value.userId)) ||
    (!legacy && !["google", "github"].includes(String(value.providerId))) ||
    ["operator", "reason", "evidence", ...identityKeys].some(
      (key) =>
        typeof value[key] !== "string" ||
        !value[key].trim() ||
        value[key].length > 500 ||
        /[\p{Cc}\p{Cf}]/u.test(value[key]),
    )
  )
    throw new AccessError(400);
  // Canonical order makes exact retries independent of JSON property order.
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as RoleCommand;
}

/** Operator-only; application credentials cannot write roles or audit receipts. */
export async function administerRole(
  db: ReturnType<typeof createDatabase>,
  input: unknown,
  setup: { environment: string; bootstrapEmail?: string; bootstrapUserId?: string },
) {
  const command = parseRoleCommand(input);
  if (command.environment !== setup.environment) throw new AccessError(400);
  const provider = command.providerId ?? "google";
  const subject = command.providerSubject ?? command.googleSubject;
  const issuer = provider === "google" ? "https://accounts.google.com" : "https://github.com";
  const hash = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  return db.$transaction(async (tx) => {
    const roles = await tx.$queryRaw<{ role: string }[]>`SELECT current_user AS role`;
    if (roles[0]?.role !== "brag_operator") throw new AccessError(403);
    // Global operator lock serializes bootstrap and request-id collisions. Admin
    // operations share the per-user lock so revocation cannot race their commit.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(1789001)::text`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${command.userId}, 1789))::text`;
    const receipt = await tx.roleAudit.findUnique({ where: { requestId: command.requestId } });
    if (receipt) {
      if (receipt.commandHash !== hash) throw new AccessError(409);
      return {
        requestId: receipt.requestId,
        userId: receipt.userId,
        version: receipt.version,
        action: receipt.action,
        replay: true,
      };
    }
    const user = await tx.user.findUnique({
      where: { id: command.userId },
      include: { accounts: true, platformRole: true },
    });
    if (
      !user?.active ||
      !user.accounts.some(
        (account) =>
          account.providerId === provider &&
          account.issuer === issuer &&
          account.accountId === subject,
      )
    )
      throw new AccessError(403);
    if ((user.platformRole?.version ?? 0) !== command.expectedVersion) throw new AccessError(409);
    if (command.action === "bootstrap") {
      if (
        (provider === "google"
          ? !setup.bootstrapEmail || user.email.toLowerCase() !== setup.bootstrapEmail.toLowerCase()
          : !setup.bootstrapUserId || user.id !== setup.bootstrapUserId) ||
        !user.emailVerified ||
        user.platformRole ||
        (await tx.roleAudit.findFirst({ where: { action: "bootstrap" } }))
      )
        throw new AccessError(409);
    }
    if (command.action === "revoke" && !user.platformRole?.active) throw new AccessError(409);
    if (command.action !== "revoke" && user.platformRole?.active) throw new AccessError(409);
    const version = command.expectedVersion + 1;
    const data = { active: command.action !== "revoke", version, updatedAt: new Date() };
    if (user.platformRole) await tx.platformRole.update({ where: { userId: user.id }, data });
    else await tx.platformRole.create({ data: { userId: user.id, ...data } });
    await tx.roleAudit.create({
      data: {
        requestId: command.requestId,
        userId: user.id,
        action: command.action,
        version,
        operator: command.operator,
        reason: command.reason,
        evidence: command.evidence,
        commandHash: hash,
      },
    });
    return {
      requestId: command.requestId,
      userId: user.id,
      version,
      action: command.action,
      replay: false,
    };
  });
}
