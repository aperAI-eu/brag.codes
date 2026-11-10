import { createHmac, randomUUID } from "node:crypto";
import type pg from "pg";
import { emptyProject, emptyDetails } from "../../src/projects/model.ts";

export async function identity(admin: pg.Client, secret: string, owner: string = randomUUID()) {
  await admin.query(
    `INSERT INTO brag.auth_user(id,name,email,"updatedAt") VALUES ($1,'Sharing fixture',$2,now()) ON CONFLICT DO NOTHING`,
    [owner, `${owner}@example.test`],
  );
  const id = randomUUID(),
    token = randomUUID();
  await admin.query(
    `INSERT INTO brag.auth_session(id,token,"userId","expiresAt","updatedAt") VALUES ($1,$2,$3,now()+interval '1 day',now())`,
    [id, token, owner],
  );
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  const cookie = "brag.session_token=" + encodeURIComponent(`${token}.${signature}`);
  return { owner, session: id, cookie, headers: new Headers({ Cookie: cookie }) };
}
export async function event(admin: pg.Client, options: { state?: string; slug?: string } = {}) {
  const id = randomUUID(),
    slug = options.slug ?? id;
  const times =
    options.state === "closed"
      ? ["-2 days", "-1 day"]
      : options.state === "scheduled"
        ? ["1 day", "2 days"]
        : ["-1 day", "1 day"];
  await admin.query(
    `INSERT INTO brag.event(id,title,timezone,starts_at,submissions_open_at,submissions_close_at,approval,version,generation)
    VALUES ($1,'Sharing event','Europe/Bratislava',now(),now()+$2::interval,now()+$3::interval,$4,1,1)`,
    [id, ...times, options.state === "suspended" ? "suspended" : "approved"],
  );
  await admin.query(
    `INSERT INTO brag.event_source_alias(id,event_id,provider,source_key,url,state,version,approved_by,approved_at) VALUES ($1,$2,'luma',$3,$4,'approved',1,(SELECT id FROM brag.auth_user ORDER BY id LIMIT 1),now())`,
    [randomUUID(), id, `luma:${slug}`, `https://luma.com/${slug}`],
  );
  return { id, url: `https://luma.com/${slug}`, slug };
}
export async function association(admin: pg.Client, owner: string, eventId: string) {
  await admin.query(
    `INSERT INTO brag.author_event(owner_id,event_id,origin) VALUES ($1,$2,'pasted_url') ON CONFLICT DO NOTHING`,
    [owner, eventId],
  );
}
export async function draft(admin: pg.Client, owner: string, eventId: string, kind = "reserved") {
  await association(admin, owner, eventId);
  const id = randomUUID();
  await admin.query(
    `INSERT INTO brag.project_draft(id,owner_id,event_id,fields,version,confirmed_version,confirmed_at,legacy_record,discarded_at)
    VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $6::int IS NULL THEN NULL ELSE now() END,$7,CASE WHEN $8 THEN now() ELSE NULL END)`,
    [
      id,
      owner,
      eventId,
      {
        ...emptyProject,
        title: kind === "reserved" ? "" : "Private project",
        description: "secret-description",
      },
      kind === "content_pending" ? 3 : 2,
      ["confirmed", "content_pending"].includes(kind) ? 2 : null,
      kind === "legacy",
      kind === "discarded",
    ],
  );
  return id;
}
export const voiceProposal = {
  title: "Nápad",
  problem: "Problém",
  description: "private-proposal",
  details: emptyDetails,
  language: "sk",
};
export async function pitch(
  admin: pg.Client,
  owner: string,
  draftId: string,
  status: string,
  options: { age?: string; lease?: string; proposal?: unknown; base?: number; id?: string } = {},
) {
  const id = options.id ?? randomUUID();
  await admin.query(
    `INSERT INTO brag.voice_pitch(id,draft_id,owner_id,key,media_hash,base_version,policy,status,admitted_at,sample_count,created_at,lease_until,attempts,proposal,transcript,provider_id,error)
    VALUES ($1,$2,$3,$4,$5,$6,'pitch-30s-pause-auto-distill-claude-v3',$7,now()-$8::interval,16000,now()-$8::interval,
      CASE WHEN $9::text IS NULL THEN NULL ELSE now()+$9::interval END,2,$10,'secret-transcript','secret-provider-id','unsafe-upstream-message')`,
    [
      id,
      draftId,
      owner,
      randomUUID(),
      "a".repeat(64),
      options.base ?? 2,
      status,
      options.age ?? "1 minute",
      options.lease ?? null,
      options.proposal === undefined
        ? status === "ready"
          ? voiceProposal
          : null
        : options.proposal,
    ],
  );
  return id;
}
/** Synthetic historical receipts, inserted atomically with matching database microseconds. */
export async function agent(
  admin: pg.Client,
  owner: string,
  eventId: string,
  draftId: string,
  options: {
    age?: string;
    base?: number;
    accepted?: boolean;
    cleared?: boolean;
    revoked?: boolean;
    unused?: boolean;
  } = {},
) {
  const upload = randomUUID(),
    proposal = randomUUID();
  await admin.query("BEGIN");
  try {
    await admin.query(
      `INSERT INTO brag.agent_proposal_upload(id,draft_id,owner_id,event_id,base_version,secret_hash,created_at,expires_at,revoked_at,consumed_proposal_id,consumed_at)
      VALUES ($1,$2,$3,$4,$5,$6,now()-$7::interval,now()-$7::interval+interval '30 minutes',
        CASE WHEN $8 THEN now() ELSE NULL END, $9,CASE WHEN $9::uuid IS NULL THEN NULL ELSE now()-$7::interval+interval '1 second' END)`,
      [
        upload,
        draftId,
        owner,
        eventId,
        options.base ?? 2,
        randomUUID().replaceAll("-", "").repeat(2),
        options.age ?? "1 minute",
        options.revoked ?? false,
        options.unused ? null : proposal,
      ],
    );
    if (!options.unused)
      await admin.query(
        `INSERT INTO brag.agent_proposal(id,upload_id,draft_id,owner_id,event_id,base_version,request_key,intent_hash,fields,received_at,retention_deadline,accepted_version,cleared_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now()-$10::interval+interval '1 second',now()-$10::interval+interval '1 second'+interval '720 hours',
        $11,CASE WHEN $12 THEN now() ELSE NULL END)`,
        [
          proposal,
          upload,
          draftId,
          owner,
          eventId,
          options.base ?? 2,
          randomUUID(),
          "b".repeat(64),
          options.cleared ? null : { ...emptyProject, title: "Agent project", language: "cs" },
          options.age ?? "1 minute",
          options.accepted ? (options.base ?? 2) + 1 : null,
          options.cleared ?? false,
        ],
      );
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
  return { upload, proposal };
}

/** Retained 10k-row cardinality fixture for query-plan qualification, never shared data. */
export async function largeHistory(admin: pg.Client, owner: string, eventId: string) {
  await association(admin, owner, eventId);
  await admin.query(
    `INSERT INTO brag.project_draft(id,owner_id,event_id,fields,created_at)
    SELECT gen_random_uuid(),$1,$2,$3,now()-n*interval '1 microsecond' FROM generate_series(1,10000) n`,
    [owner, eventId, emptyProject],
  );
}
