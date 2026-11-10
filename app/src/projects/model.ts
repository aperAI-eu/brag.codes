export const PITCH_SECONDS = 30;
export const AUDIO_RATE = 16000;
export const MAX_AUDIO_BYTES = 44 + PITCH_SECONDS * AUDIO_RATE * 2;
export const PITCH_POLICY = "pitch-30s-pause-auto-distill-claude-v3";
export const LEGACY_AUTO_PITCH_POLICY = "pitch-20s-auto-distill-claude-v2";
export const LEGACY_PITCH_POLICY = "pitch-20s-distill-claude-v1";
export type ProjectPattern = {
  id: string;
  kind: "system" | "process";
  name: string;
  description: string;
  evidence: string;
  source: "author_reported" | "agent_inferred";
};
export type ProjectDetails = {
  core_idea: string;
  capabilities: string[];
  constraints: string[];
  limitations: string[];
  stack: string[];
  patterns: ProjectPattern[];
  process: {
    tools: string[];
    workflow: string;
    hours_bucket: "under_2" | "2_8" | "8_40" | "over_40" | null;
    agent_share: number | null;
    gotchas: string;
    would_build_again: "yes" | "differently" | "no" | null;
  };
  reality_level: "idea" | "prototype" | "daily_driver" | "production" | null;
  looking_for: string[];
  can_demo: boolean | null;
  code_license: string;
  catalogue_text_permission: string;
};
export const emptyDetails: ProjectDetails = {
  core_idea: "",
  capabilities: [],
  constraints: [],
  limitations: [],
  stack: [],
  patterns: [],
  process: {
    tools: [],
    workflow: "",
    hours_bucket: null,
    agent_share: null,
    gotchas: "",
    would_build_again: null,
  },
  reality_level: null,
  looking_for: [],
  can_demo: null,
  code_license: "",
  catalogue_text_permission: "",
};
export type ProjectFields = {
  schema_version: 1;
  language?: string | null;
  title: string;
  problem: string;
  description: string;
  project_url: string;
  repository_url: string;
  details: ProjectDetails;
};
export const emptyProject: ProjectFields = {
  schema_version: 1,
  language: null,
  title: "",
  problem: "",
  description: "",
  project_url: "",
  repository_url: "",
  details: emptyDetails,
};
export type Proposal = Pick<ProjectFields, "title" | "problem" | "description" | "details"> & {
  language: string | null;
};
export type DraftSummary = {
  id: string;
  title: string;
  updated_at: string;
  pitch_status: string | null;
};
export type PitchView = {
  recovery?: {
    audio_available: boolean;
    expires_at: string;
    can_retry: boolean;
    configuration_required: boolean;
    transcription_attempt: number;
  };
  duration_seconds?: number | null;
  id: string;
  status: string;
  base_version: number;
  transcript: string;
  original_transcript: string;
  language: string | null;
  proposal: Proposal | null;
  error: string | null;
  attempt: number;
};
export type DraftView = {
  id: string;
  event_id: string | null;
  version: number;
  fields: ProjectFields;
  pitch: PitchView | null;
  last_edit?: {
    method?: "typed" | "voice" | "agent";
    pitch_id?: string;
    approved_pitch?: { id: string; attempt: number };
  };
};
export function pitchApproved(draft: DraftView | null, pitch: PitchView | null): boolean {
  if (!draft || !pitch || pitch.status !== "ready") return false;
  const approved = draft.last_edit?.approved_pitch;
  return approved
    ? approved.id === pitch.id && approved.attempt === pitch.attempt
    : draft.last_edit?.method === "voice" && draft.last_edit.pitch_id === pitch.id;
}
