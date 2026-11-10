BEGIN;
CREATE TABLE brag.auth_user (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false, image text,
  active boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL
);
CREATE TABLE brag.auth_session (
  id text PRIMARY KEY, token text NOT NULL UNIQUE, "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL,
  "ipAddress" text, "userAgent" text,
  "userId" text NOT NULL REFERENCES brag.auth_user(id) ON DELETE CASCADE
);
CREATE INDEX auth_session_user_idx ON brag.auth_session("userId");
CREATE TABLE brag.auth_account (
  id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL,
  issuer text NOT NULL DEFAULT 'https://accounts.google.com',
  "userId" text NOT NULL REFERENCES brag.auth_user(id) ON DELETE CASCADE,
  "accessToken" text, "refreshToken" text, "idToken" text,
  "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
  scope text, password text,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL,
  UNIQUE ("providerId", issuer, "accountId"),
  CONSTRAINT qualified_provider CHECK ("providerId" = 'google' AND issuer = 'https://accounts.google.com'),
  CONSTRAINT no_retained_provider_credentials CHECK ("accessToken" IS NULL AND "refreshToken" IS NULL AND "idToken" IS NULL AND password IS NULL)
);
CREATE INDEX auth_account_user_idx ON brag.auth_account("userId");
CREATE TABLE brag.auth_verification (
  id text PRIMARY KEY, identifier text NOT NULL UNIQUE, value text NOT NULL,
  "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL, claimed boolean NOT NULL DEFAULT false
);
CREATE TABLE brag.auth_throttle (
  key text PRIMARY KEY, "window" timestamptz NOT NULL, count integer NOT NULL CHECK (count > 0)
);
CREATE TABLE brag.platform_role (
  "userId" text PRIMARY KEY REFERENCES brag.auth_user(id) ON DELETE RESTRICT,
  role text NOT NULL DEFAULT 'platform_admin' CHECK (role = 'platform_admin'),
  active boolean NOT NULL, version integer NOT NULL CHECK (version > 0),
  "updatedAt" timestamptz NOT NULL
);
CREATE TABLE brag.role_audit (
  "requestId" text PRIMARY KEY,
  "userId" text NOT NULL REFERENCES brag.auth_user(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('bootstrap', 'grant', 'revoke')),
  version integer NOT NULL CHECK (version > 0),
  operator text NOT NULL, reason text NOT NULL, evidence text NOT NULL,
  "commandHash" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(), UNIQUE ("userId", version)
);
-- A first-admin receipt is durable; restart/sign-in never consumes a grant trigger.
CREATE UNIQUE INDEX one_admin_bootstrap ON brag.role_audit(action) WHERE action = 'bootstrap';
REVOKE ALL ON ALL TABLES IN SCHEMA brag FROM PUBLIC;
GRANT SELECT, INSERT ON brag.auth_user TO brag_runtime;
GRANT UPDATE (name, email, "emailVerified", image, "updatedAt") ON brag.auth_user TO brag_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON brag.auth_session, brag.auth_verification, brag.auth_throttle TO brag_runtime;
GRANT SELECT, INSERT ON brag.auth_account TO brag_runtime;
GRANT UPDATE ("accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", scope, "updatedAt") ON brag.auth_account TO brag_runtime;
GRANT SELECT ON brag.platform_role TO brag_runtime;
GRANT USAGE ON SCHEMA brag TO brag_operator;
GRANT SELECT ON brag.auth_user, brag.auth_account, brag.platform_role, brag.role_audit TO brag_operator;
GRANT INSERT ON brag.platform_role, brag.role_audit TO brag_operator;
GRANT UPDATE (active, version, "updatedAt") ON brag.platform_role TO brag_operator;
UPDATE brag.runtime_metadata SET schema_version = 2 WHERE id = 1;
COMMIT;
