BEGIN;
CREATE TABLE brag.processor_config (
  version integer PRIMARY KEY CHECK(version > 0),
  actor_id text NOT NULL REFERENCES brag.auth_user(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  intent_hmac text NOT NULL CHECK(length(intent_hmac)=64),
  enabled boolean NOT NULL,
  distill_origin text NOT NULL CHECK(length(distill_origin)<=2048),
  claude_model text NOT NULL CHECK(length(claude_model)<=90),
  has_distill boolean NOT NULL, has_claude boolean NOT NULL,
  sealed jsonb NOT NULL CHECK(jsonb_typeof(sealed)='object'),
  changed_fields text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(actor_id,request_id),
  CHECK(NOT enabled OR (has_distill AND has_claude AND distill_origin <> '' AND claude_model <> ''))
);
REVOKE ALL ON brag.processor_config FROM PUBLIC;
GRANT SELECT, INSERT ON brag.processor_config TO brag_runtime;
ALTER TABLE brag.voice_pitch ADD COLUMN config_version integer REFERENCES brag.processor_config(version) ON DELETE RESTRICT;
-- Historical capture rows have no configuration binding. They must never dispatch using new credentials.
UPDATE brag.voice_pitch SET status='cancelled', lease_until=NULL WHERE config_version IS NULL AND status IN ('queued','dispatching','transcribing','structure_queued','structuring');
UPDATE brag.runtime_metadata SET schema_version=5 WHERE id=1;
COMMIT;
