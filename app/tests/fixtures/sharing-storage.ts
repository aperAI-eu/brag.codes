import { randomUUID } from "node:crypto";
import type pg from "pg";
import {
  emptyProject,
  LEGACY_AUTO_PITCH_POLICY as PITCH_POLICY,
  LEGACY_PITCH_POLICY,
} from "../../src/projects/model.ts";

export const sharingTables = [
  "author_event",
  "author_event_mutation",
  "agent_proposal_upload",
  "agent_proposal",
] as const;
export const historicalTables = [
  "project_draft",
  "voice_pitch",
  "draft_mutation",
  "agent_handoff",
  "agent_request",
  "event",
] as const;
export async function rows(client: pg.Client, tables: readonly string[]) {
  const result: Record<string, Record<string, unknown>[]> = {};
  for (const table of tables) {
    if (!/^[a-z_]+$/.test(table)) throw new Error("Invalid fixture table");
    result[table] = (await client.query(`SELECT * FROM brag.${table}`)).rows.sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
  }
  return result;
}
export async function seedSchema6(client: pg.Client) {
  const owner = "migration-owner",
    other = "migration-other";
  for (const id of [owner, other])
    await client.query(
      `INSERT INTO brag.auth_user(id,name,email,"updatedAt") VALUES ($1,'Fixture',$2,now())`,
      [id, `${id}@example.test`],
    );
  const live = randomUUID(),
    closed = randomUUID(),
    suspended = randomUUID();
  for (const [id, approval, close] of [
    [live, "approved", "1 day"],
    [closed, "approved", "-1 hour"],
    [suspended, "suspended", "1 day"],
  ])
    await client.query(
      "INSERT INTO brag.event(id,title,timezone,starts_at,submissions_open_at,submissions_close_at,approval,version,generation) VALUES ($1,'Migration fixture','UTC',now(),now()-interval '2 days',now()+$3::interval,$2,1,1)",
      [id, approval, close],
    );
  await client.query(
    "INSERT INTO brag.processor_config(version,actor_id,request_id,intent_hmac,enabled,distill_origin,claude_model,has_distill,has_claude,sealed,changed_fields) VALUES (1,$1,$2,$3,false,'','',false,false,'{}','{}')",
    [owner, randomUUID(), "a".repeat(64)],
  );
  const reservations: { id: string; pitch: string | null; label: string }[] = [];
  const labels = [
    "no_pitch",
    "queued",
    "dispatching",
    "transcribing",
    "structure_queued",
    "structuring",
    "ready",
    "failed",
    "uncertain",
    "cancelled",
    "overdue",
    "expired",
    "absent_language",
  ];
  for (const label of labels) {
    const id = randomUUID(),
      fields = structuredClone(emptyProject);
    if (label === "absent_language") delete fields.language;
    await client.query(
      "INSERT INTO brag.project_draft(id,owner_id,event_id,fields,created_at) VALUES ($1,$2,$3,$4,now()-interval '32 days')",
      [id, owner, closed, fields],
    );
    let pitch: string | null = null;
    if (!["no_pitch", "absent_language"].includes(label)) {
      pitch = randomUUID();
      const status = label === "expired" ? "ready" : label === "overdue" ? "transcribing" : label;
      const proposal =
        status === "ready"
          ? {
              title: "Nápad",
              problem: "Problém",
              description: "Pôvodný jazyk",
              details: emptyProject.details,
              language: "sk",
            }
          : null;
      await client.query(
        "INSERT INTO brag.voice_pitch(id,draft_id,owner_id,key,media_hash,base_version,policy,status,created_at,proposal,transcript,attempts,config_version) VALUES ($1,$2,$3,$4,$5,1,$6,$7,now()-$8::interval,$9,$10,1,1)",
        [
          pitch,
          id,
          owner,
          randomUUID(),
          "a".repeat(64),
          label === "cancelled" ? LEGACY_PITCH_POLICY : PITCH_POLICY,
          status,
          label === "expired" ? "31 days" : label === "overdue" ? "16 minutes" : "1 minute",
          proposal,
          proposal ? "Pôvodný jazyk" : "",
        ],
      );
    }
    await client.query(
      "INSERT INTO brag.draft_mutation(actor_id,key,intent_hash,result) VALUES ($1,$2,$3,$4)",
      [
        owner,
        randomUUID(),
        "b".repeat(64),
        { draft: { id, event_id: closed, version: 1, fields, last_edit: {}, pitch: null } },
      ],
    );
    reservations.push({ id, pitch, label });
  }
  const legacy: string[] = [];
  for (const [language, title] of [
    ["sk", "Moja aplikácia"],
    ["cs", "Moje aplikace"],
    ["en", "My application"],
  ]) {
    const id = randomUUID();
    legacy.push(id);
    const fields = {
      ...structuredClone(emptyProject),
      language,
      title,
      description: title,
      details: { ...structuredClone(emptyProject.details), stack: ["TypeScript"], can_demo: true },
    };
    await client.query(
      "INSERT INTO brag.project_draft(id,owner_id,event_id,version,fields,last_edit) VALUES ($1,$2,$3,3,$4,$5)",
      [id, owner, suspended, fields, { method: "typed" }],
    );
    await client.query(
      "INSERT INTO brag.draft_mutation(actor_id,key,intent_hash,result) VALUES ($1,$2,$3,$4)",
      [owner, randomUUID(), "c".repeat(64), { draft: { id, version: 3, fields } }],
    );
  }
  // A real owner save of an empty form still has a version/edit receipt and must survive.
  const emptySaved = randomUUID();
  legacy.push(emptySaved);
  await client.query(
    'INSERT INTO brag.project_draft(id,owner_id,event_id,version,fields,last_edit) VALUES ($1,$2,$3,2,$4,\'{"method":"typed"}\')',
    [emptySaved, owner, live, emptyProject],
  );
  const code = "BRAG-" + "A".repeat(24),
    request = randomUUID();
  await client.query(
    "INSERT INTO brag.agent_handoff(code,draft_id,owner_id,expires_at) VALUES ($1,$2,$3,now()+interval '30 minutes')",
    [code, reservations[0].id, owner],
  );
  await client.query(
    "INSERT INTO brag.agent_request(id,code,secret_hash,verification_code,state,expires_at) VALUES ($1,$2,$3,'12345678','approved',now()+interval '30 minutes')",
    [request, code, "d".repeat(64)],
  );
  return { owner, other, live, closed, suspended, reservations, legacy, code, request };
}

/** Populate every new private table for raw restore checks; synthetic, no service calls. */
export async function seedSharingRows(client: pg.Client, owner = "sharing-restore-owner") {
  await client.query(
    `INSERT INTO brag.auth_user(id,name,email,"updatedAt") VALUES ($1,'Fixture',$2,now())`,
    [owner, `${owner}@example.test`],
  );
  const event = randomUUID(),
    draft = randomUUID(),
    upload = randomUUID(),
    proposal = randomUUID();
  await client.query(
    "INSERT INTO brag.event(id,title,timezone,starts_at,submissions_open_at,submissions_close_at,approval,version,generation) VALUES ($1,'Restore fixture','UTC',now(),now()-interval '1 hour',now()+interval '1 day','approved',1,1)",
    [event],
  );
  await client.query(
    "INSERT INTO brag.author_event(owner_id,event_id,origin) VALUES ($1,$2,'pasted_url')",
    [owner, event],
  );
  await client.query(
    "INSERT INTO brag.author_event_mutation(actor_id,key,intent_hash,event_id,outcome) VALUES ($1,$2,$3,$4,'created')",
    [owner, randomUUID(), "e".repeat(64), event],
  );
  await client.query(
    "INSERT INTO brag.project_draft(id,owner_id,event_id,fields) VALUES ($1,$2,$3,$4)",
    [draft, owner, event, emptyProject],
  );
  await client.query(
    "INSERT INTO brag.agent_proposal_upload(id,draft_id,owner_id,event_id,base_version,secret_hash) VALUES ($1,$2,$3,$4,1,$5)",
    [upload, draft, owner, event, randomUUID().replaceAll("-", "").repeat(2)],
  );
  await client.query("BEGIN");
  try {
    await client.query(
      "INSERT INTO brag.agent_proposal(id,upload_id,draft_id,owner_id,event_id,base_version,request_key,intent_hash,fields) VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8)",
      [
        proposal,
        upload,
        draft,
        owner,
        event,
        randomUUID(),
        "f".repeat(64),
        { ...emptyProject, language: "cs", title: "Návrh" },
      ],
    );
    await client.query(
      "UPDATE brag.agent_proposal_upload SET consumed_proposal_id=$1,consumed_at=(SELECT received_at FROM brag.agent_proposal WHERE id=$1) WHERE id=$2",
      [proposal, upload],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
  return { owner, event, draft, upload, proposal };
}
