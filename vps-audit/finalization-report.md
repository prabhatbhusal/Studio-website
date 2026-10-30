# Product finalization review — 30 October 2026

## Result

The local regression suite passes: 213 tests (34 client, 179 server), zero failures, one intentionally skipped duplicate S3 case. The production build and TypeScript checks pass. ESLint reports zero errors and six pre-existing warnings. npm audit reports zero known vulnerabilities in both dependency trees at the time checked.

This is a verified local improvement pass, not a statement that every bug has been found or that production is ready. PostgreSQL on the existing VPS is the selected deployment direction; the owner requested setup instructions only. No VPS connection, production database mutation, real guest notification, deployment or account cutover occurred.

## New findings, source and fixes

### F01 — High, malformed password hashes could accept an incorrect password

Source: usersStore-file.js passwordMatches, also imported by the PostgreSQL adapter. Node's hex decoder silently truncated invalid hex; a value such as zz:zz produced a zero-length expected/derived key and a successful empty comparison. This requires malformed stored account data, not merely a wrong password against a valid hash. Fix: validate the exact existing 16-byte salt / 64-byte key format before scrypt; use a fixed derivation size. Shared accountCredentials.js removes the PostgreSQL adapter's dependency on the file persistence implementation. Verification: malformed/short/null hashes fail, valid credentials pass, incorrect credentials fail; full API account suite passes.

### F02 — Medium, database URL TLS settings could replace the configured CA

Source: db.js combined connectionString and ssl without handling pg's documented precedence. Fix: dbConfig.js rejects conflicting URL SSL parameters when DATABASE_CA_FILE is present and explicitly verifies certificates. Verification: configuration conflict tests; real TLS handshake still requires the VPS/test database.

### F03 — Medium, database connection and statement waits were unbounded by application configuration

Source: db.js pool configuration had only pool size. Fix: bounded connection acquisition, statement and idle-transaction timeouts; validate positive integer limits and pool size. Verification: configuration tests and real pg.Client construction. Database outage/load behavior remains unverified without a running database.

### F04 — Medium, simultaneous migration runners could race schema creation/application

Source: db.js created schema/migration ledger before any cross-process lock. Fix: transaction-scoped advisory lock before schema creation; migration ledger and DDL commit together. Account bootstrap/admin/import operations also share their own advisory lock. Verification: source review, JavaScript syntax and existing suite; the new test:postgres drill exercises real concurrent migrations/admin changes when connected. Do not mark real PostgreSQL concurrency verified yet.

### F05 — High, account import could silently mismatch identities or leave a partial migration

Source: scripts/import-users.js inserted one account at a time and ignored email conflicts. A database account with the same email but a different ID could be retained while project ownership still referenced the old file ID. A later error could leave earlier inserts committed. Reset-link state was also omitted, and source directory failures were treated as an empty successful import. Fix: one transaction, shared bootstrap lock, explicit ID/email conflict rejection, preserve reset state, fail on missing/unreadable/empty source, close the pool in finally. Verification: conflict/identity/reset preservation unit tests. Real SQL rollback drill is prepared but not run.

### F06 — Medium, manual room blocks could exceed the inventory calculation horizon

Source: routes/reservations.js validated interval length with nightsOf, which intentionally stops at 366 entries. Thus a multi-year interval passed the <=366 check while later nights were omitted from occupancy. Fix: validate the full calendar difference before using the bounded iterator. Verification: API rejects a 731-night block without writing inventory and accepts the 366-night boundary.

### F07 — Medium, early room search used the table booking timezone

Source: StaySearch used /clock, which always returned site.booking.timezone although rooms have their own stays.timezone. Around midnight this could reject a valid room arrival date. Fix: typed optional stay clock request and room-specific server timezone. Verification: independent Honolulu room/Kathmandu table configuration returns the expected room clock; existing tour clock behavior retained.

### F08 — Medium, project/inbox pending counts could use the wrong day

Source: properties.waitingOn hardcoded Kathmandu; the reservation inbox preferred disabled table defaults over enabled room settings. Project home also included room requests on their checkout day. Fix: shared enabled-service timezone selection for inbox/project summaries and exclusive checkout comparisons in both project count paths. Verification: enabled-service timezone tests and full API/client suite. One summary day is still used for a venue; configurations spanning genuinely different timezones within one project require separate per-service UX.

### F09 — Medium, additional environment filenames were not ignored

Source: .gitignore covered .env/.env.local but not general .env.production-style files. Fix: ignore .env.* while retaining .env.example templates. Verification: git check-ignore for backend/frontend production secret paths and example exclusions. This does not erase any previously committed secrets or replace credential rotation if a secret was exposed.

### F10 — Low, PostgreSQL reset invalidation timestamp preceded password hashing

Source: usersStore-pg.resetPassword captured the cutoff before awaiting scrypt, unlike the file implementation. A session issued during hashing could fall after that cutoff. Fix: derive first, then capture the application timestamp used by the update. Verification: source review and account API regressions; the real PostgreSQL adapter still needs execution. Existing session design uses application clocks; cross-machine clock synchronization remains operationally important.

## Refinements

DATABASE_PASSWORD can now hold a raw password separately from a password-free DATABASE_URL. Ambiguous double configuration is rejected. The actual pg parser is tested with reserved password characters. Backup and API configuration share URL/password construction. Real secrets were not generated into examples or copied into browser configuration.

The PostgreSQL setup/cutover guide is deploy/POSTGRESQL.md. It covers a dedicated role/database, local-only listening, PC-to-VPS SSH tunneling, private environment settings, disposable verification, transactional account import, backup/restore, and rollback limits. There is no new runtime dependency and no broad framework rewrite.

## Browser verification

Current desktop (1440px) and mobile (390px) reservation fixtures passed phone search, overnight-calendar counting, checkout exclusion, selected-day/range filtering, waitlist and clearing filters, with no horizontal overflow. The fixture intercepts API responses; it never changes live guest data.

The local Chyasal client website passed sampled desktop/mobile rendering: no horizontal overflow, no broken loaded images, no captured uncaught runtime exceptions, and booking tabs clear the fixed header. Poppins headings and original system body text remain. Headless sample checks do not certify all customer content, screen readers, touch hardware, GPU behavior or animation performance.

The read-only client browser helper wrote its complete results but did not exit during cleanup; its identified Node process was stopped separately. The reservation fixture exited successfully. Treat the client evidence as completed browser observations, not a clean harness-exit result.

Earlier evidence remains available for the 195 design/font/viewport combinations, keyboard booking tabs, motion controls, draft recovery and review dialog. Those historical results are not represented as a fresh full rerun in this pass.

## Launch requirements still open

1. Run the disposable PostgreSQL drill, actual account import and restore verification on the chosen VPS environment. Owner requested instructions only in this pass.
2. Keep one API process while projects/scenes/sites/reservations remain file-backed. Full transactional PostgreSQL migration, unified inventory, durable notification delivery and multi-process/load tests remain necessary before claiming large-platform scaling readiness.
3. Configure and verify HTTPS/domain/nginx/firewall, persistent directories, strong secrets, restart/recovery, disk monitoring and off-VPS backups. A successful local build does not test these.
4. Verify actual email/SMS/WhatsApp/AI/hotel-engine credentials, sender domains/templates and failure behavior. Tests use fake services. Notification work is not a durable delivery queue and can be lost on a process crash.
5. Validate every real venue's room units, capacities, prices, timezones, floor-plan mapping, media and booking/deposit policy. Do not invent these business facts.
6. Complete real-device/GPU/mobile/low-bandwidth and accessibility checks, all studio-control workflows, and a realistic concurrency/volume test. No measured traffic capacity is claimed.
7. Resolve owner-content/policy placeholders and decide the intended behavior of the separate static GitHub Pages copy, whose interactive features require the API.

## Evidence and reproducibility

Run npm test, npm run lint, npx tsc --noEmit and npm run build. Build in this session used NEXT_DIST_DIR=.next-new to avoid replacing the existing dev output. Logs: evidence/finalization-tests.log, finalization-types.log, finalization-lint.log, finalization-build.log, finalization-dependencies.json and finalization-server-dependencies.json. Browser logs have the finalization-browser prefix.

Feature inventory: feature-inventory.md. Exact test and API indexes: evidence/feature-test-index.txt and evidence/feature-route-index.txt. New regressions: server/test/finalization.test.js and additions to server/test/vps-regressions.test.js. Optional real PostgreSQL drill: cd server then npm run test:postgres, with a private TEST_DATABASE_URL to an empty dedicated *_test database.

The previous 30-finding audit is retained in report-previous-fix-status.md/pdf and findings.json. The current PDF includes that issue register plus this review and the feature inventory. Known issues are not erased by a newer report. Keep the audit artifacts private.

Technical references for database settings: https://node-postgres.com/features/ssl and https://node-postgres.com/apis/client. PostgreSQL environment-secret limitations: https://www.postgresql.org/docs/18/libpq-envars.html.
