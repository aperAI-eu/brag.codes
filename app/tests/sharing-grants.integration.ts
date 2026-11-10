import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { emptyProject } from "../src/projects/model.ts";
import { createDatabase } from "../src/lib/database/client.ts";

const denied = (code: string) => (error: { code?: string }) => error.code === code;
export async function sharingGrantChecks(
  t: TestContext,
  runtime: pg.Client,
  runtimeUrl: string,
  owner: string,
  event: string,
) {
  async function draft() {
    const id = randomUUID();
    await runtime.query(
      "INSERT INTO brag.project_draft(id,owner_id,event_id,fields) VALUES ($1,$2,$3,$4)",
      [id, owner, event, emptyProject],
    );
    return id;
  }
  const uploadSql =
    "INSERT INTO brag.agent_proposal_upload(id,draft_id,owner_id,event_id,base_version,secret_hash) VALUES ($1,$2,$3,$4,1,$5)";
  const uploadValues = (id: string, target: string) => [
    id,
    target,
    owner,
    event,
    randomUUID().replaceAll("-", "").repeat(2),
  ];
  const proposalSql =
    "INSERT INTO brag.agent_proposal(id,upload_id,draft_id,owner_id,event_id,base_version,request_key,intent_hash,fields) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)";
  const proposalValues = (
    id: string,
    upload: string,
    target: string,
    base = 1,
    fields: unknown = emptyProject,
  ) => [id, upload, target, owner, event, base, randomUUID(), "a".repeat(64), fields];
  async function receive(upload: string, target: string) {
    const id = randomUUID();
    await runtime.query("BEGIN");
    try {
      await runtime.query(proposalSql, proposalValues(id, upload, target));
      await runtime.query(
        "UPDATE brag.agent_proposal_upload SET consumed_proposal_id=$1,consumed_at=(SELECT received_at FROM brag.agent_proposal WHERE id=$1) WHERE id=$2",
        [id, upload],
      );
      await runtime.query("COMMIT");
      return id;
    } catch (error) {
      await runtime.query("ROLLBACK");
      throw error;
    }
  }
  await t.test(
    "unused capability uniqueness, irreversible revocation and fixed expiry",
    async () => {
      const target = await draft(),
        id = randomUUID(),
        duplicate = randomUUID();
      await runtime.query(uploadSql, uploadValues(id, target));
      await assert.rejects(
        runtime.query(uploadSql, uploadValues(duplicate, target)),
        denied("23505"),
      );
      await runtime.query("UPDATE brag.agent_proposal_upload SET revoked_at=now() WHERE id=$1", [
        id,
      ]);
      await assert.rejects(
        runtime.query("UPDATE brag.agent_proposal_upload SET revoked_at=NULL WHERE id=$1", [id]),
        denied("23514"),
      );
      await runtime.query(uploadSql, uploadValues(duplicate, target));
      await assert.rejects(
        runtime.query(
          "UPDATE brag.agent_proposal_upload SET expires_at=expires_at+interval '1 hour' WHERE id=$1",
          [id],
        ),
        denied("42501"),
      );
      await assert.rejects(
        runtime.query(
          "INSERT INTO brag.agent_proposal_upload(id,draft_id,owner_id,event_id,base_version,secret_hash,expires_at) VALUES ($1,$2,$3,$4,1,$5,now()+interval '31 minutes')",
          uploadValues(randomUUID(), await draft()),
        ),
        denied("42501"),
      );
      await assert.rejects(
        runtime.query(uploadSql, [
          randomUUID(),
          await draft(),
          owner,
          event,
          "plaintext-is-not-a-hash",
        ]),
        denied("23514"),
      );
      await assert.rejects(
        runtime.query("UPDATE brag.agent_proposal_upload SET consumed_proposal_id=$2 WHERE id=$1", [
          duplicate,
          randomUUID(),
        ]),
        denied("23514"),
      );
      await assert.rejects(
        runtime.query(
          "UPDATE brag.agent_proposal_upload SET consumed_proposal_id=$2,consumed_at=expires_at WHERE id=$1",
          [duplicate, randomUUID()],
        ),
        denied("23514"),
      );
      await assert.rejects(
        runtime.query(
          "UPDATE brag.agent_proposal_upload SET consumed_proposal_id=$2,consumed_at=now() WHERE id=$1",
          [id, randomUUID()],
        ),
        denied("23514"),
      );
    },
  );
  await t.test(
    "receipt and consumption cannot commit separately or bind a different target/base",
    async () => {
      const target = await draft(),
        id = randomUUID();
      await runtime.query(uploadSql, uploadValues(id, target));
      await assert.rejects(
        runtime.query(proposalSql, proposalValues(randomUUID(), id, target, 2)),
        denied("23503"),
      );
      await assert.rejects(
        runtime.query(proposalSql, proposalValues(randomUUID(), id, await draft())),
        denied("23503"),
      );
      await assert.rejects(
        runtime.query(proposalSql, proposalValues(randomUUID(), id, target, 1, null)),
        denied("23514"),
      );
      const missingLanguage = structuredClone(emptyProject);
      delete missingLanguage.language;
      await assert.rejects(
        runtime.query(proposalSql, proposalValues(randomUUID(), id, target, 1, missingLanguage)),
        denied("23514"),
      );
      await runtime.query("BEGIN");
      await runtime.query(proposalSql, proposalValues(randomUUID(), id, target));
      await assert.rejects(runtime.query("COMMIT"), denied("23503"));
      await runtime.query("ROLLBACK");
      assert.equal(
        (
          await runtime.query(
            "SELECT count(*)::int AS n FROM brag.agent_proposal WHERE upload_id=$1",
            [id],
          )
        ).rows[0].n,
        0,
      );
      await assert.rejects(
        runtime.query(
          "UPDATE brag.agent_proposal_upload SET consumed_proposal_id=$2,consumed_at=now() WHERE id=$1",
          [id, randomUUID()],
        ),
        denied("23503"),
      );
      const proposal = await receive(id, target);
      assert.equal(
        (
          await runtime.query(
            "SELECT consumed_proposal_id FROM brag.agent_proposal_upload WHERE id=$1",
            [id],
          )
        ).rows[0].consumed_proposal_id,
        proposal,
      );
      const second = randomUUID();
      await runtime.query(uploadSql, uploadValues(second, target));
      await assert.rejects(
        runtime.query(proposalSql, proposalValues(randomUUID(), second, target)),
        denied("23503"),
      );
      // A subsequent round is legal only with its own reciprocal consumption receipt.
      const secondProposal = await receive(second, target);
      assert.notEqual(secondProposal, proposal);
      assert.equal(
        (
          await runtime.query(
            "SELECT count(*)::int AS n FROM brag.agent_proposal WHERE draft_id=$1",
            [target],
          )
        ).rows[0].n,
        2,
      );
      await assert.rejects(
        runtime.query("UPDATE brag.agent_proposal SET fields=NULL WHERE id=$1", [proposal]),
        denied("23514"),
      );
      await runtime.query(
        "UPDATE brag.agent_proposal SET fields=NULL,cleared_at=now() WHERE id=$1",
        [proposal],
      );
      await assert.rejects(
        runtime.query("UPDATE brag.agent_proposal SET cleared_at=NULL WHERE id=$1", [proposal]),
        denied("23514"),
      );
      await assert.rejects(
        runtime.query("UPDATE brag.agent_proposal SET fields=$2,cleared_at=NULL WHERE id=$1", [
          proposal,
          emptyProject,
        ]),
        denied("23514"),
      );
      await assert.rejects(
        runtime.query("UPDATE brag.agent_proposal SET retention_deadline=now() WHERE id=$1", [
          proposal,
        ]),
        denied("42501"),
      );
      await assert.rejects(
        runtime.query("DELETE FROM brag.agent_proposal WHERE id=$1", [proposal]),
        denied("42501"),
      );
    },
  );
  await t.test(
    "legacy pairing rows cannot be created, revived or approved by runtime SQL",
    async () => {
      await assert.rejects(
        runtime.query("UPDATE brag.agent_handoff SET revoked=false"),
        denied("42501"),
      );
      await assert.rejects(
        runtime.query("UPDATE brag.agent_request SET state='approved'"),
        denied("42501"),
      );
      await assert.rejects(
        runtime.query(
          "INSERT INTO brag.agent_handoff(code,draft_id,owner_id,expires_at) VALUES ('forbidden',$1,$2,now())",
          [await draft(), owner],
        ),
        denied("42501"),
      );
      await assert.rejects(
        runtime.query(
          "INSERT INTO brag.agent_request(id,code,secret_hash,verification_code,state,expires_at) VALUES ($1,'forbidden','hash','code','pending',now())",
          [randomUUID()],
        ),
        denied("42501"),
      );
    },
  );
  await t.test(
    "runtime cannot forge receipt times, consume revoked authority or invent historical links",
    async () => {
      const target = await draft(),
        id = randomUUID();
      await runtime.query(uploadSql, uploadValues(id, target));
      await assert.rejects(
        runtime.query(
          "INSERT INTO brag.agent_proposal_upload(id,draft_id,owner_id,event_id,base_version,secret_hash,created_at,expires_at) VALUES ($1,$2,$3,$4,1,$5,now()+interval '1 year',now()+interval '1 year 30 minutes')",
          uploadValues(randomUUID(), await draft()),
        ),
        denied("42501"),
      );
      await runtime.query(
        "UPDATE brag.agent_proposal_upload SET revoked_at=now()+interval '1 year' WHERE id=$1",
        [id],
      );
      assert.equal(
        (
          await runtime.query(
            "SELECT revoked_at <= clock_timestamp() AND revoked_at >= created_at AS server_time FROM brag.agent_proposal_upload WHERE id=$1",
            [id],
          )
        ).rows[0].server_time,
        true,
      );
      await assert.rejects(
        runtime.query(
          "UPDATE brag.agent_proposal_upload SET consumed_proposal_id=$2,consumed_at=created_at WHERE id=$1",
          [id, randomUUID()],
        ),
        denied("23514"),
      );
      await assert.rejects(
        runtime.query(
          "INSERT INTO brag.agent_proposal(id,upload_id,draft_id,owner_id,event_id,base_version,request_key,intent_hash,fields,received_at,retention_deadline) VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,now()-interval '1 year',now()-interval '1 year'+interval '720 hours')",
          [randomUUID(), id, target, owner, event, randomUUID(), "c".repeat(64), emptyProject],
        ),
        denied("42501"),
      );
      const newOwner = "origin-fixture-" + randomUUID();
      await runtime.query(
        `INSERT INTO brag.auth_user(id,name,email,"updatedAt") VALUES ($1,'Fixture',$2,now())`,
        [newOwner, newOwner + "@example.test"],
      );
      await assert.rejects(
        runtime.query(
          "INSERT INTO brag.author_event(owner_id,event_id,origin) VALUES ($1,$2,'legacy_project')",
          [newOwner, event],
        ),
        denied("23514"),
      );
      await assert.rejects(
        runtime.query(
          "INSERT INTO brag.author_event(owner_id,event_id,origin,linked_at) VALUES ($1,$2,'pasted_url',now()-interval '1 year')",
          [newOwner, event],
        ),
        denied("42501"),
      );
      const db = createDatabase(runtimeUrl);
      try {
        const link = await db.authorEvent.create({
          data: { ownerId: newOwner, eventId: event, origin: "pasted_url" },
        });
        assert.equal(link.origin, "pasted_url");
      } finally {
        await db.$disconnect();
      }
      const upload = randomUUID(),
        next = await draft();
      await runtime.query(uploadSql, uploadValues(upload, next));
      await assert.rejects(
        runtime.query(
          proposalSql,
          proposalValues(randomUUID(), upload, next, 1, { ...emptyProject, schema_version: "1" }),
        ),
        denied("23514"),
      );
      const proposal = await receive(upload, next);
      await runtime.query(
        "UPDATE brag.agent_proposal SET fields=NULL,cleared_at=now() WHERE id=$1",
        [proposal],
      );
      await assert.rejects(
        runtime.query("UPDATE brag.agent_proposal SET accepted_version=2 WHERE id=$1", [proposal]),
        denied("23514"),
      );
    },
  );
  await t.test(
    "generated Prisma writes omit migration-only defaults under runtime column grants",
    async () => {
      const db = createDatabase(runtimeUrl);
      try {
        const d = await db.projectDraft.create({
          data: { id: randomUUID(), ownerId: owner, eventId: event, fields: emptyProject },
        });
        assert.equal(d.legacyRecord, false);
        assert.equal(d.confirmedAt, null);
        const p = await db.voicePitch.create({
          data: {
            id: randomUUID(),
            draftId: d.id,
            ownerId: owner,
            key: randomUUID(),
            mediaHash: "a".repeat(64),
            baseVersion: 1,
            policy: "pitch-30s-pause-auto-distill-claude-v3",
            status: "queued",
            admittedAt: new Date(),
            sampleCount: 16000,
          },
        });
        assert.equal(p.legacyReceived, false);
        const upload = await db.agentProposalUpload.create({
          data: {
            id: randomUUID(),
            draftId: d.id,
            ownerId: owner,
            eventId: event,
            baseVersion: 1,
            secretHash: randomUUID().replaceAll("-", "").repeat(2),
          },
        });
        assert.equal(upload.expiresAt.getTime() - upload.createdAt.getTime(), 30 * 60000);
        const receipt = await db.$transaction(async (tx) => {
          const proposal = await tx.agentProposal.create({
            data: {
              id: randomUUID(),
              uploadId: upload.id,
              draftId: d.id,
              ownerId: owner,
              eventId: event,
              baseVersion: 1,
              requestKey: randomUUID(),
              intentHash: "a".repeat(64),
              fields: emptyProject,
            },
          });
          // Preserve PostgreSQL microseconds when satisfying the reciprocal receipt FK.
          await tx.$executeRaw`UPDATE brag.agent_proposal_upload SET consumed_proposal_id=${proposal.id}::uuid, consumed_at=(SELECT received_at FROM brag.agent_proposal WHERE id=${proposal.id}::uuid) WHERE id=${upload.id}::uuid`;
          return proposal;
        });
        assert.equal(
          receipt.retentionDeadline.getTime() - receipt.receivedAt.getTime(),
          30 * 86400000,
        );
      } finally {
        await db.$disconnect();
      }
    },
  );
}
