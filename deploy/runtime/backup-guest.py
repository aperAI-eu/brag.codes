"""Pure recovery assertions for owned-database tests; no host operations."""

SCHEMA_FINGERPRINT_SQL = "SET ROLE brag_migrator; SELECT encode(sha256(convert_to(COALESCE(string_agg(item, E'\\n' ORDER BY item), ''), 'UTF8')), 'hex') AS fingerprint FROM (\n SELECT 'relation:'||c.relname||':'||c.relkind::text||':'||pg_get_userbyid(c.relowner) AS item\n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='brag'\n UNION ALL SELECT 'column:'||c.relname||':'||a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull||':'||COALESCE(pg_get_expr(d.adbin,d.adrelid),'')\n FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum\n WHERE n.nspname='brag' AND a.attnum>0 AND NOT a.attisdropped\n UNION ALL SELECT 'constraint:'||c.relname||':'||x.conname||':'||pg_get_constraintdef(x.oid, true)\n FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='brag'\n UNION ALL SELECT 'index:'||tablename||':'||indexname||':'||indexdef FROM pg_indexes WHERE schemaname='brag'\n UNION ALL SELECT 'function:'||p.proname||':'||pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='brag'\n UNION ALL SELECT 'trigger:'||c.relname||':'||t.tgname||':'||pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='brag' AND NOT t.tgisinternal\n UNION ALL SELECT 'table-grant:'||table_name||':'||grantee||':'||privilege_type||':'||is_grantable FROM information_schema.role_table_grants WHERE table_schema='brag'\n UNION ALL SELECT 'column-grant:'||table_name||':'||column_name||':'||grantee||':'||privilege_type||':'||is_grantable FROM information_schema.role_column_grants WHERE table_schema='brag'\n UNION ALL SELECT 'function-grant:'||p.proname||':'||acl::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL unnest(p.proacl) acl WHERE n.nspname='brag'\n) schema_items;\n"

DELETION_CHECK_SQL = """SELECT json_build_object('deletionIntegrity',NOT EXISTS(SELECT 1 FROM brag.project_deletion x JOIN brag.project_draft d ON d.id=x.project_id WHERE d.owner_id<>x.owner_id OR d.discarded_at IS NULL OR d.fields->>'title'<>'' OR d.fields->>'description'<>'' OR EXISTS(SELECT 1 FROM brag.project_public_state s WHERE s.project_id=d.id) OR EXISTS(SELECT 1 FROM brag.agent_proposal p WHERE p.draft_id=d.id AND p.fields IS NOT NULL) OR EXISTS(SELECT 1 FROM brag.voice_pitch p WHERE p.draft_id=d.id AND (p.status<>'cancelled' OR p.transcript<>'' OR p.proposal IS NOT NULL))), 'deletionPrivileges',NOT has_table_privilege('brag_runtime','brag.project_deletion','INSERT,UPDATE,DELETE,TRUNCATE') AND NOT has_function_privilege('brag_runtime','brag.purge_deleted_project(uuid)','EXECUTE') AND has_function_privilege('brag_runtime','brag.delete_owned_project(uuid,text,integer,boolean,uuid)','EXECUTE'));"""

LIFECYCLE_CHECK_SQL = """SELECT json_build_object(
 'lifecycleIntegrity', NOT EXISTS(SELECT 1 FROM brag.project_public_state s JOIN brag.project_publication p ON p.id=s.publication_id
 JOIN brag.publication_review r ON r.id=p.review_id WHERE s.revision<r.base_revision+1 OR s.revision<p.version
 OR (s.visibility='published' AND s.owner_withdrawn) OR (s.visibility='withdrawn' AND NOT s.owner_withdrawn)),
 'lifecyclePrivileges', NOT has_table_privilege('brag_runtime','brag.project_public_state','INSERT,UPDATE,DELETE,TRUNCATE')
 AND NOT has_any_column_privilege('brag_runtime','brag.project_public_state','INSERT')
 AND NOT has_any_column_privilege('brag_runtime','brag.event_appearance','INSERT')
 AND NOT has_any_column_privilege('brag_runtime','brag.project_public_state','UPDATE')
 AND has_function_privilege('brag_runtime','brag.activate_publication(uuid,text,uuid)','EXECUTE')
 AND has_function_privilege('brag_runtime','brag.withdraw_publication(uuid,text,integer,integer)','EXECUTE')
)"""

MODERATION_CHECK_SQL = """SELECT json_build_object(
 'moderationIntegrity', NOT EXISTS(SELECT 1 FROM brag.moderation_audit a JOIN brag.project_public_state s ON s.project_id=a.project_id
 WHERE a.revision>s.revision OR (a.revision=s.revision AND (a.hidden<>(s.visibility='hidden') OR a.owner_withdrawn<>s.owner_withdrawn)))
 AND NOT EXISTS(SELECT 1 FROM brag.moderation_receipt r JOIN brag.moderation_audit a ON a.id=r.audit_id WHERE r.project_id<>a.project_id OR r.actor_id<>a.actor_id
 OR r.result->>'project_id'<>a.project_id::text OR (r.result->>'revision')::integer<>a.revision OR r.result->>'action'<>a.action)
 AND NOT EXISTS(SELECT 1 FROM brag.moderation_audit a JOIN brag.project_deletion d ON d.project_id=a.project_id),
 'moderationPrivileges', has_function_privilege('brag_runtime','brag.moderate_project(uuid,text,uuid,text,integer,text)','EXECUTE')
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['moderation_audit','moderation_receipt']) AS t(name)
 WHERE has_table_privilege('brag_runtime','brag.'||t.name,'INSERT,UPDATE,DELETE,TRUNCATE') OR has_any_column_privilege('brag_runtime','brag.'||t.name,'INSERT,UPDATE'))
)"""

OPTIONAL_EVENT_CHECK_SQL = """SELECT json_build_object(
 'optionalEventIntegrity', (SELECT count(*)=6 AND bool_and(convalidated) FROM pg_constraint WHERE connamespace='brag'::regnamespace AND conname LIKE 'optional_event_parent_%')
 AND NOT EXISTS(SELECT 1 FROM brag.project_draft WHERE event_scope IS DISTINCT FROM COALESCE(event_id::text,''))
 AND NOT EXISTS(SELECT 1 FROM brag.project_public_state s JOIN brag.event_appearance a ON a.project_id=s.project_id WHERE s.event_id IS NULL),
 'optionalEventPrivileges', NOT has_column_privilege('brag_runtime','brag.project_draft','event_id','UPDATE')
 AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='brag.project_draft'::regclass AND tgname='project_context_guard' AND tgenabled='O')
)"""

def record_hashes_sql(schema):
    """Only deterministic hashes leave the database; schema-6 columns survive upgrade unchanged."""
    if schema not in (2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15):
        raise ValueError('Unsupported recovery schema')
    tables = {'auth_user': None, 'auth_session': None, 'auth_account': None,
              'platform_role': None, 'role_audit': None}
    if schema >= 3:
        tables.update({name: None for name in ('event', 'event_source_alias', 'event_audit', 'event_mutation')})
    if schema >= 4:
        tables.update({'project_draft': ['confirmed_version', 'confirmed_at', 'discarded_at', 'legacy_record', 'deleted_at'],
                       'voice_pitch': ['admitted_at', 'sample_count', 'legacy_received', 'audio_removed_at', 'recovery_config_version', 'transcription_attempt', 'transcription_started_at'],
                       'draft_mutation': None, 'agent_handoff': ['revoked'], 'agent_request': ['state']})
    if schema >= 5:
        tables['processor_config'] = None
    if schema >= 7:
        tables.update({name: None for name in ('author_event', 'author_event_mutation', 'agent_proposal_upload', 'agent_proposal')})
    if schema >= 8:
        tables.update({name: None for name in ('project_admission','publication_review','project_publication','project_public_state','event_appearance','publication_mutation')})
    if schema >= 8:
        tables['publication_review'] = ['base_revision']
        tables['project_public_state'] = ['revision','owner_withdrawn']
    if schema >= 12:
        tables['project_deletion'] = None
    if schema >= 14:
        tables.update({'moderation_audit': None, 'moderation_receipt': None})
    pairs = []
    for name, excluded in tables.items():
        expression = 'to_jsonb(t)'
        if name in ('project_draft','agent_proposal_upload','agent_proposal','project_admission','publication_review','project_publication','project_public_state'):
            expression += " - 'event_scope'"
        if excluded:
            expression += ' - ARRAY[' + ','.join("'" + item + "'" for item in excluded) + ']'
        pairs.extend(["'" + name + "'", "(SELECT encode(sha256(convert_to(COALESCE(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') FROM (SELECT encode(sha256(convert_to((" + expression + ")::text,'UTF8')),'hex') AS h FROM brag." + name + " t) rows)"])
    if schema >= 7:
        for label, table, columns in (
            ('projectConfirmationFacts','project_draft','id,confirmed_version,confirmed_at,discarded_at,legacy_record'),
            ('pitchIntakeFacts','voice_pitch','id,admitted_at,sample_count,legacy_received'),
        ):
            pairs.extend(["'" + label + "'", "(SELECT encode(sha256(convert_to(COALESCE(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') FROM (SELECT encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') h FROM (SELECT " + columns + " FROM brag." + table + ") f) rows)"])
    if schema >= 9:
        pairs.extend(["'pitchRecoveryFacts'", "(SELECT encode(sha256(convert_to(COALESCE(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') FROM (SELECT encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') h FROM (SELECT id,audio_removed_at,recovery_config_version,transcription_attempt,transcription_started_at FROM brag.voice_pitch) f) rows)"])
    if schema >= 13:
        for label, table, columns in (
            ('publicationReviewFacts','publication_review','id,base_revision'),
            ('publicationStateFacts','project_public_state','project_id,revision,owner_withdrawn'),
        ):
            pairs.extend(["'" + label + "'", "(SELECT encode(sha256(convert_to(COALESCE(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') FROM (SELECT encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') h FROM (SELECT " + columns + " FROM brag." + table + ") f) rows)"])
    return "SELECT json_build_object('recordHashes',json_build_object(" + ','.join(pairs) + '))'

AGENT_REFINEMENT_CHECK_SQL = """SELECT json_build_object(
 'agentRefinementIntegrity', NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='brag.agent_proposal'::regclass AND conname='agent_proposal_draft_id_key')
 AND EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='brag' AND indexname='agent_proposal_draft_history' AND indexdef LIKE '%(draft_id, received_at DESC, id DESC)%')
 AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='brag.agent_proposal'::regclass AND conname='agent_proposal_upload_id_key' AND contype='u'),
 'agentRefinementPrivileges', NOT has_table_privilege('brag_runtime','brag.agent_proposal','DELETE,TRUNCATE')
 AND NOT has_column_privilege('brag_runtime','brag.agent_proposal','draft_id','UPDATE')
 AND NOT has_column_privilege('brag_runtime','brag.agent_proposal','base_version','UPDATE'))"""

PITCH_RECOVERY_CHECK_SQL = """SELECT json_build_object(
 'pitchRecoveryIntegrity', NOT EXISTS (SELECT 1 FROM brag.voice_pitch WHERE transcription_attempt NOT BETWEEN 1 AND 4
 OR (transcription_attempt=1 AND (transcription_started_at IS NOT NULL OR recovery_config_version IS NOT NULL))
 OR (transcription_attempt>1 AND (transcription_started_at IS NULL OR NOT isfinite(transcription_started_at)
 OR transcription_started_at<created_at OR transcription_started_at>=created_at+interval '24 hours'))),
 'pitchRecoveryPrivileges', has_column_privilege('brag_runtime','brag.voice_pitch','audio_removed_at','UPDATE')
 AND has_column_privilege('brag_runtime','brag.voice_pitch','recovery_config_version','UPDATE')
 AND has_column_privilege('brag_runtime','brag.voice_pitch','transcription_attempt','UPDATE')
 AND has_column_privilege('brag_runtime','brag.voice_pitch','transcription_started_at','UPDATE')
 AND NOT has_column_privilege('brag_runtime','brag.voice_pitch','config_version','UPDATE')
 AND NOT has_column_privilege('brag_runtime','brag.voice_pitch','created_at','UPDATE'))"""

SHARING_CHECK_SQL = """SELECT json_build_object(
 'authorEvents',(SELECT count(*) FROM brag.author_event),
 'authorEventReceipts',(SELECT count(*) FROM brag.author_event_mutation),
 'proposalUploads',(SELECT count(*) FROM brag.agent_proposal_upload),
 'agentProposals',(SELECT count(*) FROM brag.agent_proposal),
 'sharingIntegrity',
   NOT EXISTS(SELECT 1 FROM brag.project_draft d LEFT JOIN brag.author_event a ON a.owner_id=d.owner_id AND a.event_id=d.event_id WHERE d.event_id IS NOT NULL AND a.event_id IS NULL)
   AND NOT EXISTS(SELECT 1 FROM brag.agent_proposal p JOIN brag.agent_proposal_upload u ON u.id=p.upload_id WHERE u.consumed_proposal_id IS DISTINCT FROM p.id OR u.consumed_at IS DISTINCT FROM p.received_at OR p.base_version<>u.base_version OR p.draft_id<>u.draft_id OR p.owner_id<>u.owner_id)
   AND NOT EXISTS(SELECT 1 FROM brag.agent_proposal_upload u LEFT JOIN brag.agent_proposal p ON p.id=u.consumed_proposal_id WHERE u.consumed_proposal_id IS NOT NULL AND p.id IS NULL)
   AND NOT EXISTS(SELECT 1 FROM brag.project_draft d WHERE (confirmed_version IS NULL)<>(confirmed_at IS NULL) OR confirmed_version>version OR (discarded_at IS NOT NULL AND (confirmed_version IS NOT NULL OR legacy_record) AND to_jsonb(d)->>'deleted_at' IS NULL))
   AND NOT EXISTS(SELECT 1 FROM brag.agent_handoff WHERE NOT revoked)
   AND NOT EXISTS(SELECT 1 FROM brag.agent_request WHERE state<>'declined'),
 'sharingPrivileges',
   NOT has_table_privilege('brag_runtime','brag.author_event_mutation','UPDATE,DELETE,TRUNCATE')
   AND NOT has_table_privilege('brag_runtime','brag.agent_handoff','INSERT,UPDATE,DELETE,TRUNCATE')
   AND NOT has_table_privilege('brag_runtime','brag.agent_request','INSERT,UPDATE,DELETE,TRUNCATE')
   AND NOT has_column_privilege('brag_runtime','brag.project_draft','legacy_record','INSERT')
   AND NOT has_column_privilege('brag_runtime','brag.voice_pitch','legacy_received','INSERT')
   AND NOT has_column_privilege('brag_runtime','brag.agent_proposal_upload','secret_hash','UPDATE')
   AND NOT has_column_privilege('brag_runtime','brag.agent_proposal','received_at','INSERT')
   AND has_column_privilege('brag_runtime','brag.agent_proposal','fields','INSERT')
)"""

PUBLICATION_CHECK_SQL = """SELECT json_build_object(
 'admissions',(SELECT count(*) FROM brag.project_admission),
 'publicationReviews',(SELECT count(*) FROM brag.publication_review),
 'publications',(SELECT count(*) FROM brag.project_publication),
 'publicStates',(SELECT count(*) FROM brag.project_public_state),
 'eventAppearances',(SELECT count(*) FROM brag.event_appearance),
 'publicationReceipts',(SELECT count(*) FROM brag.publication_mutation),
 'publicationIntegrity', NOT EXISTS(SELECT 1 FROM brag.project_publication p JOIN brag.publication_review r ON r.id=p.review_id WHERE p.projection<>r.projection OR p.projection_hash<>r.projection_hash)
 AND NOT EXISTS(SELECT 1 FROM brag.project_public_state s LEFT JOIN brag.event_appearance a ON a.project_id=s.project_id AND a.event_id=s.event_id WHERE s.visibility='published' AND s.event_id IS NOT NULL AND a.project_id IS NULL),
 'publicationPrivileges',NOT has_table_privilege('brag_runtime','brag.project_admission','INSERT,UPDATE,DELETE,TRUNCATE')
 AND NOT has_any_column_privilege('brag_runtime','brag.project_admission','INSERT')
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['project_admission','publication_review','project_publication','project_public_state','event_appearance','publication_mutation']) AS t(name)
 WHERE has_table_privilege('brag_runtime','brag.'||t.name,'UPDATE,DELETE,TRUNCATE') OR has_any_column_privilege('brag_runtime','brag.'||t.name,'UPDATE'))
)"""

GITHUB_CHECK_SQL = """SELECT json_build_object(
 'githubIdentityIntegrity',
 EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='brag.auth_account'::regclass AND conname='qualified_provider' AND convalidated
 AND pg_get_constraintdef(oid) = $constraint$CHECK (((("providerId" = 'google'::text) AND (issuer = 'https://accounts.google.com'::text)) OR (("providerId" = 'github'::text) AND (issuer = 'https://github.com'::text))))$constraint$)
 AND NOT EXISTS(SELECT 1 FROM brag.auth_account WHERE NOT (("providerId"='google' AND issuer='https://accounts.google.com') OR ("providerId"='github' AND issuer='https://github.com')))
 AND NOT EXISTS(SELECT 1 FROM brag.auth_account WHERE "accessToken" IS NOT NULL OR "refreshToken" IS NOT NULL OR "idToken" IS NOT NULL),
 'githubIdentityPrivileges',
 NOT has_column_privilege('brag_runtime','brag.auth_account','providerId','UPDATE')
 AND NOT has_column_privilege('brag_runtime','brag.auth_account','issuer','UPDATE')
 AND NOT has_column_privilege('brag_runtime','brag.auth_account','accountId','UPDATE')
 AND NOT has_column_privilege('brag_runtime','brag.auth_account','userId','UPDATE')
 AND NOT has_table_privilege('brag_runtime','brag.platform_role','INSERT,UPDATE,DELETE,TRUNCATE'))"""
