import "server-only";
import type { Prisma } from "../../generated/prisma/client.ts";
import type { createDatabase } from "../database/client.ts";
import type { BragAuth } from "./config.ts";

export class AccessError extends Error {
  constructor(public status: 401 | 403 | 409 | 400) {
    super("Access unavailable");
  }
}
export async function currentAccount(
  auth: BragAuth,
  db: ReturnType<typeof createDatabase>,
  headers: Headers,
) {
  const result = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
  if (!result) return null;
  const user = await db.user.findUnique({
    where: { id: result.user.id },
    include: { platformRole: true },
  });
  if (!user?.active) return null;
  return {
    user: { id: user.id, name: user.name, email: user.email },
    can_admin: user.platformRole?.active === true,
  };
}

/** Holds the same user authority lock as role changes through the operation commit. */
export async function withAdmin<T>(
  auth: BragAuth,
  db: ReturnType<typeof createDatabase>,
  headers: Headers,
  action: (tx: Prisma.TransactionClient, actorId: string) => Promise<T>,
): Promise<T> {
  const result = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
  if (!result) throw new AccessError(401);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${result.user.id}, 1789))::text`;
    // Row locks order sign-out/disable against protected commits as well as role changes.
    const sessions = await tx.$queryRaw<{ id: string }[]>`
      SELECT s.id FROM brag.auth_session s JOIN brag.auth_user u ON u.id = s."userId"
      WHERE s.id = ${result.session.id} AND s."userId" = ${result.user.id}
        AND s."expiresAt" > clock_timestamp() AND u.active
      FOR SHARE OF s, u`;
    if (!sessions.length) throw new AccessError(401);
    const role = await tx.platformRole.findUnique({ where: { userId: result.user.id } });
    if (!role?.active) throw new AccessError(403);
    const value = await action(tx, result.user.id);
    const remaining = await tx.$queryRaw<{ valid: boolean }[]>`
      SELECT "expiresAt" > clock_timestamp() AS valid FROM brag.auth_session
      WHERE id = ${result.session.id}`;
    if (!remaining[0]?.valid) throw new AccessError(401);
    return value;
  });
}

/** Ordinary authenticated author; authorization is checked inside every draft operation. */
export async function withUser<T>(
  auth: BragAuth,
  db: ReturnType<typeof createDatabase>,
  headers: Headers,
  action: (tx: Prisma.TransactionClient, actorId: string) => Promise<T>,
): Promise<T> {
  const result = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
  if (!result) throw new AccessError(401);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${result.user.id}, 1789))::text`;
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT s.id FROM brag.auth_session s JOIN brag.auth_user u ON u.id = s."userId" WHERE s.id = ${result.session.id} AND s."userId" = ${result.user.id} AND s."expiresAt" > clock_timestamp() AND u.active FOR SHARE OF s,u`;
    if (!rows.length) throw new AccessError(401);
    const value = await action(tx, result.user.id);
    const remaining = await tx.$queryRaw<
      { valid: boolean }[]
    >`SELECT "expiresAt" > clock_timestamp() AS valid FROM brag.auth_session WHERE id = ${result.session.id}`;
    if (!remaining[0]?.valid) throw new AccessError(401);
    return value;
  });
}
