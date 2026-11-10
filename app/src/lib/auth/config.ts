import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { APIError, createAuthMiddleware, addOAuthServerContext } from "better-auth/api";
import type { createDatabase } from "../database/client.ts";
import type { RuntimeConfig } from "../config/runtime.ts";
import { githubBoundary } from "./github.ts";
import { googleBoundary } from "./google.ts";
import { authDiagnostic, authLibraryDiagnostic } from "./diagnostics.ts";

export function createAuth(db: ReturnType<typeof createDatabase>, config: RuntimeConfig) {
  const discardTokens = {
    accessToken: null,
    refreshToken: null,
    idToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
  };
  return betterAuth({
    appName: "brag.codes",
    baseURL: config.origin,
    basePath: "/api/auth",
    secret: config.authSecret,
    trustedOrigins: [config.origin],
    database: prismaAdapter(db, { provider: "postgresql", transaction: true }),
    emailAndPassword: { enabled: false },
    socialProviders: {
      ...(config.google
        ? {
            google: {
              ...config.google,
              disableIdTokenSignIn: true,
              disableDefaultScope: true,
              scope: ["openid", "profile", "email"],
              includeGrantedScopes: false,
              prompt: "select_account",
            },
          }
        : {}),
      ...(config.github
        ? {
            github: {
              ...config.github,
              disableDefaultScope: true,
              scope: ["read:user", "user:email"],
              disableIdTokenSignIn: true,
            },
          }
        : {}),
    },
    account: {
      additionalFields: { issuer: { type: "string", input: false } },
      storeStateStrategy: "database",
      encryptOAuthTokens: true,
      updateAccountOnSignIn: false,
      accountLinking: { enabled: false, disableImplicitLinking: true },
    },
    user: { additionalFields: { active: { type: "boolean", defaultValue: true, input: false } } },
    session: { expiresIn: 7 * 86400, disableSessionRefresh: true, cookieCache: { enabled: false } },
    advanced: {
      database: { generateId: "uuid" },
      cookiePrefix: "brag",
      useSecureCookies: config.origin.startsWith("https:"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      ipAddress: { ipAddressHeaders: [] },
    },
    // Application transport applies a shared atomic throttle without trusting forwarded IPs.
    rateLimit: { enabled: false },
    databaseHooks: {
      account: {
        create: {
          before: async (account) => {
            const issuer =
              account.providerId === "google" && config.google
                ? "https://accounts.google.com"
                : account.providerId === "github" && config.github
                  ? "https://github.com"
                  : null;
            if (!issuer) return false;
            return { data: { ...account, ...discardTokens, issuer } };
          },
        },
        update: { before: async (account) => ({ data: { ...account, ...discardTokens } }) },
      },
      session: {
        create: {
          before: async (session) => {
            const user = await db.user.findUnique({ where: { id: session.userId } });
            return user?.active ? { data: session } : false;
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/social") {
          const provider = ctx.body?.provider;
          if (
            !(
              (provider === "google" && config.google) ||
              (provider === "github" && config.github)
            ) ||
            ctx.body?.idToken
          )
            throw new APIError("BAD_REQUEST", { message: "Provider unavailable" });
          await addOAuthServerContext({ provider });
        } else if (!["/get-session", "/sign-out", "/callback/:id"].includes(ctx.path)) {
          throw new APIError("FORBIDDEN", { message: "Operation unavailable" });
        }
        if (ctx.path.startsWith("/callback/")) {
          const state = ctx.query?.state;
          const cookie = await ctx.getSignedCookie(
            ctx.context.createAuthCookie("state").name,
            ctx.context.secret,
          );
          if (typeof state !== "string" || state.length > 256 || cookie !== state) {
            authDiagnostic("callback_cookie");
            throw new APIError("UNAUTHORIZED", { message: "Invalid sign-in flow" });
          }
          const flow = await db.verification.findUnique({
            where: { identifier: `auth-state:${state}` },
          });
          const provider = ctx.params?.id;
          if (
            !flow ||
            JSON.parse(flow.value).serverContext?.provider !== provider ||
            !((provider === "google" && config.google) || (provider === "github" && config.github))
          ) {
            authDiagnostic("callback_provider");
            throw new APIError("UNAUTHORIZED", { message: "Invalid sign-in provider" });
          }
          // Better Auth reads then deletes state. Claim it atomically first, so concurrent
          // callbacks cannot both redeem one flow. Invalid browsers cannot claim it.
          const changed = await db.verification.updateMany({
            where: {
              identifier: `auth-state:${state}`,
              claimed: false,
              expiresAt: { gt: new Date() },
            },
            data: { claimed: true },
          });
          if (changed.count !== 1) {
            authDiagnostic("callback_expired");
            throw new APIError("UNAUTHORIZED", { message: "Expired sign-in flow" });
          }
        }
      }),
    },
    plugins: [
      ...(config.google ? [googleBoundary(config.google)] : []),
      ...(config.github ? [githubBoundary(config.github)] : []),
    ],
    // Re-throw to our sanitized boundary; Better Call otherwise prints raw DB
    // errors (which may include OAuth state/token material) after its error hook.
    onAPIError: { errorURL: config.origin + "/sign-in?auth=failed", throw: true },
    logger: { level: "error", log: authLibraryDiagnostic },
  });
}
export type BragAuth = ReturnType<typeof createAuth>;
