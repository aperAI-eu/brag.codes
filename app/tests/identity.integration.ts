import { integrationChecks } from "./integrations.integration.ts";
import { projectChecks } from "./projects.integration.ts";
import { eventChecks } from "./events.integration.ts";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import type pg from "pg";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { chromium, expect } from "@playwright/test";
import { createDatabase } from "../src/lib/database/client.ts";
import { createAuth } from "../src/lib/auth/config.ts";
import { identityHandler } from "../src/lib/auth/handler.ts";
import { AccessError, withAdmin } from "../src/lib/auth/access.ts";
import { administerRole, type RoleCommand } from "../src/lib/administration/roles.ts";

type Fixture = {
  baseUrl: string;
  runtimeUrl: string;
  operatorUrl: string;
  authFile: string;
  container: string;
};
function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .filter((value) => !value.endsWith("="))
    .join("; ");
}

export async function identityChecks(
  t: TestContext,
  fixture: Fixture,
  db: ReturnType<typeof createDatabase>,
  admin: pg.Client,
  runtime: pg.Client,
) {
  const config = {
    environment: "local" as const,
    origin: fixture.baseUrl,
    databaseUrl: fixture.runtimeUrl,
    authSecret: await readFile(fixture.authFile, "utf8"),
    google: {
      clientId: "brag-fixture.apps.googleusercontent.com",
      clientSecret: "test-only-provider-secret",
    },
  };
  const auth = createAuth(db, config);
  const handle = identityHandler(auth, db, config);
  const operator = createDatabase(fixture.operatorUrl);
  const originalFetch = globalThis.fetch;
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const wrongKey = (await generateKeyPair("RS256")).privateKey;
  const jwk = { ...(await exportJWK(publicKey)), kid: "brag-fixture", alg: "RS256", use: "sig" };
  const codes = new Map<
    string,
    { nonce: string; challenge: string; claims: Record<string, unknown> }
  >();
  let exchanges = 0;
  // Test-process-only provider transport. Production has no test provider, key,
  // identity route or switch; the actual signed-token verifier runs unchanged.
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url === "https://www.googleapis.com/oauth2/v3/certs")
      return Response.json({ keys: [jwk] });
    if (request.url === "https://oauth2.googleapis.com/token") {
      exchanges++;
      const body = new URLSearchParams(await request.text());
      const flow = codes.get(body.get("code") || "");
      assert.ok(flow, "only known synthetic codes reach the test token endpoint");
      assert.equal(body.get("redirect_uri"), config.origin + "/api/auth/callback/google");
      assert.equal(
        createHash("sha256")
          .update(body.get("code_verifier") || "")
          .digest("base64url"),
        flow.challenge,
      );
      const jwt = await new SignJWT({
        nonce: flow.nonce,
        email: "owner@example.test",
        email_verified: true,
        name: "Fixture Owner",
        ...flow.claims,
      })
        .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
        .setSubject(String(flow.claims.sub || "google-owner-subject"))
        .setIssuer(String(flow.claims.iss || "https://accounts.google.com"))
        .setAudience(String(flow.claims.aud || config.google.clientId))
        .setIssuedAt()
        .setExpirationTime(flow.claims.exp === 1 ? 1 : "5m")
        .sign(flow.claims.badSignature ? wrongKey : privateKey);
      return Response.json({
        access_token: "discard-provider-access-token",
        refresh_token: "discard-provider-refresh-token",
        token_type: "Bearer",
        expires_in: 3600,
        id_token: jwt,
      });
    }
    if (
      request.url.startsWith("https://accounts.google.com") ||
      request.url.startsWith("https://oauth2.googleapis.com")
    )
      throw new Error("Unexpected provider request in isolated test");
    return originalFetch(input, init);
  };
  const post = (path: string, body: unknown = {}, cookie = "", origin = config.origin) =>
    handle(
      new Request(config.origin + path, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(body),
      }),
    );
  const get = (path: string, cookie = "") =>
    handle(new Request(config.origin + path, { headers: { Cookie: cookie } }));
  async function begin(claims: Record<string, unknown> = {}, returnTo = "/admin") {
    const response = await post("/api/v1/auth/providers/google/start", {
      intent: "sign_in",
      return_to: returnTo,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    const url = new URL((await response.json()).url);
    assert.equal(url.origin, "https://accounts.google.com");
    assert.deepEqual(
      new Set(url.searchParams.get("scope")!.split(" ")),
      new Set(["openid", "profile", "email"]),
    );
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.ok(url.searchParams.get("nonce"));
    const code = randomUUID();
    codes.set(code, {
      nonce: url.searchParams.get("nonce")!,
      challenge: url.searchParams.get("code_challenge")!,
      claims,
    });
    return {
      cookie: cookies(response),
      path: `/api/auth/callback/google?code=${code}&state=${url.searchParams.get("state")}`,
      state: url.searchParams.get("state")!,
    };
  }
  let sessionCookie = "",
    userId = "";
  let command: RoleCommand;
  const setup = { environment: "local", bootstrapEmail: "owner@example.test" };
  try {
    await t.test(
      "HTTP boundary rejects CSRF, role input, oversized payloads and unqualified auth endpoints",
      async () => {
        assert.equal(
          (await post("/api/v1/auth/providers/google/start", {}, "", "https://evil.test")).status,
          403,
        );
        assert.equal(
          (await post("/api/v1/auth/providers/google/start", { role: "platform_admin" })).status,
          400,
        );
        assert.equal(
          (await post("/api/v1/auth/providers/google/start", { intent: "link" })).status,
          400,
        );
        assert.equal(
          (await post("/api/v1/auth/providers/google/start", { return_to: "a".repeat(5000) }))
            .status,
          400,
        );
        for (const path of [
          "/api/auth/sign-in/social",
          "/api/auth/sign-up/email",
          "/api/auth/update-user",
          "/api/auth/link-social",
          "/api/v1/admin/roles",
        ])
          assert.equal((await post(path)).status, 404);
        assert.equal((await get("/api/v1/admin/access")).status, 401);
        let called = false;
        await assert.rejects(
          withAdmin(auth, db, new Headers(), async () => {
            called = true;
          }),
          (error: AccessError) => error.status === 401,
        );
        assert.equal(called, false);
        const providers = await (
          await originalFetch(config.origin + "/api/v1/auth/providers")
        ).json();
        assert.ok(providers.providers.every((p: { enabled: boolean }) => !p.enabled));
        for (const path of ["/sign-in", "/account", "/admin"])
          assert.match(
            (await originalFetch(config.origin + path)).headers.get("cache-control") || "",
            /no-store/,
          );
      },
    );
    await t.test(
      "Google callback verifies signed claims, nonce and browser binding; rejects replay and unsafe return",
      async () => {
        for (const claims of [
          { nonce: "wrong" },
          { iss: "https://evil.test" },
          { aud: "wrong-client" },
          { exp: 1 },
          { email_verified: false },
          { badSignature: true },
        ]) {
          const flow = await begin(claims);
          const response = await get(flow.path, flow.cookie);
          assert.equal(
            response.headers.get("location"),
            config.origin + "/sign-in?auth=failed&return_to=%2Fadmin",
          );
          assert.ok(!cookies(response).includes("session_token="));
        }
        assert.equal(await db.user.count(), 0);
        const expired = await begin();
        await admin.query(
          "UPDATE brag.auth_verification SET \"expiresAt\" = now() - interval '1 minute' WHERE identifier = $1",
          [`auth-state:${expired.state}`],
        );
        const beforeExpired = exchanges;
        assert.match(
          (await get(expired.path, expired.cookie)).headers.get("location")!,
          /auth=failed/,
        );
        assert.equal(exchanges, beforeExpired);
        const cancelled = await begin();
        assert.equal(
          (
            await get(
              cancelled.path + "&error=access_denied&error_description=never-reflect-this",
              cancelled.cookie,
            )
          ).headers.get("location"),
          config.origin + "/sign-in?auth=cancelled&return_to=%2Fadmin",
        );
        const flow = await begin({}, "https://evil.test/steal");
        const countBefore = exchanges;
        assert.equal(
          (await get(flow.path)).headers.get("location"),
          config.origin + "/sign-in?auth=failed",
        );
        assert.equal(exchanges, countBefore);
        const results = await Promise.all([
          get(flow.path, flow.cookie),
          get(flow.path, flow.cookie),
        ]);
        assert.equal(exchanges, countBefore + 1);
        const success = results.find(
          (response) => response.headers.get("location") === config.origin + "/",
        )!;
        assert.ok(success);
        sessionCookie = cookies(success);
        assert.match(sessionCookie, /brag.session_token=/);
        assert.match(
          success.headers.getSetCookie().find((value) => value.includes("session_token="))!,
          /HttpOnly/i,
        );
        assert.match(
          success.headers.getSetCookie().find((value) => value.includes("session_token="))!,
          /SameSite=Lax/i,
        );
        assert.equal(
          (await get(flow.path, flow.cookie)).headers.get("location"),
          config.origin + "/sign-in?auth=failed",
        );
        const session = await (await get("/api/v1/session", sessionCookie)).json();
        userId = session.account.user.id;
        assert.equal(session.account.can_admin, false);
        assert.equal(await db.platformRole.count(), 0);
        const account = await db.account.findFirstOrThrow();
        assert.equal(account.issuer, "https://accounts.google.com");
        assert.equal(account.accountId, "google-owner-subject");
        assert.equal(account.accessToken, null);
        assert.equal(account.refreshToken, null);
        assert.equal(account.idToken, null);
      },
    );
    await t.test(
      "same-email identities cannot merge accounts and returning sign-in preserves the internal identity",
      async () => {
        const collision = await begin({ sub: "another-google-subject" });
        assert.match(
          (await get(collision.path, collision.cookie)).headers.get("location") || "",
          /auth=link_required/,
        );
        assert.equal(await db.account.count(), 1);
        const returning = await begin();
        const result = await get(returning.path, returning.cookie);
        const nextCookie = cookies(result);
        assert.notEqual(nextCookie, sessionCookie);
        sessionCookie = nextCookie;
        assert.equal(
          (await (await get("/api/v1/session", sessionCookie)).json()).account.user.id,
          userId,
        );
        assert.equal(await db.user.count(), 1);
      },
    );
    await t.test(
      "operator role grants are independent, audited, idempotent and inaccessible to runtime",
      async () => {
        command = {
          requestId: randomUUID(),
          environment: "local",
          action: "bootstrap",
          userId,
          expectedVersion: 0,
          operator: "fixture-operator",
          reason: "Initial administrator",
          evidence: "Exact Google subject independently confirmed in this synthetic test",
          googleSubject: "google-owner-subject",
        };
        assert.equal((await get("/api/v1/admin/access", sessionCookie)).status, 403);
        await assert.rejects(
          administerRole(db, command, setup),
          (e: AccessError) => e.status === 403,
        );
        await assert.rejects(
          administerRole(operator, { ...command, googleSubject: "wrong" }, setup),
          (e: AccessError) => e.status === 403,
        );
        await assert.rejects(
          administerRole(operator, command, { ...setup, bootstrapEmail: "wrong@example.test" }),
          (e: AccessError) => e.status === 409,
        );
        for (const sql of [
          `UPDATE brag.platform_role SET active = true`,
          `DELETE FROM brag.platform_role`,
          `INSERT INTO brag.platform_role ("userId", active, version, "updatedAt") VALUES ('${userId}', true, 1, now())`,
          `UPDATE brag.auth_user SET active = true`,
          `UPDATE brag.auth_account SET "userId" = '${userId}'`,
          `SELECT * FROM brag.role_audit`,
          "SET ROLE brag_operator",
        ])
          await assert.rejects(
            runtime.query(sql),
            (error: { code?: string }) => error.code === "42501",
          );
        const [first, retry] = await Promise.all([
          administerRole(operator, command, setup),
          administerRole(operator, command, setup),
        ]);
        assert.equal(first.version, 1);
        assert.equal(retry.version, 1);
        assert.notEqual(first.replay, retry.replay);
        assert.equal(await operator.roleAudit.count(), 1);
        const directory = path.dirname(fixture.authFile);
        const operatorFile = path.join(directory, "operator.url"),
          commandFile = path.join(directory, "role-command.json"),
          emailFile = path.join(directory, "bootstrap-email");
        await writeFile(operatorFile, fixture.operatorUrl, { mode: 0o600 });
        await writeFile(commandFile, JSON.stringify(command), { mode: 0o600 });
        await writeFile(emailFile, setup.bootstrapEmail, { mode: 0o600 });
        const env = {
          ...process.env,
          BRAG_ENV: "local",
          OPERATOR_DATABASE_URL_FILE: operatorFile,
          BOOTSTRAP_GOOGLE_EMAIL_FILE: emailFile,
        };
        const cli = spawnSync(
          process.execPath,
          [
            "--conditions=react-server",
            "--import",
            "tsx",
            "app/scripts/admin-role.ts",
            "apply",
            commandFile,
          ],
          { env, encoding: "utf8" },
        );
        assert.equal(cli.status, 0, "operator CLI must execute the reviewed command file");
        assert.equal(JSON.parse(cli.stdout).replay, true);
        assert.ok(!cli.stdout.includes(new URL(fixture.operatorUrl).password));
        const inspect = spawnSync(
          process.execPath,
          [
            "--conditions=react-server",
            "--import",
            "tsx",
            "app/scripts/admin-role.ts",
            "inspect",
            userId,
          ],
          { env, encoding: "utf8" },
        );
        assert.equal(inspect.status, 0);
        assert.equal(JSON.parse(inspect.stdout).user.id, userId);
        assert.equal(
          (await (await get("/api/v1/session", sessionCookie)).json()).account.can_admin,
          true,
        );
        assert.equal((await get("/api/v1/admin/access", sessionCookie)).status, 200);
        await assert.rejects(
          administerRole(operator, { ...command, reason: "Changed retry" }, setup),
          (e: AccessError) => e.status === 409,
        );
      },
    );
    await t.test(
      "multiple independent administrators are supported; operator cannot rewrite identity, sessions or audit",
      async () => {
        const flow = await begin({ sub: "second-admin-subject", email: "second@example.test" });
        const otherCookie = cookies(await get(flow.path, flow.cookie));
        const other = (await (await get("/api/v1/session", otherCookie)).json()).account;
        assert.equal(other.can_admin, false);
        await administerRole(
          operator,
          {
            ...command,
            requestId: randomUUID(),
            action: "grant",
            userId: other.user.id,
            googleSubject: "second-admin-subject",
            expectedVersion: 0,
          },
          setup,
        );
        assert.equal((await get("/api/v1/admin/access", otherCookie)).status, 200);
        assert.equal((await get("/api/v1/admin/access", sessionCookie)).status, 200);
        await assert.rejects(operator.$queryRaw`SELECT token FROM brag.auth_session`);
        await assert.rejects(operator.$executeRaw`UPDATE brag.auth_user SET name = 'forbidden'`);
        await assert.rejects(operator.$executeRaw`UPDATE brag.role_audit SET reason = 'forbidden'`);
        await assert.rejects(operator.$executeRaw`DELETE FROM brag.role_audit`);
      },
    );
    const ordinary = await begin({ sub: "ordinary-event-user", email: "ordinary@example.test" });
    const ordinaryCookie = cookies(await get(ordinary.path, ordinary.cookie));
    await t.test("Google callback preserves the local scanner continuation", async () => {
      const flow = await begin({}, "/scan");
      const response = await get(flow.path, flow.cookie);
      assert.equal(response.status, 303);
      assert.equal(new URL(response.headers.get("location")!, config.origin).pathname, "/scan");
      assert.ok(cookies(response).includes("brag.session_token="));
    });
    await eventChecks(t, fixture, auth, db, runtime, admin, sessionCookie, ordinaryCookie, config);
    await t.test("Google callback preserves an exact event contribution continuation", async () => {
      const destination = `/events/${randomUUID()}/submit`;
      const continuation = await begin(
        { sub: "ordinary-event-user", email: "ordinary@example.test" },
        destination,
      );
      const callback = await get(continuation.path, continuation.cookie);
      assert.equal(callback.status, 303);
      assert.equal(callback.headers.get("location"), config.origin + destination);
    });
    await projectChecks(
      t,
      fixture,
      auth,
      db,
      admin,
      runtime,
      ordinaryCookie,
      sessionCookie,
      config,
    );
    await integrationChecks(
      t,
      fixture,
      auth,
      db,
      admin,
      runtime,
      sessionCookie,
      ordinaryCookie,
      config,
    );
    await t.test(
      "sign-out serializes with protected commits and expiry rolls back in-flight writes",
      async () => {
        let release!: () => void, acquired!: () => void;
        const held = new Promise<void>((resolve) => {
          acquired = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const protectedCall = withAdmin(
          auth,
          db,
          new Headers({ Cookie: sessionCookie }),
          async () => {
            acquired();
            await gate;
            return "finished-before-sign-out";
          },
        );
        await held;
        let signedOut = false;
        const signingOut = post("/api/v1/auth/sign-out", {}, sessionCookie).then((response) => {
          signedOut = true;
          return response;
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(signedOut, false);
        release();
        assert.equal(await protectedCall, "finished-before-sign-out");
        assert.equal((await signingOut).status, 200);
        assert.equal((await get("/api/v1/admin/access", sessionCookie)).status, 401);
        let login = await begin();
        sessionCookie = cookies(await get(login.path, login.cookie));
        const session = await auth.api.getSession({
          headers: new Headers({ Cookie: sessionCookie }),
        });
        await admin.query(
          `UPDATE brag.auth_session SET "expiresAt" = clock_timestamp() + interval '1 second' WHERE id = $1`,
          [session!.session.id],
        );
        const before = await db.event.count();
        await assert.rejects(
          withAdmin(auth, db, new Headers({ Cookie: sessionCookie }), async (tx) => {
            await tx.event.create({
              data: {
                id: randomUUID(),
                title: "Must roll back",
                timezone: "UTC",
                startsAt: new Date("2030-01-01"),
                opensAt: new Date("2029-12-31"),
                closesAt: new Date("2030-01-02"),
                approval: "approved",
                version: 1,
                generation: 1,
              },
            });
            await new Promise((resolve) => setTimeout(resolve, 1100));
          }),
          (e: AccessError) => e.status === 401,
        );
        assert.equal(await db.event.count(), before);
        login = await begin();
        sessionCookie = cookies(await get(login.path, login.cookie));
      },
    );
    await t.test(
      "role revocation serializes against admin commits, persists across sign-in and cannot bootstrap again",
      async () => {
        const revoke = {
          ...command,
          requestId: randomUUID(),
          action: "revoke" as const,
          expectedVersion: 1,
        };
        let release!: () => void, acquired!: () => void;
        const held = new Promise<void>((resolve) => {
          acquired = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const read = withAdmin(auth, db, new Headers({ Cookie: sessionCookie }), async () => {
          acquired();
          await gate;
          return "committed-before-revocation";
        });
        await held;
        let revoked = false;
        const revocation = administerRole(operator, revoke, setup).then((result) => {
          revoked = true;
          return result;
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(revoked, false);
        release();
        assert.equal(await read, "committed-before-revocation");
        await revocation;
        assert.equal((await get("/api/v1/admin/access", sessionCookie)).status, 403);
        await assert.rejects(
          withAdmin(auth, db, new Headers({ Cookie: sessionCookie }), async () => "bypass"),
          (e: AccessError) => e.status === 403,
        );
        assert.equal((await administerRole(operator, command, setup)).replay, true);
        assert.equal(
          (await db.platformRole.findUniqueOrThrow({ where: { userId } })).active,
          false,
        );
        await assert.rejects(
          administerRole(
            operator,
            { ...command, requestId: randomUUID(), expectedVersion: 2 },
            setup,
          ),
          (e: AccessError) => e.status === 409,
        );
        const login = await begin();
        sessionCookie = cookies(await get(login.path, login.cookie));
        assert.equal(
          (await (await get("/api/v1/session", sessionCookie)).json()).account.can_admin,
          false,
        );
        await administerRole(
          operator,
          { ...command, requestId: randomUUID(), action: "grant", expectedVersion: 2 },
          setup,
        );
      },
    );
    await t.test(
      "real browser menu and direct Admin path work on mobile and desktop, and remove revoked access",
      async () => {
        const browser = await chromium.launch({ headless: true });
        try {
          for (const viewport of [
            { width: 390, height: 844 },
            { width: 1280, height: 900 },
          ]) {
            const context = await browser.newContext({ viewport });
            const page = await context.newPage();
            await page.goto(config.origin + "/admin");
            await expect(page).toHaveURL(/\/sign-in\?return_to/);
            await expect(page.getByRole("button", { name: /Continue with Google/ })).toBeDisabled();
            const pair = sessionCookie
              .split("; ")
              .find((value) => value.startsWith("brag.session_token="))!;
            await context.addCookies([
              {
                name: "brag.session_token",
                value: pair.slice(pair.indexOf("=") + 1),
                url: config.origin,
                httpOnly: true,
                sameSite: "Lax",
              },
            ]);
            await page.goto(config.origin);
            await page.getByRole("button", { name: "Account menu" }).click();
            await page.getByRole("button", { name: "Admin", exact: true }).click();
            await expect(
              page.getByRole("button", { name: "Add event", exact: true }),
            ).toBeVisible();
            assert.ok(
              await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
            );
            await page.screenshot({
              path: `.localfiles/runtime-evidence/${fixture.container}-admin-${viewport.width}.png`,
            });
            await context.close();
          }
          const context = await browser.newContext();
          const pair = sessionCookie
            .split("; ")
            .find((value) => value.startsWith("brag.session_token="))!;
          await context.addCookies([
            {
              name: "brag.session_token",
              value: pair.slice(pair.indexOf("=") + 1),
              url: config.origin,
            },
          ]);
          const page = await context.newPage();
          await page.goto(config.origin + "/admin");
          await expect(page.getByRole("button", { name: "Add event", exact: true })).toBeVisible();
          await administerRole(
            operator,
            { ...command, requestId: randomUUID(), action: "revoke", expectedVersion: 3 },
            setup,
          );
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          await expect(page.getByText("Admin access unavailable.")).toBeVisible();
          await expect(page.getByRole("button", { name: "Add event", exact: true })).toHaveCount(0);
          await page.getByRole("button", { name: "Account menu" }).click();
          await expect(page.getByRole("button", { name: "Admin", exact: true })).toHaveCount(0);
        } finally {
          await browser.close();
        }
      },
    );
    await t.test(
      "disabled users, session expiry and sign-out deny access; HTTPS cookies are secure",
      async () => {
        await admin.query("UPDATE brag.auth_user SET active = false WHERE id = $1", [userId]);
        assert.equal((await (await get("/api/v1/session", sessionCookie)).json()).account, null);
        assert.equal((await get("/api/v1/admin/access", sessionCookie)).status, 401);
        await admin.query("UPDATE brag.auth_user SET active = true WHERE id = $1", [userId]);
        assert.equal(
          (await post("/api/v1/auth/sign-out", {}, sessionCookie, "https://evil.test")).status,
          403,
        );
        assert.ok((await (await get("/api/v1/session", sessionCookie)).json()).account);
        assert.equal((await post("/api/v1/auth/sign-out", {}, sessionCookie)).status, 200);
        assert.equal((await (await get("/api/v1/session", sessionCookie)).json()).account, null);
        const flow = await begin();
        sessionCookie = cookies(await get(flow.path, flow.cookie));
        await admin.query(
          'UPDATE brag.auth_session SET "expiresAt" = now() - interval \'1 minute\' WHERE "userId" = $1',
          [userId],
        );
        assert.equal((await (await get("/api/v1/session", sessionCookie)).json()).account, null);
        const httpsConfig = {
          ...config,
          environment: "test" as const,
          origin: "https://example.invalid",
        };
        const httpsHandle = identityHandler(createAuth(db, httpsConfig), db, httpsConfig);
        const response = await httpsHandle(
          new Request(httpsConfig.origin + "/api/v1/auth/providers/google/start", {
            method: "POST",
            headers: { Origin: httpsConfig.origin, "Content-Type": "application/json" },
            body: "{}",
          }),
        );
        assert.equal(response.status, 200);
        assert.match(response.headers.getSetCookie()[0], /__Secure-brag.state=/);
        assert.match(response.headers.getSetCookie()[0], /Secure/);
        await runtime.query("UPDATE brag.auth_throttle SET count = 100 WHERE key = 'start'");
        assert.equal((await post("/api/v1/auth/providers/google/start")).status, 429);
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    await operator.$disconnect();
  }
}
