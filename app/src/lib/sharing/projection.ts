import "server-only";
import { Prisma } from "../../generated/prisma/client.ts";

/** One statement snapshot and instant for windows, review state, filters and counts. */
export const moment = Prisma.sql`moment AS MATERIALIZED (SELECT clock_timestamp() AS as_of)`;

export function linkedEvents(owner: string, origin: string) {
  return Prisma.sql`linked AS (
    SELECT a.event_id AS id, a.linked_at, a.origin,
      e.approval='approved' AND NOT e.manually_closed
        AND e.submissions_open_at <= m.as_of AND m.as_of < e.submissions_close_at AS eligible,
      jsonb_build_object('id',e.id,'title',e.title,'starts_at',e.starts_at,'timezone',e.timezone,
        'submissions_open_at',e.submissions_open_at,'submissions_close_at',e.submissions_close_at,
        'submission_state', CASE WHEN e.approval <> 'approved' THEN 'suspended'
          WHEN e.manually_closed OR m.as_of >= e.submissions_close_at THEN 'closed'
          WHEN m.as_of < e.submissions_open_at THEN 'scheduled' ELSE 'open' END,
        'eligible',e.approval='approved' AND NOT e.manually_closed
          AND e.submissions_open_at <= m.as_of AND m.as_of < e.submissions_close_at,
        'canonical_url',${origin} || '/events/' || e.id::text) AS event
    FROM brag.author_event a JOIN brag.event e ON e.id=a.event_id CROSS JOIN moment m
    WHERE a.owner_id=${owner}
  )`;
}

/** The sole sharing review predicate. No transcript, proposal content or upload secret leaves SQL. */
export function projectProjection(
  owner: string,
  eventId: string | null = null,
  draftId: string | null = null,
) {
  return Prisma.sql`draft_facts AS (
    SELECT d.id, d.event_id, d.version, d.created_at, d.updated_at,
      COALESCE(NULLIF(btrim(d.fields->>'title'),''),'Untitled project') AS title,
      d.confirmed_version, d.confirmed_at, d.legacy_record,
      EXISTS(SELECT 1 FROM brag.project_public_state s WHERE s.project_id=d.id AND s.visibility='published' AND NOT s.owner_withdrawn) AS published,
      EXISTS(SELECT 1 FROM brag.project_public_state s WHERE s.project_id=d.id) AS has_publication,
      (SELECT visibility FROM brag.project_public_state s WHERE s.project_id=d.id) AS publication_state,
      d.confirmed_version IS NOT NULL AND d.version>d.confirmed_version AS content_pending,
      p.id AS pitch_id, p.attempts AS pitch_attempt, p.base_version AS pitch_base,
      CASE WHEN p.id IS NULL THEN NULL
        WHEN m.as_of >= p.created_at + interval '720 hours' THEN 'expired'
        WHEN p.status='dispatching' AND (m.as_of >= COALESCE(p.transcription_started_at,p.created_at) + interval '15 minutes'
          OR p.lease_until <= m.as_of) THEN 'uncertain'
        WHEN p.status IN ('queued','transcribing') AND m.as_of >= COALESCE(p.transcription_started_at,p.created_at) + interval '15 minutes' THEN 'failed'
        WHEN p.status='structuring' AND p.lease_until <= m.as_of THEN 'failed'
        WHEN p.status='ready' AND NOT COALESCE(jsonb_typeof(p.proposal)='object'
          AND jsonb_typeof(p.proposal->'title')='string'
          AND jsonb_typeof(p.proposal->'problem')='string'
          AND jsonb_typeof(p.proposal->'description')='string'
          AND jsonb_typeof(p.proposal->'details')='object',false) THEN 'failed'
        ELSE p.status END AS pitch_state,
      COALESCE(ap.base_version=d.version AND ap.accepted_version IS NULL
        AND ap.cleared_at IS NULL AND ap.fields IS NOT NULL AND ap.fields <> 'null'::jsonb
        AND m.as_of < ap.retention_deadline,false) AS agent_review
    FROM brag.project_draft d CROSS JOIN moment m
    LEFT JOIN LATERAL (SELECT id,attempts,base_version,status,created_at,transcription_started_at,lease_until,proposal
      FROM brag.voice_pitch WHERE draft_id=d.id AND owner_id=${owner}
      ORDER BY created_at DESC,id DESC LIMIT 1) p ON true
    LEFT JOIN LATERAL (SELECT * FROM brag.agent_proposal WHERE draft_id=d.id AND owner_id=d.owner_id ORDER BY received_at DESC,id DESC LIMIT 1) ap ON true
    WHERE d.owner_id=${owner} AND d.discarded_at IS NULL
      ${eventId ? Prisma.sql`AND d.event_id=${eventId}::uuid` : Prisma.empty}
      ${draftId ? Prisma.sql`AND d.id=${draftId}::uuid` : Prisma.empty}
  ), attention_facts AS (
    SELECT *, CASE WHEN pitch_base=version AND pitch_state IN
        ('queued','dispatching','transcribing','structure_queued','structuring') THEN 'processing'
      WHEN content_pending OR agent_review OR (pitch_base=version AND pitch_state='ready') THEN 'review'
      ELSE NULL END AS attention
    FROM draft_facts
  ), projects AS (
    SELECT *, CASE WHEN content_pending OR attention IS NOT NULL THEN 'pending_review'
      WHEN confirmed_version=version THEN 'confirmed'
      WHEN legacy_record AND confirmed_version IS NULL THEN 'legacy' ELSE 'reserved' END AS review_state,
      confirmed_version IS NOT NULL OR legacy_record AS saved,
      (confirmed_version IS NULL AND NOT legacy_record) OR content_pending OR attention IS NOT NULL AS unfinished
    FROM attention_facts
  )`;
}

export const reviewJson = Prisma.sql`jsonb_build_object(
  'state',p.review_state,'attention',p.attention,'content_pending',p.content_pending,
  'confirmed_version',p.confirmed_version,'confirmed_at',p.confirmed_at,'legacy_record',p.legacy_record)`;
export const projectJson = Prisma.sql`jsonb_build_object(
  'id',p.id,'event',l.event,'title',p.title,'created_at',p.created_at,'updated_at',p.updated_at,
  'version',p.version,'published',p.published,'has_publication',p.has_publication,'publication_state',p.publication_state,'review',${reviewJson},
  'pitch',CASE WHEN p.pitch_id IS NULL THEN NULL ELSE jsonb_build_object(
    'id',p.pitch_id,'status',p.pitch_state,'attempt',p.pitch_attempt,
    'recovery',CASE WHEN p.pitch_state IN ('failed','uncertain','cancelled','expired') THEN p.pitch_state ELSE NULL END) END)`;
