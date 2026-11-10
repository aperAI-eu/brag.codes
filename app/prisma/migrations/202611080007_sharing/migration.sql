BEGIN;
-- This forward-only storage revision is deployed with the coordinated sharing writer.
-- All validation/backfill is transactional. Never classify pitch output as a saved draft.
LOCK TABLE brag.project_draft, brag.draft_mutation, brag.voice_pitch, brag.agent_handoff, brag.agent_request IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM brag.runtime_metadata WHERE id=1 AND schema_version=6) THEN
    RAISE EXCEPTION 'Sharing upgrade requires schema 6';
  END IF;
  IF EXISTS (SELECT 1 FROM brag.voice_pitch WHERE policy NOT IN ('pitch-20s-distill-claude-v1','pitch-20s-auto-distill-claude-v2')) THEN
    RAISE EXCEPTION 'Unrecognized historical pitch policy; diagnose before migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM brag.project_draft d WHERE
      NOT isfinite(d.created_at) OR NOT isfinite(d.updated_at)
      OR d.fields - ARRAY['schema_version','language','title','problem','description','project_url','repository_url','details'] <> '{}'
      OR EXISTS (SELECT 1 FROM unnest(ARRAY['title','problem','description','project_url','repository_url']) k WHERE jsonb_typeof(d.fields->k) IS DISTINCT FROM 'string')
      OR (d.fields ? 'language' AND d.fields->'language' <> 'null' AND jsonb_typeof(d.fields->'language') IS DISTINCT FROM 'string')
  ) THEN RAISE EXCEPTION 'Ambiguous historical project record; diagnose before migration'; END IF;
  IF EXISTS (
    SELECT 1 FROM brag.project_draft d JOIN brag.draft_mutation m ON m.actor_id=d.owner_id
    WHERE m.result#>>'{draft,id}'=d.id::text
      AND jsonb_typeof(m.result#>'{draft,version}')='number'
      AND (m.result#>>'{draft,version}')::numeric>d.version
  ) THEN RAISE EXCEPTION 'Historical content receipt exceeds draft version; diagnose before migration'; END IF;
END $$;

CREATE TABLE brag.author_event (
  owner_id text NOT NULL REFERENCES brag.auth_user(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL REFERENCES brag.event(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now() CHECK(isfinite(linked_at)),
  origin text NOT NULL CHECK(origin IN ('qr_scan','pasted_url','direct_event','legacy_project')),
  PRIMARY KEY(owner_id,event_id)
);
INSERT INTO brag.author_event(owner_id,event_id,linked_at,origin)
  SELECT owner_id,event_id,min(created_at),'legacy_project' FROM brag.project_draft GROUP BY owner_id,event_id;
CREATE INDEX author_event_owner_linked ON brag.author_event(owner_id,linked_at DESC,event_id DESC);
CREATE TABLE brag.author_event_mutation (
  actor_id text NOT NULL, key uuid NOT NULL,
  intent_hash text NOT NULL CHECK(intent_hash ~ '^[a-f0-9]{64}$'),
  event_id uuid NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('created','already_linked')),
  created_at timestamptz NOT NULL DEFAULT now() CHECK(isfinite(created_at)),
  PRIMARY KEY(actor_id,key),
  FOREIGN KEY(actor_id,event_id) REFERENCES brag.author_event(owner_id,event_id) ON DELETE RESTRICT
);
REVOKE ALL ON brag.author_event, brag.author_event_mutation FROM PUBLIC;
GRANT SELECT ON brag.author_event TO brag_runtime;
GRANT INSERT(owner_id,event_id,origin) ON brag.author_event TO brag_runtime;
GRANT SELECT,INSERT ON brag.author_event_mutation TO brag_runtime;
CREATE FUNCTION brag.guard_author_event_origin() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,brag AS $$
BEGIN
  IF NEW.origin='legacy_project' THEN
    RAISE EXCEPTION 'Historical associations can only be backfilled by migration' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER author_event_origin_guard BEFORE INSERT ON brag.author_event FOR EACH ROW EXECUTE FUNCTION brag.guard_author_event_origin();
REVOKE ALL ON FUNCTION brag.guard_author_event_origin() FROM PUBLIC;

ALTER TABLE brag.project_draft
  ADD COLUMN confirmed_version integer,
  ADD COLUMN confirmed_at timestamptz,
  ADD COLUMN discarded_at timestamptz,
  ADD COLUMN legacy_record boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT project_draft_author_event FOREIGN KEY(owner_id,event_id) REFERENCES brag.author_event(owner_id,event_id) ON DELETE RESTRICT,
  ADD CONSTRAINT project_draft_binding UNIQUE(id,owner_id,event_id),
  ADD CONSTRAINT project_draft_confirmation CHECK (
    (confirmed_version IS NULL AND confirmed_at IS NULL) OR
    (confirmed_version IS NOT NULL AND confirmed_at IS NOT NULL AND confirmed_version>0 AND confirmed_version<=version AND isfinite(confirmed_at))
  ),
  ADD CONSTRAINT project_draft_discard CHECK (
    discarded_at IS NULL OR (isfinite(discarded_at) AND confirmed_version IS NULL AND confirmed_at IS NULL AND NOT legacy_record)
  );
DO $$
DECLARE empty_record jsonb := '{"schema_version":1,"language":null,"title":"","problem":"","description":"","project_url":"","repository_url":"","details":{"core_idea":"","capabilities":[],"constraints":[],"limitations":[],"stack":[],"patterns":[],"process":{"tools":[],"workflow":"","hours_bucket":null,"agent_share":null,"gotchas":"","would_build_again":null},"reality_level":null,"looking_for":[],"can_demo":null,"code_license":"","catalogue_text_permission":""}}';
BEGIN
  UPDATE brag.project_draft d SET legacy_record = NOT (
    d.version=1 AND d.fields IN (empty_record,empty_record-'language') AND d.last_edit='{}'
    AND NOT EXISTS (
      SELECT 1 FROM brag.draft_mutation m WHERE m.actor_id=d.owner_id AND
      ((m.result#>>'{draft,id}'=d.id::text AND jsonb_typeof(m.result#>'{draft,version}')='number' AND (m.result#>>'{draft,version}')::numeric>1)
       OR (m.result->>'status'='saved' AND right(m.result->>'review_url',36)=d.id::text))
    )
  );
END $$;
CREATE INDEX project_draft_owner_created ON brag.project_draft(owner_id,created_at DESC,id DESC);
CREATE INDEX voice_pitch_draft_latest ON brag.voice_pitch(draft_id,created_at DESC,id DESC);
REVOKE INSERT ON brag.project_draft FROM brag_runtime;
GRANT INSERT(id,owner_id,event_id,version,fields,last_edit,created_at,updated_at) ON brag.project_draft TO brag_runtime;
GRANT UPDATE(confirmed_version,confirmed_at,discarded_at) ON brag.project_draft TO brag_runtime;
CREATE FUNCTION brag.guard_draft_confirmation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,brag AS $$
BEGIN
  IF OLD.confirmed_version IS NOT NULL AND
     (NEW.confirmed_version IS NULL OR NEW.confirmed_version<OLD.confirmed_version OR NEW.confirmed_at<OLD.confirmed_at
      OR (NEW.confirmed_version=OLD.confirmed_version AND NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at)) THEN
    RAISE EXCEPTION 'Confirmation facts cannot regress' USING ERRCODE='23514';
  END IF;
  IF OLD.discarded_at IS NOT NULL AND
     (NEW.discarded_at IS DISTINCT FROM OLD.discarded_at OR NEW.fields IS DISTINCT FROM OLD.fields
      OR NEW.version<>OLD.version OR NEW.last_edit IS DISTINCT FROM OLD.last_edit) THEN
    RAISE EXCEPTION 'Discarded content cannot be revived' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER project_draft_confirmation_guard BEFORE UPDATE ON brag.project_draft FOR EACH ROW EXECUTE FUNCTION brag.guard_draft_confirmation();
REVOKE ALL ON FUNCTION brag.guard_draft_confirmation() FROM PUBLIC;

ALTER TABLE brag.voice_pitch
  ADD COLUMN admitted_at timestamptz,
  ADD COLUMN sample_count integer,
  ADD COLUMN legacy_received boolean NOT NULL DEFAULT false;
UPDATE brag.voice_pitch SET legacy_received=true;
ALTER TABLE brag.voice_pitch ADD CONSTRAINT voice_pitch_intake CHECK (
  (legacy_received AND policy IN ('pitch-20s-distill-claude-v1','pitch-20s-auto-distill-claude-v2') AND admitted_at IS NULL AND sample_count IS NULL)
  OR (NOT legacy_received AND policy='pitch-30s-pause-auto-distill-claude-v3'
      AND admitted_at IS NOT NULL AND isfinite(admitted_at) AND sample_count IS NOT NULL AND sample_count BETWEEN 1 AND 480000)
);
REVOKE INSERT ON brag.voice_pitch FROM brag_runtime;
GRANT INSERT(id,draft_id,owner_id,key,media_hash,base_version,policy,config_version,status,provider_id,original,corrected,transcript,proposal,model,error,attempts,lease_until,next_attempt,cleanup_pending,created_at,updated_at,admitted_at,sample_count) ON brag.voice_pitch TO brag_runtime;

UPDATE brag.agent_handoff SET revoked=true;
UPDATE brag.agent_request SET state='declined';
REVOKE INSERT,UPDATE ON brag.agent_handoff,brag.agent_request FROM brag_runtime;
REVOKE UPDATE(revoked) ON brag.agent_handoff FROM brag_runtime;
REVOKE UPDATE(state) ON brag.agent_request FROM brag_runtime;

CREATE TABLE brag.agent_proposal_upload (
  id uuid PRIMARY KEY,
  draft_id uuid NOT NULL, owner_id text NOT NULL, event_id uuid NOT NULL,
  base_version integer NOT NULL CHECK(base_version>0),
  secret_hash text NOT NULL UNIQUE CHECK(secret_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now() CHECK(isfinite(created_at)),
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '30 minutes') CHECK(isfinite(expires_at)),
  revoked_at timestamptz,
  consumed_proposal_id uuid, consumed_at timestamptz,
  FOREIGN KEY(draft_id,owner_id,event_id) REFERENCES brag.project_draft(id,owner_id,event_id) ON DELETE RESTRICT,
  UNIQUE(id,draft_id,owner_id,event_id,base_version),
  UNIQUE(consumed_proposal_id,id,consumed_at),
  CHECK(expires_at=created_at+interval '30 minutes'),
  CHECK(revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at>=created_at)),
  CHECK((consumed_proposal_id IS NULL AND consumed_at IS NULL) OR
    (consumed_proposal_id IS NOT NULL AND consumed_at IS NOT NULL AND isfinite(consumed_at) AND consumed_at>=created_at AND consumed_at<expires_at)),
  CHECK(revoked_at IS NULL OR consumed_at IS NULL OR consumed_at<=revoked_at)
);
CREATE UNIQUE INDEX agent_upload_one_unused ON brag.agent_proposal_upload(draft_id) WHERE revoked_at IS NULL AND consumed_proposal_id IS NULL;
CREATE TABLE brag.agent_proposal (
  id uuid PRIMARY KEY, upload_id uuid NOT NULL UNIQUE, draft_id uuid NOT NULL UNIQUE,
  owner_id text NOT NULL, event_id uuid NOT NULL, base_version integer NOT NULL CHECK(base_version>0),
  request_key uuid NOT NULL, intent_hash text NOT NULL CHECK(intent_hash ~ '^[a-f0-9]{64}$'),
  fields jsonb,
  received_at timestamptz NOT NULL DEFAULT now() CHECK(isfinite(received_at)),
  retention_deadline timestamptz NOT NULL DEFAULT (now()+interval '720 hours') CHECK(isfinite(retention_deadline)),
  accepted_version integer, cleared_at timestamptz,
  FOREIGN KEY(upload_id,draft_id,owner_id,event_id,base_version) REFERENCES brag.agent_proposal_upload(id,draft_id,owner_id,event_id,base_version) ON DELETE RESTRICT,
  UNIQUE(id,upload_id,received_at),
  CONSTRAINT proposal_consumption FOREIGN KEY(id,upload_id,received_at) REFERENCES brag.agent_proposal_upload(consumed_proposal_id,id,consumed_at) DEFERRABLE INITIALLY DEFERRED,
  CHECK(retention_deadline=received_at+interval '720 hours'),
  CHECK(accepted_version IS NULL OR accepted_version::bigint=base_version::bigint+1),
  CHECK((fields IS NULL)=(cleared_at IS NOT NULL)),
  CHECK(cleared_at IS NULL OR (isfinite(cleared_at) AND cleared_at>=received_at)),
  CHECK(fields IS NULL OR (
    jsonb_typeof(fields) IS NOT DISTINCT FROM 'object' AND fields->'schema_version' IS NOT DISTINCT FROM '1'::jsonb
    AND jsonb_typeof(fields->'details') IS NOT DISTINCT FROM 'object'
    AND jsonb_typeof(fields->'title') IS NOT DISTINCT FROM 'string'
    AND jsonb_typeof(fields->'problem') IS NOT DISTINCT FROM 'string'
    AND jsonb_typeof(fields->'description') IS NOT DISTINCT FROM 'string'
    AND jsonb_typeof(fields->'project_url') IS NOT DISTINCT FROM 'string'
    AND jsonb_typeof(fields->'repository_url') IS NOT DISTINCT FROM 'string'
    AND fields ? 'language' AND COALESCE(fields->'language'='null' OR jsonb_typeof(fields->'language')='string',false)
  ))
);
ALTER TABLE brag.agent_proposal_upload ADD CONSTRAINT upload_consumption
  FOREIGN KEY(consumed_proposal_id,id,consumed_at) REFERENCES brag.agent_proposal(id,upload_id,received_at) DEFERRABLE INITIALLY DEFERRED;
REVOKE ALL ON brag.agent_proposal_upload,brag.agent_proposal FROM PUBLIC;
GRANT SELECT ON brag.agent_proposal_upload,brag.agent_proposal TO brag_runtime;
GRANT INSERT(id,draft_id,owner_id,event_id,base_version,secret_hash) ON brag.agent_proposal_upload TO brag_runtime;
GRANT UPDATE(revoked_at,consumed_proposal_id,consumed_at) ON brag.agent_proposal_upload TO brag_runtime;
GRANT INSERT(id,upload_id,draft_id,owner_id,event_id,base_version,request_key,intent_hash,fields) ON brag.agent_proposal TO brag_runtime;
GRANT UPDATE(accepted_version,fields,cleared_at) ON brag.agent_proposal TO brag_runtime;
CREATE FUNCTION brag.guard_agent_upload() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,brag AS $$
BEGIN
  IF OLD.consumed_proposal_id IS NULL AND NEW.consumed_proposal_id IS NOT NULL
     AND (NEW.revoked_at IS NOT NULL OR clock_timestamp()>=OLD.expires_at) THEN
    RAISE EXCEPTION 'Revoked or expired uploads cannot be consumed' USING ERRCODE='23514';
  END IF;
  IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
    NEW.revoked_at := clock_timestamp();
  END IF;
  IF (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
     OR (OLD.consumed_proposal_id IS NOT NULL AND (NEW.consumed_proposal_id IS DISTINCT FROM OLD.consumed_proposal_id OR NEW.consumed_at IS DISTINCT FROM OLD.consumed_at)) THEN
    RAISE EXCEPTION 'Upload lifecycle facts cannot regress' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER agent_upload_guard BEFORE UPDATE ON brag.agent_proposal_upload FOR EACH ROW EXECUTE FUNCTION brag.guard_agent_upload();
CREATE FUNCTION brag.guard_agent_proposal() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,brag AS $$
BEGIN
  IF (NEW.fields IS DISTINCT FROM OLD.fields AND NEW.fields IS NOT NULL)
     OR (OLD.cleared_at IS NOT NULL AND NEW.cleared_at IS DISTINCT FROM OLD.cleared_at)
     OR (OLD.cleared_at IS NOT NULL AND NEW.accepted_version IS DISTINCT FROM OLD.accepted_version)
     OR (OLD.accepted_version IS NOT NULL AND NEW.accepted_version IS DISTINCT FROM OLD.accepted_version) THEN
    RAISE EXCEPTION 'Proposal content and acceptance cannot be rewritten' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER agent_proposal_guard BEFORE UPDATE ON brag.agent_proposal FOR EACH ROW EXECUTE FUNCTION brag.guard_agent_proposal();
REVOKE ALL ON FUNCTION brag.guard_agent_upload(),brag.guard_agent_proposal() FROM PUBLIC;
UPDATE brag.runtime_metadata SET schema_version=7 WHERE id=1;
COMMIT;
