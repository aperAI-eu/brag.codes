BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM brag.runtime_metadata WHERE id=1 AND schema_version=12) THEN
    RAISE EXCEPTION 'Publication lifecycle upgrade requires schema 12';
  END IF;
END $$;
ALTER TABLE brag.publication_review DROP CONSTRAINT publication_review_publication_version_check;
ALTER TABLE brag.publication_review ADD CHECK(publication_version>0);
ALTER TABLE brag.publication_review ADD COLUMN base_revision integer NOT NULL DEFAULT 0 CHECK(base_revision>=0);
ALTER TABLE brag.project_publication DROP CONSTRAINT project_publication_version_check;
ALTER TABLE brag.project_publication ADD CHECK(version>0);
ALTER TABLE brag.project_public_state ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE brag.project_public_state ADD COLUMN owner_withdrawn boolean NOT NULL DEFAULT false;
UPDATE brag.project_public_state SET owner_withdrawn=true WHERE visibility='withdrawn';
ALTER TABLE brag.publication_mutation DROP CONSTRAINT publication_mutation_operation_check;
ALTER TABLE brag.publication_mutation ADD CHECK(operation IN ('review','publish','withdraw'));
REVOKE INSERT ON brag.project_public_state,brag.event_appearance FROM brag_runtime;

CREATE FUNCTION brag.activate_publication(target uuid, actor text, publication uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,brag AS $$
DECLARE d brag.project_draft; s brag.project_public_state; p brag.project_publication;
  r brag.publication_review; previous_version integer; next_revision integer;
BEGIN
  PERFORM 1 FROM brag.event WHERE id=(SELECT event_id FROM brag.project_draft WHERE id=target) FOR SHARE;
  SELECT * INTO d FROM brag.project_draft WHERE id=target AND owner_id=actor AND discarded_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project unavailable' USING ERRCODE='23514'; END IF;
  SELECT * INTO s FROM brag.project_public_state WHERE project_id=target;
  SELECT * INTO p FROM brag.project_publication WHERE id=publication AND project_id=target AND owner_id=actor AND event_id=d.event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Publication unavailable' USING ERRCODE='23514'; END IF;
  SELECT * INTO r FROM brag.publication_review WHERE id=p.review_id;
  SELECT version INTO previous_version FROM brag.project_publication WHERE id=s.publication_id;
  IF r.base_revision<>COALESCE(s.revision,0) OR r.expires_at<=clock_timestamp()
     OR r.draft_version<>d.version OR d.confirmed_version IS DISTINCT FROM d.version
     OR p.version<>COALESCE(previous_version,0)+1 OR s.visibility='hidden'
     OR NOT EXISTS(SELECT 1 FROM brag.event e JOIN brag.author_event a ON a.event_id=e.id
       WHERE e.id=d.event_id AND a.owner_id=actor AND e.approval='approved') THEN
    RAISE EXCEPTION 'Publication state conflict' USING ERRCODE='23514';
  END IF;
  next_revision:=COALESCE(s.revision,0)+1;
  IF s.project_id IS NULL THEN
    INSERT INTO brag.project_public_state(project_id,owner_id,event_id,publication_id,visibility,revision)
      VALUES(target,actor,d.event_id,publication,'published',next_revision);
    INSERT INTO brag.event_appearance(project_id,event_id) VALUES(target,d.event_id);
  ELSE
    UPDATE brag.project_public_state SET publication_id=publication,visibility='published',owner_withdrawn=false,revision=next_revision WHERE project_id=target;
    UPDATE brag.project_draft SET version=version+1,
      confirmed_version=CASE WHEN confirmed_version=version THEN version+1 ELSE confirmed_version END,
      updated_at=clock_timestamp() WHERE id=target;
  END IF;
  RETURN next_revision;
END $$;
REVOKE ALL ON FUNCTION brag.activate_publication(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION brag.activate_publication(uuid,text,uuid) TO brag_runtime;

CREATE FUNCTION brag.withdraw_publication(target uuid, actor text, expected_draft integer, expected_revision integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,brag AS $$
DECLARE d brag.project_draft; s brag.project_public_state;
BEGIN
  PERFORM 1 FROM brag.event WHERE id=(SELECT event_id FROM brag.project_draft WHERE id=target) FOR SHARE;
  SELECT * INTO d FROM brag.project_draft WHERE id=target AND owner_id=actor AND discarded_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project unavailable' USING ERRCODE='23514'; END IF;
  SELECT * INTO s FROM brag.project_public_state WHERE project_id=target AND owner_id=actor;
  IF NOT FOUND OR d.version<>expected_draft OR s.revision<>expected_revision OR s.owner_withdrawn OR s.visibility='withdrawn' THEN
    RAISE EXCEPTION 'Publication state conflict' USING ERRCODE='23514';
  END IF;
  UPDATE brag.project_public_state SET owner_withdrawn=true,
    visibility=CASE WHEN visibility='hidden' THEN 'hidden' ELSE 'withdrawn' END,
    revision=revision+1 WHERE project_id=target;
  UPDATE brag.project_draft SET version=version+1,
    confirmed_version=CASE WHEN confirmed_version=version THEN version+1 ELSE confirmed_version END,
    updated_at=clock_timestamp() WHERE id=target;
  RETURN s.revision+1;
END $$;
REVOKE ALL ON FUNCTION brag.withdraw_publication(uuid,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION brag.withdraw_publication(uuid,text,integer,integer) TO brag_runtime;
UPDATE brag.runtime_metadata SET schema_version=13 WHERE id=1;
COMMIT;
