import "server-only";
import type { createDatabase } from "../database/client.ts";

export const expectedSchemaVersion = 15;
export async function isDatabaseReady(db: ReturnType<typeof createDatabase>): Promise<boolean> {
  try {
    const rows = await db.$queryRaw<{ safe: boolean }[]>`
      SELECT (current_user = 'brag_runtime'
        AND (SELECT count(*)=6 AND bool_and(convalidated) FROM pg_constraint WHERE connamespace='brag'::regnamespace AND conname LIKE 'optional_event_parent_%')
        AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='brag.project_draft'::regclass AND tgname='project_context_guard' AND tgenabled='O')
        AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
        AND NOT rolreplication AND NOT rolbypassrls
        AND NOT has_database_privilege(current_user, current_database(), 'CREATE')
        AND NOT has_schema_privilege(current_user, 'brag', 'CREATE')
        AND NOT has_schema_privilege(current_user, 'public', 'CREATE')
        AND NOT pg_has_role(current_user, 'brag_migrator', 'MEMBER')
        AND NOT pg_has_role(current_user, 'brag_operator', 'MEMBER')
        AND NOT has_table_privilege(current_user, 'brag.platform_role', 'INSERT,UPDATE,DELETE,TRUNCATE')
        AND NOT has_any_column_privilege(current_user, 'brag.platform_role', 'UPDATE')
        AND NOT has_table_privilege(current_user, 'brag.role_audit', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
        AND NOT has_table_privilege(current_user, 'brag.processor_config', 'UPDATE,DELETE,TRUNCATE')
        AND NOT has_column_privilege(current_user, 'brag.voice_pitch', 'config_version', 'UPDATE')
        AND has_function_privilege(current_user, 'brag.activate_publication(uuid,text,uuid)', 'EXECUTE')
        AND has_function_privilege(current_user, 'brag.withdraw_publication(uuid,text,integer,integer)', 'EXECUTE')
        AND has_function_privilege(current_user, 'brag.moderate_project(uuid,text,uuid,text,integer,text)', 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['moderation_audit','moderation_receipt']) AS t(name) WHERE has_table_privilege(current_user,'brag.'||t.name,'INSERT,UPDATE,DELETE,TRUNCATE') OR has_any_column_privilege(current_user,'brag.'||t.name,'INSERT,UPDATE'))
        AND NOT has_any_column_privilege(current_user, 'brag.project_public_state', 'INSERT')
        AND NOT has_any_column_privilege(current_user, 'brag.event_appearance', 'INSERT')
        AND NOT has_table_privilege(current_user, 'brag.project_deletion', 'INSERT,UPDATE,DELETE,TRUNCATE')
        AND NOT has_function_privilege(current_user, 'brag.purge_deleted_project(uuid)', 'EXECUTE')
        AND has_function_privilege(current_user, 'brag.delete_owned_project(uuid,text,integer,boolean,uuid)', 'EXECUTE')
        AND NOT has_table_privilege(current_user, 'brag.draft_mutation', 'UPDATE,DELETE,TRUNCATE')
        AND NOT has_column_privilege(current_user, 'brag.project_draft', 'owner_id', 'UPDATE')
        AND NOT has_column_privilege(current_user, 'brag.voice_pitch', 'draft_id', 'UPDATE')
        AND NOT has_column_privilege(current_user, 'brag.agent_request', 'secret_hash', 'UPDATE')
        AND NOT has_table_privilege(current_user, 'brag.agent_handoff', 'INSERT,UPDATE,DELETE,TRUNCATE')
        AND NOT has_any_column_privilege(current_user, 'brag.agent_handoff', 'UPDATE')
        AND NOT has_table_privilege(current_user, 'brag.agent_request', 'INSERT,UPDATE,DELETE,TRUNCATE')
        AND NOT has_any_column_privilege(current_user, 'brag.agent_request', 'UPDATE')
        AND NOT EXISTS (
          SELECT 1 FROM (VALUES
            ('project_draft','INSERT',ARRAY['legacy_record','confirmed_version','confirmed_at','discarded_at','deleted_at']),
            ('project_draft','UPDATE',ARRAY['legacy_record','owner_id','event_id','deleted_at']),
            ('voice_pitch','INSERT,UPDATE',ARRAY['legacy_received']),
            ('voice_pitch','UPDATE',ARRAY['admitted_at','sample_count']),
            ('author_event','INSERT',ARRAY['linked_at']),
            ('agent_proposal_upload','INSERT',ARRAY['created_at','expires_at','revoked_at','consumed_proposal_id','consumed_at']),
            ('agent_proposal_upload','UPDATE',ARRAY['id','draft_id','owner_id','event_id','base_version','secret_hash','created_at','expires_at']),
            ('agent_proposal','INSERT',ARRAY['received_at','retention_deadline','accepted_version','cleared_at']),
            ('agent_proposal','UPDATE',ARRAY['id','upload_id','draft_id','owner_id','event_id','base_version','request_key','intent_hash','received_at','retention_deadline'])
          ) AS forbidden(table_name,privilege,columns), unnest(forbidden.columns) AS protected_column(name)
          WHERE has_column_privilege(current_user, 'brag.'||forbidden.table_name, protected_column.name, forbidden.privilege)
        )
        AND NOT has_table_privilege(current_user, 'brag.author_event', 'UPDATE,DELETE,TRUNCATE')
        AND NOT has_any_column_privilege(current_user, 'brag.author_event', 'UPDATE')
        AND NOT has_table_privilege(current_user, 'brag.author_event_mutation', 'UPDATE,DELETE,TRUNCATE')
        AND NOT has_any_column_privilege(current_user, 'brag.author_event_mutation', 'UPDATE')
        AND NOT has_column_privilege(current_user, 'brag.agent_proposal_upload', 'secret_hash', 'UPDATE')
        AND NOT has_column_privilege(current_user, 'brag.agent_proposal_upload', 'draft_id', 'UPDATE')
        AND NOT has_column_privilege(current_user, 'brag.agent_proposal', 'request_key', 'UPDATE')
        AND NOT has_column_privilege(current_user, 'brag.agent_proposal', 'accepted_version', 'INSERT')
        AND NOT has_column_privilege(current_user, 'brag.agent_proposal', 'cleared_at', 'INSERT')
        AND NOT has_table_privilege(current_user, 'brag.agent_proposal', 'DELETE,TRUNCATE')
        AND NOT has_table_privilege(current_user, 'brag.agent_proposal_upload', 'DELETE,TRUNCATE')
        AND NOT has_table_privilege(current_user, 'brag.project_admission', 'INSERT,UPDATE,DELETE,TRUNCATE')
        AND NOT has_any_column_privilege(current_user, 'brag.project_admission', 'INSERT')
        AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['project_admission','publication_review','project_publication','project_public_state','event_appearance','publication_mutation']) AS t(name)
          WHERE has_table_privilege(current_user,'brag.'||t.name,'UPDATE,DELETE,TRUNCATE') OR has_any_column_privilege(current_user,'brag.'||t.name,'UPDATE'))
        AND NOT has_table_privilege(current_user, 'brag.event_audit', 'UPDATE,DELETE,TRUNCATE')
        AND NOT has_table_privilege(current_user, 'brag.event_mutation', 'UPDATE,DELETE,TRUNCATE')
        AND NOT has_column_privilege(current_user, 'brag.event_source_alias', 'event_id', 'UPDATE')
        AND NOT has_table_privilege(current_user, 'brag.runtime_metadata', 'INSERT,UPDATE,DELETE,TRUNCATE')
        AND NOT has_table_privilege(current_user, 'brag._prisma_migrations', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      ) AS safe FROM pg_roles WHERE rolname = current_user`;
    if (rows.length !== 1 || !rows[0].safe) return false;
    const metadata = await db.runtimeMetadata.findUnique({ where: { id: 1 } });
    return metadata?.schemaVersion === expectedSchemaVersion;
  } catch {
    return false;
  }
}

export function healthResponse(ready: boolean): Response {
  return Response.json(
    { status: ready ? "ok" : "unavailable" },
    {
      status: ready ? 200 : 503,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        ...(ready ? {} : { "Retry-After": "5" }),
      },
    },
  );
}
