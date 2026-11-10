import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { chromium, expect } from "@playwright/test";
import {
  ownedFixture,
  bootstrapSchema9,
  migrateCandidate,
  restoreOwned,
} from "./fixtures/owned-migration.ts";
import { identity, event, association, draft as seedDraft } from "./fixtures/sharing-history.ts";
import { createDatabase } from "../src/lib/database/client.ts";
import { createAuth } from "../src/lib/auth/config.ts";
import { agentOperations } from "../src/lib/projects/agent.ts";
import { publicationOperations } from "../src/lib/publication/operations.ts";
import { draftOperations } from "../src/lib/projects/drafts.ts";
import { sharingOperations } from "../src/lib/sharing/operations.ts";
import { emptyProject } from "../src/projects/model.ts";

const error = (code: string) => (e: { code?: string }) => e.code === code;
const backupSql = (expression: string) =>
  execFileSync(
    "python3",
    [
      "-c",
      "import runpy; b=runpy.run_path('deploy/runtime/backup-guest.py'); print(" + expression + ")",
    ],
    { encoding: "utf8" },
  );
test("existing draft refinement preserves history, authorization and owner control", async (t) => {
  const f = await ownedFixture();
  const admin = new pg.Client({ connectionString: f.adminUrl });
  await admin.connect();
  const db = createDatabase(f.runtimeUrl);
  const secret = await readFile(f.authFile, "utf8");
  const auth = createAuth(db, {
    environment: "local",
    origin: f.baseUrl,
    databaseUrl: f.runtimeUrl,
    authSecret: secret,
  });
  t.after(async () => {
    await db.$disconnect();
    await admin.end();
  });
  await bootstrapSchema9(f);
  const owner = await identity(admin, secret),
    other = await identity(admin, secret),
    e = await event(admin);
  owner.headers.set("x-capture-contract", "share-work-v1");
  other.headers.set("x-capture-contract", "share-work-v1");
  await association(admin, owner.owner, e.id);
  const oldId = await seedDraft(admin, owner.owner, e.id, "confirmed");
  const before = (await admin.query(backupSql("b['record_hashes_sql'](9)"))).rows[0]
    .json_build_object;
  assert.equal(migrateCandidate(f).status, 0);
  assert.deepEqual(
    (await admin.query(backupSql("b['record_hashes_sql'](10)"))).rows[0].json_build_object,
    before,
  );
  assert.equal(migrateCandidate(f).status, 0);
  const agents = agentOperations(auth, db, f.baseUrl),
    drafts = draftOperations(auth, db, f.baseUrl, false),
    sharing = sharingOperations(auth, db, f.baseUrl);
  const content = {
    ...emptyProject,
    title: "Original",
    problem: "A real problem",
    description: "Current draft",
    language: "sk",
  };
  const save = (
    id: string,
    version: number,
    values = content,
    source: unknown = { method: "typed" },
  ) =>
    drafts.save(owner.headers, id, randomUUID(), {
      expected_version: version,
      fields: values,
      review_source: source,
    });
  const issue = async (id: string, version: number) => {
    const r = await agents.issue(owner.headers, id, randomUUID(), { expected_version: version });
    assert.ok("credential" in r);
    return r.credential;
  };
  await t.test(
    "saved draft supports repeated rounds after close, exact retry, rejection and one history row",
    async () => {
      const d = (await save(oldId, 2)).draft;
      await admin.query("UPDATE brag.event SET manually_closed=true WHERE id=$1", [e.id]);
      const token = await issue(d.id, d.version),
        key = randomUUID(),
        body = { fields: { ...content, title: "First proposal" } };
      const p = await agents.upload("Bearer " + token, key, body);
      assert.deepEqual(await agents.upload("Bearer " + token, key, body), p);
      await assert.rejects(
        agents.upload("Bearer " + token, key, { fields: content }),
        error("proposal_already_received"),
      );
      assert.equal((await drafts.read(owner.headers, d.id)).draft.fields.title, "Original");
      await assert.rejects(issue(d.id, d.version), error("proposal_already_received"));
      await assert.rejects(
        agents.reject(other.headers, d.id, randomUUID(), {
          expected_version: d.version,
          proposal_id: p.proposal_id,
        }),
        error("draft_unavailable"),
      );
      const rejectKey = randomUUID(),
        rejectBody = { expected_version: d.version, proposal_id: p.proposal_id };
      const rejected = await agents.reject(owner.headers, d.id, rejectKey, rejectBody);
      assert.deepEqual(await agents.reject(owner.headers, d.id, rejectKey, rejectBody), rejected);
      await assert.rejects(
        save(d.id, d.version, body.fields, { method: "agent", proposal_id: p.proposal_id }),
        error("version_conflict"),
      );
      const next = await agents.upload("Bearer " + (await issue(d.id, d.version)), randomUUID(), {
        fields: { ...content, title: "Second proposal" },
      });
      const approved = await save(
        d.id,
        d.version,
        { ...content, title: "Owner edited proposal" },
        { method: "agent", proposal_id: next.proposal_id },
      );
      assert.equal(approved.draft.id, d.id);
      assert.equal(approved.draft.fields.title, "Owner edited proposal");
      assert.equal(await db.agentProposal.count({ where: { draftId: d.id } }), 2);
      assert.equal(
        (await sharing.projects(owner.headers, {})).projects.filter((p) => p.id === d.id).length,
        1,
      );
      await issue(d.id, approved.draft.version);
    },
  );
  await t.test(
    "version, cancelled capability, closed first intake, suspended event and owner boundaries fail closed",
    async () => {
      const d = (await drafts.read(owner.headers, oldId)).draft;
      await assert.rejects(
        agents.issue(other.headers, d.id, randomUUID(), { expected_version: d.version }),
        error("draft_unavailable"),
      );
      await assert.rejects(issue(d.id, d.version - 1), error("version_conflict"));
      await agents.cancel(owner.headers, d.id, randomUUID());
      const token = await issue(d.id, d.version);
      await agents.cancel(owner.headers, d.id, randomUUID());
      await assert.rejects(agents.upload("Bearer " + token, randomUUID(), { fields: content }));
      const stale = await issue(d.id, d.version);
      await save(d.id, d.version, { ...content, title: "Newer owner edit" });
      await assert.rejects(agents.upload("Bearer " + stale, randomUUID(), { fields: content }));
      const fresh = await seedDraft(admin, owner.owner, e.id);
      await assert.rejects(issue(fresh, 2), error("submissions_closed"));
      await admin.query("UPDATE brag.event SET approval='suspended' WHERE id=$1", [e.id]);
      await assert.rejects(issue(d.id, d.version + 1), error("event_suspended"));
      await admin.query(
        "UPDATE brag.event SET approval='approved',manually_closed=false WHERE id=$1",
        [e.id],
      );
    },
  );
  await t.test(
    "two concurrent uploads consume once and owner edit rejects stale proposal acceptance",
    async () => {
      const d = (await drafts.create(owner.headers, randomUUID(), { event_id: e.id })).draft;
      const token = await issue(d.id, d.version);
      const results = await Promise.allSettled([
        agents.upload("Bearer " + token, randomUUID(), { fields: content }),
        agents.upload("Bearer " + token, randomUUID(), {
          fields: { ...content, title: "Competing" },
        }),
      ]);
      assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
      const p = (await agents.proposal(owner.headers, d.id)).proposal!;
      await save(d.id, d.version);
      await assert.rejects(
        save(d.id, d.version + 1, content, { method: "agent", proposal_id: p.id }),
        error("version_conflict"),
      );
      assert.equal((await drafts.read(owner.headers, d.id)).draft.fields.title, "Original");
    },
  );
  await t.test(
    "expired capabilities, disabled accounts and publication cannot authorize refinement",
    async () => {
      const fresh = (await drafts.create(owner.headers, randomUUID(), { event_id: e.id })).draft;
      const d = (await save(fresh.id, fresh.version)).draft;
      const expired = await issue(d.id, d.version);
      await admin.query(
        "UPDATE brag.agent_proposal_upload SET created_at=now()-interval '31 minutes',expires_at=now()-interval '1 minute' WHERE draft_id=$1",
        [d.id],
      );
      await assert.rejects(
        agents.upload("Bearer " + expired, randomUUID(), { fields: content }),
        error("upload_expired"),
      );
      await agents.cancel(owner.headers, d.id, randomUUID());
      const token = await issue(d.id, d.version);
      await admin.query("UPDATE brag.auth_user SET active=false WHERE id=$1", [owner.owner]);
      try {
        await assert.rejects(agents.upload("Bearer " + token, randomUUID(), { fields: content }));
      } finally {
        await admin.query("UPDATE brag.auth_user SET active=true WHERE id=$1", [owner.owner]);
      }
      const publication = publicationOperations(auth, db, f.baseUrl);
      const review = await publication.prepare(owner.headers, d.id, randomUUID(), {
        expected_version: d.version,
        public_author: {
          display_name: "Fixture author",
          contact: { kind: "profile", value: "https://example.test/author" },
        },
        include: { project_link: false, repository_link: false, details: false },
      });
      await publication.publish(owner.headers, d.id, randomUUID(), { review_id: review.review_id });
      await assert.rejects(
        agents.upload("Bearer " + token, randomUUID(), { fields: content }),
        error("published_project"),
      );
      await assert.rejects(issue(d.id, d.version), error("published_project"));
      assert.equal((await drafts.read(owner.headers, d.id)).draft.can_use_agent, false);
    },
  );
  await t.test("database restore preserves proposals and refinement integrity", async () => {
    const query = backupSql("b['AGENT_REFINEMENT_CHECK_SQL']");
    const expected = { agentRefinementIntegrity: true, agentRefinementPrivileges: true };
    assert.deepEqual((await admin.query(query)).rows[0].json_build_object, expected);
    await assert.rejects(db.$executeRaw`UPDATE brag.agent_proposal SET base_version=999`);
    const restore = await restoreOwned(f, "brag_restore_refinement");
    const restoreAdmin = new URL(f.adminUrl);
    restoreAdmin.pathname = new URL(restore).pathname;
    const restored = new pg.Client({ connectionString: restoreAdmin.toString() });
    await restored.connect();
    try {
      assert.deepEqual((await restored.query(query)).rows[0].json_build_object, expected);
      assert.deepEqual(
        (await restored.query(backupSql("b['record_hashes_sql'](10)"))).rows[0],
        (await admin.query(backupSql("b['record_hashes_sql'](10)"))).rows[0],
      );
    } finally {
      await restored.end();
    }
  });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 1000 },
  ])
    await t.test(
      `${viewport.width}px real handoff includes unsaved text; reject keeps original; next proposal saves same ID`,
      async () => {
        const d = (await drafts.create(owner.headers, randomUUID(), { event_id: e.id })).draft;
        const saved = (await save(d.id, d.version)).draft;
        const context = await browser.newContext({ viewport });
        t.after(() => context.close());
        await context.addCookies([
          {
            name: "brag.session_token",
            value: owner.cookie.slice("brag.session_token=".length),
            url: f.baseUrl,
          },
        ]);
        const page = await context.newPage();
        await page.goto(`${f.baseUrl}/events/${e.id}/submit/${d.id}`);
        await page.getByLabel("Project name", { exact: true }).fill("Unsaved current content");
        await page.getByRole("button", { name: "Send to your agent", exact: true }).click();
        const instructions = page.getByLabel("Agent instruction", { exact: true });
        const text = await instructions.inputValue();
        // Never capture the live synthetic upload credential in screenshots/logs.

        assert.ok(text.includes(d.id));
        assert.ok(text.includes("Unsaved current content"));
        assert.ok(text.includes(`Base version: ${saved.version}`));
        const token = text.match(/Bearer header: ([A-Za-z0-9_-]{43})/)![1];
        const response = await fetch(f.baseUrl + "/api/v1/agent/proposals", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify({ fields: { ...content, title: "Agent rewrite" } }),
        });
        assert.equal(response.status, 201);
        await expect(
          page.getByRole("heading", { name: "Review your agent’s changes." }),
        ).toBeVisible({ timeout: 15000 });
        await page.getByRole("button", { name: "Keep my draft", exact: true }).click();
        await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
          "Unsaved current content",
        );
        await page.getByRole("button", { name: "Send to your agent", exact: true }).click();
        const second = (await instructions.inputValue()).match(
          /Bearer header: ([A-Za-z0-9_-]{43})/,
        )![1];
        await agents.upload("Bearer " + second, randomUUID(), {
          fields: { ...content, title: "Refined again" },
        });
        await page.getByLabel("Project name", { exact: true }).fill("Owner final title");
        await page.getByRole("button", { name: "Approve and save draft", exact: true }).click();
        await expect(
          page.getByRole("heading", { name: "Project saved.", exact: true }),
        ).toBeVisible();
        await expect(page.getByRole("list", { name: "Agent proposal progress" })).toBeVisible();
        const final = (await drafts.read(owner.headers, d.id)).draft;
        assert.equal(final.id, d.id);
        assert.equal(final.fields.title, "Owner final title");
        assert.equal(final.published, false);
        await mkdir(".localfiles/screenshots", { recursive: true });
        await page.screenshot({
          path: `.localfiles/screenshots/req019-runtime-saved-${viewport.width}.png`,
          fullPage: true,
        });
        if (viewport.width === 1440) {
          await page.goto(`${f.baseUrl}/events/${e.id}/submit/${d.id}`);
          await page.getByLabel("Project name", { exact: true }).fill("Retained on cancel");
          await page.getByRole("button", { name: "Send to your agent", exact: true }).click();
          await page
            .getByRole("button", { name: "Cancel upload instructions", exact: true })
            .click();
          await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
            "Retained on cancel",
          );
          await page.getByRole("button", { name: "Send to your agent", exact: true }).click();
          const staleToken = (await instructions.inputValue()).match(
            /Bearer header: ([A-Za-z0-9_-]{43})/,
          )![1];
          await agents.upload("Bearer " + staleToken, randomUUID(), {
            fields: { ...content, title: "Stale proposal" },
          });
          await save(d.id, final.version, { ...content, title: "Newer remote edit" });
          await expect(
            page.getByRole("button", { name: "Return to latest draft", exact: true }),
          ).toBeVisible({ timeout: 15000 });
          await expect(
            page.getByRole("button", { name: "Approve and save draft", exact: true }),
          ).toBeDisabled();
          await page.getByRole("button", { name: "Return to latest draft", exact: true }).click();
          await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
            "Newer remote edit",
          );
          await expect(
            page.getByRole("button", { name: "Send to your agent", exact: true }),
          ).toBeEnabled();
          await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeEnabled();
          await page.getByLabel("Project name", { exact: true }).fill("Unsaved before remote edit");
          await page.getByRole("button", { name: "Send to your agent", exact: true }).click();
          await expect(instructions).toBeVisible();
          await save(d.id, final.version + 1, { ...content, title: "Remote edit during handoff" });
          await page
            .getByRole("button", { name: "Cancel upload instructions", exact: true })
            .click();
          await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
            "Unsaved before remote edit",
          );
          await expect(
            page.getByRole("button", { name: "Save draft", exact: true }),
          ).toBeDisabled();
          await page.getByRole("button", { name: "Return to latest draft", exact: true }).click();
          await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
            "Remote edit during handoff",
          );
          const expiring = (await drafts.create(owner.headers, randomUUID(), { event_id: e.id }))
            .draft;
          await save(expiring.id, expiring.version);
          await page.goto(`${f.baseUrl}/events/${e.id}/submit/${expiring.id}`);
          await page.getByRole("button", { name: "Send to your agent", exact: true }).click();
          await expect(instructions).toBeVisible();
          await admin.query(
            "UPDATE brag.agent_proposal_upload SET created_at=now()-interval '31 minutes',expires_at=now()-interval '1 minute' WHERE draft_id=$1 AND consumed_proposal_id IS NULL AND revoked_at IS NULL",
            [expiring.id],
          );
          await page.reload();
          await page.getByRole("button", { name: "Send to your agent", exact: true }).click();
          await expect(
            page.getByRole("heading", { name: "These upload instructions expired." }),
          ).toBeVisible();
          await page.getByRole("button", { name: "Create new instructions", exact: true }).click();
          await expect(instructions).toBeVisible();
        }
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          true,
        );
      },
    );
});
