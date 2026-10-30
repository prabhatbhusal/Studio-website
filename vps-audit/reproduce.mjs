// Isolated checks: never imports dotenv or uses the platform's runtime data.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const data = await fs.mkdtemp(path.join(root, 'scratch-'));
process.env.DATA_DIR = data;
process.env.ASSET_DIR = path.join(data, 'assets');
process.env.DATABASE_URL = '';
process.env.SESSION_SECRET = 'audit-only-secret-not-for-deployment-123456';
process.env.EDITOR_PASSWORD = 'audit-only-team-code';
process.env.NODE_ENV = 'development';
for (const key of ['RESEND_API_KEY', 'ANTHROPIC_API_KEY', 'SPARROW_TOKEN', 'WHATSAPP_TOKEN']) process.env[key] = '';
const store = await import('../server/src/store.js');
const users = await import('../server/src/usersStore-file.js');
const reservations = await import('../server/src/reservations.js');
const { default: express } = await import('../server/node_modules/express/index.js');
const { default: cookieParser } = await import('../server/node_modules/cookie-parser/index.js');
const { default: jwt } = await import('../server/node_modules/jsonwebtoken/index.js');
const { assetsRouter } = await import('../server/src/routes/assets.js');
const { authRouter } = await import('../server/src/routes/auth.js');
const { leadsRouter } = await import('../server/src/routes/leads.js');
const { readSite } = await import('../server/src/routes/sites.js');
const { engineBooked } = await import('../server/src/engine.js');
const app = express(); app.use(cookieParser()); app.use(express.json());
app.use('/assets', assetsRouter); app.use('/auth', authRouter); app.use('/leads', leadsRouter);
app.use((err, req, res, _next) => res.status(500).json({ error: err.code || err.message }));
const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
let failed = 0;
async function check(name, fn) { try { console.log('CONFIRMED: ' + name + ' | ' + await fn()); } catch(e) { failed++; console.log('CHECK FAILED: ' + name + ' | ' + e.stack); } }
const doc = { id: 'audit-room', version: 1, title: 'Audit', spawn: { position: [1,2,3] }, splat: { format: 'glb', variants: { high: { assetId: 'ast_audit', meta: 'a.glb' } } }, tracks: [], hotspots: [] };
const cookie = u => 'splatspace_session=' + jwt.sign({ sub: u.id, role: u.role, iatMs: Date.now() }, process.env.SESSION_SECRET, { expiresIn: '1h' });
try {
 await check('A01 team signup code also grants unrestricted legacy admin login', async () => {
  const r = await fetch(base+'/auth/login', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({password:process.env.EDITOR_PASSWORD}) });
  const token = r.headers.get('set-cookie').split(';')[0].split('=')[1];
  const claims = jwt.verify(token,process.env.SESSION_SECRET);
  assert.equal(claims.role,'admin'); assert.equal(claims.sub,undefined); return 'HTTP '+r.status+', admin claim without account';
 });
 await check('A02 staff account can write arbitrary upload staging ID', async () => {
  await users.createUser({name:'Admin',email:'admin@example.test',password:'audit-password'});
  const staff = await users.createUser({name:'Staff',email:'staff@example.test',password:'audit-password',role:'staff'});
  const r = await fetch(base+'/assets/ast_other_upload/files/chunk?relPath=test.bin&offset=0',{method:'PUT',headers:{cookie:cookie(staff),'content-type':'application/octet-stream'},body:'unauthorized data'});
  assert.equal(r.status,200); assert.equal(await fs.readFile(path.join(data,'uploads-staging/ast_other_upload/test.bin'),'utf8'),'unauthorized data'); return 'HTTP 200; bytes written by staff without creating upload';
 });
 await check('A03 unpublish then republish fails with EEXIST', async () => {
  await store.saveScene(doc.id,doc,{creator:'owner-a'}); await store.publishScene(doc.id); await store.unpublishScene(doc.id);
  await assert.rejects(store.publishScene(doc.id),{code:'EEXIST'}); return 'retained @1 snapshot collides with reset version 1';
 });
 await check('A04 restoring a version changes unfiled scene owner', async () => {
  await store.setSceneProperty(doc.id,null,'owner-b'); assert.equal((await store.getScene(doc.id)).ownerId,'owner-b');
  await store.restoreVersion(doc.id,1); assert.equal((await store.getScene(doc.id)).ownerId,'owner-a'); return 'owner-b becomes owner-a';
 });
 await check('A05 malformed reservations are silently overwritten', async () => {
  await fs.mkdir(path.join(data,'reservations'),{recursive:true}); const file=path.join(data,'reservations/audit.json'); await fs.writeFile(file,'{damaged booking data');
  assert.deepEqual(await reservations.readReservations('audit'),[]); await reservations.withReservations('audit',list=>list.push({id:'new'}));
  assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),[{id:'new'}]); return 'damaged file replaced with only the new record';
 });
 await check('A06 same reset token succeeds twice concurrently in file store', async () => {
  const u=await users.getUserByEmail('staff@example.test'); const reset=await users.createResetToken(u.id);
  const result=await Promise.all([users.resetPassword(reset.token,'new-password-one'),users.resetPassword(reset.token,'new-password-two')]);
  assert.ok(result.every(Boolean)); return '2 successful resets from one token';
 });
 await check('A07 concurrent first accounts both become administrators', async () => {
  const dir=path.join(data,'users'); const saved=path.join(data,'users-saved'); await fs.rename(dir,saved);
  try { const a=await Promise.all([users.createUser({name:'First',email:'first@example.test',password:'audit-password'}),users.createUser({name:'Second',email:'second@example.test',password:'audit-password'})]); assert.ok(a.every(x=>x.role==='admin')); return '2 admins created simultaneously'; }
  finally { await fs.rm(dir,{recursive:true,force:true}); await fs.rename(saved,dir); }
 });
 await check('A08 nonexistent scene accepts public enquiry', async () => {
  const r=await fetch(base+'/leads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sceneId:'not-a-real-space',name:'Audit',email:'guest@example.test',formRenderedAt:Date.now()-5000})});
  assert.equal(r.status,200); const j=await r.json(); assert.ok(j.id); return 'HTTP 200 with persisted lead id';
 });
 await check('A09 malformed site file is treated as nonexistent', async () => {
  await fs.mkdir(path.join(data,'sites'),{recursive:true}); await fs.writeFile(path.join(data,'sites/audit.json'),'{damaged'); assert.equal(await readSite('audit'),null); return 'readSite returns null rather than an error';
 });
 await check('A10 booking engine buffers entire response before size check', async () => {
  const original=globalThis.fetch; let read=false;
  globalThis.fetch=async()=>({ok:true,text:async()=>{read=true;return 'x'.repeat(70000);}});
  try { assert.equal(await engineBooked('https://engine.example.test/availability',{checkin:'2026-11-01',checkout:'2026-11-02',guests:2}),null); assert.ok(read); return 'entire oversized text body consumed before rejection'; }
  finally {globalThis.fetch=original;}
 });
 await check('A11 suffix byte range serves the wrong bytes', async () => {
  const file=path.join(data,'assets/ast_range/data.bin'); await fs.mkdir(path.dirname(file),{recursive:true}); await fs.writeFile(file,'0123456789');
  const r=await fetch(base+'/assets/ast_range/data.bin',{headers:{range:'bytes=-3'}}); const body=await r.text(); assert.equal(body,'0123'); return 'bytes=-3 returns 0123 instead of 789';
 });
 await check('A12 valid range beyond EOF is rejected rather than clamped', async () => {
  const r=await fetch(base+'/assets/ast_range/data.bin',{headers:{range:'bytes=0-99'}}); assert.equal(r.status,416); return '10-byte file returns 416 for bytes=0-99 rather than 206';
 });
 await check('A13 impossible event date passes validation', async () => {
  const {eventProblem}=await import('../server/src/events.js');
  assert.equal(eventProblem({days:90,kinds:['Wedding']},{label:'Hall',seated:100,standing:100},{date:'2026-11-31',session:'day',guests:2,occasion:'Wedding'},'2026-11-01'),null); return 'November 31 accepted';
 });
 await check('A14 one malformed scene breaks the entire scene listing', async () => {
  await fs.writeFile(path.join(data,'scenes/broken.json'),'{broken'); await assert.rejects(store.listScenes(),SyntaxError); return 'listScenes rejects despite a healthy scene';
 });
 await check('A15 published website hall and tour hall have independent inventory', async () => {
  const {hallHotspotFree}=await import('../server/src/events.js');
  const list=[{kind:'event',hall:'hall1',date:'2026-11-10',session:'full',status:'confirmed'}];
  assert.equal(hallHotspotFree(list,'space1','hotspot1','2026-11-10','day'),true); return 'tour inventory reports free despite confirmed website hall booking';
 });
} finally {
 await new Promise(r=>setTimeout(r,100)); await new Promise(r=>server.close(r)); await fs.rm(data,{recursive:true,force:true});
}
if(failed) process.exitCode=1;
