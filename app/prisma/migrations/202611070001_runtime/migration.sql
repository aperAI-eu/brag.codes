BEGIN;
CREATE TABLE brag.runtime_metadata (
  id integer PRIMARY KEY CHECK (id = 1),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  installed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO brag.runtime_metadata (id, schema_version) VALUES (1, 1);
REVOKE ALL ON brag.runtime_metadata FROM PUBLIC;
GRANT SELECT ON brag.runtime_metadata TO brag_runtime;
-- Future tables receive explicit grants in their own migrations. The runtime
-- cannot alter metadata, migration history or future role-assignment records.
COMMIT;
