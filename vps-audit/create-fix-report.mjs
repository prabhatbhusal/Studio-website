import { writeAuditPdf } from './write-audit-pdf.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const dir=import.meta.dirname;
const root=path.resolve(dir,'..');
const original=JSON.parse(readFileSync(path.join(dir,'findings-before-fixes.json'),'utf8'));
const changes=[
 ['A01','Fixed','server/src/routes/auth.js',"if (process.env.NODE_ENV === 'production')",'Production refuses shared-password login and previously issued accountless JWTs. The uploader now signs in with a personal email/password. Development compatibility remains.'],
 ['A02','Fixed','server/src/uploadStore.js','export async function uploadGuard','Upload IDs have persistent owners. Staff, unknown IDs, expired uploads and other accounts are refused on init/chunk/finalize. Ownership is retained for unreferenced finalized assets. Existing in-progress uploads must restart.'],
 ['A03','Fixed','server/src/store.js','const version = Math.max','New publication numbers are allocated above all retained history, including after unpublishing. Immutable snapshots are preserved.'],
 ['A04','Fixed','server/src/store.js',"[...PUBLISH_FIELDS, 'propertyId', 'ownerId']",'Restoring history preserves the current owner and project, and updates the editing revision.'],
 ['A05','Fixed','server/src/reservations.js','Invalid reservation store.','Only a missing booking file is empty. Corruption, invalid record shape and disk failures fail closed; the original damaged file is preserved.'],
 ['A06','Fixed','server/src/usersStore-file.js','serialMutation(resetPasswordImpl)','File-account mutations are serialized. A reset token has one concurrent winner; role/password/reset updates no longer race read-modify-write operations.'],
 ['A07','Fixed','server/src/usersStore-pg.js','pg_advisory_xact_lock','File bootstrap is serialized and checks physical account files before declaring an empty store. PostgreSQL uses a transactional advisory lock for first signup. PostgreSQL implementation is source-reviewed; real database execution remains pending.'],
 ['A08','Fixed','server/src/routes/leads.js',"import { getPublishedScene",'Enquiries require a published scene or a real project hub. Unknown/draft scene requests return 404 instead of creating orphan leads. Project routing comes from the published scene.'],
 ['A09','Fixed','server/src/routes/sites.js','Invalid website store.','Website read failures propagate rather than returning null and overwriting publication/review/schedule state.'],
 ['A10','Fixed','server/src/engine.js','if (bytes > 65536)','Engine bodies are streamed with a 64 KiB cap and a four-second total timeout; oversized bodies are destroyed before full buffering.'],
 ['A11','Fixed','server/src/routes/assets.js','const suffix =','Suffix byte ranges now return the final N bytes. Empty, zero-length and unsatisfiable ranges are refused.'],
 ['A12','Fixed','server/src/routes/assets.js','const end = suffix','A satisfiable range extending past EOF is clamped to the last byte rather than rejected.'],
 ['A13','Fixed','server/src/calendar.js','export function validDate','Server booking entry points require a strict calendar round trip, including leap years. Invalid dates cannot reach the night generator.'],
 ['A14','Fixed','server/src/records.js','export async function readRecord','Malformed listing records are logged and isolated from healthy scene/account/lead listings. Public gallery reads likewise isolate corrupt scene JSON. Damaged individual records still require operator recovery.'],
 ['A15','Mitigated','server/src/routes/reservations.js','function websiteOwnsKind','One booking channel per room/hall resource kind is enforced. Hotspot requests/marks are refused while website booking is enabled. Publishing/scheduling a switch is blocked by active legacy hotspot bookings; live website guest requests also refuse legacy conflicts. Resource IDs have not been unified; reconcile existing bookings before switching.'],
 ['A16','Mitigated','server/src/processLock.js','export function acquireProcessLock','Production refuses another API writer for the same DATA_DIR. PM2 configuration uses one instance and fixed loopback ports. This enforces the supported single-process architecture; it does not implement multi-node transactions or shared distributed rate limits.'],
 ['A17','Fixed','server/src/serial.js','export function serialMutation','Metadata mutations and website scheduling are serialized. Full scene and website edits carry revisions and stale edits return 409. Upload operations use a separate queue so model finalization does not hold the metadata queue. Multi-file crash consistency still depends on recovery/backups; this is not a database migration.'],
 ['A18','Fixed','server/src/uploadStore.js','export const UPLOAD_MAX','Defaults: 8 GiB/upload, 20,000 files, 100 GiB/account for uploads with ownership records, 20 active uploads/account, 24-hour staging expiry and disk headroom checks. ZIP extraction checks expansion count/bytes/path depth while extracting. Pre-upgrade orphan staging needs reviewed manual cleanup; existing assets without metadata are outside the new quota ledger.'],
 ['A19','Fixed','server/src/uploadStore.js','export function uploadHandler','Chunks/finalization are serialized with an ownership recheck inside the queue. Same-offset concurrent chunks yield one success and one conflict.'],
 ['A20','Fixed','server/src/engine.js','function safeLookup','Production engine hosts require an explicit allowlist and HTTPS/443. DNS is validated in the socket lookup and the connection uses the validated result; private, loopback and link-local addresses are refused. Redirects are not followed. Configure vetted adapter hosts before enabling real integrations.'],
 ['A21','Fixed','server/src/engine.js','if (active >= 4)','Availability reads are rate limited; external engine work has a four-request concurrency cap, in-flight deduplication, bounded input and failure caching.'],
 ['A22','Fixed','server/src/routes/reservations.js','const attachment = await withReservations','Attachment file storage succeeds before consuming the one-time key. A simulated storage failure preserves the key and a retry succeeds. Private attachment metadata is committed in the booking queue.'],
 ['A23','Prepared','server/scripts/backup-data.js',"'--format=custom'",'Backup format 2 includes JSON, external local assets and optional PostgreSQL app-schema dump plus a manifest. JSON and external asset restore passed locally. Real PostgreSQL restore, bucket backup/versioning, secured secret backup and off-VPS recovery still need deployment verification. Archive format changed: use deploy/README.md restore steps.'],
 ['A24','Prepared','deploy/README.md','# VPS deployment and restore','Added nginx/TLS starter configuration, one-instance PM2 setup, environment example and restore instructions. Production API binds loopback by default, enforces HTTPS CLIENT_ORIGIN, refuses example secrets and fails on port conflicts. Actual VPS provisioning, nginx validation, DNS/certificates/firewall and account-level settings have not been performed.'],
 ['A25','Fixed','server/src/middleware/auth.js','export async function requireAdmin','Async admin and session handlers catch lookup failures and forward to Express error handling. Fault-injection checks receive controlled 500 responses without terminating the API.'],
 ['A26','Fixed','server/package-lock.json','"node_modules/qs"','Updated the compatible server qs dependency. npm audit fix reported zero vulnerabilities after the update; the lockfile is changed. No forced major upgrades were applied.'],
 ['A27','Fixed','.gitignore','server/src/data/attachments/','Private attachments, ownership records and the default API lock are now ignored by git. Production runtime data is configured outside the code checkout.'],
 ['A28','Fixed','src/features/booking/HotspotBookCard.tsx','getVenueClock(project)','Hotspot booking reads the configured venue timezone from a public clock endpoint and uses it for date defaults/minimums and outgoing booking links. Submission waits for the clock.'],
 ['A29','Fixed','src/app/tour/TourClient.tsx','const opening = await loadSceneDoc','The public tour loads the starting document first; sibling documents load on selection. API fetches have bounded timeouts and superseded scene loads are ignored. Production build/type checks pass; first-frame and motion performance still need real GPU/mobile measurements.'],
 ['A30','Open','src/features/marketing/pages/GameWorldsPage.tsx','[[TBC: formats','Business facts and policy placeholders require verified owner content. No company details, licensing promises or legal policy wording were invented. Review rendered public pages before launch.']
];
const entries=changes.map(([id,status,file,marker,resolution])=>{
 const source=readFileSync(path.join(root,file),'utf8').split('\n');const line=source.findIndex((s)=>s.includes(marker))+1;
 if(!line)throw new Error('Unresolved current reference '+id);
 const before=original.find((f)=>f.id===id);
 return {...before,originalStatus:before.status,status,currentReference:`${file}:${line}`,resolution};
});
const counts={};for(const entry of entries)counts[entry.status]=(counts[entry.status]??0)+1;
const parts=[
 {title:'RCAAS platform | Audit fix status',body:[
  'Updated 29 October 2026. This report supersedes the original open-findings report for the current working tree. The before-fix report and evidence are preserved as report-before-fixes.pdf / report-before-fixes.md and findings-before-fixes.json.',
  `${entries.length} original findings: ${Object.entries(counts).map(([s,n])=>n+' '+s.toLowerCase()).join(', ')}. Fixed means the code change is implemented with the verification described below; it does not certify a production service. Mitigated means a supported operating constraint prevents the trigger. Prepared means code/configuration is ready but external setup or restore validation remains.`,
  'The confirmed bugs have fixes or an enforced mitigation. The platform has not been deployed, and the remaining operator work below must be completed before public launch. Source changes are uncommitted; no customer runtime data was migrated or modified.',
  'Key behavior changes: personal account login in production; restart old in-progress uploads; one API process; stale scene/site saves return 409; one room/hall booking channel per venue resource kind; engine host allowlist; backup format 2 with component archives.'
 ]},
 {title:'Verification and practical limits',body:[
  'Existing baseline: 176 passing tests and one skipped. Current validation: 195 passing tests and one skipped (27 client tests; 168 server tests passing of 169). Nineteen regression/backup tests were added, including a real API production-mode startup and second-writer rejection, reset races, upload authorization and quota, booking corruption, history/ownership, edit conflicts, strict dates, ranges, engine bounds, attachment retry and local backup restore.',
  'TypeScript noEmit passed. ESLint: zero errors and the six existing warnings (five image optimization warnings and one effect-dependency warning). Production webpack build passed into .next-new. Server dependency patch reported zero known vulnerabilities. Logs are under vps-audit/evidence/.',
  'Local-only verification: mocks/disposable stores, loopback HTTP, and a temporary backup/restore. Real PostgreSQL execution remains skipped; PostgreSQL bootstrap/pg_dump changes need a disposable database drill. No nginx binary/TLS/firewall verification or real cloud-provider/mail/hotel service validation was done.',
  'The application is still backed by JSON for projects/scenes/sites/bookings. It deliberately enforces a single production API process; do not enable PM2 cluster or rolling API reload. Database migration and load testing remain prerequisites for claiming large-scale capacity.',
  'No browser/GPU/mobile sign-off was performed for lazy scene selection and booking clock changes. Build/types and server tests do not establish rendering quality or real network performance. Business/policy placeholders remain open for owner content.'
 ]},
 {title:'Before deployment',body:[
  'Follow deploy/README.md. Set the actual domain and TLS paths, provision an unprivileged account, persistent data/assets, strong secrets, production frontend URLs and HTTPS CLIENT_ORIGIN. Transfer ignored runtime models and records explicitly.',
  'Use personal accounts. Restart pre-upgrade in-progress uploads, reconcile legacy room/hall bookings before changing channels, and configure exact ENGINE_ALLOWED_HOSTS for vetted hotel adapters. Set quotas appropriate to the VPS disk.',
  'Use one API instance and stop/start upgrades. After a forced kill/power loss, verify no writer exists before removing a stale .api.lock. Monitor failures and disk space. Do not use the report folder as a public web root.',
  'Verify a mail sender domain and delivery to real guests; configure off-site retention/bucket versioning and separate secret backups. Restore PostgreSQL plus JSON, scans and attachments on a different machine before relying on the backup plan.',
  'Replace placeholders with verified company facts and approved policy text. Test owner/member/staff/public workflows, every model, real devices and the intended production URLs. Decide whether to disable the second GitHub Pages deployment.'
 ]}
];
for(const e of entries)parts.push({title:`${e.id} | ${e.status} | ${e.title}`,body:[`Original severity: ${e.severity}. Current source: ${e.currentReference}.`,e.resolution,'Acceptance check: '+e.verify]});
parts.push({title:'Artifacts and rerunning checks',body:[
 'Current report.pdf/report.md and findings.json/fix-status.json describe the working-tree fixes. Original detailed triggers/reproductions are retained in report-before-fixes.pdf/.md, findings-before-fixes.json and reproductions.log.',
 'Run npm test, npx tsc --noEmit, npm run lint and npm run build for regression validation. The historical reproduce.mjs intentionally asserted that bugs existed; it is preserved for audit history and must not be used as the post-fix passing test suite. Current regression tests are in server/test/vps-regressions.test.js and server/test/backup.test.js.',
 'This review cannot establish that every bug is found or that the platform is ready for any traffic level. Keep the report private: it documents security-sensitive behavior and deployment constraints.'
]});
writeFileSync(path.join(dir,'report.md'),parts.map((p)=>'## '+p.title+'\n\n'+p.body.join('\n\n')).join('\n\n')+'\n');
writeFileSync(path.join(dir,'findings.json'),JSON.stringify(entries,null,2)+'\n');
writeFileSync(path.join(dir,'fix-status.json'),JSON.stringify({date:'2026-10-29',counts,entries:entries.map(({id,status,currentReference,resolution})=>({id,status,currentReference,resolution}))},null,2)+'\n');

console.log(JSON.stringify({counts, ...writeAuditPdf(parts, path.join(dir, 'report.pdf'), 'RCAAS | Private audit fix status | 29 October 2026')}));
