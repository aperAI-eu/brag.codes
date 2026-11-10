BEGIN;
-- A project has its own identity. Repeating a mutation key still replays one creation.
ALTER TABLE brag.project_draft DROP CONSTRAINT project_draft_owner_id_event_id_key;
CREATE INDEX project_draft_owner_event_created ON brag.project_draft(owner_id, event_id, created_at, id);
ALTER TABLE brag.project_draft ADD COLUMN last_edit jsonb NOT NULL DEFAULT '{}';
UPDATE brag.project_draft SET fields = fields || jsonb_build_object('schema_version', 1, 'details', '{"core_idea":"","capabilities":[],"constraints":[],"limitations":[],"stack":[],"patterns":[],"process":{"tools":[],"workflow":"","hours_bucket":null,"agent_share":null,"gotchas":"","would_build_again":null},"reality_level":null,"looking_for":[],"can_demo":null,"code_license":"","catalogue_text_permission":""}'::jsonb);
ALTER TABLE brag.project_draft ADD CONSTRAINT project_draft_fields_v1 CHECK (
  (fields->>'schema_version') IS NOT DISTINCT FROM '1'
  AND jsonb_typeof(fields->'details') IS NOT DISTINCT FROM 'object'
  AND fields ?& ARRAY['title','problem','description','project_url','repository_url']
);
ALTER TABLE brag.project_draft ADD CONSTRAINT project_draft_last_edit CHECK (
  jsonb_typeof(last_edit) = 'object' AND (last_edit = '{}' OR coalesce(last_edit->>'method' IN ('typed','voice','agent'), false))
);
GRANT UPDATE(last_edit) ON brag.project_draft TO brag_runtime;
UPDATE brag.runtime_metadata SET schema_version = 6 WHERE id = 1;
COMMIT;
