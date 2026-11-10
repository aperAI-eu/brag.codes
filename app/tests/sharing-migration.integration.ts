import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import {
  ownedFixture,
  bootstrapSchema6,
  migrateCandidate,
  restoreOwned,
} from "./fixtures/owned-migration.ts";
import {
  seedSchema6,
  seedSharingRows,
  historicalTables,
  sharingTables,
  rows,
} from "./fixtures/sharing-storage.ts";
import { emptyProject } from "../src/projects/model.ts";
import { createDatabase } from "../src/lib/database/client.ts";
import { isDatabaseReady } from "../src/lib/runtime/health.ts";

import { sharingRecoveryChecks } from "./sharing-recovery.integration.ts";
import { sharingGrantChecks } from "./sharing-grants.integration.ts";

const fixture = await ownedFixture();
const admin = new pg.Client({ connectionString: fixture.adminUrl });
const runtime = new pg.Client({ connectionString: fixture.runtimeUrl });
const migrator = new pg.Client({ connectionString: fixture.migrationUrl });
const denied = (code: string) => (error: { code?: string }) => error.code === code;
const migrationPath = "app/prisma/migrations/202611080007_sharing/migration.sql";

test("sharing storage upgrade from populated schema 6 in an owned database", async (t) => {
  await Promise.all([admin.connect(), runtime.connect(), migrator.connect()]);
  try {
    await bootstrapSchema6(fixture);
    assert.equal(
      (await admin.query("SELECT schema_version FROM brag.runtime_metadata")).rows[0]
        .schema_version,
      6,
    );
    const seeded = await seedSchema6(admin);
    const before = await rows(admin, historicalTables);
    await t.test(
      "invalid provenance aborts the whole forward SQL without partial storage",
      async () => {
        const pitch = seeded.reservations.find((r) => r.pitch)!.pitch;
        await admin.query("UPDATE brag.voice_pitch SET policy='unknown-policy' WHERE id=$1", [
          pitch,
        ]);
        await assert.rejects(
          migrator.query(await readFile(migrationPath, "utf8")),
          /historical pitch policy/,
        );
        await migrator.query("ROLLBACK");
        assert.equal(
          (
            await admin.query(
              "SELECT schema_version, to_regclass('brag.author_event') AS links FROM brag.runtime_metadata",
            )
          ).rows[0].links,
          null,
        );
        assert.equal(
          (await admin.query("SELECT schema_version FROM brag.runtime_metadata")).rows[0]
            .schema_version,
          6,
        );
        await admin.query("UPDATE brag.voice_pitch SET policy=$2 WHERE id=$1", [
          pitch,
          before.voice_pitch.find((p) => p.id === pitch)!.policy,
        ]);
        assert.deepEqual(await rows(admin, historicalTables), before);
        const draftId = seeded.reservations[0].id;
        const original = before.project_draft.find((d) => d.id === draftId)!.fields;
        await admin.query(
          "UPDATE brag.project_draft SET fields=jsonb_set(fields,'{title}','[]') WHERE id=$1",
          [draftId],
        );
        await assert.rejects(
          migrator.query(await readFile(migrationPath, "utf8")),
          /Ambiguous historical project record/,
        );
        await migrator.query("ROLLBACK");
        await admin.query("UPDATE brag.project_draft SET fields=$2 WHERE id=$1", [
          draftId,
          original,
        ]);
        const badKey = randomUUID();
        await admin.query(
          "INSERT INTO brag.draft_mutation(actor_id,key,intent_hash,result) VALUES ($1,$2,$3,$4)",
          [seeded.owner, badKey, "f".repeat(64), { draft: { id: draftId, version: 2 } }],
        );
        await assert.rejects(
          migrator.query(await readFile(migrationPath, "utf8")),
          /Historical content receipt exceeds draft version/,
        );
        await migrator.query("ROLLBACK");
        await admin.query("DELETE FROM brag.draft_mutation WHERE actor_id=$1 AND key=$2", [
          seeded.owner,
          badKey,
        ]);
        assert.deepEqual(await rows(admin, historicalTables), before);
      },
    );
    await sharingRecoveryChecks(t, fixture, admin, runtime, migrator);
    await t.test(
      "real Prisma migration applies once, repeats safely and preserves original history",
      async () => {
        const first = migrateCandidate(fixture);
        assert.equal(first.status, 0, first.output);
        const replay = migrateCandidate(fixture);
        assert.equal(replay.status, 0, replay.output);
        assert.equal(
          (
            await admin.query(
              "SELECT count(*)::int AS n FROM brag._prisma_migrations WHERE finished_at IS NOT NULL",
            )
          ).rows[0].n,
          15,
        );
        assert.equal(
          (await admin.query("SELECT schema_version FROM brag.runtime_metadata")).rows[0]
            .schema_version,
          15,
        );
        const after = await rows(admin, historicalTables);
        for (const table of historicalTables) {
          const normalized = after[table].map((row) => {
            const copy = { ...row };
            for (const column of [
              "event_scope",
              "confirmed_version",
              "confirmed_at",
              "discarded_at",
              "deleted_at",
              "legacy_record",
              "admitted_at",
              "sample_count",
              "legacy_received",
              "audio_removed_at",
              "recovery_config_version",
              "transcription_attempt",
              "transcription_started_at",
            ])
              delete copy[column];
            if (table === "agent_handoff") copy.revoked = false;
            if (table === "agent_request") copy.state = "approved";
            return copy;
          });
          const stable = (values: unknown[]) => values.map((value) => JSON.stringify(value)).sort();
          assert.deepEqual(stable(normalized), stable(before[table]), table);
        }
      },
    );
    await t.test(
      "empty reservations remain unconfirmed regardless of pitch state; legacy data retains language",
      async () => {
        for (const reservation of seeded.reservations) {
          const row = (
            await runtime.query("SELECT * FROM brag.project_draft WHERE id=$1", [reservation.id])
          ).rows[0];
          assert.equal(row.legacy_record, false, reservation.label);
          assert.equal(row.confirmed_version, null);
          assert.equal(row.confirmed_at, null);
          assert.equal(row.discarded_at, null);
        }
        const saved = await runtime.query(
          "SELECT id,fields,legacy_record,confirmed_version FROM brag.project_draft WHERE legacy_record",
        );
        assert.deepEqual(saved.rows.map((r) => r.id).sort(), seeded.legacy.sort());
        assert.ok(saved.rows.every((r) => r.confirmed_version === null));
        assert.deepEqual(
          saved.rows
            .map((r) => r.fields.language)
            .filter(Boolean)
            .sort(),
          ["cs", "en", "sk"],
        );
        assert.equal(
          (await runtime.query("SELECT count(*)::int AS n FROM brag.agent_proposal")).rows[0].n,
          0,
        );
        assert.ok(
          (
            await runtime.query(
              "SELECT legacy_received,admitted_at,sample_count FROM brag.voice_pitch",
            )
          ).rows.every(
            (r) => r.legacy_received && r.admitted_at === null && r.sample_count === null,
          ),
        );
        for (const state of ["cancelled", "failed"]) {
          const reservation = seeded.reservations.find((r) => r.label === "ready")!;
          await runtime.query("UPDATE brag.voice_pitch SET status=$2,proposal=NULL WHERE id=$1", [
            reservation.pitch,
            state,
          ]);
          const row = (
            await runtime.query(
              "SELECT confirmed_version,legacy_record FROM brag.project_draft WHERE id=$1",
              [reservation.id],
            )
          ).rows[0];
          assert.deepEqual(row, { confirmed_version: null, legacy_record: false });
        }
        // No maintenance tick is needed to maintain confirmation facts. Derived clock-state and admission are T010/T011.
        assert.equal(
          (
            await runtime.query(
              "SELECT count(*)::int AS n FROM brag.project_draft WHERE confirmed_version IS NOT NULL",
            )
          ).rows[0].n,
          0,
        );
      },
    );
    await t.test(
      "backfilled links use earliest creation and preserve closed/suspended event settings",
      async () => {
        const links = (await runtime.query("SELECT * FROM brag.author_event")).rows;
        assert.equal(links.length, 3);
        for (const link of links) {
          assert.equal(link.origin, "legacy_project");
          const min = (
            await runtime.query(
              "SELECT min(created_at) AS earliest FROM brag.project_draft WHERE owner_id=$1 AND event_id=$2",
              [link.owner_id, link.event_id],
            )
          ).rows[0].earliest;
          assert.deepEqual(link.linked_at, min);
        }
        assert.deepEqual((await rows(runtime, ["event"])).event, before.event);
        await assert.rejects(
          runtime.query(
            "INSERT INTO brag.project_draft(id,owner_id,event_id,fields) VALUES ($1,$2,$3,$4)",
            [randomUUID(), seeded.other, seeded.live, emptyProject],
          ),
          denied("23503"),
        );
        await assert.rejects(
          runtime.query("UPDATE brag.author_event SET origin='qr_scan'"),
          denied("42501"),
        );
        await assert.rejects(runtime.query("DELETE FROM brag.author_event"), denied("42501"));
      },
    );
    await t.test(
      "runtime cannot invent historical provenance or confirmation during insert",
      async () => {
        const id = seeded.reservations[0].id;
        await assert.rejects(
          runtime.query("UPDATE brag.project_draft SET legacy_record=true WHERE id=$1", [id]),
          denied("42501"),
        );
        await assert.rejects(
          runtime.query(
            "INSERT INTO brag.project_draft(id,owner_id,event_id,fields,legacy_record) VALUES ($1,$2,$3,$4,true)",
            [randomUUID(), seeded.owner, seeded.live, emptyProject],
          ),
          denied("42501"),
        );
        await assert.rejects(
          runtime.query(
            "INSERT INTO brag.project_draft(id,owner_id,event_id,fields,confirmed_version) VALUES ($1,$2,$3,$4,1)",
            [randomUUID(), seeded.owner, seeded.live, emptyProject],
          ),
          denied("42501"),
        );
        await assert.rejects(
          runtime.query("UPDATE brag.voice_pitch SET legacy_received=true"),
          denied("42501"),
        );
        const insert =
          "INSERT INTO brag.voice_pitch(id,draft_id,owner_id,key,media_hash,base_version,policy,status";
        const values = [randomUUID(), id, seeded.owner, randomUUID(), "a".repeat(64)];
        await assert.rejects(
          runtime.query(
            insert +
              ",legacy_received) VALUES ($1,$2,$3,$4,$5,1,'pitch-20s-auto-distill-claude-v2','queued',true)",
            values,
          ),
          denied("42501"),
        );
        await assert.rejects(
          runtime.query(
            insert + ") VALUES ($1,$2,$3,$4,$5,1,'pitch-20s-auto-distill-claude-v2','queued')",
            values,
          ),
          denied("23514"),
        );
        await assert.rejects(
          runtime.query(
            insert +
              ") VALUES ($1,$2,$3,$4,$5,1,'pitch-30s-pause-auto-distill-claude-v3','queued')",
            values,
          ),
          denied("23514"),
        );
        await assert.rejects(
          runtime.query(
            insert +
              ",admitted_at,sample_count) VALUES ($1,$2,$3,$4,$5,1,'pitch-30s-pause-auto-distill-claude-v3','queued',now(),480001)",
            values,
          ),
          denied("23514"),
        );
        await runtime.query(
          insert +
            ",admitted_at,sample_count) VALUES ($1,$2,$3,$4,$5,1,'pitch-30s-pause-auto-distill-claude-v3','queued',now(),480000)",
          values,
        );
        await assert.rejects(
          runtime.query(
            "UPDATE brag.voice_pitch SET admitted_at=now(),sample_count=1 WHERE id=$1",
            [values[0]],
          ),
          denied("42501"),
        );
      },
    );
    await t.test(
      "confirmation and discard facts cannot regress or bypass NULL checks",
      async () => {
        const id = seeded.reservations[0].id;
        for (const assignment of [
          "confirmed_version=1",
          "confirmed_at=now()",
          "confirmed_version=0,confirmed_at=now()",
          "confirmed_version=2,confirmed_at=now()",
          "confirmed_version=1,confirmed_at='infinity'",
        ])
          await assert.rejects(
            runtime.query(`UPDATE brag.project_draft SET ${assignment} WHERE id=$1`, [id]),
            denied("23514"),
          );
        await runtime.query(
          "UPDATE brag.project_draft SET version=2,confirmed_version=2,confirmed_at=now() WHERE id=$1",
          [id],
        );
        for (const assignment of [
          "confirmed_version=NULL,confirmed_at=NULL",
          "confirmed_version=1",
          "confirmed_at=now()+interval '1 hour'",
          "version=3,confirmed_version=3,confirmed_at=confirmed_at-interval '1 hour'",
          "discarded_at=now()",
        ])
          await assert.rejects(
            runtime.query(`UPDATE brag.project_draft SET ${assignment} WHERE id=$1`, [id]),
            denied("23514"),
          );
        const discard = seeded.reservations.find((r) => r.label === "ready")!.id;
        await runtime.query("UPDATE brag.project_draft SET discarded_at=now() WHERE id=$1", [
          discard,
        ]);
        await assert.rejects(
          runtime.query("UPDATE brag.project_draft SET discarded_at=NULL WHERE id=$1", [discard]),
          denied("23514"),
        );
        for (const change of ["version=version+1", 'last_edit=\'{"method":"typed"}\''])
          await assert.rejects(
            runtime.query(`UPDATE brag.project_draft SET ${change} WHERE id=$1`, [discard]),
            denied("23514"),
          );
        await assert.rejects(
          runtime.query(
            "UPDATE brag.project_draft SET fields=jsonb_set(fields,'{title}','\"Revived\"') WHERE id=$1",
            [discard],
          ),
          denied("23514"),
        );
        await assert.rejects(
          runtime.query("UPDATE brag.project_draft SET discarded_at=now() WHERE id=$1", [
            seeded.legacy[0],
          ]),
          denied("23514"),
        );
      },
    );
    await t.test(
      "legacy pairing is revoked; revised upload receipt is atomic and bound to its draft",
      async () => {
        assert.ok(
          (await runtime.query("SELECT revoked FROM brag.agent_handoff")).rows.every(
            (r) => r.revoked,
          ),
        );
        assert.ok(
          (await runtime.query("SELECT state FROM brag.agent_request")).rows.every(
            (r) => r.state === "declined",
          ),
        );
        const sample = await seedSharingRows(runtime);
        await assert.rejects(
          runtime.query("UPDATE brag.agent_proposal_upload SET secret_hash=secret_hash"),
          denied("42501"),
        );
        await assert.rejects(
          runtime.query("UPDATE brag.agent_proposal SET request_key=request_key"),
          denied("42501"),
        );
        await assert.rejects(
          runtime.query(
            "UPDATE brag.agent_proposal_upload SET consumed_proposal_id=NULL,consumed_at=NULL WHERE id=$1",
            [sample.upload],
          ),
          denied("23514"),
        );
        await assert.rejects(
          runtime.query("UPDATE brag.agent_proposal SET fields=$2 WHERE id=$1", [
            sample.proposal,
            { ...emptyProject, title: "Overwritten" },
          ]),
          denied("23514"),
        );
        await assert.rejects(
          runtime.query("UPDATE brag.agent_proposal SET accepted_version=1 WHERE id=$1", [
            sample.proposal,
          ]),
          denied("23514"),
        );
        await runtime.query("UPDATE brag.agent_proposal SET accepted_version=2 WHERE id=$1", [
          sample.proposal,
        ]);
        await assert.rejects(
          runtime.query("UPDATE brag.agent_proposal SET accepted_version=NULL WHERE id=$1", [
            sample.proposal,
          ]),
          denied("23514"),
        );
        await runtime.query(
          "UPDATE brag.agent_proposal SET fields=NULL,cleared_at=now() WHERE id=$1",
          [sample.proposal],
        );
        await assert.rejects(
          runtime.query("UPDATE brag.agent_proposal SET fields=$2 WHERE id=$1", [
            sample.proposal,
            emptyProject,
          ]),
          denied("23514"),
        );
        await assert.rejects(
          runtime.query(
            "INSERT INTO brag.agent_proposal_upload(id,draft_id,owner_id,event_id,base_version,secret_hash) VALUES ($1,$2,$3,$4,1,$5)",
            [randomUUID(), sample.draft, seeded.other, sample.event, "c".repeat(64)],
          ),
          denied("23503"),
        );
        // Full proposal data remains in another populated row for recovery comparisons.
        await seedSharingRows(runtime, "sharing-retained-owner");
      },
    );
    await sharingGrantChecks(t, runtime, fixture.runtimeUrl, seeded.owner, seeded.live);
    await t.test("populated backup restores exact private rows and narrow grants", async () => {
      const url = await restoreOwned(fixture, "brag_restore_sharing");
      const restored = new pg.Client({ connectionString: url });
      await restored.connect();
      const db = createDatabase(url);
      try {
        assert.equal(await isDatabaseReady(db), true);
        const tables = [...historicalTables, ...sharingTables];
        const original = await rows(runtime, tables),
          copy = await rows(restored, tables);
        for (const table of tables) {
          assert.ok(original[table].length > 0, table);
          const stable = (values: unknown[]) => values.map((v) => JSON.stringify(v)).sort();
          assert.deepEqual(stable(copy[table]), stable(original[table]), table);
        }
        await assert.rejects(
          restored.query("UPDATE brag.project_draft SET legacy_record=true"),
          denied("42501"),
        );
        await assert.rejects(
          restored.query("UPDATE brag.agent_proposal_upload SET secret_hash=secret_hash"),
          denied("42501"),
        );
      } finally {
        await restored.end();
        await db.$disconnect();
      }
    });
    await t.test(
      "readiness rejects an older binary and expanded historical insert privileges",
      async () => {
        const db = createDatabase(fixture.runtimeUrl);
        try {
          assert.equal(await isDatabaseReady(db), true);
          await admin.query("GRANT INSERT(legacy_received) ON brag.voice_pitch TO brag_runtime");
          assert.equal(await isDatabaseReady(db), false);
          await admin.query("REVOKE INSERT(legacy_received) ON brag.voice_pitch FROM brag_runtime");
          assert.equal(await isDatabaseReady(db), true);
          // The old expected-schema predicate cannot admit this database.
          assert.equal(
            (await runtime.query("SELECT schema_version=6 AS old_ready FROM brag.runtime_metadata"))
              .rows[0].old_ready,
            false,
          );
        } finally {
          await db.$disconnect();
        }
      },
    );
  } finally {
    await Promise.allSettled([admin.end(), runtime.end(), migrator.end()]);
  }
});
