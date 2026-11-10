BEGIN;
LOCK TABLE brag.project_draft, brag.draft_mutation, brag.voice_pitch, brag.agent_proposal IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM brag.runtime_metadata WHERE id=1 AND schema_version=7) THEN
    RAISE EXCEPTION 'Publication upgrade requires schema 7';
  END IF;
END $$;

CREATE TABLE brag.project_admission (
  project_id uuid PRIMARY KEY, owner_id text NOT NULL, event_id uuid NOT NULL,
  origin text NOT NULL CHECK(origin IN ('typed','voice','agent','publication_review','historical_voice')),
  source_id uuid NOT NULL, admitted_at timestamptz, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(project_id,owner_id,event_id) REFERENCES brag.project_draft(id,owner_id,event_id),
  UNIQUE(project_id,owner_id,event_id),
  CHECK(isfinite(recorded_at)),
  CHECK((origin='historical_voice' AND admitted_at IS NULL) OR
    (origin<>'historical_voice' AND admitted_at IS NOT NULL AND isfinite(admitted_at)))
);
-- A schema-7 typed save receipt is authoritative. Version 1 is just a reservation.
-- Keep the receipt's actual time; mutable event windows cannot reconstruct history.
INSERT INTO brag.project_admission(project_id,owner_id,event_id,origin,source_id,admitted_at)
SELECT DISTINCT ON (d.id) d.id,d.owner_id,d.event_id,'typed',m.key,m.created_at
FROM brag.project_draft d JOIN brag.draft_mutation m ON m.actor_id=d.owner_id
WHERE m.result->>'draft_id'=d.id::text AND m.result#>>'{receipt,draft_id}'=d.id::text
  AND m.result#>>'{receipt,operation_class}'='new_submission'
  AND jsonb_typeof(m.result#>'{receipt,version}')='number'
  AND (m.result#>>'{receipt,version}')::numeric BETWEEN 2 AND d.version
ORDER BY d.id,m.created_at,m.key;
INSERT INTO brag.project_admission(project_id,owner_id,event_id,origin,source_id,admitted_at)
SELECT d.id,d.owner_id,d.event_id,'agent',p.id,p.received_at
FROM brag.project_draft d JOIN brag.agent_proposal p ON p.draft_id=d.id AND p.owner_id=d.owner_id AND p.event_id=d.event_id
WHERE p.accepted_version IS NOT NULL AND p.accepted_version<=d.version
ON CONFLICT DO NOTHING;
-- Only saved, explicitly approved historical voice results qualify. Retain the
-- protected legacy provenance without inventing an exact historical admission time.
INSERT INTO brag.project_admission(project_id,owner_id,event_id,origin,source_id,admitted_at)
SELECT d.id,d.owner_id,d.event_id,CASE WHEN p.legacy_received THEN 'historical_voice' ELSE 'voice' END,p.id,p.admitted_at
FROM brag.project_draft d JOIN brag.voice_pitch p ON p.draft_id=d.id AND p.owner_id=d.owner_id
WHERE d.last_edit#>>'{approved_pitch,id}'=p.id::text AND d.confirmed_version IS NOT NULL
  AND (p.admitted_at IS NOT NULL OR p.legacy_received)
ON CONFLICT DO NOTHING;

CREATE FUNCTION brag.admit_project(project uuid, actor text, source text, source_ref uuid)
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
  IF e.approval<>'approved' OR e.manually_closed OR at<e.submissions_open_at OR at>=e.submissions_close_at THEN
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
      WHERE p.id=source_ref AND p.draft_id=project AND p.owner_id=actor AND p.event_id=d.event_id AND p.base_version=d.version
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
REVOKE ALL ON FUNCTION brag.admit_project(uuid,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION brag.admit_project(uuid,text,text,uuid) TO brag_runtime;
REVOKE ALL ON brag.project_admission FROM PUBLIC;
GRANT SELECT ON brag.project_admission TO brag_runtime;

CREATE TABLE brag.publication_review (
  id uuid PRIMARY KEY, project_id uuid NOT NULL, owner_id text NOT NULL, event_id uuid NOT NULL,
  draft_version integer NOT NULL CHECK(draft_version>0), publication_version integer NOT NULL CHECK(publication_version=1),
  projection jsonb NOT NULL CHECK(jsonb_typeof(projection)='object'),
  projection_hash text NOT NULL CHECK(projection_hash ~ '^[a-f0-9]{64}$'),
  selection jsonb NOT NULL CHECK(jsonb_typeof(selection)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY(project_id,owner_id,event_id) REFERENCES brag.project_admission(project_id,owner_id,event_id),
  UNIQUE(id,project_id,owner_id,event_id,draft_version,publication_version,projection_hash),
  CHECK(isfinite(created_at) AND isfinite(expires_at) AND expires_at=created_at+interval '15 minutes')
);
CREATE INDEX publication_review_expiry ON brag.publication_review(expires_at,id);
CREATE TABLE brag.project_publication (
  id uuid PRIMARY KEY, project_id uuid NOT NULL, owner_id text NOT NULL, event_id uuid NOT NULL,
  version integer NOT NULL CHECK(version=1), draft_version integer NOT NULL, review_id uuid NOT NULL UNIQUE,
  projection jsonb NOT NULL CHECK(jsonb_typeof(projection)='object'),
  projection_hash text NOT NULL CHECK(projection_hash ~ '^[a-f0-9]{64}$'),
  published_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(published_at)),
  FOREIGN KEY(review_id,project_id,owner_id,event_id,draft_version,version,projection_hash)
    REFERENCES brag.publication_review(id,project_id,owner_id,event_id,draft_version,publication_version,projection_hash),
  UNIQUE(project_id,version), UNIQUE(id,project_id,owner_id,event_id)
);
CREATE TABLE brag.project_public_state (
  project_id uuid PRIMARY KEY, owner_id text NOT NULL, event_id uuid NOT NULL,
  publication_id uuid NOT NULL UNIQUE, visibility text NOT NULL CHECK(visibility IN ('published','withdrawn','hidden')),
  FOREIGN KEY(publication_id,project_id,owner_id,event_id) REFERENCES brag.project_publication(id,project_id,owner_id,event_id),
  UNIQUE(project_id,event_id)
);
CREATE TABLE brag.event_appearance (
  project_id uuid NOT NULL, event_id uuid NOT NULL,
  PRIMARY KEY(project_id,event_id),
  FOREIGN KEY(project_id,event_id) REFERENCES brag.project_public_state(project_id,event_id)
);
CREATE INDEX project_publication_event_page ON brag.project_publication(event_id,published_at DESC,project_id DESC);
CREATE TABLE brag.publication_mutation (
  actor_id text NOT NULL REFERENCES brag.auth_user(id), key uuid NOT NULL,
  project_id uuid NOT NULL, operation text NOT NULL CHECK(operation IN ('review','publish')),
  intent_hash text NOT NULL CHECK(intent_hash ~ '^[a-f0-9]{64}$'),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor_id,key), FOREIGN KEY(project_id) REFERENCES brag.project_draft(id)
);
REVOKE ALL ON brag.publication_review,brag.project_publication,brag.project_public_state,brag.event_appearance,brag.publication_mutation FROM PUBLIC;
GRANT SELECT,INSERT ON brag.publication_review,brag.project_publication,brag.project_public_state,brag.event_appearance,brag.publication_mutation TO brag_runtime;
-- A snapshot must contain exactly the reviewed bytes, not an independently supplied projection.
CREATE FUNCTION brag.guard_publication() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,brag AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM brag.publication_review r WHERE r.id=NEW.review_id AND r.projection=NEW.projection AND r.expires_at>clock_timestamp()) THEN
    RAISE EXCEPTION 'Publication must match an unexpired review' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER publication_guard BEFORE INSERT ON brag.project_publication FOR EACH ROW EXECUTE FUNCTION brag.guard_publication();
REVOKE ALL ON FUNCTION brag.guard_publication() FROM PUBLIC;
CREATE FUNCTION brag.cleanup_publication_reviews() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,brag AS $$
DECLARE removed integer;
BEGIN
  DELETE FROM brag.publication_review WHERE id IN (
    SELECT r.id FROM brag.publication_review r WHERE r.expires_at<clock_timestamp()-interval '24 hours'
    AND NOT EXISTS(SELECT 1 FROM brag.project_publication p WHERE p.review_id=r.id)
    ORDER BY r.expires_at,r.id LIMIT 100 FOR UPDATE OF r SKIP LOCKED);
  GET DIAGNOSTICS removed=ROW_COUNT;
  RETURN removed;
END $$;
REVOKE ALL ON FUNCTION brag.cleanup_publication_reviews() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION brag.cleanup_publication_reviews() TO brag_runtime;
UPDATE brag.runtime_metadata SET schema_version=8 WHERE id=1;
COMMIT;
