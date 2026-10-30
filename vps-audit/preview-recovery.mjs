// Browser-only fixture responses: never reads or writes real guest data.
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..');
const profile = await fs.mkdtemp(path.join(import.meta.dirname, 'booking-profile-'));
const freePort = async () => {
  const s = http.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r));
  const port = s.address().port; await new Promise(r => s.close(r)); return port;
};
const port = await freePort(), cdp = await freePort();
const pause = ms => new Promise(r => setTimeout(r, ms));
const web = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
  cwd: root, env: { ...process.env, NEXT_DIST_DIR: '.next-new' }, stdio: 'ignore', windowsHide: true
});
let chrome, ws;
try {
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/login`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    await pause(100);
  }
  assert.ok(ready, 'Preview server started');
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu',
    `--remote-debugging-port=${cdp}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let target;
  for (let i = 0; i < 100; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${cdp}/json/list`, { signal: AbortSignal.timeout(1000) })).json()).find(t => t.type === 'page'); if (target) break; } catch {}
    await pause(100);
  }
  assert.ok(target, 'Chrome started');
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(), errors = [];
  ws.addEventListener('message', e => {
    const r = JSON.parse(e.data);
    if (r.method === 'Runtime.exceptionThrown') errors.push(r.params.exceptionDetails.text);
    if (pending.has(r.id)) { pending.get(r.id)(r); pending.delete(r.id); }
  });
  const send = (method, params = {}) => new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.ok(!r.result?.exceptionDetails, JSON.stringify(r)); return r.result?.result?.value;
  };
  const click = async label => { assert.equal(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}); if(!b)return false;b.click();return true})()`), true, label); await pause(150); };
  const doc = { id: 'recovery-fixture', propertyId: 'fixture', revision: 1, version: 2, title: 'Recovery fixture', unitScale: 1, hotspots: [], tracks: [], colliders: [], transform: { position: [0,0,0], rotation: [0,0,0], scale: 1 }, spawn: { position: [0,1,2], yaw: 0 }, splat: { format: 'lcc2', variants: { high: { assetId: 'fixture' } } }, booking: null };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `{
    const realFetch=window.fetch;
    window.fetch=async(input,options)=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(!url.pathname.startsWith('/api/'))return realFetch(input,options);
      if(options?.method && options.method!=='GET')throw Error('Writes prohibited');
      let data;
      if(url.pathname==='/api/auth/session')data={authenticated:true,user:{id:'fixture-account',role:'editor'}};
      else if(url.pathname==='/api/scenes/recovery-fixture')data={...${JSON.stringify(doc)},revision:Number(sessionStorage.getItem('fixture-revision')||1)};
      else throw Error('Unexpected API '+url.pathname);
      return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
    };
  }` });
  const key='studio-recovery:v1:fixture-account:recovery-fixture';
  const visit=async()=>{await send('Page.navigate',{url:`http://127.0.0.1:${port}/recovery-check`});await pause(1600);};
  await visit();
  await click('Edit fixture'); await pause(1800);
  assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('${key}')).doc.booking.label`),'Recovered booking');
  await visit();
  assert.equal(await evaluate(`document.querySelector('output').textContent`),'No edit','reload does not silently restore');
  await click('Restore edits');
  assert.equal(await evaluate(`document.querySelector('output').textContent`),'Recovered booking','restores edits');
  await click('Simulate saved'); await pause(1800);
  assert.equal(await evaluate(`sessionStorage.getItem('${key}')`),null,'saved work removes copy');
  await visit(); await click('Edit fixture'); await pause(1800); await visit();
  await click('Discard copy');
  assert.equal(await evaluate(`sessionStorage.getItem('${key}')`),null,'discard removes copy');
  assert.equal(await evaluate(`document.querySelector('output').textContent`),'No edit','discard leaves draft unchanged');
  await click('Edit fixture'); await pause(1800);
  await evaluate(`sessionStorage.setItem('fixture-revision','2')`); await visit();
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Restore edits').disabled`),true,'new revision cannot restore');
  for(const width of [1440,390]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth`),false,'no overflow');
    const shot=await send('Page.captureScreenshot',{format:'png'});
    await fs.writeFile(path.join(import.meta.dirname,`recovery-${width}.png`),Buffer.from(shot.result.data,'base64'));
  }
  assert.deepEqual(errors,[]);
  const result={capture:true,explicitRestore:true,clearAfterSave:true,discard:true,revisionConflict:true,widths:[1440,390],browserErrors:errors};
  await fs.writeFile(path.join(import.meta.dirname,'evidence/recovery-browser.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {
  ws?.close(); chrome?.kill(); web.kill(); await pause(500);
  if (path.dirname(profile) !== import.meta.dirname) throw Error('Invalid profile path');
  try { await fs.rm(profile, { recursive: true, force: true }); } catch {}
}

