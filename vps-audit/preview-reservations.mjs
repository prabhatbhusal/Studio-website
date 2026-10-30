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
    if(r.method==='Fetch.requestPaused') void send('Fetch.fulfillRequest',{requestId:r.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'image/svg+xml'}],body:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="420"><rect width="800" height="420" fill="#f5f1e8"/><path d="M30 30H770V390H30ZM400 30V390" stroke="#333" stroke-width="8" fill="none"/><text x="60" y="70" font-size="24">Synthetic floor plan</text></svg>').toString('base64')});
    if (r.method === 'Runtime.exceptionThrown') errors.push(r.params.exceptionDetails.text);
    if (pending.has(r.id)) { pending.get(r.id)(r); pending.delete(r.id); }
  });
  const send = (method, params = {}) => new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.ok(!r.result?.exceptionDetails, JSON.stringify(r)); return r.result?.result?.value;
  };
  const click = async label => { assert.equal(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}); if(!b)return false;b.click();return true})()`), true, label); await pause(150); };
  const fixture = {
    today: '2026-10-29', booking: { on: true, tables: [] }, stays: null, events: null, hotspots: [],
    reservations: [
      { id: 'stay-001', kind: 'stay', status: 'requested', name: 'Sita Sharma', phone: '+977 (980)-1234567', email: 'sita@example.test', date: '2026-10-30', checkin: '2026-10-30', checkout: '2026-11-03', nights: 4, party: 2, roomLabel: 'Deluxe suite' },
      { id: 'table-002', status: 'confirmed', name: 'Alex Guest', phone: '123456', date: '2026-10-29', time: '18:00', party: 4, tableLabel: 'Garden table' },
      { id: 'wait-003', kind: 'wait', of: 'room', status: 'waiting', name: 'Wait Guest', phone: '123457', date: '2026-10-30', checkout: '2026-11-02', nights: 3, party: 2 }
    ]
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Fetch.enable',{patterns:[{urlPattern:'*/api/assets/fixture-plan/*',requestStage:'Request'}]});
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `{
    const realFetch=window.fetch;
    const previewData=${JSON.stringify(fixture)};
    window.previewWrites=[];
    window.fetch=async(input,options)=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(!url.pathname.startsWith('/api/'))return realFetch(input,options);
      if(options?.method && options.method!=='GET'){
        if(options.method!=='PATCH'||!url.pathname.startsWith('/api/sites/preview/reservations/'))throw Error('Writes prohibited in preview');
        const r=previewData.reservations.find(r=>url.pathname.endsWith('/'+r.id));
        const patch=JSON.parse(options.body);window.previewWrites.push(patch);
        if(!r||r.status!==patch.expectedStatus)return new Response(JSON.stringify({error:'Stale fixture'}),{status:409});
        r.status=patch.status;r.guestDelivery={sent:false,pending:false,status:r.status,reason:'Test fixture, no message sent'};
        return new Response(JSON.stringify(r),{headers:{'Content-Type':'application/json'}});
      }
      let data;
      if(url.pathname==='/api/auth/session')data={authenticated:true};
      else if(url.pathname==='/api/properties/preview')data={title:'Preview hotel',access:'staff'};
      else if(url.pathname==='/api/sites/preview/reservations')data=previewData;
      else if(url.pathname.endsWith('/review')){const r=previewData.reservations.find(r=>url.pathname.includes('/'+r.id+'/'));data={reservation:r,plan:'fixture-plan/floorplan/plan.svg',markers:[{id:'room',label:'Deluxe suite',x:0.25,y:0.5,selected:true,available:true}],available:true,note:'Fixture availability',checkedAt:new Date().toISOString()};}
      else throw Error('Unexpected API request: '+url.pathname);
      return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
    };
  }` });
  const results = [];
  for (const width of [1440, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/studio/preview/reservations` });
    for (let i=0;i<100;i++) { if (await evaluate(`!!document.querySelector('input[type=search]')`)) break; await pause(100); }
    await click('All');
    await evaluate(`(()=>{const e=document.querySelector('input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'9801234567');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await pause(150);
    assert.equal(await evaluate(`document.querySelectorAll('.rs-item').length`), 1, 'phone search');
    await click('Clear filters'); await click('Calendar'); await click('Next');
    assert.equal(await evaluate(`document.querySelector('[aria-label="2026-11-01: 1 reservation"]')?.textContent.includes('1')`), true, 'occupied night');
    assert.equal(await evaluate(`!!document.querySelector('[aria-label="2026-11-03: 0 reservations"]')`), true, 'checkout excluded');
    await evaluate(`document.querySelector('[aria-label="2026-11-01: 1 reservation"]').click()`); await pause(150);
    assert.equal(await evaluate(`document.querySelectorAll('.rs-item').length`), 1, 'selected-day list');
    const layout = await evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,calendar:document.querySelector('.rs-calendar').getBoundingClientRect().width})`);
    assert.equal(layout.overflow, false, 'no horizontal overflow');
    await evaluate(`document.querySelector('.rs-calendar').scrollIntoView()`);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(path.join(import.meta.dirname, `reservations-${width}.png`), Buffer.from(shot.result.data, 'base64'));
    await click('List');
    await evaluate(`(()=>{const inputs=document.querySelectorAll('input[type=date]');for(const [i,value] of ['2026-11-01','2026-11-01'].entries()){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(inputs[i],value);inputs[i].dispatchEvent(new Event('input',{bubbles:true}));}})()`);
    await pause(150);
    assert.equal(await evaluate(`document.querySelectorAll('.rs-item').length`), 1, 'range includes ongoing stay');
    await click('Waitlist (1)');
    assert.equal(await evaluate(`document.querySelectorAll('.rs-item').length`), 1, 'waitlist supports dates');
    await click('Clear filters'); await click('All');
    assert.equal(await evaluate(`document.querySelectorAll('.rs-item').length`), 2, 'clear restores bookings');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ed2')).fontFamily.includes('Inter')`),true,'studio Inter');
    assert.equal(await evaluate(`document.querySelector('.rs-manual-block').open`),false,'external block starts collapsed');
    await click('Review reservation');
    assert.equal(await evaluate(`document.querySelector('dialog').open`),true,'review dialog');
    for(let i=0;i<30;i++){if(await evaluate(`!!document.querySelector('.rs-review-plan img')?.naturalWidth`))break;await pause(100);}
    assert.equal(await evaluate(`!!document.querySelector('.rs-review-plan img')?.naturalWidth`),true,'floor plan loads');
    assert.equal(await evaluate(`document.querySelectorAll('.rs-plan-pin.is-selected').length`),1,'requested resource highlighted');
    const reviewShot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(import.meta.dirname,`review-${width}.png`),Buffer.from(reviewShot.result.data,'base64'));
    await click('Decline request');
    await click('Decline and notify guest');
    assert.equal(await evaluate(`window.previewWrites.length`),1,'one decision, no extra booking');
    assert.equal(await evaluate(`window.previewWrites[0].status`),'declined');
    assert.equal(await evaluate(`document.querySelector('dialog').textContent.includes('notification was not sent')`),true,'honest notification result');
    await click('Close');
    results.push({ width, ...layout, phoneSearch: true, overnightCalendar: true, checkoutExcluded: true, selectedDay: true, dateRange: true, waitlist: true, clearFilters: true });
  }
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  const websiteCss=await fs.readFile(path.join(root,'src/features/website/website.css'),'utf8');
  const viewerCss=await fs.readFile(path.join(root,'src/features/tour/viewer.css'),'utf8');
  const fonts=await evaluate(`(()=>{const style=document.createElement('style');style.textContent=${JSON.stringify(websiteCss+'\n'+viewerCss)};document.head.append(style);const wrap=document.createElement('div');wrap.innerHTML='<div class="ws" style="--ws-serif: Georgia; --ws-script: cursive"><h1>Client brand heading</h1><p>Client body</p><span class="ws-script">Client script</span></div><div class="vw"><p>Client tour</p><h1 style="font-family: Georgia">Tour brand heading</h1></div>';document.querySelector('.studio-fonts').append(wrap);return {clientHeading:getComputedStyle(wrap.querySelector('h1')).fontFamily,clientBody:getComputedStyle(wrap.querySelector('.ws p')).fontFamily,clientScript:getComputedStyle(wrap.querySelector('.ws-script')).fontFamily,tourBody:getComputedStyle(wrap.querySelector('.vw p')).fontFamily,tourBrand:getComputedStyle(wrap.querySelector('.vw h1')).fontFamily};})()`);
  assert.match(fonts.clientHeading,/Georgia/);assert.doesNotMatch(fonts.clientBody,/Inter/);assert.match(fonts.clientScript,/cursive/);assert.match(fonts.tourBody,/JetBrains/);assert.match(fonts.tourBrand,/Georgia/);
  await send('Page.navigate',{url:`http://127.0.0.1:${port}/`});await pause(1200);
  fonts.company=await evaluate(`getComputedStyle(document.querySelector('.rcaas')).fontFamily`);
  assert.match(fonts.company,/Inter/);
  await fs.writeFile(path.join(import.meta.dirname,'evidence/font-scope-browser.json'),JSON.stringify(fonts,null,2));
  await fs.writeFile(path.join(import.meta.dirname, 'evidence/booking-browser.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  ws?.close(); chrome?.kill(); web.kill(); await pause(500);
  if (path.dirname(profile) !== import.meta.dirname) throw Error('Invalid profile path');
  try { await fs.rm(profile, { recursive: true, force: true }); } catch {}
}
