import "server-only";
import { Prisma, type VoicePitch } from "../../generated/prisma/client.ts";
import { linkedEvents, moment, projectProjection, reviewJson } from "../sharing/projection.ts";
import type { EventSummary, ReviewSummary } from "../sharing/queries.ts";
import type { Tx } from "../sharing/admission.ts";
import { CAPTURE_CONTRACT } from "../sharing/admission.ts";
import { owned } from "../sharing/admission.ts";
import {
  AUDIO_RATE,
  PITCH_POLICY,
  PITCH_SECONDS,
  emptyDetails,
  type DraftView,
  type PitchView,
  type Proposal,
} from "../../projects/model.ts";
import { recoveryInfo } from "./recovery.ts";
import type { PitchConfig } from "./providers.ts";
import { transcriptText, type Sentence } from "./providers.ts";

export function pitchView(pitch: VoicePitch, at = new Date()): PitchView {
  let state = pitch.status;
  if (at.getTime() >= pitch.createdAt.getTime() + 30 * 86400000) state = "expired";
  else if (
    pitch.status === "dispatching" &&
    ((pitch.leaseUntil && pitch.leaseUntil <= at) ||
      at.getTime() >= (pitch.transcriptionStartedAt ?? pitch.createdAt).getTime() + 900000)
  )
    state = "uncertain";
  else if (
    (pitch.status === "structuring" && pitch.leaseUntil && pitch.leaseUntil <= at) ||
    (["queued", "transcribing"].includes(pitch.status) &&
      at.getTime() >= (pitch.transcriptionStartedAt ?? pitch.createdAt).getTime() + 900000)
  )
    state = "failed";
  if (state === "ready") {
    const value = pitch.proposal as Record<string, unknown> | null;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !["title", "problem", "description"].every((key) => typeof value[key] === "string") ||
      !value.details ||
      typeof value.details !== "object" ||
      Array.isArray(value.details)
    )
      state = "failed";
  }
  const cleared = ["cancelled", "expired"].includes(state);
  const proposal = cleared ? null : (pitch.proposal as Proposal | null);
  return {
    id: pitch.id,
    status: state,
    base_version: pitch.baseVersion,
    transcript: cleared ? "" : pitch.transcript,
    original_transcript:
      cleared || !pitch.original ? "" : transcriptText(pitch.original as Sentence[]),
    language: proposal?.language ?? null,
    proposal: proposal
      ? {
          ...proposal,
          language: proposal.language ?? null,
          details: proposal.details ?? structuredClone(emptyDetails),
        }
      : null,
    error: ["failed", "uncertain", "expired"].includes(state) ? state : null,
    attempt: pitch.attempts,
    duration_seconds: pitch.sampleCount === null ? null : pitch.sampleCount / AUDIO_RATE,
  };
}
export type SharingDraft = DraftView & {
  published: boolean;
  has_publication: boolean;
  review: ReviewSummary;
  event: EventSummary | null;
  can_submit: boolean;
  can_edit_saved: boolean;
  can_complete_received: boolean;
  can_use_agent: boolean;
  as_of: string;
  capture: {
    contract: string;
    pitch_seconds: number;
    processing_policy: string;
    voice_available: boolean;
  };
};
export async function draftView(
  tx: Tx,
  owner: string,
  id: string,
  origin: string,
  voiceAvailable: boolean,
  pitchConfig: PitchConfig | null = null,
): Promise<SharingDraft> {
  await owned(tx, owner, id);
  const [row] = await tx.$queryRaw<
    {
      published: boolean;
      has_publication: boolean;
      as_of: Date;
      review: ReviewSummary;
      event: EventSummary | null;
      draft: DraftView;
      received: boolean;
      agent_exists: boolean;
      competing: boolean;
    }[]
  >(Prisma.sql`
    WITH ${moment},${linkedEvents(owner, origin)},${projectProjection(owner, null, id)}
    SELECT m.as_of,p.published,p.has_publication,${reviewJson} AS review,l.event,
      jsonb_build_object('id',d.id,'event_id',d.event_id,'version',d.version,'fields',d.fields,'last_edit',d.last_edit,
        'pitch',CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object('id',v.id,'status',p.pitch_state,'base_version',v.base_version,
          'transcript',CASE WHEN p.pitch_state IN ('expired','cancelled') THEN '' ELSE v.transcript END,
          'original_transcript',CASE WHEN p.pitch_state IN ('expired','cancelled') THEN '' ELSE COALESCE((SELECT string_agg(item->>'sentence',' ' ORDER BY ord) FROM jsonb_array_elements(COALESCE(v.original,'[]'::jsonb)) WITH ORDINALITY AS lines(item,ord)),'') END,
          'language',CASE WHEN p.pitch_state IN ('expired','cancelled') THEN NULL ELSE v.proposal->'language' END,
          'proposal',CASE WHEN p.pitch_state IN ('expired','cancelled') THEN NULL ELSE v.proposal END,
          'error',CASE WHEN p.pitch_state IN ('failed','uncertain','expired') THEN p.pitch_state ELSE NULL END,
          'attempt',v.attempts,'duration_seconds',v.sample_count::float8/16000) END) AS draft,
      (p.agent_review OR COALESCE(p.pitch_state='ready' AND p.pitch_base=p.version
        AND (v.admitted_at IS NOT NULL OR v.legacy_received),false)) AS received,
      EXISTS(SELECT 1 FROM brag.agent_proposal WHERE draft_id=d.id AND base_version=d.version AND accepted_version IS NULL AND cleared_at IS NULL AND retention_deadline>m.as_of) AS agent_exists,
      COALESCE(p.pitch_base=p.version AND p.pitch_state IN ('queued','dispatching','transcribing','structure_queued','structuring','uncertain'),false) AS competing
    FROM projects p JOIN brag.project_draft d ON d.id=p.id LEFT JOIN linked l ON l.id=d.event_id CROSS JOIN moment m
    LEFT JOIN brag.voice_pitch v ON v.id=p.pitch_id`);
  if (row.draft.pitch) {
    const pitch = await tx.voicePitch.findUniqueOrThrow({ where: { id: row.draft.pitch.id } });
    row.draft.pitch = {
      ...pitchView(pitch, row.as_of),
      recovery: await recoveryInfo(tx, pitch, row.as_of, pitchConfig),
    };
  }
  const allowed = row.event?.submission_state !== "suspended";
  return {
    ...row.draft,
    published: row.published,
    has_publication: row.has_publication,
    review: row.review,
    event: row.event,
    as_of: row.as_of.toISOString(),
    can_submit: row.event?.eligible ?? row.draft.event_id === null,
    can_edit_saved: allowed && (row.review.confirmed_version !== null || row.review.legacy_record),
    can_complete_received: allowed && row.received,
    can_use_agent:
      allowed &&
      !row.published &&
      ((row.event?.eligible ?? row.draft.event_id === null) ||
        row.review.confirmed_version !== null ||
        row.review.legacy_record) &&
      !row.agent_exists &&
      !row.competing,
    capture: {
      contract: CAPTURE_CONTRACT,
      pitch_seconds: PITCH_SECONDS,
      processing_policy: PITCH_POLICY,
      voice_available: voiceAvailable,
    },
  };
}
