import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import type { OwnedFixture } from "./fixtures/owned-migration.ts";
import { identity, event, draft, pitch } from "./fixtures/sharing-history.ts";
import type { RuntimeConfig } from "../src/lib/config/runtime.ts";
import type { BragAuth } from "../src/lib/auth/config.ts";
import type { createDatabase } from "../src/lib/database/client.ts";
import { Prisma } from "../src/generated/prisma/client.ts";
import { eventOperations } from "../src/lib/events/operations.ts";
import { EventError } from "../src/lib/events/validation.ts";
import { sharingOperations } from "../src/lib/sharing/operations.ts";
import { linkedEvents, projectProjection } from "../src/lib/sharing/projection.ts";

async function waitingOnLock(admin: pg.Client) {
  for (let i = 0; i < 100; i++) {
    const { rows } = await admin.query(
      "SELECT 1 FROM pg_stat_activity WHERE usename='brag_runtime' AND wait_event_type='Lock'",
    );
    if (rows.length) return;
    await pause(5);
  }
  assert.fail("operation did not reach the database lock barrier");
}
export async function boundaryChecks(
  t: TestContext,
  fixture: OwnedFixture,
  admin: pg.Client,
  db: ReturnType<typeof createDatabase>,
  auth: BragAuth,
  config: RuntimeConfig,
) {
  const ops = sharingOperations(auth, db, config.origin);
  await t.test(
    "linking rechecks alias removal and suspension after a real event-lock wait",
    async () => {
      const locker = new pg.Client({ connectionString: fixture.adminUrl });
      await locker.connect();
      const owner = await identity(admin, config.authSecret);
      try {
        for (const change of ["suspend", "remove_alias"]) {
          const e = await event(admin);
          await locker.query("BEGIN");
          await locker.query("SELECT id FROM brag.event WHERE id=$1 FOR UPDATE", [e.id]);
          const pending = ops.link(owner.headers, randomUUID(), {
            url: e.url,
            entry_method: "qr_scan",
          });
          const denied = assert.rejects(pending, (error: EventError) => error.status === 404);
          await waitingOnLock(admin);
          if (change === "suspend")
            await locker.query("UPDATE brag.event SET approval='suspended' WHERE id=$1", [e.id]);
          else
            await locker.query(
              "UPDATE brag.event_source_alias SET state='removed' WHERE event_id=$1",
              [e.id],
            );
          await locker.query("COMMIT");
          await denied;
          assert.equal(
            await db.authorEvent.count({ where: { ownerId: owner.owner, eventId: e.id } }),
            0,
          );
          assert.equal(
            await db.authorEventMutation.count({ where: { actorId: owner.owner, eventId: e.id } }),
            0,
          );
        }
      } finally {
        await locker.query("ROLLBACK");
        await locker.end();
      }
    },
  );
  await t.test(
    "admin alias mutations acquire event before alias; link and admin commits have no lock inversion",
    async () => {
      const operator = await identity(admin, config.authSecret),
        author = await identity(admin, config.authSecret),
        e = await event(admin);
      await admin.query(
        'INSERT INTO brag.platform_role("userId",role,active,version,"updatedAt") VALUES ($1,\'platform_admin\',true,1,now())',
        [operator.owner],
      );
      const alias = await db.eventSourceAlias.findFirstOrThrow({ where: { eventId: e.id } });
      const locker = new pg.Client({ connectionString: fixture.adminUrl });
      await locker.connect();
      try {
        await locker.query("BEGIN");
        await locker.query("SELECT id FROM brag.event WHERE id=$1 FOR UPDATE", [e.id]);
        const change = eventOperations(auth, db, config.origin).mutate(
          operator.headers,
          "remove_alias",
          e.id,
          randomUUID(),
          {
            expected_version: 1,
            expected_alias_version: 1,
            alias_id: alias.id,
            reason: "Synthetic lock-order check",
          },
        );
        await waitingOnLock(admin);
        // NOWAIT proves the waiting admin writer has not already acquired its alias row.
        await locker.query("SELECT id FROM brag.event_source_alias WHERE id=$1 FOR UPDATE NOWAIT", [
          alias.id,
        ]);
        const link = ops.link(author.headers, randomUUID(), {
          url: e.url,
          entry_method: "pasted_url",
        });
        const denied = assert.rejects(link, (error: EventError) => error.status === 404);
        await locker.query("COMMIT");
        assert.equal((await change).status, 200);
        await denied;
      } finally {
        await locker.query("ROLLBACK");
        await locker.end();
      }
    },
  );
  await t.test(
    "single shared SQL predicate changes at exact window, lease, 15-minute and 30-day instants",
    async () => {
      const owner = await identity(admin, config.authSecret),
        e = await event(admin);
      const id = await draft(admin, owner.owner, e.id, "confirmed"),
        p = await pitch(admin, owner.owner, id, "queued");
      const instant = "2035-01-02T12:00:00.000Z";
      await admin.query(
        "UPDATE brag.event SET submissions_open_at=$2::timestamptz,submissions_close_at=$2::timestamptz+interval '1 day' WHERE id=$1",
        [e.id, instant],
      );
      const snapshot = async () => {
        const [row] = await db.$queryRaw<
          { eligible: boolean; review_state: string; pitch_state: string }[]
        >(Prisma.sql`
        WITH moment AS (SELECT ${instant}::timestamptz AS as_of),${linkedEvents(owner.owner, config.origin)},${projectProjection(owner.owner)}
        SELECT l.eligible,p.review_state,p.pitch_state FROM projects p JOIN linked l ON l.id=p.event_id`);
        return row;
      };
      await admin.query(
        "UPDATE brag.voice_pitch SET created_at=$2::timestamptz-interval '15 minutes'+interval '1 microsecond' WHERE id=$1",
        [p, instant],
      );
      assert.deepEqual(await snapshot(), {
        eligible: true,
        review_state: "pending_review",
        pitch_state: "queued",
      });
      await admin.query(
        "UPDATE brag.voice_pitch SET created_at=$2::timestamptz-interval '15 minutes' WHERE id=$1",
        [p, instant],
      );
      assert.equal((await snapshot()).review_state, "confirmed");
      await admin.query(
        "UPDATE brag.event SET submissions_open_at=$2::timestamptz-interval '1 day',submissions_close_at=$2::timestamptz WHERE id=$1",
        [e.id, instant],
      );
      assert.equal((await snapshot()).eligible, false);
      await admin.query(
        "UPDATE brag.voice_pitch SET status='structuring',created_at=$2::timestamptz-interval '1 minute',lease_until=$2::timestamptz WHERE id=$1",
        [p, instant],
      );
      assert.equal((await snapshot()).pitch_state, "failed");
      await admin.query("UPDATE brag.voice_pitch SET status='dispatching' WHERE id=$1", [p]);
      assert.equal((await snapshot()).pitch_state, "uncertain");
      await admin.query(
        "UPDATE brag.voice_pitch SET status='transcribing',created_at=$2::timestamptz-interval '720 hours' WHERE id=$1",
        [p, instant],
      );
      assert.deepEqual(await snapshot(), {
        eligible: false,
        review_state: "confirmed",
        pitch_state: "expired",
      });
    },
  );
  await t.test(
    "direct history/link operations make no outbound requests and failed storage returns a bounded HTTP error",
    async () => {
      const owner = await identity(admin, config.authSecret),
        e = await event(admin);
      const original = globalThis.fetch;
      let network = 0;
      globalThis.fetch = async () => {
        network++;
        throw new Error("Unexpected network access");
      };
      try {
        await ops.link(owner.headers, randomUUID(), { url: e.url, entry_method: "pasted_url" });
        await ops.context(owner.headers);
        await ops.events(owner.headers);
        await ops.projects(owner.headers);
        assert.equal(network, 0);
      } finally {
        globalThis.fetch = original;
      }
      await admin.query("REVOKE SELECT ON brag.author_event FROM brag_runtime");
      try {
        const r = await fetch(config.origin + "/api/v1/me/share-context", {
          headers: owner.headers,
        });
        assert.equal(r.status, 503);
        const body = await r.json();
        assert.equal(body.error.code, "temporarily_unavailable");
        assert.match(body.error.request_id, /^[a-f0-9-]{36}$/);
        assert.deepEqual(Object.keys(body.error).sort(), ["code", "request_id"]);
      } finally {
        await admin.query("GRANT SELECT ON brag.author_event TO brag_runtime");
      }
    },
  );
}
