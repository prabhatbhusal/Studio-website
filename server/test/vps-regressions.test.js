import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

const data = await fs.mkdtemp(path.join(os.tmpdir(), 'vps-regression-'));
Object.assign(process.env, { DATA_DIR: data, ASSET_DIR: path.join(data, 'assets'), DATABASE_URL: '', NODE_ENV: 'development', SESSION_SECRET: 'regression-session-secret-123456789', EDITOR_PASSWORD: 'regression-team-code', RESEND_API_KEY: '', ANTHROPIC_API_KEY: '' });
const store = await import('../src/store.js');
const users = await import('../src/usersStore-file.js');
const bookings = await import('../src/reservations.js');
const { authRouter } = await import('../src/routes/auth.js');
const { assetsRouter } = await import('../src/routes/assets.js');
const { sitesRouter, readSite } = await import('../src/routes/sites.js');
const { reservationsRouter } = await import('../src/routes/reservations.js');
const { leadsRouter } = await import('../src/routes/leads.js');
const { engineBooked, publicAddress } = await import('../src/engine.js');
const { eventProblem } = await import('../src/events.js');
const { cleanSite } = await import('../src/routes/sites.js');
const { nightsOf } = await import('../src/stays.js');
const { requireAdmin } = await import('../src/middleware/auth.js');
const { acquireProcessLock } = await import('../src/processLock.js');
const { cleanupUploads } = await import('../src/uploadStore.js');
let server, base, owner, other, staff;
const cookie = (u) => 'splatspace_session=' + jwt.sign({ sub: u.id, role: u.role, iatMs: Date.now() }, process.env.SESSION_SECRET);
const request = async (url, { user = owner, body, method = body ? 'POST' : 'GET', headers = {} } = {}) => {
  return fetch(base + url, { method, headers: { ...(user ? { cookie: cookie(user) } : {}), ...(body && typeof body === 'object' && !Buffer.isBuffer(body) ? { 'content-type': 'application/json' } : {}), ...headers }, body: body && typeof body === 'object' && !Buffer.isBuffer(body) ? JSON.stringify(body) : body });
};
const scene = (id) => ({ id, version: 2, title: 'Test', propertyId: null, spawn: { position: [1,2,3] }, splat: { format: 'glb', variants: { high: { assetId: 'ast_test', meta: 'model.glb' } } }, tracks: [], hotspots: [] });
before(async () => {
  owner = await users.createUser({ name: 'Owner', email: 'owner@example.test', password: 'account-password' });
  other = await users.createUser({ name: 'Other', email: 'other@example.test', password: 'account-password' });
  staff = await users.createUser({ name: 'Staff', email: 'staff@example.test', password: 'account-password', role: 'staff' });
  const app = express(); app.use(cookieParser()); app.use(express.json());
  app.use('/auth',authRouter); app.use('/assets',assetsRouter); app.use('/sites',reservationsRouter); app.use('/sites',sitesRouter); app.use('/leads',leadsRouter);
  app.get('/admin',requireAdmin,(_req,res)=>res.json({ok:true}));
  app.use((err,_req,res,_next)=>res.status(err.status || 500).json({ error: 'Controlled error' }));
  server = await new Promise((resolve) => { const s=app.listen(0,'127.0.0.1',()=>resolve(s)); });
  base='http://127.0.0.1:'+server.address().port;
});
after(async () => { await new Promise((r)=>server.close(r)); await fs.rm(data,{recursive:true,force:true}); });

test('production refuses both shared-password login and previously issued accountless cookies', async () => {
  process.env.NODE_ENV='production';
  try {
    assert.equal((await request('/auth/login',{user:null,body:{password:process.env.EDITOR_PASSWORD}})).status,401);
    const legacy='splatspace_session='+jwt.sign({role:'admin'},process.env.SESSION_SECRET);
    assert.equal((await request('/admin',{user:null,headers:{cookie:legacy}})).status,401);
    assert.equal((await request('/admin')).status,200);
  } finally {process.env.NODE_ENV='development';}
});
test('upload staging belongs to its creator and staff cannot send chunks', async () => {
  const id=(await (await request('/assets',{method:'POST'})).json()).assetId;
  const chunk={method:'PUT',body:Buffer.from('data'),headers:{'content-type':'application/octet-stream'}};
  const url=`/assets/${id}/files/chunk?relPath=data.bin&offset=0`;
  assert.equal((await request(url,{...chunk,user:staff})).status,403);
  assert.equal((await request(url,{...chunk,user:other})).status,403);
  assert.equal((await request('/assets/ast_unknown/files',{body:{relPath:'x'}})).status,404);
  const results=await Promise.all([request(url,chunk),request(url,chunk)]);
  assert.deepEqual(results.map((r)=>r.status).sort(),[200,409]);
  assert.equal(await fs.readFile(path.join(data,'uploads-staging',id,'data.bin'),'utf8'),'data');
});
test('upload quota refuses bytes before writing and expired staging is removed', async () => {
  const id=(await (await request('/assets',{method:'POST'})).json()).assetId;
  process.env.UPLOAD_ACCOUNT_MAX_BYTES='3';
  try {
    const r=await request(`/assets/${id}/files/chunk?relPath=quota.bin&offset=0`,{method:'PUT',body:Buffer.from('four'),headers:{'content-type':'application/octet-stream'}});
    assert.equal(r.status,413);
    await assert.rejects(fs.readFile(path.join(data,'uploads-staging',id,'quota.bin')),{code:'ENOENT'});
  } finally {delete process.env.UPLOAD_ACCOUNT_MAX_BYTES;}
  const file=path.join(data,'upload-owners',id+'.json');const record=JSON.parse(await fs.readFile(file,'utf8'));
  await fs.writeFile(file,JSON.stringify({...record,created:Date.now()-25*60*60*1000}));
  assert.equal((await request(`/assets/${id}/files`,{body:{relPath:'quota.bin'}})).status,410);
  await cleanupUploads();await assert.rejects(fs.stat(path.join(data,'uploads-staging',id)),{code:'ENOENT'});
});
test('republishing after unpublish allocates new immutable history and restores preserve the current owner', async () => {
  await store.saveScene('history',scene('history'),{creator:owner.id});
  assert.equal((await store.publishScene('history')).version,1);
  await store.unpublishScene('history');
  assert.equal((await store.publishScene('history')).version,2);
  await store.setSceneProperty('history',null,other.id);
  const restored=await store.restoreVersion('history',1);
  assert.equal(restored.ownerId,other.id);
  assert.equal((await store.publishScene('history')).version,3);
});
test('stale scene saves conflict and simultaneous project patches both survive', async () => {
  const saved=await store.saveScene('revision',scene('revision'),{creator:owner.id});
  const results=await Promise.allSettled([store.saveScene('revision',{...saved,title:'One'}),store.saveScene('revision',{...saved,title:'Two'})]);
  assert.equal(results.filter((r)=>r.status==='fulfilled').length,1);
  assert.equal(results.find((r)=>r.status==='rejected').reason.status,409);
  const p=await store.createProperty('Concurrent',owner.id);
  await Promise.all([store.addPropertyMember(p.id,'a'),store.addPropertyMember(p.id,'b')]);
  assert.deepEqual((await store.getProperty(p.id)).members.sort(),['a','b']);
});
test('one reset token has exactly one winner under concurrent redemption', async () => {
  const link=await users.createResetToken(staff.id);
  const results=await Promise.all([users.resetPassword(link.token,'new-password-a'),users.resetPassword(link.token,'new-password-b')]);
  assert.equal(results.filter(Boolean).length,1);
});
test('first-account bootstrap is serialized and malformed accounts never restart bootstrap', async () => {
  const dir=path.join(data,'users'), saved=path.join(data,'users-saved'); await fs.rename(dir,saved);
  try {
    const results=await Promise.all(['a','b'].map((n)=>users.createUser({name:n,email:n+'@example.test',password:'account-password'})));
    assert.equal(results.filter((u)=>u.role==='admin').length,1);
    for(const file of await fs.readdir(dir))await fs.rm(path.join(dir,file));
    await fs.writeFile(path.join(dir,'damaged.json'),'{broken');
    assert.equal((await users.createUser({name:'Later',email:'later@example.test',password:'account-password'})).role,'editor');
  } finally {await fs.rm(dir,{recursive:true,force:true});await fs.rename(saved,dir);}
});
test('damaged bookings and site state fail closed without being overwritten', async () => {
  await fs.mkdir(path.join(data,'reservations'),{recursive:true}); const file=path.join(data,'reservations/broken.json'); await fs.writeFile(file,'{broken');
  await assert.rejects(bookings.readReservations('broken'),SyntaxError);
  await assert.rejects(bookings.withReservations('broken',(list)=>list.push({id:'new'})),SyntaxError);
  assert.equal(await fs.readFile(file,'utf8'),'{broken');
  await fs.mkdir(path.join(data,'sites'),{recursive:true});await fs.writeFile(path.join(data,'sites/broken.json'),'{broken');
  await assert.rejects(readSite('broken'),SyntaxError);
});
test('a damaged scene does not take healthy listings down', async () => {
  await fs.writeFile(path.join(data,'scenes/broken.json'),'{broken');
  assert.ok((await store.listScenes()).some((s)=>s.id==='history'));
  // Public listings must isolate the same record too.
  assert.ok((await store.listPublished()).some((s)=>s.id==='history'));
});
test('byte ranges implement suffix, clamped EOF, unsatisfiable and empty ranges', async () => {
  const dir=path.join(data,'assets/ast_range');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'data.bin'),'0123456789');
  for(const [range,status,body] of [['bytes=-3',206,'789'],['bytes=0-99',206,'0123456789'],['bytes=3-',206,'3456789'],['bytes=10-99',416,''],['bytes=-0',416,''],['bytes=-',416,'']]) {
    const r=await request('/assets/ast_range/data.bin',{user:null,headers:{range}});assert.equal(r.status,status,range);assert.equal(await r.text(),body,range);
  }
});
test('strict dates reject impossible event and room dates', () => {
  assert.ok(eventProblem({days:90,kinds:['Wedding']},{label:'Hall',seated:100,standing:100},{date:'2026-11-31',session:'day',guests:2,occasion:'Wedding'},'2026-11-01'));
  assert.deepEqual(nightsOf('2026-02-30','2026-03-04'),[]);
  assert.deepEqual(nightsOf('2028-02-29','2028-03-01'),['2028-02-29']);
});
test('website saves reject stale edits and shared room/hall inventory cannot accept hotspot requests', async () => {
  const p=await store.createProperty('Inventory Guard',owner.id);
  const first=await request(`/sites/${p.id}/draft`,{method:'PUT',body:{hero:{title:'First'}}});
  assert.equal(first.status,200);
  const saved=(await first.json()).draft;
  assert.equal((await request(`/sites/${p.id}/draft`,{method:'PUT',body:{hero:{title:'Stale'},revision:0}})).status,409);
  assert.equal((await request(`/sites/${p.id}/draft`,{method:'PUT',body:{...saved,hero:{title:'Fresh'}}})).status,200);
  const doc=scene('inventory-hall');doc.propertyId=p.id;doc.hotspots=[{id:'hall',type:'hall',label:'Hall',payload:{},position:[0,0,0]}];
  await store.saveScene(doc.id,doc,{creator:owner.id});await store.publishScene(doc.id);
  const site=cleanSite({events:{on:true,halls:[{id:'hall',label:'Hall',seated:100}],kinds:['Wedding']}},p.id);
  const siteFile=path.join(data,'sites',p.id+'.json');await fs.writeFile(siteFile,JSON.stringify({draft:site,published:site}));
  const tomorrow=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
  const body={space:doc.id,hotspot:'hall',date:tomorrow,session:'day',guests:2,name:'Guest',phone:'9812345678',formRenderedAt:Date.now()-5000};
  assert.equal((await request(`/sites/${p.id}/requests`,{body,user:null})).status,409);
  assert.equal((await request(`/sites/${p.id}/reservations/mark`,{body})).status,409);
  await bookings.withReservations(p.id,(list)=>list.push({id:'legacy',kind:'request',of:'hall',space:doc.id,hotspot:'hall',status:'confirmed',date:tomorrow,session:'day'}));
  assert.equal((await request(`/sites/${p.id}/publish`,{method:'POST'})).status,409,'legacy inventory must be reconciled before switching channels');
});
test('manual room blocks reject more than 366 nights without changing inventory', async () => {
  const p = await store.createProperty('Long block', owner.id);
  const site = cleanSite({ stays: { on: true, rooms: [{ id: 'room', label: 'Room', count: 1, sleeps: 2 }] } }, p.id);
  await fs.mkdir(path.join(data, 'sites'), { recursive: true });
  await fs.writeFile(path.join(data, 'sites', p.id + '.json'), JSON.stringify({ draft: site, published: site }));
  const mark = (checkout) => request(`/sites/${p.id}/reservations/mark`, { body: { room: 'room', checkin: '2028-01-01', checkout } });
  assert.equal((await mark('2030-01-01')).status, 400);
  assert.deepEqual(await bookings.readReservations(p.id), []);
  assert.equal((await mark('2029-01-01')).status, 201);
  assert.equal((await bookings.readReservations(p.id))[0].nights, 366);
});

test('early room search uses room timezone independently of table booking timezone', async () => {
  const p = await store.createProperty('Timezone search', owner.id);
  const site = cleanSite({ booking: { timezone: 'Asia/Kathmandu' }, stays: { on: true, timezone: 'Pacific/Honolulu' } }, p.id);
  await fs.mkdir(path.join(data, 'sites'), { recursive: true });
  await fs.writeFile(path.join(data, 'sites', p.id + '.json'), JSON.stringify({ draft: site, published: site }));
  const room = await (await request(`/sites/${p.id}/clock?kind=stay`, { user: null })).json();
  assert.equal(room.timezone, 'Pacific/Honolulu');
  assert.equal(room.today, bookings.nowIn('Pacific/Honolulu').date);
  assert.equal((await (await request(`/sites/${p.id}/clock`, { user: null })).json()).timezone, 'Asia/Kathmandu');
});

test('reservation review isolates projects, excludes own holds, and confirmation rechecks conflicts', async () => {
  const p = await store.createProperty('Review workflow', owner.id);
  await store.addPropertyMember(p.id, staff.id, 'staff');
  const site = cleanSite({ booking: { on: true, plan: 'ast_test/floorplan/plan.svg', tables: [{ id: 'table1', label: 'Window', seats: 4, x: 0.3, y: 0.4 }], stay: 90 } }, p.id);
  await fs.mkdir(path.join(data, 'sites'), { recursive: true });
  await fs.writeFile(path.join(data, 'sites', p.id + '.json'), JSON.stringify({ draft: site, published: site }));
  const r = { id: 'review1', status: 'requested', table: 'table1', date: '2027-01-02', time: '18:00', party: 2, name: 'Test guest', email: '', phone: '9812345678' };
  await bookings.withReservations(p.id, list => list.push(r));
  const url = `/sites/${p.id}/reservations/${r.id}`;
  assert.equal((await request(url + '/review', { user: null })).status, 401);
  assert.equal((await request(url + '/review', { user: other })).status, 404);
  const review = await (await request(url + '/review', { user: staff })).json();
  assert.equal(review.available, true, 'the request does not conflict with itself');
  assert.equal(review.markers[0].selected, true);
  assert.equal(review.plan, 'ast_test/floorplan/plan.svg');
  await bookings.withReservations(p.id, list => list.push({ ...r, id: 'conflicting', status: 'confirmed' }));
  assert.equal((await (await request(url + '/review')).json()).available, false);
  assert.equal((await request(url, { method: 'PATCH', body: { status: 'confirmed', expectedStatus: 'requested' } })).status, 409);
  assert.equal((await bookings.readReservations(p.id)).find(x => x.id === r.id).status, 'requested');
  assert.equal((await request(url, { method: 'PATCH', body: { status: 'declined', expectedStatus: 'requested' } })).status, 200);
  assert.equal((await request(url, { method: 'PATCH', body: { status: 'confirmed', expectedStatus: 'requested' } })).status, 409, 'stale decisions cannot replace a newer status');
});

test('GUI website presentation survives saves and legacy sites get neutral defaults', async () => {
  const p = await store.createProperty('GUI design controls', owner.id);
  const presentation = { motion: 'none', bookingNote: 'We reply during reception opening hours.' };
  const response = await request(`/sites/${p.id}/draft`, { method: 'PUT', body: { style: 'classic', presentation, hero: { title: 'Our guesthouse' } } });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).draft.presentation, presentation);
  assert.deepEqual((await readSite(p.id)).draft.presentation, presentation);
  assert.deepEqual(cleanSite({}, p.id).presentation, { motion: 'calm', bookingNote: '' });
  const invalid = cleanSite({ presentation: { motion: 'unexpected', bookingNote: 'x'.repeat(500) } }, p.id);
  assert.equal(invalid.presentation.motion, 'calm');
  assert.equal(invalid.presentation.bookingNote.length, 240);
});

test('unknown and draft scene enquiries are rejected without saving leads', async () => {
  for(const id of ['not-real','revision'])assert.equal((await request('/leads',{user:null,body:{sceneId:id,name:'Guest',email:'guest@example.test',formRenderedAt:Date.now()-5000}})).status,404);
  await assert.rejects(fs.readdir(path.join(data,'leads')),{code:'ENOENT'});
});
test('engine responses are bounded, deduplicated and private addresses are excluded', async () => {
  let calls=0;
  const engine=http.createServer((_req,res)=>{calls++;setTimeout(()=>res.end('x'.repeat(100000)),20);});
  await new Promise((r)=>engine.listen(0,'127.0.0.1',r));
  try {
    const url='http://127.0.0.1:'+engine.address().port+'/availability';const stay={checkin:'2026-11-01',checkout:'2026-11-02',guests:2};
    assert.deepEqual(await Promise.all([engineBooked(url,stay),engineBooked(url,stay)]),[null,null]);
    assert.equal(calls,1);assert.equal(await engineBooked(url,stay),null);assert.equal(calls,1);
    for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1'])assert.equal(publicAddress(ip),false,ip);
    assert.equal(publicAddress('1.1.1.1'),true);
  } finally {await new Promise((r)=>engine.close(r));}
});
test('production data lock refuses a second process owner', () => {
  const release=acquireProcessLock();try {assert.throws(()=>acquireProcessLock(),/Another API process/);}finally{release();}
});
test('an attachment storage failure preserves the upload key for a successful retry', async () => {
  const p=await store.createProperty('Attachment Retry',owner.id);
  const id='retry-booking',key='retry-key';
  await bookings.withReservations(p.id,(list)=>list.push({id,kind:'event',status:'requested',uploadKey:key,uploadUntil:Date.now()+60000}));
  const attachmentRoot=path.join(data,'attachments');await fs.writeFile(attachmentRoot,'blocked directory');
  const body=Buffer.from('%PDF-1.7 test');const options={method:'PUT',user:null,body,headers:{'content-type':'application/octet-stream'}};
  try {
    assert.equal((await request(`/sites/${p.id}/reservations/${id}/attachment?key=${key}`,options)).status,500);
    assert.equal((await bookings.readReservations(p.id))[0].uploadKey,key);
  } finally {await fs.rm(attachmentRoot);}
  assert.equal((await request(`/sites/${p.id}/reservations/${id}/attachment?key=${key}`,options)).status,200);
  assert.equal((await bookings.readReservations(p.id))[0].uploadKey,undefined);
  assert.deepEqual(await fs.readFile(path.join(attachmentRoot,p.id,id+'.pdf')),body);
});
test('real production API boots on loopback and refuses a second writer', async () => {
  const probe=http.createServer();await new Promise((r)=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise((r)=>probe.close(r));
  const dir=path.join(data,'production-smoke');
  const env={...process.env,NODE_ENV:'production',PORT:String(port),HOST:'127.0.0.1',DATA_DIR:dir,ASSET_DIR:path.join(dir,'assets'),ASSET_DRIVER:'local',DATABASE_URL:'',CLIENT_ORIGIN:'https://audit.example.test',SESSION_SECRET:'production-smoke-session-1234567890abcdef',EMBED_TOKEN_SECRET:'production-smoke-embed-1234567890abcdef',EDITOR_PASSWORD:'production-smoke-team-code',RESEND_API_KEY:'',ANTHROPIC_API_KEY:''};
  const start=()=>spawn(process.execPath,['src/index.js'],{cwd:path.resolve(import.meta.dirname,'..'),env,stdio:['ignore','pipe','pipe']});
  const first=start();let errors='';first.stderr.on('data',(b)=>{errors+=b;});first.stdout.resume();
  try {
    let healthy=false;
    for(let i=0;i<80;i++){try{healthy=(await fetch(`http://127.0.0.1:${port}/api/health`)).ok;if(healthy)break;}catch{/* booting */}await new Promise((r)=>setTimeout(r,25));}
    assert.ok(healthy,errors);
    const r=await fetch(`http://127.0.0.1:${port}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:env.EDITOR_PASSWORD})});assert.equal(r.status,401);
    const second=start();let secondErrors='';second.stdout.resume();second.stderr.on('data',(b)=>{secondErrors+=b;});
    const [code]=await once(second,'exit');assert.equal(code,1);assert.match(secondErrors,/Another API process/);
  } finally {const exit=once(first,'exit');first.kill();await exit;}
});
test('an account-store failure reaches the Express error handler instead of crashing', async () => {
  const dir=path.join(data,'users'),saved=path.join(data,'users-error');await fs.rename(dir,saved);await fs.writeFile(dir,'not a directory');
  try {assert.equal((await request('/admin')).status,500);assert.equal((await request('/auth/session')).status,500);}
  finally {await fs.rm(dir);await fs.rename(saved,dir);}
});
