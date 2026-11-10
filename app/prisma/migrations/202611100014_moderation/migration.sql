BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM brag.runtime_metadata WHERE id=1 AND schema_version=13) THEN
  RAISE EXCEPTION 'Moderation upgrade requires schema 13';
 END IF;
END $$;
-- Cascading from public state also covers the existing permanent-deletion/replay helper.
CREATE TABLE brag.moderation_audit (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES brag.project_public_state(project_id) ON DELETE CASCADE,
 actor_id text NOT NULL REFERENCES brag.auth_user(id), actor_name text NOT NULL,
 action text NOT NULL CHECK(action IN ('hide','restore')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000 AND reason=btrim(reason) AND reason ~ '[^[:space:]]'),
 revision integer NOT NULL CHECK(revision>1), hidden boolean NOT NULL, owner_withdrawn boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(project_id,revision),
 CHECK(hidden=(action='hide'))
);
CREATE TABLE brag.moderation_receipt (
 actor_id text NOT NULL REFERENCES brag.auth_user(id), key uuid NOT NULL,
 project_id uuid NOT NULL REFERENCES brag.project_public_state(project_id) ON DELETE CASCADE,
 intent_hash text NOT NULL CHECK(intent_hash ~ '^[a-f0-9]{64}$'),
 audit_id uuid NOT NULL UNIQUE REFERENCES brag.moderation_audit(id) ON DELETE CASCADE,
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(actor_id,key)
);
CREATE INDEX moderation_receipt_rate ON brag.moderation_receipt(actor_id,created_at);
REVOKE ALL ON brag.moderation_audit,brag.moderation_receipt FROM PUBLIC;
GRANT SELECT ON brag.moderation_audit,brag.moderation_receipt TO brag_runtime;

CREATE FUNCTION brag.moderate_project(target uuid, actor text, request_key uuid, operation text, expected integer, explanation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,brag AS $$
DECLARE s brag.project_public_state; d brag.project_draft; previous brag.moderation_receipt;
 actor_name text; digest text; result jsonb; audit uuid; at timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(actor,1789));
 SELECT u.name INTO actor_name FROM brag.auth_user u JOIN brag.platform_role r ON r."userId"=u.id
 WHERE u.id=actor AND u.active AND r.active FOR SHARE OF u,r;
 IF NOT FOUND THEN RAISE EXCEPTION 'access_unavailable' USING ERRCODE='42501'; END IF;
 explanation:=btrim(explanation);
 IF request_key IS NULL OR operation IS NULL OR operation NOT IN ('hide','restore') OR expected IS NULL OR expected<1
 OR explanation IS NULL OR explanation !~ '[^[:space:]]' OR length(explanation) NOT BETWEEN 1 AND 1000 OR explanation ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' THEN
  RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';
 END IF;
 digest:=encode(sha256(convert_to(jsonb_build_array(target,operation,expected,explanation)::text,'UTF8')),'hex');
 SELECT * INTO previous FROM brag.moderation_receipt WHERE actor_id=actor AND key=request_key;
 IF FOUND THEN
  IF previous.intent_hash<>digest THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23514'; END IF;
  RETURN previous.result;
 END IF;
 IF (SELECT count(*) FROM brag.moderation_receipt WHERE actor_id=actor AND created_at>clock_timestamp()-interval '1 minute')>=20 THEN
  RAISE EXCEPTION 'rate_limited' USING ERRCODE='23514';
 END IF;
 PERFORM 1 FROM brag.event WHERE id=(SELECT event_id FROM brag.project_draft WHERE id=target) FOR SHARE;
 SELECT * INTO d FROM brag.project_draft WHERE id=target AND discarded_at IS NULL AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'project_unavailable' USING ERRCODE='23514'; END IF;
 SELECT * INTO s FROM brag.project_public_state WHERE project_id=target;
 IF NOT FOUND THEN RAISE EXCEPTION 'project_unavailable' USING ERRCODE='23514'; END IF;
 IF s.revision<>expected OR (s.visibility='hidden')=(operation='hide') THEN
  RAISE EXCEPTION 'version_conflict' USING ERRCODE='23514';
 END IF;
 UPDATE brag.project_public_state SET visibility=CASE WHEN operation='hide' THEN 'hidden' WHEN owner_withdrawn THEN 'withdrawn' ELSE 'published' END,
 revision=revision+1 WHERE project_id=target;
 UPDATE brag.project_draft SET version=version+1,
 confirmed_version=CASE WHEN confirmed_version=version THEN version+1 ELSE confirmed_version END,
 updated_at=clock_timestamp() WHERE id=target;
 audit:=gen_random_uuid(); at:=clock_timestamp();
 INSERT INTO brag.moderation_audit(id,project_id,actor_id,actor_name,action,reason,revision,hidden,owner_withdrawn,created_at)
 VALUES(audit,target,actor,actor_name,operation,explanation,s.revision+1,operation='hide',s.owner_withdrawn,at);
 result:=jsonb_build_object('project_id',target,'action',operation,'revision',s.revision+1,'hidden',operation='hide','owner_withdrawn',s.owner_withdrawn,'committed_at',at);
 INSERT INTO brag.moderation_receipt(actor_id,key,project_id,intent_hash,audit_id,result,created_at)
 VALUES(actor,request_key,target,digest,audit,result,at);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION brag.moderate_project(uuid,text,uuid,text,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION brag.moderate_project(uuid,text,uuid,text,integer,text) TO brag_runtime;
UPDATE brag.runtime_metadata SET schema_version=14 WHERE id=1;
COMMIT;
