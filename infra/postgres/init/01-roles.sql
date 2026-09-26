-- Runs once, on first container start.
-- taxi_owner (POSTGRES_USER) owns the schema and runs migrations.
-- taxi_app is the API/worker runtime role: not a superuser and not a table owner,
-- so it cannot alter the schema; migrations grant it table access.
CREATE ROLE taxi_app LOGIN PASSWORD 'taxi_app_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- Test databases: the default one and spares for parallel checkouts (worktrees).
CREATE DATABASE taxi_test OWNER taxi_owner;
CREATE DATABASE taxi_test_2 OWNER taxi_owner;
