BEGIN;
ALTER TABLE brag.agent_proposal DROP CONSTRAINT agent_proposal_draft_id_key;
CREATE INDEX agent_proposal_draft_history ON brag.agent_proposal(draft_id,received_at DESC,id DESC);
UPDATE brag.runtime_metadata SET schema_version=10 WHERE id=1;
COMMIT;
