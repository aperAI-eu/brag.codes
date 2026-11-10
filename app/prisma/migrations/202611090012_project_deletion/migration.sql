BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM brag.runtime_metadata WHERE id=1 AND schema_version=11) THEN
  RAISE EXCEPTION 'Project deletion requires schema 11';
 END IF;
END $$;
CREATE TABLE brag.project_deletion (
 project_id uuid PRIMARY KEY, owner_id text NOT NULL, key uuid NOT NULL,
 expected_version integer NOT NULL CHECK(expected_version>0), expected_published boolean NOT NULL,
 deleted_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(deleted_at)),
 UNIQUE(owner_id,key)
);
REVOKE ALL ON brag.project_deletion FROM PUBLIC;
GRANT SELECT ON brag.project_deletion TO brag_runtime;
ALTER TABLE brag.project_deletion ADD UNIQUE(project_id,deleted_at);
ALTER TABLE brag.project_draft ADD COLUMN deleted_at timestamptz;
ALTER TABLE brag.project_draft DROP CONSTRAINT project_draft_discard;
ALTER TABLE brag.project_draft ADD CONSTRAINT project_draft_discard CHECK (
 discarded_at IS NULL OR (isfinite(discarded_at) AND ((confirmed_version IS NULL AND confirmed_at IS NULL AND NOT legacy_record) OR deleted_at IS NOT NULL))
);
ALTER TABLE brag.project_draft ADD CONSTRAINT project_draft_deleted CHECK (
 deleted_at IS NULL OR (discarded_at IS NOT NULL AND fields='{"schema_version":1,"language":null,"title":"","problem":"","description":"","project_url":"","repository_url":"","details":{"core_idea":"","capabilities":[],"constraints":[],"limitations":[],"stack":[],"patterns":[],"process":{"tools":[],"workflow":"","hours_bucket":null,"agent_share":null,"gotchas":"","would_build_again":null},"reality_level":null,"looking_for":[],"can_demo":null,"code_license":"","catalogue_text_permission":""}}'::jsonb AND last_edit='{}'::jsonb)
);
ALTER TABLE brag.project_draft ADD CONSTRAINT project_draft_deletion_ledger FOREIGN KEY(id,deleted_at) REFERENCES brag.project_deletion(project_id,deleted_at);


-- Purging a previously discarded draft is allowed only with a deletion ledger row.
CREATE OR REPLACE FUNCTION brag.guard_draft_confirmation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,brag AS $$
BEGIN
 IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
  RAISE EXCEPTION 'Deletion cannot be reverted' USING ERRCODE='23514';
 END IF;
 IF OLD.confirmed_version IS NOT NULL AND
 (NEW.confirmed_version IS NULL OR NEW.confirmed_version<OLD.confirmed_version OR NEW.confirmed_at<OLD.confirmed_at
 OR (NEW.confirmed_version=OLD.confirmed_version AND NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at)) THEN
  RAISE EXCEPTION 'Confirmation facts cannot regress' USING ERRCODE='23514';
 END IF;
 IF OLD.discarded_at IS NOT NULL AND
 (NEW.discarded_at IS DISTINCT FROM OLD.discarded_at OR NEW.fields IS DISTINCT FROM OLD.fields OR NEW.version<>OLD.version OR NEW.last_edit IS DISTINCT FROM OLD.last_edit)
 AND NOT (NEW.discarded_at=OLD.discarded_at AND NEW.version=OLD.version AND NEW.fields='{"schema_version":1,"language":null,"title":"","problem":"","description":"","project_url":"","repository_url":"","details":{"core_idea":"","capabilities":[],"constraints":[],"limitations":[],"stack":[],"patterns":[],"process":{"tools":[],"workflow":"","hours_bucket":null,"agent_share":null,"gotchas":"","would_build_again":null},"reality_level":null,"looking_for":[],"can_demo":null,"code_license":"","catalogue_text_permission":""}}'::jsonb AND NEW.last_edit='{}'::jsonb
 AND EXISTS(SELECT 1 FROM brag.project_deletion WHERE project_id=OLD.id AND owner_id=OLD.owner_id)) THEN
  RAISE EXCEPTION 'Discarded content cannot be revived' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

-- Internal helper. Web callers cannot execute it or supply a target for recovery.
CREATE FUNCTION brag.purge_deleted_project(project uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,brag AS $$
DECLARE marker brag.project_deletion; d brag.project_draft;
BEGIN
 SELECT * INTO marker FROM brag.project_deletion WHERE project_id=project;
 IF NOT FOUND THEN RAISE EXCEPTION 'Deletion ledger required' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(marker.owner_id,1789));
 SELECT * INTO d FROM brag.project_draft WHERE id=project;
 IF NOT FOUND THEN RETURN; END IF;
 IF d.owner_id<>marker.owner_id THEN RAISE EXCEPTION 'Deletion owner mismatch' USING ERRCODE='23514'; END IF;
 PERFORM id FROM brag.event WHERE id=d.event_id FOR SHARE;
 PERFORM id FROM brag.project_draft WHERE id=project FOR UPDATE;
 DELETE FROM brag.event_appearance WHERE project_id=project;
 DELETE FROM brag.project_public_state WHERE project_id=project;
 DELETE FROM brag.project_publication WHERE project_id=project;
 DELETE FROM brag.publication_review WHERE project_id=project;
 DELETE FROM brag.publication_mutation WHERE project_id=project;
 DELETE FROM brag.project_admission WHERE project_id=project;
 UPDATE brag.agent_proposal_upload SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE draft_id=project;
 UPDATE brag.agent_proposal SET fields=NULL,cleared_at=COALESCE(cleared_at,clock_timestamp()) WHERE draft_id=project;
 DELETE FROM brag.agent_request WHERE code IN (SELECT code FROM brag.agent_handoff WHERE draft_id=project);
 DELETE FROM brag.agent_handoff WHERE draft_id=project;
 UPDATE brag.draft_mutation m SET result=jsonb_build_object('draft_id',project,'deleted',true)
 WHERE m.actor_id=marker.owner_id AND (m.result->>'draft_id'=project::text OR m.result#>>'{draft,id}'=project::text
 OR m.result#>>'{receipt,draft_id}'=project::text OR right(m.result->>'review_url',36)=project::text
 OR m.result->>'pitch_id' IN (SELECT id::text FROM brag.voice_pitch WHERE draft_id=project));
 UPDATE brag.voice_pitch SET status='cancelled',original=NULL,corrected=NULL,transcript='',proposal=NULL,model=NULL,error=NULL,
 lease_until=NULL,cleanup_pending=(provider_id IS NOT NULL),next_attempt=clock_timestamp() WHERE draft_id=project;
 UPDATE brag.project_draft SET fields='{"schema_version":1,"language":null,"title":"","problem":"","description":"","project_url":"","repository_url":"","details":{"core_idea":"","capabilities":[],"constraints":[],"limitations":[],"stack":[],"patterns":[],"process":{"tools":[],"workflow":"","hours_bucket":null,"agent_share":null,"gotchas":"","would_build_again":null},"reality_level":null,"looking_for":[],"can_demo":null,"code_license":"","catalogue_text_permission":""}}'::jsonb,last_edit='{}',deleted_at=marker.deleted_at,discarded_at=COALESCE(discarded_at,marker.deleted_at) WHERE id=project;
END $$;
REVOKE ALL ON FUNCTION brag.purge_deleted_project(uuid) FROM PUBLIC,brag_runtime;

CREATE FUNCTION brag.delete_owned_project(project uuid,actor text,expected integer,was_published boolean,request_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,brag AS $$
DECLARE d brag.project_draft; marker brag.project_deletion; actual_published boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(actor,1789));
 IF NOT EXISTS(SELECT 1 FROM brag.auth_user WHERE id=actor AND active) THEN
  RAISE EXCEPTION 'Unavailable actor' USING ERRCODE='23514';
 END IF;
 SELECT * INTO marker FROM brag.project_deletion WHERE owner_id=actor AND key=request_key;
 IF FOUND THEN
  IF marker.project_id<>project OR marker.expected_version<>expected OR marker.expected_published<>was_published THEN
   RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='23514';
  END IF;
 ELSE
  SELECT * INTO d FROM brag.project_draft WHERE id=project AND owner_id=actor AND discarded_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable project' USING ERRCODE='23514'; END IF;
  PERFORM id FROM brag.event WHERE id=d.event_id FOR SHARE;
  SELECT * INTO d FROM brag.project_draft WHERE id=project AND owner_id=actor AND discarded_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable project' USING ERRCODE='23514'; END IF;
  actual_published := EXISTS(SELECT 1 FROM brag.project_public_state WHERE project_id=project);
  IF d.version<>expected OR actual_published<>was_published THEN
   RAISE EXCEPTION 'Stale confirmation' USING ERRCODE='23514';
  END IF;
  INSERT INTO brag.project_deletion(project_id,owner_id,key,expected_version,expected_published)
   VALUES(project,actor,request_key,expected,was_published) RETURNING * INTO marker;
  PERFORM brag.purge_deleted_project(project);
 END IF;
 RETURN jsonb_build_object('project_id',marker.project_id,'deleted',true,'deleted_at',marker.deleted_at,'receipt',marker.key);
END $$;
REVOKE ALL ON FUNCTION brag.delete_owned_project(uuid,text,integer,boolean,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION brag.delete_owned_project(uuid,text,integer,boolean,uuid) TO brag_runtime;
UPDATE brag.runtime_metadata SET schema_version=12 WHERE id=1;
COMMIT;
