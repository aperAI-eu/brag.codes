BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM brag.runtime_metadata WHERE id=1 AND schema_version=14) THEN
   RAISE EXCEPTION 'Optional event upgrade requires schema 14';
 END IF;
END $$;
-- Scope is a non-null integrity discriminator, never a synthetic event ID.
ALTER TABLE brag.project_draft ALTER COLUMN event_id DROP NOT NULL, ADD COLUMN event_scope text GENERATED ALWAYS AS (COALESCE(event_id::text,'')) STORED NOT NULL;
ALTER TABLE brag.agent_proposal_upload ALTER COLUMN event_id DROP NOT NULL, ADD COLUMN event_scope text GENERATED ALWAYS AS (COALESCE(event_id::text,'')) STORED NOT NULL;
ALTER TABLE brag.agent_proposal ALTER COLUMN event_id DROP NOT NULL, ADD COLUMN event_scope text GENERATED ALWAYS AS (COALESCE(event_id::text,'')) STORED NOT NULL;
ALTER TABLE brag.project_admission ALTER COLUMN event_id DROP NOT NULL, ADD COLUMN event_scope text GENERATED ALWAYS AS (COALESCE(event_id::text,'')) STORED NOT NULL;
ALTER TABLE brag.publication_review ALTER COLUMN event_id DROP NOT NULL, ADD COLUMN event_scope text GENERATED ALWAYS AS (COALESCE(event_id::text,'')) STORED NOT NULL;
ALTER TABLE brag.project_publication ALTER COLUMN event_id DROP NOT NULL, ADD COLUMN event_scope text GENERATED ALWAYS AS (COALESCE(event_id::text,'')) STORED NOT NULL;
ALTER TABLE brag.project_public_state ALTER COLUMN event_id DROP NOT NULL, ADD COLUMN event_scope text GENERATED ALWAYS AS (COALESCE(event_id::text,'')) STORED NOT NULL;
ALTER TABLE brag.project_draft ADD CONSTRAINT optional_event_binding_0 UNIQUE(id,owner_id,event_scope);
ALTER TABLE brag.agent_proposal_upload ADD CONSTRAINT optional_event_binding_1 UNIQUE(id,draft_id,owner_id,event_scope,base_version);
ALTER TABLE brag.project_admission ADD CONSTRAINT optional_event_binding_2 UNIQUE(project_id,owner_id,event_scope);
ALTER TABLE brag.publication_review ADD CONSTRAINT optional_event_binding_3 UNIQUE(id,project_id,owner_id,event_scope,draft_version,publication_version,projection_hash);
ALTER TABLE brag.project_publication ADD CONSTRAINT optional_event_binding_4 UNIQUE(id,project_id,owner_id,event_scope);
ALTER TABLE brag.agent_proposal_upload ADD CONSTRAINT optional_event_parent_0 FOREIGN KEY(draft_id,owner_id,event_scope) REFERENCES brag.project_draft(id,owner_id,event_scope) ON DELETE RESTRICT;
ALTER TABLE brag.agent_proposal ADD CONSTRAINT optional_event_parent_1 FOREIGN KEY(upload_id,draft_id,owner_id,event_scope,base_version) REFERENCES brag.agent_proposal_upload(id,draft_id,owner_id,event_scope,base_version) ON DELETE RESTRICT;
ALTER TABLE brag.project_admission ADD CONSTRAINT optional_event_parent_2 FOREIGN KEY(project_id,owner_id,event_scope) REFERENCES brag.project_draft(id,owner_id,event_scope) ON DELETE RESTRICT;
ALTER TABLE brag.publication_review ADD CONSTRAINT optional_event_parent_3 FOREIGN KEY(project_id,owner_id,event_scope) REFERENCES brag.project_admission(project_id,owner_id,event_scope) ON DELETE RESTRICT;
ALTER TABLE brag.project_publication ADD CONSTRAINT optional_event_parent_4 FOREIGN KEY(review_id,project_id,owner_id,event_scope,draft_version,version,projection_hash) REFERENCES brag.publication_review(id,project_id,owner_id,event_scope,draft_version,publication_version,projection_hash) ON DELETE RESTRICT;
ALTER TABLE brag.project_public_state ADD CONSTRAINT optional_event_parent_5 FOREIGN KEY(publication_id,project_id,owner_id,event_scope) REFERENCES brag.project_publication(id,project_id,owner_id,event_scope) ON DELETE RESTRICT;
CREATE FUNCTION brag.guard_project_context() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,brag AS $$
BEGIN
 IF NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
   RAISE EXCEPTION 'Project ownership and event context are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION brag.guard_project_context() FROM PUBLIC;
CREATE TRIGGER project_context_guard BEFORE UPDATE ON brag.project_draft FOR EACH ROW EXECUTE FUNCTION brag.guard_project_context();
CREATE OR REPLACE FUNCTION brag.admit_project(project uuid, actor text, source text, source_ref uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,brag AS $$
DECLARE d brag.project_draft; e brag.event; at timestamptz;
BEGIN
  SELECT * INTO d FROM brag.project_draft WHERE id=project AND owner_id=actor AND discarded_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown project' USING ERRCODE='23514'; END IF;
  -- Match the application's authority -> event -> project order, even for direct calls.
  SELECT * INTO e FROM brag.event WHERE id=d.event_id FOR SHARE;
  SELECT * INTO d FROM brag.project_draft WHERE id=project AND owner_id=actor AND discarded_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown project' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM brag.project_admission WHERE project_id=project) THEN RETURN; END IF;
  at := clock_timestamp();
  IF d.event_id IS NOT NULL AND (e.id IS NULL OR e.approval<>'approved' OR e.manually_closed OR at<e.submissions_open_at OR at>=e.submissions_close_at) THEN
    RAISE EXCEPTION 'Admission requires live event' USING ERRCODE='23514';
  END IF;
  IF source='typed' THEN
    IF NOT EXISTS(SELECT 1 FROM brag.draft_mutation m WHERE m.actor_id=actor AND m.key=source_ref
      AND m.result->>'draft_id'=project::text AND m.result#>>'{receipt,draft_id}'=project::text
      AND m.result#>>'{receipt,operation_class}'='new_submission'
      AND m.result#>>'{receipt,version}'=d.version::text AND d.version>1 AND d.confirmed_version=d.version) THEN
      RAISE EXCEPTION 'Typed admission requires save receipt' USING ERRCODE='23514';
    END IF;
  ELSIF source='voice' THEN
    IF NOT EXISTS(SELECT 1 FROM brag.voice_pitch p WHERE p.id=source_ref AND p.draft_id=project AND p.owner_id=actor
      AND NOT p.legacy_received AND p.admitted_at IS NOT NULL AND p.base_version=d.version AND p.status='queued') THEN
      RAISE EXCEPTION 'Voice admission requires complete intake' USING ERRCODE='23514';
    END IF;
  ELSIF source='agent' THEN
    IF NOT EXISTS(SELECT 1 FROM brag.agent_proposal p JOIN brag.agent_proposal_upload u ON u.id=p.upload_id
      WHERE p.id=source_ref AND p.draft_id=project AND p.owner_id=actor AND p.event_id IS NOT DISTINCT FROM d.event_id AND p.base_version=d.version
      AND p.fields IS NOT NULL AND u.consumed_proposal_id=p.id AND u.consumed_at=p.received_at) THEN
      RAISE EXCEPTION 'Agent admission requires received proposal' USING ERRCODE='23514';
    END IF;
  ELSIF source='publication_review' THEN
    IF source_ref<>project OR d.confirmed_version IS DISTINCT FROM d.version
      OR btrim(d.fields->>'title')='' OR btrim(d.fields->>'problem')='' OR btrim(d.fields->>'description')='' THEN
      RAISE EXCEPTION 'Review admission requires confirmed content' USING ERRCODE='23514';
    END IF;
  ELSE RAISE EXCEPTION 'Invalid admission source' USING ERRCODE='23514'; END IF;
  INSERT INTO brag.project_admission(project_id,owner_id,event_id,origin,source_id,admitted_at)
    VALUES(project,actor,d.event_id,source,source_ref,at);
END $$;
CREATE OR REPLACE FUNCTION brag.activate_publication(target uuid, actor text, publication uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,brag AS $$
DECLARE d brag.project_draft; s brag.project_public_state; p brag.project_publication;
  r brag.publication_review; previous_version integer; next_revision integer;
BEGIN
  PERFORM 1 FROM brag.event WHERE id=(SELECT event_id FROM brag.project_draft WHERE id=target) FOR SHARE;
  SELECT * INTO d FROM brag.project_draft WHERE id=target AND owner_id=actor AND discarded_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project unavailable' USING ERRCODE='23514'; END IF;
  SELECT * INTO s FROM brag.project_public_state WHERE project_id=target;
  SELECT * INTO p FROM brag.project_publication WHERE id=publication AND project_id=target AND owner_id=actor AND event_id IS NOT DISTINCT FROM d.event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Publication unavailable' USING ERRCODE='23514'; END IF;
  SELECT * INTO r FROM brag.publication_review WHERE id=p.review_id;
  SELECT version INTO previous_version FROM brag.project_publication WHERE id=s.publication_id;
  IF r.base_revision<>COALESCE(s.revision,0) OR r.expires_at<=clock_timestamp()
     OR r.draft_version<>d.version OR d.confirmed_version IS DISTINCT FROM d.version
     OR p.version<>COALESCE(previous_version,0)+1 OR s.visibility='hidden'
     OR (d.event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM brag.event e JOIN brag.author_event a ON a.event_id=e.id
       WHERE e.id=d.event_id AND a.owner_id=actor AND e.approval='approved')) THEN
    RAISE EXCEPTION 'Publication state conflict' USING ERRCODE='23514';
  END IF;
  next_revision:=COALESCE(s.revision,0)+1;
  IF s.project_id IS NULL THEN
    INSERT INTO brag.project_public_state(project_id,owner_id,event_id,publication_id,visibility,revision)
      VALUES(target,actor,d.event_id,publication,'published',next_revision);
    IF d.event_id IS NOT NULL THEN
      INSERT INTO brag.event_appearance(project_id,event_id) VALUES(target,d.event_id);
    END IF;
  ELSE
    UPDATE brag.project_public_state SET publication_id=publication,visibility='published',owner_withdrawn=false,revision=next_revision WHERE project_id=target;
    UPDATE brag.project_draft SET version=version+1,
      confirmed_version=CASE WHEN confirmed_version=version THEN version+1 ELSE confirmed_version END,
      updated_at=clock_timestamp() WHERE id=target;
  END IF;
  RETURN next_revision;
END $$;
UPDATE brag.runtime_metadata SET schema_version=15 WHERE id=1;
COMMIT;
