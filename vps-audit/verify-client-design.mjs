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
 await send('Page.navigate',{url:'http://localhost:3000/design-check'});
 for(let i=0;i<120;i++){if(await evaluate(`!!document.querySelector('[aria-label="Fixture font"]')`))break;await pause(200);}
 const setSelect=async(label,value)=>{await evaluate(`(()=>{const e=document.querySelector('[aria-label="${label}"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(90);};
 const fonts=await evaluate(`[...document.querySelector('[aria-label="Fixture font"]').options].map(o=>o.value)`);
 const designs=['heritage','classic','modern','minimal','night'];
 for(const width of [1440,390,320]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
  for(const design of designs){
   await setSelect('Fixture design',design);
   for(const font of fonts){
    await setSelect('Fixture font',font);
    const result=await evaluate(`(async()=>{await document.fonts.ready;const root=document.querySelector('.ws');root.scrollTo({top:0,behavior:'instant'});const h=root.querySelector('h1'),s=root.querySelector('.ws-hero-script');const hr=h.getBoundingClientRect(),sr=s?.getBoundingClientRect();return {font:getComputedStyle(h).fontFamily,headingOverflow:hr.left<0||hr.right>innerWidth+1,scriptOverlap:!!sr&&sr.height>0&&sr.bottom>hr.top+1,rootOverflow:root.scrollWidth>root.clientWidth+1,navOverlap:(()=>{const brand=root.querySelector('.wsn-brand').getBoundingClientRect(),cta=root.querySelector('.wsn-cta').getBoundingClientRect();return brand.right>cta.left+1})()};})()`);
    if(result.headingOverflow||result.scriptOverlap||result.navOverlap)throw Error(JSON.stringify({width,design,font,...result}));
    results.push({width,design,key:font,...result});
   }
  }
 }
 await fs.writeFile(path.join(dir,'evidence/client-design-geometry.json'),JSON.stringify({combinations:results.length,fonts,designs,results},null,2));
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:1000,deviceScaleFactor:1,mobile:false});
 await setSelect('Fixture design','heritage');await setSelect('Fixture font','playfair');
 await evaluate(`document.querySelector('.ws').scrollTo({top:0,behavior:'instant'})`);await pause(500);
 let shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(dir,'client-design-after-mobile.png'),Buffer.from(shot.result.data,'base64'));
 // Exercise the early search without submitting a reservation.
 const dates=await evaluate(`(async()=>{const c=await(await fetch('http://localhost:4000/api/sites/chyasal-house/stays/availability')).json();return c.dates.filter(d=>d>c.today).slice(0,3);})()`);
 await evaluate(`(()=>{const f=document.querySelector('.ws-stay-search'),inputs=f.querySelectorAll('input[type=date]');[${JSON.stringify(dates[0])},${JSON.stringify(dates[2])}].forEach((v,i)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(inputs[i],v);inputs[i].dispatchEvent(new Event('input',{bubbles:true}));});})()`);await pause(150);
 await evaluate(`document.querySelector('.ws-stay-search').requestSubmit()`);await pause(1400);
 const search=await evaluate(`({hash:location.hash,checkin:document.querySelector('.rb-day.is-in')?.getAttribute('aria-label'),summary:document.querySelector('.rb-cal-foot').textContent,tabsTop:document.querySelector('.ws-desk-tabs').getBoundingClientRect().top,headerBottom:document.querySelector('.wsn').getBoundingClientRect().bottom})`);
 if(search.hash!=='#stay'||!search.checkin||!search.summary.includes('2 nights'))throw Error('Early search failed: '+JSON.stringify(search));
 if(search.tabsTop<search.headerBottom)throw Error('Booking tabs behind header: '+JSON.stringify(search));
 shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(dir,'client-booking-after-mobile.png'),Buffer.from(shot.result.data,'base64'));
 // Keyboard navigation selects the next booking panel.
 await evaluate(`document.querySelector('.ws-desk-tabs [aria-selected=true]').focus()`);
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight'});await pause(100);
 const keyboard=await evaluate(`document.activeElement.getAttribute('aria-selected')==='true'&&document.activeElement.id!=='ws-desk-tab-stay'`);
 if(!keyboard)throw Error('Booking tab keyboard navigation failed');
 await setSelect('Fixture motion','none');await pause(250);
 const none=await evaluate(`getComputedStyle(document.querySelector('.ws')).scrollBehavior==='auto'`);
 if(!none)throw Error('Motion none failed');
 if(errors.length)throw Error(JSON.stringify(errors));
 await fs.writeFile(path.join(dir,'evidence/client-design-matrix.json'),JSON.stringify({combinations:results.length,fonts,designs,results,search,keyboard,motionNone:none,errors},null,2));
 console.log(JSON.stringify({combinations:results.length,fonts:fonts.length,designs:designs.length,search,keyboard,motionNone:none,errors}));
}finally{ws?.close();chrome.kill();await pause(500);if(path.dirname(profile)!==dir)throw Error('Invalid profile');try{await fs.rm(profile,{recursive:true,force:true});}catch{}}

