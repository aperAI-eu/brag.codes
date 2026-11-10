#!/usr/bin/env bash
set -euo pipefail
# Runs only for a new database volume, under the image's bootstrap account.
# Values come from a private env file; psql quotes them as literals, never SQL.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 <<'SQL'
\getenv migrator_password BRAG_MIGRATOR_PASSWORD
\getenv runtime_password BRAG_RUNTIME_PASSWORD
\getenv operator_password BRAG_OPERATOR_PASSWORD
CREATE ROLE brag_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD :'migrator_password';
CREATE ROLE brag_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD :'runtime_password';
CREATE ROLE brag_operator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD :'operator_password';
REVOKE ALL ON DATABASE brag FROM PUBLIC;
GRANT CONNECT ON DATABASE brag TO brag_migrator, brag_runtime, brag_operator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA brag AUTHORIZATION brag_migrator;
GRANT USAGE ON SCHEMA brag TO brag_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE brag_migrator IN SCHEMA brag REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE brag_migrator IN SCHEMA brag REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE brag_migrator IN SCHEMA brag REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER ROLE brag_runtime SET statement_timeout = '2s';
ALTER ROLE brag_runtime SET idle_in_transaction_session_timeout = '5s';
SQL
