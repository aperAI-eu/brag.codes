"""Pure recovery assertions for owned-database tests; no host operations."""

TABLES = ('auth_user','auth_session','auth_account','auth_verification','platform_role','role_audit',
          'event','event_source_alias','event_audit','event_mutation','project_draft','draft_mutation',
          'agent_handoff','agent_request','processor_config')

SHARING_TABLES = ('author_event','author_event_mutation','agent_proposal_upload')

PUBLICATION_TABLES = ('project_admission','publication_review','project_publication','project_public_state','event_appearance','publication_mutation')

FUNCTION = """CREATE FUNCTION brag.rollout_author_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'TEST maintenance: author mutations are paused' USING ERRCODE='55000';
END $$;
CREATE FUNCTION brag.rollout_pitch_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'UPDATE' THEN
  RAISE EXCEPTION 'TEST maintenance: new pitch admissions are paused' USING ERRCODE='55000';
 END IF;
 -- A late dispatch acknowledgement must retain its provider ID solely for cleanup.
 IF OLD.provider_id IS NULL AND NEW.provider_id IS NOT NULL AND NEW.cleanup_pending
   AND (to_jsonb(NEW)-ARRAY['provider_id','cleanup_pending'])=(to_jsonb(OLD)-ARRAY['provider_id','cleanup_pending']) THEN RETURN NEW; END IF;
 -- Cleanup of known provider jobs does not create or replace authored work.
 IF (to_jsonb(NEW)-ARRAY['cleanup_pending','next_attempt']) = (to_jsonb(OLD)-ARRAY['cleanup_pending','next_attempt']) THEN RETURN NEW; END IF;
 IF OLD.status IN ('queued','dispatching','transcribing','structure_queued','structuring')
    AND NEW.status IN ('dispatching','transcribing','structure_queued','structuring','ready','failed','uncertain') THEN RETURN NEW; END IF;
 IF NEW.status='cancelled' AND (OLD.created_at+interval '30 days'<=clock_timestamp()
      OR EXISTS(SELECT 1 FROM brag.auth_user WHERE id=OLD.owner_id AND NOT active)) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'TEST maintenance: author pitch changes are paused' USING ERRCODE='55000';
END $$;"""

DRAIN_SQL = """SELECT json_build_object('active',(SELECT count(*) FROM brag.voice_pitch
 WHERE status IN ('queued','dispatching','transcribing','structure_queued','structuring')
 OR lease_until>clock_timestamp()),'fenced',to_regprocedure('brag.rollout_author_fence()') IS NOT NULL)"""

def install_sql(schema):
    if schema not in (6,7,8,9,10,11,12,13,14,15):
        raise ValueError('Only qualified schema-6/7/8/9/10 runtimes can be drained')
    tables=TABLES+(SHARING_TABLES if schema>=7 else ())+(PUBLICATION_TABLES if schema>=8 else ())
    proposal = "" if schema==6 else """CREATE FUNCTION brag.rollout_proposal_fence() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP='UPDATE' AND OLD.retention_deadline<=clock_timestamp() AND NEW.fields IS NULL AND NEW.cleared_at IS NOT NULL
      AND (to_jsonb(NEW)-ARRAY['fields','cleared_at'])=(to_jsonb(OLD)-ARRAY['fields','cleared_at']) THEN RETURN NEW; END IF;
      RAISE EXCEPTION 'TEST maintenance: proposal writes are paused' USING ERRCODE='55000';
    END $$; CREATE TRIGGER rollout_proposal_fence BEFORE INSERT OR UPDATE OR DELETE ON brag.agent_proposal FOR EACH ROW EXECUTE FUNCTION brag.rollout_proposal_fence();"""
    return "BEGIN; SET LOCAL lock_timeout='5s';" + FUNCTION + proposal + ''.join(
      'CREATE TRIGGER rollout_author_fence BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON brag.'+name+
      ' FOR EACH STATEMENT EXECUTE FUNCTION brag.rollout_author_fence();' for name in tables) + \
      'CREATE TRIGGER rollout_pitch_fence BEFORE INSERT OR UPDATE OR DELETE ON brag.voice_pitch FOR EACH ROW EXECUTE FUNCTION brag.rollout_pitch_fence(); COMMIT;'

def remove_sql(schema):
    if schema not in (6,7,8,9,10,11,12,13,14,15):
        raise ValueError('Unsupported fence schema')
    proposal = '' if schema==6 else 'DROP TRIGGER rollout_proposal_fence ON brag.agent_proposal; DROP FUNCTION brag.rollout_proposal_fence();'
    return 'BEGIN;'+proposal+''.join('DROP TRIGGER rollout_author_fence ON brag.'+name+';' for name in TABLES+(SHARING_TABLES if schema>=7 else ())+(PUBLICATION_TABLES if schema>=8 else ()))+\
      'DROP TRIGGER rollout_pitch_fence ON brag.voice_pitch; DROP FUNCTION brag.rollout_pitch_fence(); DROP FUNCTION brag.rollout_author_fence(); COMMIT;'
