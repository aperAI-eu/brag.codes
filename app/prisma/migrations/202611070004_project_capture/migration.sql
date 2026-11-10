BEGIN;
CREATE TABLE brag.project_draft (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES brag.auth_user(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL REFERENCES brag.event(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  fields jsonb NOT NULL CHECK(jsonb_typeof(fields) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, event_id), UNIQUE(id, owner_id)
);
CREATE TABLE brag.draft_mutation (
  actor_id text NOT NULL REFERENCES brag.auth_user(id) ON DELETE RESTRICT,
  key uuid NOT NULL, intent_hash text NOT NULL, result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id, key)
);
CREATE TABLE brag.voice_pitch (
  id uuid PRIMARY KEY, draft_id uuid NOT NULL, owner_id text NOT NULL,
  FOREIGN KEY(draft_id, owner_id) REFERENCES brag.project_draft(id, owner_id) ON DELETE RESTRICT,
  key uuid NOT NULL, media_hash text NOT NULL CHECK(length(media_hash) = 64),
  base_version integer NOT NULL CHECK(base_version > 0), policy text NOT NULL,
  status text NOT NULL CHECK(status IN ('queued','dispatching','transcribing','structure_queued','structuring','ready','failed','uncertain','cancelled')),
  provider_id text, original jsonb, corrected jsonb, transcript text NOT NULL DEFAULT '' CHECK(length(transcript) <= 12000),
  proposal jsonb, model text, error text, attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz, next_attempt timestamptz NOT NULL DEFAULT now(),
  cleanup_pending boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,key)
);
CREATE INDEX voice_pitch_work ON brag.voice_pitch(status, next_attempt);
CREATE INDEX voice_pitch_draft ON brag.voice_pitch(draft_id, created_at);
REVOKE ALL ON brag.project_draft, brag.draft_mutation, brag.voice_pitch FROM PUBLIC;
GRANT SELECT, INSERT ON brag.project_draft, brag.draft_mutation, brag.voice_pitch TO brag_runtime;
GRANT UPDATE(version, fields, updated_at) ON brag.project_draft TO brag_runtime;
GRANT UPDATE(status, provider_id, original, corrected, transcript, proposal, model, error, attempts, lease_until, next_attempt, cleanup_pending, updated_at) ON brag.voice_pitch TO brag_runtime;
CREATE TABLE brag.agent_handoff (
  code text PRIMARY KEY, draft_id uuid NOT NULL, owner_id text NOT NULL,
  FOREIGN KEY(draft_id, owner_id) REFERENCES brag.project_draft(id, owner_id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false
);
CREATE TABLE brag.agent_request (
  id uuid PRIMARY KEY, code text NOT NULL REFERENCES brag.agent_handoff(code),
  secret_hash text NOT NULL UNIQUE, verification_code text NOT NULL,
  state text NOT NULL CHECK(state IN ('pending','approved','declined')),
  expires_at timestamptz NOT NULL
);
REVOKE ALL ON brag.agent_handoff, brag.agent_request FROM PUBLIC;
GRANT SELECT, INSERT ON brag.agent_handoff, brag.agent_request TO brag_runtime;
GRANT UPDATE(revoked) ON brag.agent_handoff TO brag_runtime;
GRANT UPDATE(state) ON brag.agent_request TO brag_runtime;
UPDATE brag.runtime_metadata SET schema_version = 4 WHERE id = 1;
COMMIT;
