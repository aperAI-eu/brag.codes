import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { execFileSync } from "node:child_process";
import { event, draft, identity } from "./fixtures/sharing-history.ts";
import { chromium, expect } from "@playwright/test";
import {
  ownedFixture,
  bootstrapSchema10,
  migrateCandidate,
  restoreOwned,
} from "./fixtures/owned-migration.ts";
import { createDatabase } from "../src/lib/database/client.ts";
import { createAuth } from "../src/lib/auth/config.ts";
import { identityHandler } from "../src/lib/auth/handler.ts";
const cookies = (r: Response) =>
  r.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .filter((v) => !v.endsWith("="))
    .join("; ");
test("GitHub identity preserves ownership and validates OAuth boundaries", async (t) => {
  const f = await ownedFixture();
  const admin = new pg.Client({ connectionString: f.adminUrl });
  await admin.connect();
  const db = createDatabase(f.runtimeUrl);
  const config = {
    environment: "local" as const,
    origin: f.baseUrl,
    databaseUrl: f.runtimeUrl,
    authSecret: await readFile(f.authFile, "utf8"),
    github: { clientId: "fixture-github", clientSecret: "fixture-only-secret" },
    google: { clientId: "fixture.apps.googleusercontent.com", clientSecret: "fixture-google" },
  };
  const auth = createAuth(db, config),
    handle = identityHandler(auth, db, config);
  const originalFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await db.$disconnect();
    await admin.end();
  });
  await bootstrapSchema10(f);
  const googleUser = randomUUID();
  await admin.query(
    `INSERT INTO brag.auth_user(id,name,email,"emailVerified","updatedAt") VALUES ($1,'Original Google','google@example.test',true,now())`,
    [googleUser],
  );
  await admin.query(
    `INSERT INTO brag.auth_account(id,"accountId","providerId","userId","updatedAt") VALUES ($1,'google-original','google',$2,now())`,
    [randomUUID(), googleUser],
  );
  await admin.query(
    'INSERT INTO brag.platform_role("userId",active,version,"updatedAt") VALUES ($1,true,1,now())',
    [googleUser],
  );
  const oldSession = await identity(admin, config.authSecret, googleUser);
  const oldEvent = await event(admin);
  await draft(admin, googleUser, oldEvent.id, "confirmed");
  const backupSql = (key: string) =>
    execFileSync(
      "python3",
      [
        "-c",
        `import runpy; b=runpy.run_path('deploy/runtime/backup-guest.py');print(b[${JSON.stringify(key)}])`,
      ],
      { encoding: "utf8" },
    );
  const recordSql = execFileSync(
    "python3",
    [
      "-c",
      "import runpy; b=runpy.run_path('deploy/runtime/backup-guest.py');print(b['record_hashes_sql'](10))",
    ],
    { encoding: "utf8" },
  );
  const beforeRecords = (await admin.query(recordSql)).rows;
  const before = (await admin.query("SELECT row_to_json(a) value FROM brag.auth_account a")).rows;
  await t.test(
    "schema-10 upgrade preserves identity bytes and rejects wrong issuer or retained tokens",
    async () => {
      assert.equal(migrateCandidate(f).status, 0);
      assert.deepEqual((await admin.query(recordSql)).rows, beforeRecords);
      assert.equal(
        (await auth.api.getSession({ headers: oldSession.headers }))?.user.id,
        googleUser,
      );
      assert.deepEqual(
        (await admin.query(backupSql("GITHUB_CHECK_SQL"))).rows[0].json_build_object,
        { githubIdentityIntegrity: true, githubIdentityPrivileges: true },
      );
      assert.deepEqual(
        (await admin.query("SELECT row_to_json(a) value FROM brag.auth_account a")).rows,
        before,
      );
      assert.equal(
        (await admin.query("SELECT schema_version FROM brag.runtime_metadata")).rows[0]
          .schema_version,
        15,
      );
      for (const [provider, issuer] of [
        ["github", "https://accounts.google.com"],
        ["google", "https://github.com"],
        ["other", "https://github.com"],
      ])
        await assert.rejects(
          db.account.create({
            data: {
              id: randomUUID(),
              accountId: "bad",
              providerId: provider,
              issuer,
              userId: googleUser,
            },
          }),
        );
      await assert.rejects(
        db.account.create({
          data: {
            id: randomUUID(),
            accountId: "bad",
            providerId: "github",
            issuer: "https://github.com",
            userId: googleUser,
            accessToken: "must-not-persist",
          },
        }),
      );
      await assert.rejects(
        db.$executeRaw`UPDATE brag.auth_account SET issuer='https://github.com' WHERE "userId"=${googleUser}`,
      );
    },
  );
  type Profile = {
    id?: number;
    email?: string | null;
    name?: string;
    type?: string;
    emails?: unknown;
    failure?: string;
  };
  const flows = new Map<string, { challenge: string; profile: Profile }>();
  const tokens = new Map<string, Profile>();
  let exchanges = 0;
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    if (req.url === "https://github.com/login/oauth/access_token") {
      exchanges++;
      const body = new URLSearchParams(await req.text());
      const flow = flows.get(body.get("code")!);
      assert.ok(flow);
      assert.equal(req.redirect, "error");
      assert.equal(body.get("client_secret"), config.github.clientSecret);
      assert.equal(body.get("redirect_uri"), config.origin + "/api/auth/callback/github");
      assert.equal(
        createHash("sha256").update(body.get("code_verifier")!).digest("base64url"),
        flow.challenge,
      );
      if (flow.profile.failure === "exchange")
        return Response.json({ error: "provider-private-error" }, { status: 400 });
      const token = randomUUID();
      tokens.set(token, flow.profile);
      return Response.json({ access_token: token, token_type: "bearer" });
    }
    if (req.url.startsWith("https://api.github.com/")) {
      assert.equal(req.redirect, "error");
      const p = tokens.get(req.headers.get("authorization")!.slice(7));
      assert.ok(p);
      if (p.failure === "oversize") return new Response("x".repeat(65537));
      if (p.failure === "network") throw new Error("private-provider-detail");
      if (req.url === "https://api.github.com/user")
        return Response.json({
          id: 1001,
          login: "fictional",
          name: "GitHub User",
          type: "User",
          email: null,
          ...p,
        });
      assert.equal(req.url, "https://api.github.com/user/emails?per_page=100");
      return Response.json(
        p.emails ?? [{ email: p.email ?? "github@example.test", verified: true, primary: true }],
      );
    }
    if (req.url.startsWith(config.origin)) return originalFetch(input, init);
    throw new Error("Unexpected outbound provider request");
  };
  const post = (path: string, body: unknown = {}) =>
    handle(
      new Request(config.origin + path, {
        method: "POST",
        headers: { Origin: config.origin, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  const get = (path: string, cookie = "") =>
    handle(new Request(config.origin + path, { headers: { cookie } }));
  async function begin(profile: Profile = {}, returnTo = "/my/projects") {
    const response = await post("/api/v1/auth/providers/github/start", { return_to: returnTo });
    assert.equal(response.status, 200);
    const url = new URL((await response.json()).url);
    assert.equal(url.origin, "https://github.com");
    assert.equal(url.pathname, "/login/oauth/authorize");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.deepEqual(
      new Set(url.searchParams.get("scope")!.split(" ")),
      new Set(["read:user", "user:email"]),
    );
    const code = randomUUID();
    flows.set(code, { challenge: url.searchParams.get("code_challenge")!, profile });
    const state = url.searchParams.get("state")!;
    const verification = await db.verification.findUniqueOrThrow({
      where: { identifier: `auth-state:${state}` },
    });
    assert.equal(
      JSON.parse(verification.value).serverContext?.provider,
      "github",
      "server-owned provider binding must persist",
    );
    return {
      path: `/api/auth/callback/github?code=${code}&state=${state}&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth`,
      cookie: cookies(response),
      state,
    };
  }
  await t.test("mismatched callback issuer is diagnosed before any code exchange", async () => {
    for (const issuer of [
      "https://github.com",
      "https://github.com/login/oauth/",
      "https://untrusted.example",
    ]) {
      const flow = await begin();
      const count = exchanges;
      const messages: unknown[][] = [];
      const original = console.error;
      console.error = (...args) => {
        messages.push(args);
      };
      try {
        const callback = new URL(config.origin + flow.path);
        callback.searchParams.set("iss", issuer);
        const response = await get(callback.pathname + callback.search, flow.cookie);
        assert.equal(new URL(response.headers.get("location")!).searchParams.get("auth"), "failed");
        assert.equal(exchanges, count);
        assert.deepEqual(
          messages.map((message) => message[1]),
          ["callback_issuer", "callback_issuer"],
        );
        assert.equal(JSON.stringify(messages).includes(issuer), false);
      } finally {
        console.error = original;
      }
    }
  });
  let owner = "";
  await t.test(
    "built server accepts GitHub RFC 9207 issuer and completes the HTTP callback",
    async () => {
      const start = await originalFetch(config.origin + "/api/v1/auth/providers/github/start", {
        method: "POST",
        headers: { Origin: config.origin, "Content-Type": "application/json" },
        body: JSON.stringify({ return_to: "/my/projects" }),
      });
      assert.equal(start.status, 200);
      const url = new URL((await start.json()).url);
      const state = url.searchParams.get("state")!;
      const stored = await db.verification.findUniqueOrThrow({
        where: { identifier: `auth-state:${state}` },
      });
      const flow = JSON.parse(stored.value);
      assert.equal(flow.serverContext?.provider, "github");
      assert.equal(
        createHash("sha256").update(flow.codeVerifier).digest("base64url"),
        url.searchParams.get("code_challenge"),
      );
      const response = await originalFetch(
        config.origin +
          `/api/auth/callback/github?code=owned-http-code&state=${state}&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth`,
        {
          headers: {
            cookie: cookies(start),
            referer: "https://github.com/",
            "sec-fetch-site": "cross-site",
            "sec-fetch-mode": "navigate",
            "sec-fetch-dest": "document",
          },
          redirect: "manual",
        },
      );
      assert.equal(response.headers.get("location"), config.origin + "/my/projects");
      const session = await originalFetch(config.origin + "/api/v1/session", {
        headers: { cookie: cookies(response) },
      });
      const account = (await session.json()).account;
      assert.equal(account.user.email, "owned-http@example.test");
      assert.equal(account.can_admin, false);
    },
  );
  await t.test(
    "private verified email creates ordinary account; repeat subject retains identity and tokens are discarded",
    async () => {
      const flow = await begin();
      const response = await get(flow.path, flow.cookie);
      assert.equal(response.headers.get("location"), config.origin + "/my/projects");
      const session = await get("/api/v1/session", cookies(response));
      const account = (await session.json()).account;
      assert.equal(account.can_admin, false);
      owner = account.user.id;
      const saved = await db.account.findFirstOrThrow({ where: { userId: owner } });
      assert.equal(saved.providerId, "github");
      assert.equal(saved.issuer, "https://github.com");
      assert.equal(saved.accountId, "1001");
      for (const key of ["accessToken", "refreshToken", "idToken"] as const)
        assert.equal(saved[key], null);
      const repeat = await begin({ name: "Changed name", email: "changed@example.test" });
      const second = await get(repeat.path, repeat.cookie);
      const repeated = (await (await get("/api/v1/session", cookies(second))).json()).account;
      assert.equal(repeated.user.id, owner);
      assert.equal(repeated.user.email, "github@example.test");
      assert.equal(await db.account.count({ where: { providerId: "github", userId: owner } }), 1);
    },
  );
  await t.test(
    "missing verified email and Google collision create no partial accounts, preserve safe return",
    async () => {
      const count = await db.user.count();
      for (const [profile, reason] of [
        [
          {
            id: 2001,
            emails: [{ email: "unverified@example.test", verified: false, primary: true }],
          },
          "email_required",
        ],
        [{ id: 2002, email: "google@example.test" }, "link_required"],
      ] as const) {
        const flow = await begin(profile);
        const r = await get(flow.path, flow.cookie);
        const url = new URL(r.headers.get("location")!);
        assert.equal(url.searchParams.get("auth"), reason);
        assert.equal(url.searchParams.get("return_to"), "/my/projects");
        assert.equal(await db.user.count(), count);
      }
      assert.equal(await db.platformRole.count(), 1);
      assert.equal(
        (await db.platformRole.findUniqueOrThrow({ where: { userId: googleUser } })).active,
        true,
      );
      assert.equal(
        (await db.account.findFirstOrThrow({ where: { userId: googleUser } })).accountId,
        "google-original",
      );
    },
  );
  await t.test(
    "verified fallback is allowed but malformed identity/email responses fail closed",
    async () => {
      const fallback = await begin({
        id: 3001,
        email: "public-unverified@example.test",
        emails: [
          { email: "public-unverified@example.test", primary: true, verified: false },
          { email: "verified-fallback@example.test", primary: false, verified: true },
        ],
      });
      const result = await get(fallback.path, fallback.cookie);
      const account = (await (await get("/api/v1/session", cookies(result))).json()).account;
      assert.equal(account.user.email, "verified-fallback@example.test");
      assert.equal(account.can_admin, false);
      const count = await db.user.count();
      for (const profile of [
        { id: 0 },
        { id: 1.5 },
        { id: 3002, type: "Organization" },
        { id: 3003, emails: { email: "invalid" } },
      ]) {
        const flow = await begin(profile);
        const rejected = await get(flow.path, flow.cookie);
        assert.match(rejected.headers.get("location")!, /auth=failed/);
        assert.equal(await db.user.count(), count);
      }
    },
  );
  await t.test(
    "forged, replayed, concurrent, expired and wrong-provider callbacks cannot redeem twice",
    async () => {
      const flow = await begin();
      const prior = exchanges;
      await get(flow.path);
      assert.equal(exchanges, prior);
      await get(flow.path.replace("/github?", "/google?"), flow.cookie);
      assert.equal(exchanges, prior);
      const responses = await Promise.all([
        get(flow.path, flow.cookie),
        get(flow.path, flow.cookie),
      ]);
      assert.equal(
        responses.filter((r) => r.headers.get("location") === config.origin + "/my/projects")
          .length,
        1,
      );
      assert.equal(exchanges, prior + 1);
      await get(flow.path, flow.cookie);
      assert.equal(exchanges, prior + 1);
      const expired = await begin();
      await admin.query(
        "UPDATE brag.auth_verification SET \"expiresAt\"=now()-interval '1 minute' WHERE identifier=$1",
        ["auth-state:" + expired.state],
      );
      await get(expired.path, expired.cookie);
      assert.equal(exchanges, prior + 1);
      const dup = await begin();
      await get(dup.path + "&state=wrong", dup.cookie);
      assert.equal(exchanges, prior + 1);
    },
  );
  await t.test(
    "cancellation, bounded failures, disabled accounts and unsafe returns fail safely",
    async () => {
      const denied = await begin();
      const cancel = await get(
        `/api/auth/callback/github?error=access_denied&state=${denied.state}`,
        denied.cookie,
      );
      assert.equal(new URL(cancel.headers.get("location")!).searchParams.get("auth"), "cancelled");
      for (const failure of ["exchange", "network", "oversize"]) {
        const flow = await begin({ failure });
        const r = await get(flow.path, flow.cookie);
        assert.match(r.headers.get("location")!, /auth=failed/);
        assert.doesNotMatch(JSON.stringify([...r.headers]), /private-provider/);
      }
      await admin.query("UPDATE brag.auth_user SET active=false WHERE id=$1", [owner]);
      const off = await begin();
      const r = await get(off.path, off.cookie);
      assert.equal((await (await get("/api/v1/session", cookies(r))).json()).account, null);
      await admin.query("UPDATE brag.auth_user SET active=true WHERE id=$1", [owner]);
      const safe = await begin({}, "https://evil.example/");
      assert.equal(
        (await get(safe.path, safe.cookie)).headers.get("location"),
        config.origin + "/",
      );
      assert.equal(
        (await post("/api/v1/auth/providers/github/start", { intent: "link" })).status,
        400,
      );
      assert.equal((await get("/api/auth/get-access-token")).status, 404);
      await assert.rejects(
        auth.api.linkSocialAccount({
          body: { provider: "github", callbackURL: config.origin },
          headers: new Headers(),
        }),
      );
      const unavailable = identityHandler(createAuth(db, { ...config, github: undefined }), db, {
        ...config,
        github: undefined,
      });
      assert.equal(
        (
          await unavailable(
            new Request(config.origin + "/api/v1/auth/providers/github/start", {
              method: "POST",
              headers: { Origin: config.origin, "Content-Type": "application/json" },
              body: "{}",
            }),
          )
        ).status,
        503,
      );
    },
  );
  await t.test("restored database retains both provider identities and narrow grants", async () => {
    const restored = await restoreOwned(f, "brag_restore_github");
    const restoredDb = createDatabase(restored);
    try {
      assert.equal(await restoredDb.account.count(), await db.account.count());
      await assert.rejects(
        restoredDb.$executeRaw`UPDATE brag.auth_account SET "providerId"='google' WHERE "providerId"='github'`,
      );
    } finally {
      await restoredDb.$disconnect();
    }
  });
  await t.test(
    "production sign-in controller uses capabilities and preserves retry destination on mobile and desktop",
    async () => {
      const browser = await chromium.launch();
      try {
        for (const width of [390, 1440]) {
          const page = await browser.newPage({ viewport: { width, height: 900 } });
          await page.route("**/api/v1/auth/providers", (route) =>
            route.fulfill({
              json: {
                providers: [
                  { id: "google", enabled: true },
                  { id: "github", enabled: true },
                ],
              },
            }),
          );
          let body: unknown;
          await page.route("**/api/v1/auth/providers/github/start", async (route) => {
            body = route.request().postDataJSON();
            await route.fulfill({ status: 503, json: { error: "provider_unavailable" } });
          });
          await page.goto(f.baseUrl + "/sign-in?auth=email_required&return_to=%2Fmy%2Fprojects");
          await expect(page.getByRole("main").getByRole("alert")).toContainText(
            "Verify an email on GitHub",
          );
          await page.getByRole("button", { name: "Continue with GitHub", exact: true }).click();
          await expect(page.getByRole("main").getByRole("alert")).toContainText("Couldn’t start");
          assert.deepEqual(body, { intent: "sign_in", return_to: "/my/projects" });
          await expect(
            page.getByRole("button", { name: /Continue with Microsoft/ }),
          ).toBeDisabled();
          await page.close();
        }
      } finally {
        await browser.close();
      }
    },
  );
});
