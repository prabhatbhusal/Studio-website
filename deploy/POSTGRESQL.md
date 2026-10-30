# PostgreSQL on your VPS

The existing VPS PostgreSQL installation is a reasonable starting point. Managed PostgreSQL means a provider operates the database service; backup retention, recovery, availability and maintenance guarantees depend on the provider and plan. Self-hosting avoids another service bill but makes updates, monitoring, disk capacity and tested off-VPS recovery your responsibility. One VPS is also one failure domain for both application and database.

## What this application currently stores

PostgreSQL holds accounts, password hashes and password-reset state. Projects, permissions attached to projects, scenes, published snapshots, websites, reservations, leads, statistics and activity still use DATA_DIR. Uploads use local assets or S3. Setting DATABASE_URL does not migrate these stores. Keep one production API process. Do not enable cluster mode or remove the process lock.

## Provision securely on the VPS

Use a dedicated application database and role, not the PostgreSQL superuser. From an administrator's psql session, for a new installation only:

```sql
CREATE ROLE rcaas_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
\password rcaas_app
CREATE DATABASE rcaas OWNER rcaas_app;
REVOKE ALL ON DATABASE rcaas FROM PUBLIC;
GRANT CONNECT ON DATABASE rcaas TO rcaas_app;
```

The interactive password prompt avoids recording the password in shell history. Use a generated unique secret. Do not recreate an existing database or overwrite existing roles. The migration runner creates the app schema; the connecting role must own its tables (RLS intentionally blocks unrelated roles). This role can migrate the application schema but is not a cluster administrator. A separate migration role can be introduced later if runtime grants and RLS policies are explicitly designed and tested.

Keep PostgreSQL listening on loopback if the API is on the same VPS, require SCRAM authentication for its loopback host entries in pg_hba.conf, and do not expose port 5432 to the internet. Validate the existing server configuration before changing it.

## Private server environment

Copy only the needed settings into server/.env; example files contain no real credentials:

```dotenv
DATABASE_URL=postgresql://rcaas_app@127.0.0.1:5432/rcaas
DATABASE_PASSWORD="replace-with-a-generated-unique-password"
DATABASE_POOL_MAX=10
DATABASE_CONNECT_TIMEOUT_MS=5000
DATABASE_STATEMENT_TIMEOUT_MS=15000
```

Separate DATABASE_PASSWORD is a raw password, not URL encoded. Alternatively embed a percent-encoded password in DATABASE_URL and omit DATABASE_PASSWORD; using both is refused. The API and backup command use the same password handling. These are backend-only values: never prefix them NEXT_PUBLIC_, put them in client code, or commit them. On Linux restrict the file to the service account with chmod 600 and keep a separately secured secret backup. Root/admin access can still read process environments; an environment variable is not a secret vault. Account passwords are scrypt hashes in storage, not individual environment variables.

For a remote database outside an SSH tunnel, require verified TLS. Set DATABASE_CA_FILE to the trusted server CA and omit SSL parameters from DATABASE_URL; conflicting settings are rejected because node-postgres can otherwise replace the CA configuration. Local loopback/tunnel connections can use the local connection above. Do not disable certificate verification to solve certificate errors.

## Connect from your normal PC

Leave the database on the VPS. Use your SSH key and a local-only tunnel:

```text
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:15432:127.0.0.1:5432 YOUR_SSH_ALIAS
```

While the tunnel is open, PC server/.env uses port 15432 instead of 5432. Keep development pointed at a separate test database; do not attach a local development API with unrelated JSON data to production accounts. The live VPS API uses port 5432 directly. No password is needed in frontend environment files.

## Verification and account cutover

1. Back up DATA_DIR, assets and any existing database. Stop API writers during import and backup/cutover. Do not rely on copying a live collection of JSON files for cross-file consistency.
2. Create an EMPTY disposable database named rcaas_test and give its role permission to create the app schema. Configure TEST_DATABASE_URL privately for the test process. If TLS needs a private CA, also set DATABASE_CA_FILE. Never point this test at production.
3. From server/, run `npm run test:postgres`. It refuses an existing app schema, checks parallel migrations and first signups, password verification, reset redemption races, last-admin protection and transactional import rollback. It removes only the app schema it creates in the dedicated test database. This drill has not been run in the current PC session because no database is configured.
4. Configure production DATABASE_URL and DATABASE_PASSWORD, confirm DATA_DIR points at the existing accounts, then run `npm run db:import-users` from server/. Import preserves IDs, hashes and reset links, retains matching accounts, and rolls back account inserts on conflicts. Source files remain intact. An unreadable/empty source fails visibly.
5. Start the API; verify /api/health, existing-account login, owner/member/staff permissions, reset and password-change flows. Confirm original projects and published content remain accessible.
6. Run the backup command with pg_dump installed. Restore its app-schema dump plus DATA_DIR and assets into a separate environment; verify login, ownership, bookings, attachments and scans there. Keep encrypted off-VPS copies and monitor backup failures and free disk space.

After the first PostgreSQL password/account change, old JSON accounts are stale. Unsetting DATABASE_URL is not a safe rollback then. A rollback needs a reconciled account export or restoration of a consistent cutover backup. Do not run the application in two account modes simultaneously.

## Remaining database work for large-scale operation

Accounts-only PostgreSQL does not make bookings transactional across processes. Before multi-instance deployment, migrate project/scene/site/reservation stores behind their existing interfaces, preserve immutable published versions and IDs, unify physical inventory across website/hotspot channels, enforce availability within database transactions, and add a durable notification outbox. Test two independent API processes contending for the last room/table and a complete restore. This is a separate data migration, not a safe switch to flip blindly on customer data.

References: https://node-postgres.com/features/ssl ; https://node-postgres.com/apis/client ; https://www.postgresql.org/docs/18/libpq-envars.html
