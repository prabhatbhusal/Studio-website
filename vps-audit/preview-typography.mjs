// Read-only browser inspection of the built app; no form submissions.
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
const root=path.resolve(import.meta.dirname,'..');
const profile=await fs.mkdtemp(path.join(import.meta.dirname,'typography-profile-'));
const freePort=async()=>{const s=http.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;};
const port=await freePort(),cdp=await freePort();
const web=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{cwd:root,env:{...process.env,NEXT_DIST_DIR:'.next-new'},stdio:'ignore',windowsHide:true});
let chrome,ws;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try {
 let ready=false;
 for(let i=0;i<100;i++){try{ready=(await fetch(`http://127.0.0.1:${port}/login`)).ok;if(ready)break;}catch{/* starting */}await pause(100);}
 if(!ready)throw Error('Next server did not start.');
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu',`--remote-debugging-port=${cdp}`,`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
 let target;
 for(let i=0;i<100;i++){try{target=(await(await fetch(`http://127.0.0.1:${cdp}/json/list`)).json()).find(t=>t.type==='page');if(target)break;}catch{/* starting */}await pause(100);}
 if(!target)throw Error('Chrome did not start.');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r));
 let id=0;const pending=new Map();ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(pending.has(r.id)){pending.get(r.id)(r);pending.delete(r.id);}});
 const send=(method,params={})=>new Promise(r=>{pending.set(++id,r);ws.send(JSON.stringify({id,method,params}));});
 await send('Page.enable');
 const results=[];
 for(const [route,width] of [['/',1440],['/login',1440],['/login',390],['/studio',1440]]) {
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});
  await send('Page.navigate',{url:`http://127.0.0.1:${port}${route}`});await pause(1700);
  const result=await send('Runtime.evaluate',{expression:`(async()=>{await document.fonts.ready; const text=[...document.querySelectorAll('body *')].filter(e=>![...e.children].length&&e.textContent.trim()&&e.getClientRects().length&&!['SCRIPT','STYLE','PATH'].includes(e.tagName)); const controls=[...document.querySelectorAll('input,button,select,textarea')]; const nodes=[...new Set([...text,...controls])];const bad=nodes.filter(e=>!getComputedStyle(e).fontFamily.includes('Inter'));const weights={};for(const e of nodes){const w=getComputedStyle(e).fontWeight;weights[w]=(weights[w]||0)+1;}return {checked:nodes.length,weights,bodyWeight:getComputedStyle(document.body).fontWeight,incorrect:bad.map(e=>({tag:e.tagName,font:getComputedStyle(e).fontFamily})).slice(0,8),loadedFonts:[...document.fonts].filter(f=>f.status==='loaded').map(f=>({family:f.family,weight:f.weight})),horizontalOverflow:document.documentElement.scrollWidth>innerWidth}})()`,awaitPromise:true,returnByValue:true});
  const data=result.result?.result?.value;if(!data)throw Error(JSON.stringify(result));
  results.push({route,width,...data});
  if(data.incorrect.length)throw Error('Typography override failed: '+JSON.stringify(results));
  if(data.bodyWeight!=='400'||!data.weights['400']||Object.keys(data.weights).length<2)throw Error('Missing regular/bold hierarchy: '+JSON.stringify(results));
  if(route==='/login'&&width===1440){const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(import.meta.dirname,'inter-login.png'),Buffer.from(shot.result.data,'base64'));}
 }
 await fs.writeFile(path.join(import.meta.dirname,'evidence/inter-browser.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
} finally {
 ws?.close();chrome?.kill();web.kill();await pause(500);
 if(path.dirname(profile)!==import.meta.dirname)throw Error('Invalid preview profile path.');
 try{await fs.rm(profile,{recursive:true,force:true});}catch{/* Chrome may still be exiting. */}
}
