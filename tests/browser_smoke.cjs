/* Real MV3 and fixture pages, never the user's Chrome profile.
   Run: node tests/browser_smoke.cjs (requires Playwright and cached Chromium).
   The isolated test copy adds fixture-only host permissions because headless
   Chrome cannot click the toolbar to grant activeTab. Download API and optional
   permission consent are stubbed; script registration/unregistration is real.
   This does not verify actual platform delivery or Chrome permission dialogs. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..'),work=path.resolve(root,'../../../work/2026-10-12');
const url='https://video.twimg.com/ext_tw_video/123/pu/vid/1280x720/test.mp4';
const low='https://video.twimg.com/ext_tw_video/123/pu/vid/320x180/test.mp4';
const igURL='https://scontent.cdninstagram.com/video.mp4?signature=A%2FB';
const ttURL='https://v16-web.tiktokcdn.com/direct/video?token=A%2FB';
const webURL='https://media.example.net/clip.webm?signature=A%2FB';
const fixture=(id='123',hls=false)=>({data:{tweet:{rest_id:id,legacy:{extended_entities:{media:[{id_str:'m1',type:'video',video_info:{variants:hls?
  [{url:'https://video.twimg.com/test.m3u8',content_type:'application/x-mpegURL'}]:
  [{url,bitrate:2176000,content_type:'video/mp4'},{url:low,bitrate:256000,content_type:'video/mp4'}]}}]}}}}});
const html=body=>'<!doctype html><html><head><title>合成视频测试</title></head><body>'+body+'</body></html>';
const script=(data,id='initial-json')=>`<script type="application/json" id="${id}">${JSON.stringify(data)}</script>`;
(async()=>{
 fs.mkdirSync(work,{recursive:true});const temp=fs.mkdtempSync(path.join(work,'multi-site-chrome-'));
 const tested=path.join(temp,'extension');fs.cpSync(root,tested,{recursive:true});
 const manifest=JSON.parse(fs.readFileSync(path.join(tested,'manifest.json')));
 manifest.host_permissions.push('https://www.instagram.com/*','https://www.tiktok.com/*','https://videos.example.net/*');
 fs.writeFileSync(path.join(tested,'manifest.json'),JSON.stringify(manifest));
 let context;
 try {
  context=await chromium.launchPersistentContext(path.join(temp,'profile'),{...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{channel:'chromium'}),headless:true,ignoreDefaultArgs:['--disable-extensions'],
   args:[`--disable-extensions-except=${tested}`,`--load-extension=${tested}`],viewport:{width:1000,height:800}});
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const ext=worker.url().split('/')[2];
  await worker.evaluate(async()=>{
   globalThis.testDownloads=[];chrome.downloads.download=async args=>{testDownloads.push(args);return 42;};
   chrome.downloads.search=async()=>[{state:'complete'}];globalThis.testGrant=false;
   chrome.permissions.contains=async({origins})=>origins.every(v=>v.startsWith('https://x.com/')||v.startsWith('https://twitter.com/'))||testGrant;
   chrome.permissions.getAll=async()=>({origins:testGrant?['https://videos.example.net/*']:[]});
   chrome.permissions.remove=async()=>{testGrant=false;return true;};await chrome.storage.local.set({quality:'best',saveAs:false});
   globalThis.testTrace=[];
   for(const [group,name] of [['tabs','get'],['tabs','sendMessage'],['scripting','executeScript']]){
    const original=chrome[group][name];chrome[group][name]=async(...args)=>{testTrace.push({group,name,args,start:true});try{const result=await original.apply(chrome[group],args);testTrace.push({group,name,done:true});return result;}catch(e){testTrace.push({group,name,error:e.message});throw e;}};
   }
  });
  const errors=[];
  const newPage=async()=>{const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));return page;};
  const page=await newPage();
  await context.route('**/*',async route=>{
   const value=route.request().url();
   if(value.startsWith('chrome-extension://')){await route.continue();return;}
   if(['media','image'].includes(route.request().resourceType())){await route.fulfill({status:404,body:'Synthetic media has no bytes'});return;}
   let body;
   if(value.startsWith('https://x.com/')) {
    if(value.includes('/fixture.json')) {await route.fulfill({contentType:'application/json',body:JSON.stringify(fixture())});return;}
    body=html('<h1>Fixture tweet</h1><script>fetch("/fixture.json").then(r=>r.json())</script>');
   } else if(value.startsWith('https://www.instagram.com/')) {
    body=html('<h1>Fixture Instagram reel</h1>'+script({data:{shortcode_media:{shortcode:'Abc_12',id:'ig1',is_video:true,video_url:igURL}}}));
   } else if(value.startsWith('https://www.tiktok.com/')) {
    body=html('<h1>Fixture TikTok video</h1>'+script({__DEFAULT_SCOPE__:{'webapp.video-detail':{itemInfo:{itemStruct:{id:'123456789',video:{playAddr:ttURL,downloadAddr:'https://v16-web.tiktokcdn.com/download.mp4',width:720,height:1280}}}}}},'__UNIVERSAL_DATA_FOR_REHYDRATION__'));
   } else if(value.startsWith('https://videos.example.net/')) {
    body=html(`<h1>Fixture ordinary video page</h1><video preload="none"><source src="${webURL}" type="video/webm"></video><video preload="none" src="https://media.example.net/second.mp4"></video>`);
   } else {await route.fulfill({status:404,body:'No real network in synthetic tests'});return;}
   await route.fulfill({contentType:'text/html',body});
  });
  const tabID=async page=>worker.evaluate(async value=>{const tab=(await chrome.tabs.query({})).find(t=>t.url===value);if(!tab)throw Error(`Fixture tab unavailable: ${value}`);return tab.id;},page.url());
  const snapshot=async tid=>worker.evaluate(async id=>chrome.tabs.sendMessage(id,{type:'SNAPSHOT'}),tid);
  const popupFor=async(tid,tabURL)=>{
   const popup=await newPage();await popup.addInitScript('chrome.tabs.query=async()=>'+JSON.stringify([{id:tid,url:tabURL}])+';');
   await popup.goto(`chrome-extension://${ext}/popup.html`);await popup.waitForLoadState('networkidle');return popup;
  };
  const send=async(popup,msg)=>popup.evaluate(async msg=>chrome.runtime.sendMessage(msg),msg);
  const ready=async popup=>{try{await popup.waitForFunction(()=>document.querySelector('#save').disabled===false,{},{timeout:10000});}catch(error){console.error('Popup readiness diagnostics:',await popup.evaluate(()=>({status:document.querySelector('#status')?.textContent,body:document.body.innerText,saveDisabled:document.querySelector('#save')?.disabled})));console.error('Worker trace:',await worker.evaluate('testTrace'));console.error('Page errors:',errors);throw error;}};
  await page.goto('https://x.com/test/status/123');await page.waitForLoadState('networkidle');
  await page.waitForSelector('#vclip-floating',{state:'visible',timeout:5000});let tid=await tabID(page);
  let data=await snapshot(tid);assert.equal(data.ok,true);assert.equal(data.media[0].variants.length,2);assert.equal(data.media[0].variants[0].height,720);
  const box=await page.locator('#vclip-floating').boundingBox();await page.mouse.click(box.x+box.width/2,box.y+20);
  await page.waitForTimeout(350);assert.equal((await worker.evaluate('testDownloads')).length,1);
  let popup=await popupFor(tid,page.url());await ready(popup);
  await popup.locator('#quality').selectOption(low);await popup.locator('#filename').fill('旅行片段');
  await popup.evaluate(()=>document.querySelector('#form').requestSubmit());
  await popup.waitForFunction(()=>document.querySelector('#status').textContent.includes('已提交'));
  const args=await worker.evaluate('testDownloads.at(-1)');assert.equal(args.url,low);assert.equal(args.filename,'旅行片段.mp4');assert.equal(args.saveAs,false);
  await popup.close();await page.evaluate(()=>history.pushState({},'', '/test/status/456'));
  const stale=await snapshot(tid);assert.equal(stale.id,'456');assert.deepEqual(stale.media,[]);
  await context.route('https://x.com/hls.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(fixture('456',true))}));
  await page.evaluate(()=>fetch('/hls.json').then(r=>r.json()));await page.waitForTimeout(200);
  const hls=await snapshot(tid);assert.equal(hls.media[0].hls,true);assert.deepEqual(hls.media[0].variants,[]);
  await page.evaluate(()=>history.pushState({},'', '/test/status/789'));
  await context.route('https://x.com/xhr.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(fixture('789'))}));
  assert.equal(await page.evaluate(()=>new Promise((resolve,reject)=>{const x=new XMLHttpRequest();x.open('GET','/xhr.json');x.responseType='json';x.onload=()=>resolve(x.response.data.tweet.rest_id);x.onerror=reject;x.send();})),'789');
  const observed=await snapshot(tid);assert.equal(observed.id,'789');assert.equal(observed.media[0].variants[0].url,url);
  for(const [target,platform,expected] of [['https://www.instagram.com/reel/Abc_12/','instagram',igURL],['https://www.tiktok.com/@fixture/video/123456789','tiktok',ttURL]]) {
   await page.goto(target);await page.waitForLoadState('networkidle');tid=await tabID(page);
   assert.equal(await page.locator('#vclip-floating').count(),0);popup=await popupFor(tid,target);await ready(popup);
   data=await snapshot(tid);assert.equal(data.platform,platform);assert.equal(data.pageKey,target);
   assert.ok(data.media.some(m=>m.variants.some(v=>v.url===expected)));
   assert.equal(await page.locator('#vclip-floating:visible').count(),0);await popup.close();
  }
  await page.goto('https://videos.example.net/watch#first');await page.waitForLoadState('networkidle');tid=await tabID(page);
  popup=await popupFor(tid,page.url());await ready(popup);data=await snapshot(tid);assert.equal(data.platform,'web');assert.equal(data.media.length,2);
  const selected=data.media.find(m=>m.variants.some(v=>v.url===webURL));assert.equal(selected.source,'dom');
  const other=data.media.find(m=>m.key!==selected.key);
  await popup.locator('#media').selectOption(selected.key);await popup.locator('#quality').selectOption(webURL);await popup.locator('#filename').fill('我的 WebM 片段');
  await popup.locator('#media').selectOption(other.key);await popup.locator('#filename').fill('第二段');
  await popup.locator('#media').selectOption(selected.key);assert.equal(await popup.locator('#quality').inputValue(),webURL);assert.equal(await popup.locator('#filename').inputValue(),'我的 WebM 片段');
  await popup.locator('#refresh').click();await ready(popup);assert.equal(await popup.locator('#quality').inputValue(),webURL);assert.equal(await popup.locator('#filename').inputValue(),'我的 WebM 片段');
  assert.equal((await send(popup,{type:'SAVE',tabId:tid,pageKey:data.pageKey,mediaKey:selected.key,url:webURL,filename:'通用视频.mp4',saveAs:false})).ok,true);
  assert.equal(await worker.evaluate('testDownloads.at(-1).filename'),'通用视频.webm');
  await popup.locator('body').screenshot({path:path.join(root,'../short-video-clipper-popup-preview.png')});
  await page.evaluate(()=>window.__beforePrepareFetch=window.fetch);
  for(let i=0;i<2;i++)assert.equal((await send(popup,{type:'PREPARE',tabId:tid})).ok,true);
  assert.equal(await page.evaluate(()=>window.__beforePrepareFetch===window.fetch),true);
  assert.equal(await page.locator('#vclip-floating').count(),1);
  assert.equal((await send(popup,{type:'ENABLE_SITE',tabId:tid})).ok,false);await worker.evaluate('testGrant=true');
  assert.equal((await send(popup,{type:'ENABLE_SITE',tabId:tid})).ok,true);
  const registrations=await worker.evaluate(()=>chrome.scripting.getRegisteredContentScripts());assert.equal(registrations.length,2);
  assert.deepEqual(new Set(registrations.map(v=>v.world)),new Set(['MAIN','ISOLATED']));
  assert.ok(registrations.every(v=>JSON.stringify(v.matches)===JSON.stringify(['https://videos.example.net/*'])));
  await page.waitForSelector('#vclip-floating',{state:'visible'});assert.equal(await page.locator('#vclip-floating').count(),1);
  assert.equal((await send(popup,{type:'DISABLE_SITE',tabId:tid})).ok,true);
  assert.deepEqual(await worker.evaluate(()=>chrome.scripting.getRegisteredContentScripts()),[]);
  assert.equal(await page.locator('#vclip-floating:visible').count(),0);
  const before=await snapshot(tid);
  await page.evaluate(()=>{document.querySelectorAll('video').forEach(v=>v.remove());history.pushState({},'', '/watch#second');});
  const after=await snapshot(tid);assert.notEqual(after.pageKey,before.pageKey);assert.deepEqual(after.media,[]);
  assert.equal((await send(popup,{type:'SAVE',tabId:tid,pageKey:before.pageKey,mediaKey:selected.key,url:webURL,filename:'stale',saveAs:false})).ok,false);
  assert.deepEqual(errors,[]);
  console.log('PASS: real MV3 load, X fetch/XHR and popup/floating regression, Instagram/TikTok initial JSON, ordinary multi-video/WebM, signed URL, SPA reset, repeated injection, dynamic script register/remove. Fixture-only host permissions; downloads and consent stubbed.');
 } finally {if(context)await context.close();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
