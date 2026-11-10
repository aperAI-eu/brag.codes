BEGIN;
ALTER TABLE brag.auth_account DROP CONSTRAINT qualified_provider;
ALTER TABLE brag.auth_account ADD CONSTRAINT qualified_provider CHECK (
  ("providerId" = 'google' AND issuer = 'https://accounts.google.com') OR
  ("providerId" = 'github' AND issuer = 'https://github.com')
);
UPDATE brag.runtime_metadata SET schema_version = 11 WHERE id = 1;
COMMIT;
