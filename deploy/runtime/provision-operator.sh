#!/usr/bin/env bash
set -euo pipefail
# Explicit upgrade for an existing LOCAL database, before identity migration.
# Run inside the owned database container; never give this bootstrap account to web.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 <<'SQL'
\getenv operator_password BRAG_OPERATOR_PASSWORD
SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'brag_operator') AS missing \gset
\if :missing
CREATE ROLE brag_operator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD :'operator_password';
\endif
GRANT CONNECT ON DATABASE brag TO brag_operator;
SQL
