import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
const ROOT=path.resolve(import.meta.dirname,'..');
const read=f=>readFileSync(path.join(ROOT,f),'utf8');
const loc=(f,s)=>{const a=read(f).split('\n');const i=a.findIndex(l=>l.includes(s));return `${f}:${i+1}`;};
const findings=[];
function add(id,severity,status,title,refs,impact,evidence,fix,verify){findings.push({id,severity,status,title,refs:refs.map(([f,s])=>loc(f,s)),impact,evidence,fix,verify});}
add('A01','High','Reproduced','The shared signup code also grants unrestricted administrator access',[
 ['server/src/routes/auth.js','if (!email)'],['server/src/middleware/auth.js',"{ role: 'admin' }"],['server/src/store.js','function propertyIsManageable']],
 'Anyone given the team access code to create an editor account can instead log in without an email and obtain access across projects and admin operations. Removing their account or resetting its password does not revoke this accountless session.',
 'reproduce.mjs A01: POST /auth/login with the team code returned an admin JWT without sub. The normal signup path uses that same EDITOR_PASSWORD. This is a legacy compatibility path, but it defeats the current account roles.',
 'Disable accountless login in production; use separate, revocable invitations for signup. Require a real current account for every admin and project action. Rotate SESSION_SECRET after retiring legacy sessions.',
 'The signup code alone must never authenticate as admin; deleted or demoted accounts and old legacy cookies must fail authorization.');
add('A02','High','Reproduced','Staff can write into any known or invented upload staging ID',[
 ['server/src/routes/assets.js',"assetsRouter.post('/:assetId/files'"],['server/src/routes/assets.js',"'/:assetId/files/chunk'"],['server/src/access.js','function mayWorkOnAsset']],
 'The limited staff role can write files despite being barred from creating uploads. Any signed-in user knowing another staging ID can interfere with it. Staging IDs have no stored owner; unreferenced assets also lack ownership checks.',
 'A02 used a staff account to PUT a chunk to ast_other_upload without creating an upload; HTTP 200 and the bytes were written. Init and chunk routes lack assetGuard/refuseStaff. Finalize is guarded but cannot undo the staging modification.',
 'Persist upload owner and state on creation; authorize init, chunk, finalize and cleanup against that owner. Refuse staff before reading upload bodies; reject unknown IDs. Give stored assets explicit ownership.',
 'Staff writes return 403; a second editor cannot initialize, resume, finalize or delete another editor\'s unused upload.');
add('A03','High','Reproduced','Unpublish then publish cannot restore a scene to live',[
 ['server/src/store.js','const version = (draft.publishedVersion'],['server/src/store.js','const { publishedVersion, publishedAt, ...rest }']],
 'A routinely unpublished tour cannot be published again through the normal publish flow. The request fails while the scene remains offline.',
 'A03: publish created @1, unpublish removed publishedVersion from the draft, and republish tried immutable @1 again and threw EEXIST. The same collision follows any published version because numbering restarts at 1.',
 'Keep a monotonic lastVersion counter independent of live status, or allocate from the highest historical version under a lock. Preserve immutable snapshots.',
 'Publish/unpublish/publish repeatedly; every attempt succeeds with a new increasing version, including after restoring older snapshots.');
add('A04','High','Reproduced','Version restore rolls back scene ownership',[
 ['server/src/store.js','export async function restoreVersion'],['server/src/store.js',"[...PUBLISH_FIELDS, 'propertyId']"]],
 'Restoring history after a scene moves out of a shared project can transfer ownership to an earlier owner or null. The person restoring it can lose access, and the old owner may regain access.',
 'A04 published as owner-a, detached the scene as owner-b, then restored version 1: ownerId changed back to owner-a. Restore protects propertyId but does not preserve current ownerId.',
 'Preserve ownership and all authorization metadata from the current draft during restore; restore only editable scene content.',
 'Restore a snapshot after transfer/detach/delete-project flows and assert current ownerId and permissions remain unchanged.');
add('A05','High','Reproduced','Booking read failures become empty inventory and can destroy records',[
 ['server/src/reservations.js','export async function listReservations'],['server/src/reservations.js','const list = await listReservations']],
 'A corrupt reservation file or filesystem read error makes all inventory appear available. The next mutation can replace existing booking data with a new partial list, causing data loss and double bookings.',
 'A05 wrote malformed JSON, readReservations returned [], then withReservations overwrote the damaged file with only a new record. The catch handles every error as an empty store.',
 'Treat only ENOENT as empty. Fail closed for invalid JSON, permission and disk failures; quarantine damaged files, alert operators, and restore from backup before accepting bookings.',
 'Malformed JSON and simulated read failures must return a controlled service error and leave the original file intact.');
add('A06','High','Reproduced','One-time reset links can be redeemed twice concurrently in file mode',[
 ['server/src/usersStore-file.js','export async function resetPassword'],['server/src/usersStore-file.js','record.passwordHash = await hashPassword(password)']],
 'Two requests with the same reset link both succeed and race to choose the account password. File-backed role/password/reset updates can also overwrite each other because whole-file atomic writes do not serialize read-modify-write operations.',
 'A06 called resetPassword twice through Promise.all with one token; both returned a user. The PostgreSQL implementation uses a conditional UPDATE and is stronger for this specific operation.',
 'Serialize all mutations per account, re-read and consume the token inside the lock; preferably use transactional database updates. Never allow a stale role write to revive old credentials.',
 'Concurrent redemption has exactly one success. Concurrent password reset and role change preserve both the new password and intended role.');
add('A07','Medium','Reproduced','Concurrent first signups both become administrators',[
 ['server/src/usersStore-file.js','const isFirstAccount'],['server/src/usersStore-pg.js',"case when exists (select 1 from app.users)"]],
 'During first deployment, two people using the team code can both receive the initial administrator role. The first-account bootstrap is not serialized.',
 'A07 created two users concurrently in an empty file store; both became admin. PostgreSQL has a similar check-then-insert condition; that database path was inspected, not executed.',
 'Bootstrap the first admin explicitly through an operator command, or protect initialization with a global transaction/advisory lock and an invariant.',
 'Concurrent initial registration creates at most one admin; staff invitation must never unexpectedly become admin.');
add('A08','Medium','Reproduced','Public enquiries accept nonexistent or unpublished scene references',[
 ['server/src/routes/leads.js',"const scene = sceneId !== 'hub'"],['server/src/routes/leads.js','const lead = await saveLead']],
 'Invalid scene requests are saved and may trigger default-team email. This creates orphan leads and lets public callers submit against draft scene IDs. Valid published scenes moved between projects are routed using their current draft association.',
 'A08 posted a valid guest form with not-a-real-space and received a persisted lead ID. Lookup uses getScene rather than getPublishedScene and does not reject an unresolved scene.',
 'Require a valid published scene or a valid public project entry point, derive project and scene labels from that public state, and reject unknown IDs before storage/email.',
 'Unknown/draft scenes cannot create leads; published tours route enquiries to the project shown to visitors.');
add('A09','High','Reproduced','Corrupt website state is silently treated as a new website',[
 ['server/src/routes/sites.js','export async function readSite'],['server/src/routes/sites.js',"sitesRouter.put('/:id/draft'"]],
 'A read failure returns null, so a subsequent draft save writes a new object and discards the prior publication, schedule and review state. The live site may disappear without a recoverable API error.',
 'A09 wrote invalid JSON and readSite returned null. The draft route uses (await readSite(...)) ?? {} before overwriting the file.',
 'Only ENOENT means no site. Propagate corruption and disk errors; refuse mutations until recovery and retain backups.',
 'Invalid JSON yields a controlled error and a draft save cannot replace the damaged state.');
add('A10','Medium','Reproduced','External availability response size is checked after full buffering',[
 ['server/src/engine.js','const body = await r.text()']],
 'An engine endpoint can make the VPS allocate a large response despite the intended 64 KB limit. Public room-availability requests can invoke this path concurrently.',
 'A10 supplied a mocked oversized response and proved text() completed before rejection. Code sets a timeout but does not cap streamed response bytes.',
 'Read a bounded stream, stop and cancel once the byte limit is reached; also enforce concurrency limits and a short timeout.',
 'A response over the cap is aborted before full consumption and peak memory stays bounded under simultaneous requests.');
add('A11','Medium','Reproduced','Suffix byte ranges return incorrect file content',[
 ['server/src/routes/assets.js','const start = match?.[1]']],
 'Media clients asking for bytes from the end receive the beginning instead, which can break MP4 metadata probing, seeking and other streaming clients.',
 'A11: a 10-byte file containing 0123456789 returned 0123 for Range: bytes=-3. It should return 789 with Content-Range bytes 7-9/10.',
 'Implement suffix-length semantics and reject empty/invalid ranges; preferably use an established range parser.',
 'Verify bytes=-3, bytes=-100, bytes=3-, bytes=-0, zero-length files and large integer boundaries.');
add('A12','Medium','Reproduced','Byte ranges extending past EOF are rejected unnecessarily',[
 ['server/src/routes/assets.js','if (!match || start > end || end >= bytes)']],
 'A valid request beginning inside a file but ending past EOF gets 416, creating avoidable media/download failures.',
 'A12: Range bytes=0-99 against a 10-byte file returned 416. A satisfiable range should clamp the end and serve bytes 0-9.',
 'Clamp the end to bytes-1 when the start is valid; return 416 when no byte is satisfiable.',
 'Check bytes=0-99 returns the complete 10-byte file as 206, while bytes=10-99 returns 416.');
add('A13','Medium','Reproduced','Booking dates are validated by shape rather than calendar validity',[
 ['server/src/events.js','export function eventProblem'],['server/src/stays.js','export function stayProblem'],['server/src/routes/reservations.js','const DATE =']],
 'Impossible dates can enter event bookings. Some room dates normalize inconsistently or cause addDays/toISOString failures and 500 responses.',
 'A13 eventProblem accepted 2026-11-31 with otherwise valid inputs. Regex YYYY-MM-DD alone cannot establish that the day exists.',
 'Use one strict calendar-date parser shared across server entry points; reject unless parsing and formatting round-trip exactly. Apply it to availability and staff marks too.',
 'Reject November 31, February 30, month 00/13 and day 00; accept valid leap days and enforce date windows.');
add('A14','Medium','Reproduced','One bad scene can break the entire studio scene list',[
 ['server/src/store.js','export async function listScenes'],['server/src/leadsStore.js','export async function listLeads'],['server/src/usersStore-file.js','async function readAllUsers']],
 'Listings parse every JSON file with Promise.all. A single malformed file fails the whole list; the account scan can similarly disrupt authentication for unrelated users.',
 'A14 inserted one broken scene alongside a healthy scene and listScenes rejected with SyntaxError. Leads and file accounts have the same global parsing pattern, confirmed by inspection.',
 'Validate on write, isolate/quarantine individual damaged records during reads, report degraded health, and avoid exposing data outside the caller\'s scope while recovering.',
 'One bad record is detected and alerted without taking unrelated accounts, projects or public listings offline.');
add('A15','High','Reproduced','Website and hotspot bookings do not share room/hall inventory',[
 ['server/src/events.js','export function hallFree'],['server/src/events.js','export function hallHotspotFree'],['server/src/stays.js','function heldByNight'],['server/src/stays.js','export function roomHotspotBooked']],
 'If a venue enables both booking channels for the same physical space, both can accept overlapping confirmed bookings. This is conditional on configuring both channels; embed-first operations can avoid the trigger.',
 'A15 supplied a confirmed website hall booking; hallHotspotFree still returned true. Hall inventory filters different kinds. Website rooms and room hotspots likewise use separate identifiers and record kinds.',
 'Give each physical resource one inventory identifier across channels and centralize locking/availability. Until implemented, enforce one booking channel for a resource in configuration.',
 'Booking through either channel blocks overlapping requests/confirmations/marks through the other.');
add('A16','High','Source-confirmed risk','Multiple API processes bypass in-memory booking locks',[
 ['server/src/reservations.js','const queues = new Map()'],['server/src/stats.js','const queues = new Map()'],['server/src/rateLimit.js','const hits = new Map()']],
 'PM2 cluster mode, overlapping deploys or two API instances can both read the last available room/table and overwrite reservations. Rate limits multiply with each process and reset on restart. PostgreSQL accounts do not migrate booking storage.',
 'Booking/stat queues and rate-limit counters are process-local Maps; all instances still write shared JSON files. No multi-process stress run was performed.',
 'Launch with exactly one API process until inventory uses database transactions/shared locks. Use shared rate limits when scaling; prevent old/new API overlap during deploy.',
 'Run a two-process last-table contention test after the storage fix; exactly one reservation succeeds and no records disappear.');
add('A17','High','Source-confirmed risk','Concurrent project/scene/site updates can lose edits and permission changes',[
 ['server/src/store.js','export async function claimProperty'],['server/src/store.js','export async function saveScene'],['server/src/routes/sites.js','export async function publishDue']],
 'Atomic file replacement prevents torn JSON but not lost updates. Two editors can overwrite each other; a draft save can race a publish/scheduled publish, and two claims can both appear successful.',
 'These operations read current objects, change them, and write with no shared per-record lock or revision check. publishDue explicitly shares the site file with draft and review operations.',
 'Add serialization and optimistic revision checks for every mutable entity, returning 409 on stale saves; use transactions for multi-file operations and ownership claims.',
 'Race publish/save, membership changes, claims and scheduled publish; all intended updates survive or receive explicit conflicts.');
add('A18','High','Source-confirmed risk','Uploads have no total quota, expiry or ZIP expansion budget',[
 ['server/src/routes/assets.js',"const CHUNK_MAX = '16mb'"],['server/src/routes/assets.js','function extractZipToStaging']],
 'An authorized account can fill VPS disk by sending many individually permitted chunks or a highly compressed ZIP. Abandoned staging data has no automatic retention policy. Disk exhaustion affects every tenant.',
 'Only per-chunk limits are present. ZIP extraction writes entries without total uncompressed bytes/file-count/depth limits. No staging janitor was found. No destructive disk-fill experiment was run.',
 'Set per-upload and account quotas, extracted-byte/file/depth limits, free-space thresholds, and expired-upload cleanup. Enforce budgets while streaming, including during ZIP expansion.',
 'Small-budget tests stop oversized uploads safely, remove partial extraction, and leave capacity for normal bookings.');
add('A19','Medium','Source-confirmed risk','Concurrent chunks can overwrite each other after the offset check',[
 ['server/src/routes/assets.js','const current = await stagedBytes'],['server/src/routes/assets.js',"flags: offset === 0 ? 'w' : 'r+'"]],
 'Duplicate/retried or overlapping requests can both see the same current offset and write to the same file. An offset-0 writer may truncate another writer\'s data.',
 'The stat/offset check and createWriteStream are separate awaits with no per-file lock; the successful response reports the requested byte count rather than a protected committed state.',
 'Serialize chunk mutations per upload/file, atomically enforce expected offsets, and prevent finalize from running while writes are in progress.',
 'Two same-offset chunks produce one accepted write and one conflict; finalize cannot race an unfinished chunk.');
add('A20','Medium','Source-confirmed risk','Engine URL filtering does not prevent DNS-based private network access',[
 ['server/src/engine.js','const PRIVATE_HOST'],['server/src/engine.js','const r = await fetch(u']],
 'A studio author who configures an HTTPS hostname resolving to a private address can make the VPS contact internal services. This requires author control over availabilityUrl; it is not direct visitor URL input.',
 'The filter checks the hostname string rather than resolved addresses. The source itself notes this gap. Redirects are correctly refused. No internal services were contacted in this review.',
 'Allowlist vetted engine hosts, or validate and pin all resolved IPv4/IPv6 addresses and enforce egress restrictions. Apply equivalent checks to every network hop.',
 'A controlled hostname resolving to loopback/private/link-local addresses is refused without initiating the connection.');
add('A21','Medium','Source-confirmed risk','Public room availability can trigger uncapped engine requests',[
 ['server/src/routes/reservations.js',"reservationsRouter.get('/:id/requests/rooms'"],['server/src/engine.js','const cache = new Map()']],
 'Changing date/guest combinations defeats the per-URL one-minute cache. Public traffic can create many simultaneous external requests and consume VPS and provider resources.',
 'The room availability GET route has no rateLimiter check or shared concurrency cap; the booking submission route is separately rate limited. Bad engine responses are not cached.',
 'Rate limit availability reads, validate a bounded date/guest window, deduplicate in-flight engine calls, cap per-project concurrency and add failure caching/circuit breaking.',
 'A local fake engine sees bounded requests under a flood of varied dates; healthy callers still receive timely responses.');
add('A22','Medium','Source-confirmed risk','Attachment upload consumes its one-time key before saving the file',[
 ['server/src/routes/reservations.js','delete x.uploadKey'],['server/src/routes/reservations.js','await writeFileWhole(path.join(attachDir']],
 'If mkdir or file writing fails after reservation metadata commits, the upload key is gone and the reservation claims an attachment that cannot be downloaded. The guest cannot retry normally.',
 'The reservation queue saves attachment metadata and deletes the key before filesystem writes begin. This ordering is visible in the route; disk failure was not injected.',
 'Stage the attachment first and commit metadata/key consumption only after durable storage succeeds, with rollback/cleanup and retry-safe operation IDs.',
 'Inject a storage failure: the guest can retry with the original key and the inbox does not show a nonexistent attachment.');
add('A23','High','Source-confirmed gap','The backup command does not back up PostgreSQL accounts or external local assets',[
 ['server/scripts/backup-data.js',"spawnSync('tar'"],['server/src/usersStore.js','const impl = process.env.DATABASE_URL'],['server/src/storage.js','const ASSET_DIR =']],
 'After switching accounts to PostgreSQL, restoring this archive does not restore users, password hashes or reset state. An ASSET_DIR outside DATA_DIR is also excluded in local-driver mode.',
 'The backup script archives only DATA_DIR and optionally uploads that archive to S3. It never dumps PostgreSQL or separately archives ASSET_DIR. This is conditional on those deployment settings.',
 'Add tested PostgreSQL backups/PITR and a separate asset backup policy. Keep off-VPS copies, encrypt/restrict them, and document a complete restore including credentials/config held in an appropriate secret store.',
 'Restore into an empty machine/database; confirm accounts, permissions, booking history, attachments, scene JSON and every scan all work.');
add('A24','High','Source-confirmed gap','VPS deployment files are absent and production defaults are permissive',[
 ['server/src/index.js',"const DEV = process.env.NODE_ENV !== 'production'"],['server/src/index.js','const server = app.listen(port'],['next.config.mts',"const api = new URL"]],
 'There is no deploy directory despite references to it. Without explicit production environment and routing, the API enables development behavior, the browser calls localhost:4000, and the API binds all interfaces. Port conflicts silently move even in production.',
 'No nginx/process-manager/deployment files exist in this checkout. NODE_ENV controls production secret checks, secure cookies, demo routes and localhost CORS. API_URL defaults to localhost; listen() has no host restriction and retries another port.',
 'Create reviewed nginx/TLS and process-manager configs; bind API to loopback or firewall it, pin ports and fail fast in production. Explicitly set NODE_ENV, strong secrets, CLIENT_ORIGIN, API URL and persistent data paths. Build frontend with production URLs.',
 'Test from an external machine: only intended HTTPS ports are open, cookies are secure, API routing works, restarts retain data, and a port conflict fails visibly.');
add('A25','Medium','Source-confirmed risk','Some Express 4 async authentication handlers do not forward rejected promises',[
 ['server/src/middleware/auth.js','export async function requireAdmin'],['server/src/routes/auth.js',"authRouter.get('/session', async"]],
 'A database or account-file failure during these handlers can become an unhandled rejection instead of reaching the JSON error handler. On Node\'s default handling this can terminate the API process.',
 'The server uses Express 4. requireAdmin and GET /session are bare async functions without try/catch or a promise wrapper, unlike most other routes. A real database-outage/process-crash test was not run.',
 'Wrap every async route/middleware in a rejection-forwarding helper or consistently catch and next(err). Test failures at all authentication lookup points.',
 'Force account lookup to reject and assert a sanitized 5xx response, no hung request, and continued API health.');
add('A26','Medium','Registry advisory','Server lockfile includes a qs version flagged by npm audit',[
 ['server/package-lock.json','"node_modules/qs"']],
 'The installed server dependency tree has one moderate advisory. This is not proof that the vulnerable qs.stringify comma option is reachable in this application.',
 'npm audit --prefix server --json reported GHSA-6pq8-jhm2-2vcw (qs.stringify comma-format TypeError DoS), affected range 6.7.0 through 6.16.0, fix available. Frontend audit reported zero known advisories at audit time.',
 'Update the affected transitive dependency through a compatible parent/lockfile update, review changes, rerun audit and application checks. Avoid blind forced major upgrades.',
 'Server audit has no remaining advisory and query parsing/API regressions still pass. Source: https://github.com/advisories/GHSA-6pq8-jhm2-2vcw');
add('A27','Medium','Source-confirmed gap','Private booking attachments are missing from git ignore rules',[
 ['server/src/routes/reservations.js','const attachDir ='],['.gitignore','server/src/data/reservations/']],
 'New guest PDF/Word attachments under the default data directory can be accidentally added to source control, unlike users, leads and reservations which are ignored.',
 'Attachments are written to DATA_DIR/attachments/<project>; .gitignore has no server/src/data/attachments/ rule. No attachment contents or credentials were copied into this report.',
 'Ignore the default attachments directory and prefer runtime DATA_DIR outside the source checkout. Inspect staged changes for private data before commits.',
 'git check-ignore confirms a sample default-path attachment is ignored; no guest files are tracked.');
add('A28','Medium','Source-confirmed gap','Tour defaults assume Nepal even when the venue uses another timezone',[
 ['src/features/booking/booking.ts',"timeZone = 'Asia/Kathmandu'"],['src/features/booking/HotspotBookCard.tsx',"date: kind === 'table'"],['server/src/routes/reservations.js','const now = nowIn(hours.timezone)']],
 'The old visitor-local-clock issue is fixed for Nepal venues, but the hotspot form calls venueDay without the project\'s configured timezone. A venue elsewhere can still receive dates inconsistent with server rules.',
 'Source inspection: form defaults and min dates use venueDay() with the Nepal default; backend uses the published booking.timezone. Not reproduced in a browser.',
 'Expose the venue clock/timezone to the hotspot form and pass it to every date default/min helper; prefer server-returned today for public booking rules.',
 'Check venues in Kathmandu, Honolulu and Auckland around midnight with visitors in different timezones.');
add('A29','Medium','Source-confirmed risk','Tour first render waits for every published scene in the project',[
 ['src/app/tour/TourClient.tsx','const docs = await Promise.all'],['src/lib/api.ts','return await fetch']],
 'A large project requires all scene documents before mounting 3D. The shared API client has no timeout, so a stalled related scene request can keep the visitor on Opening the tour indefinitely.',
 'TourClient fetches all matching project scenes with Promise.all before setGate ready. This is a scaling/reliability risk, not a measured first-frame regression.',
 'Load the requested starting scene first, hydrate the rest lazily, and add bounded timeouts/cancellation and useful retry states. Preserve access checks.',
 'With one sibling scene delayed or failed, the requested healthy scene still opens within the first-frame target on a real mobile device.');
add('A30','Low','Source-confirmed gap','Public marketing content still contains editorial placeholders',[
 ['src/features/marketing/pages/GameWorldsPage.tsx','[[TBC: formats'],['src/features/marketing/pages/PrivacyPage.tsx',"const ADDRESS ="]],
 'Visitors can encounter unfinished copy and unresolved service/policy facts. This lowers trust and means the public policy text may not describe the final deployment.',
 'Source includes visible TBI/TBC markers for formats, licensing, address and providers. Draft policy handling is intentional, but the final content still needs owner review.',
 'Replace placeholders with verified business facts and deployment-specific policy text; hide unfinished sections until approved. Do not invent business or policy claims.',
 'Crawl rendered public pages for TBI/TBC, broken contact actions and draft content before launch.');

const walk=(dir,out=[])=>{if(!existsSync(path.join(ROOT,dir)))return out;for(const e of readdirSync(path.join(ROOT,dir),{withFileTypes:true})){if(['node_modules','data','vendor','.git'].includes(e.name))continue;const f=dir+'/'+e.name;if(e.isDirectory())walk(f,out);else if(/\.(tsx?|jsx?|mjs|css|sql)$/.test(e.name))out.push(f);}return out;};
const inventory=[...walk('src'),...walk('server/src'),...walk('server/test'),...walk('test'),...walk('scripts'),...walk('server/scripts')];
writeFileSync(path.join(import.meta.dirname,'source-inventory.txt'),inventory.join('\n')+'\n');
const counts={};for(const f of findings)counts[f.severity]=(counts[f.severity]??0)+1;
const parts=[];
const section=(title,body)=>parts.push({title,body});
section('RCAAS platform | VPS readiness audit',[
 'Report date: 29 October 2026 (Asia/Katmandu). Source revision: 239a3f1. Local repository review; no deployment or application fixes were performed.',
 'Recommendation: address the high-priority findings before public launch. The application builds and its existing tests pass, but that does not establish production readiness.',
 `${findings.length} findings: ${Object.entries(counts).map(([s,n])=>n+' '+s.toLowerCase()).join(', ')}. Fifteen defects were reproduced in isolated local checks. Remaining items are clearly labeled source-confirmed risks, gaps, or a dependency advisory. No critical public remote takeover was demonstrated.`,
 'This is a broad, risk-based code and configuration audit, not a guarantee that every bug has been found. It does not certify security, uptime or legal compliance.',
 'Application files and real customer data were left unchanged. New files are audit artifacts only; the build regenerated ignored build output. No credentials, account records or customer attachments are included.'
]);
section('Scope, evidence and limitations',[
 `Indexed ${inventory.length} source/test/script files (source-inventory.txt). Focused manual review: all API route families; authentication/access control; stores and persistence; local/S3 assets; booking rules and status flows; attachment handling; backup/deployment; frontend API and tour loading; booking form dates; metadata and CI. This is not a claim of line-by-line review of every component.`,
 'Existing checks: 27 client tests passed; 149 of 150 server tests passed, with one skipped; total 176 passing and one skipped. TypeScript noEmit completed successfully. ESLint: zero errors, six warnings (five img optimization warnings and one effect dependency warning). The warnings are not counted as confirmed bugs.',
 'Production build: npm run build with NEXT_DIST_DIR=.next-new passed. The first sandboxed attempt failed fetching Google Fonts; the network-enabled retry passed. Build-time internet access to font providers is therefore a deployment dependency. Build used local default URL settings, not a validated VPS environment.',
 'Tool versions: Node 24.13.0, npm 11.21.1, built Next 16.4.3. npm registry audit: frontend zero advisories, server one moderate advisory. Registry results are a time-specific snapshot and do not analyze custom or vendored code.',
 'New checks: node vps-audit/reproduce.mjs, 15 confirmations; see reproductions.log. Checks use scratch data under this folder, loopback HTTP and mocks, with email/provider keys absent. They delete scratch data afterward.',
 'Not verified: real PostgreSQL execution (the database-dependent suite is skipped), real R2 provider behavior, actual VPS Linux/nginx/TLS/firewall/systemd/PM2 configuration, production secrets, DNS, email domain verification/delivery, real hotel integrations, full rendered-page crawl, real GPU/mobile performance, accessibility screen-reader behavior, backups restored onto a separate machine, or sustained load/penetration testing. Minified vendor SDK internals were not manually audited.',
 'Existing qa-bug-hunt report was rechecked: its Nepal date issue, outlet decline-email fragment, missing email subject space and waitlist status wording are fixed in current source; they are not repeated as open bugs. A28 describes a narrower remaining multi-timezone issue.'
]);
section('Priority order and reading guide',[
 'P0 before launch: A01 accountless admin, A02 upload authorization, A03 publish lifecycle, A04 restored ownership, A05/A09 fail-closed storage, A06 credential concurrency. These have local reproductions.',
 'P1 before accepting real bookings: A15 unify or explicitly disable duplicate channels; A16 enforce one API process; A17 resolve lost writes; A18 upload quotas; A23 complete restore plan; A24 production deployment configuration. Update A26 dependency and protect attachments A27.',
 'P2 hardening and polish: range behavior, strict calendar dates, bounded engine calls, attachment retry, async error forwarding, timezone configuration, large-project loading and content completion.',
 'Each finding contains an exact current file/line reference, impact and prerequisites, evidence level, recommended repair and acceptance check. Source-confirmed risk means the risky implementation is visible, but the full outage/exploitation scenario was not executed.',
 'A01 is a deliberate legacy path with an unsafe consequence for the newer permission model. A15 depends on enabling two channels for one physical resource. A16 depends on multiple API processes. A23 depends on PostgreSQL and/or an external ASSET_DIR. These conditions matter when prioritizing.'
]);
for(const f of findings)section(`${f.id} | ${f.severity} | ${f.title}`,['Evidence level: '+f.status,'Location: '+f.refs.join('; '),'Impact / trigger: '+f.impact,'Evidence: '+f.evidence,'Recommended fix: '+f.fix,'Acceptance check: '+f.verify]);
section('VPS launch acceptance checklist',[
 '1. Resolve the high findings, rerun the reproduction checks as regression tests expecting the corrected behavior, then run types, lint, existing tests and a production build. The audit reproductions currently assert the presence of bugs; their current success must not be mistaken for a passing post-fix suite.',
 '2. Pin a supported Node runtime and reproducible npm ci installs for both projects. Install frontend build dependencies before compiling. Set NODE_ENV=production explicitly for the API; generate new strong SESSION_SECRET, EMBED_TOKEN_SECRET and team/bootstrap credentials. Do not reuse local values.',
 '3. Build with HTTPS NEXT_PUBLIC_API_URL and NEXT_PUBLIC_SITE_URL, matching CLIENT_ORIGIN. The frontend environment values are compiled into browser output: restart alone does not change them. Validate same-site cookie behavior and next/image against the production API host.',
 '4. Put nginx/TLS in front of Next and one API process, restrict direct API exposure, set body-size/timeouts appropriate for chunk/attachment uploads, preserve correct forwarded client IP handling, and test byte ranges. Verify port conflicts cannot silently shift the service.',
 '5. Use persistent DATA_DIR and ASSET_DIR outside release directories. Transfer ignored scans, websites and other runtime records explicitly; a git clone does not include them. Inventory every published scene variant and referenced tile after migration. Do not publish sample/draft projects accidentally.',
 '6. Exercise owner/member/staff/anonymous flows: sign-in, reset, invite, upload/resume/finalize, edit/save/publish/unpublish/restore, website publish/schedule, enquiry, booking/conflict/confirm/cancel, guest attachment and team download. Include two simultaneous editors/guests.',
 '7. Validate mail provider sender-domain DNS and real guest delivery, provider outages, and any SMS/WhatsApp templates. Local mock tests do not establish deliverability. Test booking links and return/analytics behavior with each real hotel engine.',
 '8. Perform and restore off-VPS backups of database, JSON stores, attachments and scans. Monitor disk space, uptime, API errors, failed mail, booking conflicts and backup failures. Confirm log retention and private data access.',
 '9. Check desktop and real Android/iOS devices over mobile networks, first frame and long-session memory, browser history/navigation, uploads after a disconnect, form keyboard access and reduced-motion behavior. Crawl final public URLs, canonical/sitemap links and contact actions.',
 '10. Review the active GitHub Pages workflow and account settings if the VPS becomes the primary site: avoid an unintended second indexed copy. Resolve placeholder content and document actual hosting/storage choices before public launch.'
]);
section('Evidence bundle and safe follow-up',[
 'report.pdf: this printable audit. report.md: searchable text with the same findings. findings.json: structured finding list. source-inventory.txt: indexed scope. reproduce.mjs and reproductions.log: isolated confirmations. evidence/: original build, lint, tests, types and dependency audit outputs.',
 'Recommended follow-up is to fix findings in small reviewed batches and repeat the corresponding acceptance checks. No source changes were made as part of this reporting request.',
 'Keep this report and reproduction script private: they describe permission weaknesses. The script creates only test accounts and test data and does not use server/.env. Do not point a future adapted test harness at production data.'
]);
writeFileSync(path.join(import.meta.dirname,'findings.json'),JSON.stringify(findings,null,2)+'\n');
writeFileSync(path.join(import.meta.dirname,'report.md'),parts.map(p=>'## '+p.title+'\n\n'+p.body.join('\n\n')).join('\n\n')+'\n');

// Dependency-free PDF generation: searchable standard-font text, wrapped and paginated.
const ascii=s=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[\u2013\u2014]/g,'-').replace(/[^\x20-\x7e]/g,' ');
const wrap=(text,max)=>{const out=[];let line='';for(let word of ascii(text).split(/\s+/)){while(word.length>max){if(line){out.push(line);line='';}out.push(word.slice(0,max));word=word.slice(max);}if((line+' '+word).trim().length>max){out.push(line);line=word;}else line=(line+' '+word).trim();}if(line)out.push(line);return out;};
const pages=[];let lines=[];const flush=()=>{if(lines.length){pages.push(lines);lines=[];}};
for(const p of parts){const h=wrap(p.title,76);if(lines.length+h.length+8>64)flush();if(lines.length)lines.push({text:'',size:10});for(const text of h)lines.push({text,size:13,bold:true});lines.push({text:'',size:10});for(const paragraph of p.body){const rows=wrap(paragraph,97);for(const text of rows){if(lines.length>=64)flush();lines.push({text,size:10});}if(lines.length>=64)flush();lines.push({text:'',size:10});}}flush();
const escape=s=>s.replace(/([\\()])/g,'\\$1');
const objs=[null];const addObj=s=>{objs.push(s);return objs.length-1;};
const catalog=addObj(''),pageTree=addObj('');const font=addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');const bold=addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');const kids=[];
for(let i=0;i<pages.length;i++){
 let stream='0.12 0.18 0.25 rg\n';let y=797;
 for(const l of pages[i]){stream+=`BT /${l.bold?'F2':'F1'} ${l.size} Tf 44 ${y} Td (${escape(l.text)}) Tj ET\n`;y-=11.3;}
 stream+=`0.45 0.45 0.45 rg BT /F1 8 Tf 44 25 Td (RCAAS | Private code audit | 29 October 2026) Tj ET\nBT /F1 8 Tf 485 25 Td (Page ${i+1} / ${pages.length}) Tj ET\n`;
 const content=addObj(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
 kids.push(addObj(`<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
}
objs[catalog]=`<< /Type /Catalog /Pages ${pageTree} 0 R >>`;objs[pageTree]=`<< /Type /Pages /Count ${kids.length} /Kids [${kids.map(k=>k+' 0 R').join(' ')}] >>`;
let pdf='%PDF-1.4\n';const offsets=[0];for(let i=1;i<objs.length;i++){offsets[i]=Buffer.byteLength(pdf);pdf+=`${i} 0 obj\n${objs[i]}\nendobj\n`;}
const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objs.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objs.length} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const out=path.join(import.meta.dirname,'report.pdf');writeFileSync(out,pdf);
console.log(JSON.stringify({findings:findings.length,severity:counts,pages:pages.length,bytes:statSync(out).size,indexedFiles:inventory.length}));
