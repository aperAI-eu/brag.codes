import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import type pg from "pg";
import type { sharingOperations } from "../src/lib/sharing/operations.ts";
import type { ProjectSummary } from "../src/lib/sharing/queries.ts";
import { draft, pitch, agent } from "./fixtures/sharing-history.ts";

export async function lifecycleChecks(
  t: TestContext,
  admin: pg.Client,
  ops: ReturnType<typeof sharingOperations>,
  owner: { owner: string; headers: Headers; cookie: string },
  eventId: string,
  call: (path: string, method?: string, input?: unknown, cookie?: string) => Promise<Response>,
) {
  const expected = new Map<
    string,
    {
      state: string;
      attention: string | null;
      status: string | null;
      saved: boolean;
      unfinished: boolean;
    }
  >();
  async function all(state: string) {
    const rows: ProjectSummary[] = [];
    let cursor: string | null = null;
    do {
      const page = await ops.projects(owner.headers, {
        state,
        event_id: eventId,
        ...(cursor ? { cursor } : {}),
      });
      rows.push(...page.projects);
      cursor = page.next_cursor;
    } while (cursor);
    return rows;
  }
  await t.test(
    "confirmed, legacy and reserved rows derive terminal and active pitch states with maintenance paused",
    async () => {
      const outcomes = [
        { status: "queued", effective: "queued", attention: "processing" },
        {
          status: "dispatching",
          lease: "1 minute",
          effective: "dispatching",
          attention: "processing",
        },
        { status: "transcribing", effective: "transcribing", attention: "processing" },
        { status: "structure_queued", effective: "structure_queued", attention: "processing" },
        {
          status: "structuring",
          lease: "1 minute",
          effective: "structuring",
          attention: "processing",
        },
        { status: "ready", effective: "ready", attention: "review" },
        { status: "failed", effective: "failed", attention: null },
        { status: "cancelled", effective: "cancelled", attention: null },
        { status: "uncertain", effective: "uncertain", attention: null },
        { status: "queued", age: "16 minutes", effective: "failed", attention: null },
        { status: "transcribing", age: "16 minutes", effective: "failed", attention: null },
        {
          status: "dispatching",
          age: "16 minutes",
          lease: "1 minute",
          effective: "uncertain",
          attention: null,
        },
        { status: "dispatching", lease: "-1 second", effective: "uncertain", attention: null },
        { status: "structuring", lease: "-1 second", effective: "failed", attention: null },
        { status: "ready", age: "31 days", effective: "expired", attention: null },
        { status: "ready", proposal: null, effective: "failed", attention: null },
      ];
      for (const kind of ["confirmed", "legacy", "reserved"])
        for (const outcome of outcomes) {
          const id = await draft(admin, owner.owner, eventId, kind);
          await pitch(admin, owner.owner, id, outcome.status, outcome);
          expected.set(id, {
            state: outcome.attention ? "pending_review" : kind,
            attention: outcome.attention,
            status: outcome.effective,
            saved: kind !== "reserved",
            unfinished: kind === "reserved" || outcome.attention !== null,
          });
        }
      const before = (
        await admin.query("SELECT id,status,proposal,transcript FROM brag.voice_pitch ORDER BY id")
      ).rows;
      const rows = await all("all");
      assert.equal(rows.length, expected.size);
      for (const row of rows) {
        const e = expected.get(row.id)!;
        assert.equal(row.review.state, e.state, row.id);
        assert.equal(row.review.attention, e.attention);
        assert.equal(row.pitch?.status, e.status);
        assert.equal(row.event?.submission_state, "closed");
      }
      assert.deepEqual(
        (
          await admin.query(
            "SELECT id,status,proposal,transcript FROM brag.voice_pitch ORDER BY id",
          )
        ).rows,
        before,
        "reads do not wait for or perform cleanup",
      );
    },
  );
  await t.test(
    "latest pitch is selected before state/base filtering; content pending survives processing precedence",
    async () => {
      const newest = await draft(admin, owner.owner, eventId, "confirmed");
      await pitch(admin, owner.owner, newest, "ready", { age: "2 minutes" });
      await pitch(admin, owner.owner, newest, "failed");
      expected.set(newest, {
        state: "confirmed",
        attention: null,
        status: "failed",
        saved: true,
        unfinished: false,
      });
      const stale = await draft(admin, owner.owner, eventId, "confirmed");
      await pitch(admin, owner.owner, stale, "ready", { base: 1 });
      expected.set(stale, {
        state: "confirmed",
        attention: null,
        status: "ready",
        saved: true,
        unfinished: false,
      });
      const pending = await draft(admin, owner.owner, eventId, "content_pending");
      await pitch(admin, owner.owner, pending, "transcribing", { base: 3 });
      expected.set(pending, {
        state: "pending_review",
        attention: "processing",
        status: "transcribing",
        saved: true,
        unfinished: true,
      });
      const rows = await all("all");
      assert.equal(rows.find((r) => r.id === pending)?.review.content_pending, true);
      for (const id of [newest, stale, pending]) {
        const row = rows.find((r) => r.id === id)!;
        assert.equal(row.review.state, expected.get(id)?.state);
        assert.equal(row.review.attention, expected.get(id)?.attention);
      }
      const discarded = await draft(admin, owner.owner, eventId, "discarded");
      assert.ok(!(await all("all")).some((r) => r.id === discarded));
    },
  );
  await t.test(
    "unused/revoked/expired credentials do not create pending work; retained received proposals do",
    async () => {
      for (const scenario of [
        { unused: true, revoked: true, pending: false },
        { unused: true, age: "1 hour", pending: false },
        { revoked: true, pending: true },
        { age: "1 hour", pending: true },
        { age: "31 days", pending: false },
        { cleared: true, pending: false },
        { accepted: true, pending: false },
        { base: 1, pending: false },
      ]) {
        const id = await draft(admin, owner.owner, eventId, "reserved");
        await agent(admin, owner.owner, eventId, id, scenario);
        expected.set(id, {
          state: scenario.pending ? "pending_review" : "reserved",
          attention: scenario.pending ? "review" : null,
          status: null,
          saved: false,
          unfinished: true,
        });
      }
      const rows = await all("all");
      for (const row of rows) {
        const e = expected.get(row.id)!;
        assert.equal(row.review.state, e.state);
        assert.equal(row.review.attention, e.attention);
      }
    },
  );
  await t.test(
    "context, every filter and HTTP summaries agree without leaking proposal/transcript/provider data",
    async () => {
      const saved = await all("saved"),
        unfinished = await all("unfinished"),
        rows = await all("all"),
        context = await ops.context(owner.headers);
      assert.equal(saved.length, [...expected.values()].filter((x) => x.saved).length);
      assert.equal(unfinished.length, [...expected.values()].filter((x) => x.unfinished).length);
      assert.equal(context.project_count, saved.length);
      assert.equal(context.unfinished_count, unfinished.length);
      assert.equal(rows.length, expected.size);
      assert.ok(saved.length + unfinished.length > rows.length);
      assert.deepEqual(
        new Set(saved.map((x) => x.id)),
        new Set([...expected].filter(([, e]) => e.saved).map(([id]) => id)),
      );
      const response = await call("projects?state=all&event_id=" + eventId);
      assert.equal(response.status, 200);
      const text = await response.text();
      for (const forbidden of [
        "secret-description",
        "secret-transcript",
        "secret-provider-id",
        "unsafe-upstream-message",
        "private-proposal",
        "proposal",
        "secret_hash",
        "original",
        "email",
      ])
        assert.ok(!text.includes(forbidden), forbidden);
      const body = JSON.parse(text);
      assert.deepEqual(body.projects, rows.slice(0, 50));
    },
  );
}
