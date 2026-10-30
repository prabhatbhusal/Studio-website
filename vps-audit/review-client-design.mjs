// Read-only inspection of the existing local sample site. No forms submitted.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
const dir=import.meta.dirname;
const profile=await fs.mkdtemp(path.join(dir,'design-profile-'));
const socket=http.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let ws;
try {
 let target;
 for(let i=0;i<50;i++){try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');if(target)break;}catch{}await pause(100);}
 if(!target)throw Error('Browser did not start');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r));
 let seq=0;const pending=new Map();const errors=[];
 ws.addEventListener('message',e=>{const d=JSON.parse(e.data);if(d.method==='Runtime.exceptionThrown')errors.push(d.params.exceptionDetails.text);if(pending.has(d.id)){pending.get(d.id)(d);pending.delete(d.id);}});
 const send=(method,params={})=>new Promise(r=>{pending.set(++seq,r);ws.send(JSON.stringify({id:seq,method,params}));});
 const evaluate=async expression=>{const d=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(d.result?.exceptionDetails)throw Error(JSON.stringify(d));return d.result?.result?.value;};
 await send('Page.enable');await send('Runtime.enable');
 const results=[];
 for(const width of [1440,390]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'http://localhost:3000/s/chyasal-house'});
  for(let i=0;i<70;i++){if(await evaluate(`!!document.querySelector('.ws h1')`))break;await pause(200);}
  await pause(3200);
  const data=await evaluate(`(async()=>{await document.fonts.ready;const root=document.querySelector('.ws');const box=e=>{const b=e.getBoundingClientRect();return {top:Math.round(b.top),height:Math.round(b.height),width:Math.round(b.width)}};return {style:root.dataset.style,scrollHeight:root.scrollHeight,overflow:root.scrollWidth>root.clientWidth,heading:{text:root.querySelector('h1').textContent,font:getComputedStyle(root.querySelector('h1')).fontFamily,size:getComputedStyle(root.querySelector('h1')).fontSize},bodyFont:getComputedStyle(root).fontFamily,chapters:[...root.querySelectorAll('[data-chapter]')].map(e=>({id:e.id,title:e.dataset.chapter,...box(e)})),brokenImages:[...root.querySelectorAll('img')].filter(i=>i.complete&&!i.naturalWidth).map(i=>i.alt),tourFrames:root.querySelectorAll('iframe.ws-tour').length}})()`);
  for(const id of ['top','spaces','stay']){
   await evaluate(`(()=>{const ws=document.querySelector('.ws');const el=document.getElementById(${JSON.stringify(id)});if(el){if(${JSON.stringify(id)}==='stay')location.hash='stay';else ws.scrollTo({top:ws.scrollTop+el.getBoundingClientRect().top,behavior:'instant'});}})()`);
   await pause(1500);
   if(id==='stay'){
    const clearance=await evaluate(`({tabsTop:document.querySelector('.ws-desk-tabs').getBoundingClientRect().top,headerBottom:document.querySelector('.wsn').getBoundingClientRect().bottom})`);
    if(clearance.tabsTop<clearance.headerBottom)throw Error('Booking tabs overlap header: '+JSON.stringify({width,...clearance}));
    data.bookingClearance=clearance;
   }
   const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(dir,`client-design-${width}-${id}.png`),Buffer.from(shot.result.data,'base64'));
  }
  results.push({width,...data});
 }
 await fs.writeFile(path.join(dir,'evidence/client-design-review.json'),JSON.stringify({results,errors},null,2));
 console.log(JSON.stringify({results,errors}));
}finally{ws?.close();chrome.kill();await pause(500);if(path.dirname(profile)!==dir)throw Error('Invalid profile');try{await fs.rm(profile,{recursive:true,force:true});}catch{}}
