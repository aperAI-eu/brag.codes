BEGIN;
CREATE TABLE brag.event (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  location text NOT NULL DEFAULT '' CHECK (length(location) <= 240),
  timezone text NOT NULL CHECK (length(timezone) BETWEEN 1 AND 100),
  starts_at timestamptz NOT NULL CHECK (isfinite(starts_at)),
  submissions_open_at timestamptz NOT NULL CHECK (isfinite(submissions_open_at)),
  submissions_close_at timestamptz NOT NULL CHECK (isfinite(submissions_close_at)),
  approval text NOT NULL CHECK (approval IN ('pending', 'approved', 'suspended')),
  manually_closed boolean NOT NULL DEFAULT false,
  version integer NOT NULL CHECK (version > 0),
  generation integer NOT NULL CHECK (generation > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (submissions_open_at < submissions_close_at)
);
CREATE INDEX event_title_idx ON brag.event (lower(title));
CREATE INDEX event_window_idx ON brag.event (approval, submissions_open_at, submissions_close_at);
CREATE TABLE brag.event_source_alias (
  id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES brag.event(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('luma', 'meetup', 'eventbrite')),
  source_key text NOT NULL UNIQUE CHECK (length(source_key) <= 200),
  url text NOT NULL CHECK (length(url) <= 2048),
  state text NOT NULL CHECK (state IN ('pending', 'approved', 'removed')),
  version integer NOT NULL CHECK (version > 0),
  approved_by text REFERENCES brag.auth_user(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  CHECK (state <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX event_alias_event_idx ON brag.event_source_alias(event_id);
CREATE TABLE brag.event_mutation (
  actor_id text NOT NULL REFERENCES brag.auth_user(id) ON DELETE RESTRICT,
  key uuid NOT NULL, intent_hash text NOT NULL,
  result jsonb NOT NULL, status integer NOT NULL CHECK (status IN (200,201)),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id, key)
);
CREATE TABLE brag.event_audit (
  id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES brag.event(id) ON DELETE RESTRICT,
  actor_id text NOT NULL REFERENCES brag.auth_user(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('whitelist','edit','approve','suspend','close','reopen','add_alias','approve_alias','remove_alias')),
  version integer NOT NULL CHECK (version > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(event_id, version)
);
REVOKE ALL ON brag.event, brag.event_source_alias, brag.event_mutation, brag.event_audit FROM PUBLIC;
GRANT SELECT, INSERT ON brag.event, brag.event_source_alias, brag.event_mutation, brag.event_audit TO brag_runtime;
GRANT UPDATE (title, description, location, timezone, starts_at, submissions_open_at, submissions_close_at, approval, manually_closed, version, generation, updated_at) ON brag.event TO brag_runtime;
GRANT UPDATE (state, version, approved_by, approved_at) ON brag.event_source_alias TO brag_runtime;
UPDATE brag.runtime_metadata SET schema_version = 3 WHERE id = 1;
COMMIT;
