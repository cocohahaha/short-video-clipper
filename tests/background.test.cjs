const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),url='https://video.twimg.com/a.mp4',webURL='https://media.example.net/video.webm?token=a%2Fb';
const plain=value=>JSON.parse(JSON.stringify(value));
const linkedinPage='https://www.linkedin.com/feed/update/urn:li:activity:7472423970055647232/';
const linkedinURL='https://dms.licdn.com/video/target.mp4?token=A%2FB';
const linkedinHTML='<!doctype html><article data-activity-urn="urn:li:activity:7472423970055647232"><video data-sources=\'[{"src":"'+linkedinURL+'","type":"video/mp4","data-bitrate":1200000}]\'></video></article>';
function setup({tabURL='https://x.com/u/status/123',found=true,fail=false,snapshotURL,mediaURL=url,mime='video/mp4',source='page',enabled=false,navigateDuringSnapshot=false,fetchError,fetchBody=linkedinHTML,fetchStatus=200,fetchType='text/html',navigateDuringFetch=false,fetchDeclaredSize,snapshotPosts,fetchOutcomes=[]}={}) {
 let listener,changed,permissionRemoved,store={},downloadArgs,grant=enabled;
 const registrations=new Map(),executions=[],sent=[],fetches=[],fetchStats={active:0,max:0};
 const tabs=[{id:1,url:tabURL},{id:2,url:'https://x.com/u/status/123'}];
 const chrome={runtime:{id:'self',getURL:name=>'chrome-extension://self/'+name,onMessage:{addListener:f=>listener=f},onInstalled:{addListener:()=>{}},onStartup:{addListener:()=>{}}},
   tabs:{get:async id=>{const t=tabs.find(t=>t.id===id);if(!t)throw Error('No tab');return t;},query:async query=>query.active?[tabs[0]]:tabs,sendMessage:async(id,msg)=>{
     sent.push({id,msg});if(msg.type!=='SNAPSHOT')return {ok:true};const info=ctx.XClipCore.pageInfo(snapshotURL || tabs.find(t=>t.id===id).url);
     if(navigateDuringSnapshot)tabs.find(t=>t.id===id).url='https://x.com/u/status/999';
     return {ok:true,pageKey:info.key,platform:info.platform,id:info.id,label:info.label,filename:'sample',posts:snapshotPosts,media:found?[{key:'m1',source,variants:[{url:mediaURL,mime,width:1920,height:1080}]}]:[]};
   }},
   scripting:{executeScript:async args=>{executions.push(plain(args));return [];},getRegisteredContentScripts:async()=>[...registrations.values()],
     registerContentScripts:async list=>{for(const item of list){if(registrations.has(item.id))throw Error('Duplicate script');registrations.set(item.id,plain(item));}},
     unregisterContentScripts:async({ids}={})=>{if(ids)for(const id of ids)registrations.delete(id);else registrations.clear();}},
   permissions:{contains:async()=>grant,getAll:async()=>({origins:grant?[new URL(tabURL).origin+'/*']:[]}),remove:async()=>{grant=false;return true;},
     onRemoved:{addListener:f=>permissionRemoved=f},onAdded:{addListener:()=>{}}},
   downloads:{download:async args=>{downloadArgs=args;if(fail)throw Error('USER_CANCELED');return 5;},search:async()=>[{state:'complete'}],onChanged:{addListener:f=>changed=f}},
   storage:{local:{set:async value=>Object.assign(store,value),get:async()=>store}}};
 const fetch=async(value,options)=>{
   const index=fetches.length,outcome=fetchOutcomes[index] || {};fetches.push({url:String(value),options});fetchStats.active++;fetchStats.max=Math.max(fetchStats.max,fetchStats.active);
   try {
    await new Promise(resolve=>setImmediate(resolve));if(outcome.error || fetchError)throw Error(outcome.error || fetchError);
    if(navigateDuringFetch)tabs[0].url='https://www.linkedin.com/feed/update/urn:li:activity:999/';
    return new Response(outcome.body ?? fetchBody,{status:outcome.status ?? fetchStatus,headers:{'content-type':outcome.type ?? fetchType,...(fetchDeclaredSize?{'content-length':String(fetchDeclaredSize)}:{})}});
   } finally {fetchStats.active--;}
 };
 const ctx=vm.createContext({chrome,URL,Date,console,fetch,Request,Response,Headers,AbortController,AbortSignal,TextEncoder,TextDecoder,Uint8Array,setTimeout,clearTimeout});ctx.importScripts=name=>vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),ctx);
 vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),ctx);
 const send=(msg,sender={id:'self',url:'chrome-extension://self/popup.html'})=>new Promise(resolve=>{const result=listener(msg,sender,resolve);if(result!==true)resolve(undefined);});
 const save={type:'SAVE',tabId:1,pageKey:ctx.XClipCore.pageInfo(tabURL).key,mediaKey:'m1',url:mediaURL,filename:'../clip',saveAs:false};
 return {send,save,store,tabs,executions,sent,registrations,fetches,fetchStats,grant:value=>grant=value,args:()=>downloadArgs,changed,permissionRemoved};
}
test('background verifies page and selected media before safe download options',async()=>{
 const s=setup();assert.equal((await s.send(s.save)).ok,true);assert.equal(s.args().url,url);assert.equal(s.args().filename,'-clip.mp4');assert.equal(s.args().saveAs,false);assert.equal(s.args().conflictAction,'uniquify');assert.equal(s.store.lastDownload.state,'complete');
});
test('navigation or stale snapshot prevents an old page download',async()=>{
 const s=setup();s.tabs[0].url='https://x.com/u/status/456';assert.equal((await s.send(s.save)).ok,false);assert.equal(s.args(),undefined);
 const stale=setup({snapshotURL:'https://x.com/u/status/456'});assert.equal((await stale.send(stale.save)).ok,false);assert.equal(stale.args(),undefined);
});
test('navigation during asynchronous snapshot is checked again before downloading',async()=>{
 const s=setup({navigateDuringSnapshot:true});assert.equal((await s.send(s.save)).ok,false);assert.equal(s.args(),undefined);
});
test('missing media key and unobserved variant cannot trigger download',async()=>{
 for(const extra of [{mediaKey:'other'},{url:'https://video.twimg.com/unobserved.mp4'}]){const s=setup();assert.equal((await s.send({...s.save,...extra})).ok,false);assert.equal(s.args(),undefined);}
 const s=setup({found:false});assert.equal((await s.send(s.save)).ok,false);assert.equal(s.args(),undefined);
});
test('download cancellation is surfaced and foreign extension messages ignored',async()=>{
 const s=setup({fail:true});assert.equal((await s.send(s.save)).error,'已取消保存。');assert.equal(await s.send(s.save,{id:'other'}),undefined);
});
test('floating save uses sender tab and cannot select another tab',async()=>{
 const s=setup({tabURL:'https://x.com/home'});const msg={...s.save,tabId:1,pageKey:'https://x.com/u/status/123'};
 assert.equal((await s.send(msg,{id:'self',url:'https://x.com/u/status/123',tab:s.tabs[1]})).ok,true);
});
test('generic DOM media retains signed URL and saves selected WebM extension',async()=>{
 const s=setup({tabURL:'https://videos.example.net/watch#clip',mediaURL:webURL,mime:'video/webm',source:'dom'});
 assert.equal((await s.send({...s.save,filename:'旅行片段.mp4'})).ok,true);assert.equal(s.args().url,webURL);assert.equal(s.args().filename,'旅行片段.webm');
});
test('Instagram DOM fallback accepts a direct public video outside structured CDN list',async()=>{
 const s=setup({tabURL:'https://www.instagram.com/reel/Abc_12/',mediaURL:webURL,mime:'video/webm',source:'dom'});
 assert.equal((await s.send(s.save)).ok,true);assert.equal(s.args().filename,'-clip.webm');
});
test('unsafe private-network URL is rejected even if present in a claimed DOM snapshot',async()=>{
 const s=setup({tabURL:'https://videos.example.net/watch',mediaURL:'https://127.0.0.1/video.mp4',source:'dom'});
 assert.equal((await s.send(s.save)).ok,false);assert.equal(s.args(),undefined);
});
test('popup PREPARE injects only current tab with separate MAIN and isolated worlds',async()=>{
 const s=setup({tabURL:'https://videos.example.net/watch'});assert.equal((await s.send({type:'PREPARE',tabId:1})).ok,true);
 assert.ok(s.executions.some(e=>e.target.tabId===1 && e.world==='MAIN' && e.files.includes('observer.js')));
 assert.ok(s.executions.some(e=>e.target.tabId===1 && e.world==='ISOLATED' && e.files.includes('content.js')));
 assert.equal(s.registrations.size,0);
});
test('page content cannot inject scripts or change permanent site permissions',async()=>{
 const s=setup({tabURL:'https://videos.example.net/watch',enabled:true});
 for(const type of ['PREPARE','ENABLE_SITE','DISABLE_SITE'])assert.equal((await s.send({type,tabId:1},{id:'self',url:s.tabs[0].url,tab:s.tabs[0]})).ok,false);
 assert.equal(s.executions.length,0);assert.equal(s.registrations.size,0);
});
test('a grant without registered scripts is reported separately from automatic detection',async()=>{
 const s=setup({tabURL:'https://videos.example.net/watch',enabled:true});const status=await s.send({type:'SITE_STATUS',tabId:1});
 assert.equal(status.granted,true);assert.equal(status.enabled,false);
});
test('persistent site enable requires a granted exact origin and registers both worlds',async()=>{
 const s=setup({tabURL:'https://videos.example.net/watch'});
 assert.equal((await s.send({type:'ENABLE_SITE',tabId:1})).ok,false);assert.equal(s.registrations.size,0);
 s.grant(true);assert.equal((await s.send({type:'ENABLE_SITE',tabId:1})).ok,true);assert.equal(s.registrations.size,2);
 const registered=[...s.registrations.values()];
 assert.ok(registered.some(v=>v.world==='MAIN'));assert.ok(registered.some(v=>v.world==='ISOLATED'));
 for(const script of registered){assert.deepEqual(script.matches,['https://videos.example.net/*']);assert.equal(script.persistAcrossSessions,true);assert.notEqual(script.allFrames,true);}
 assert.equal((await s.send({type:'SITE_STATUS',tabId:1})).enabled,true);
 assert.equal((await s.send({type:'ENABLE_SITE',tabId:1})).ok,true);assert.equal(s.registrations.size,2);
});
test('site disable removes registrations and hides current floating button',async()=>{
 const s=setup({tabURL:'https://videos.example.net/watch',enabled:true});await s.send({type:'ENABLE_SITE',tabId:1});
 assert.equal((await s.send({type:'DISABLE_SITE',tabId:1})).ok,true);assert.equal(s.registrations.size,0);
 assert.equal((await s.send({type:'SITE_STATUS',tabId:1})).enabled,false);
 assert.ok(s.sent.some(v=>v.msg.type==='FLOAT_MODE' && v.msg.enabled===false));
});
test('site disable broadcasts the shared host pattern to pages on different ports',async()=>{
 const s=setup({tabURL:'https://videos.example.net:8443/watch',enabled:true});
 s.tabs.push({id:3,url:'https://videos.example.net:9443/another-video'});
 await s.send({type:'ENABLE_SITE',tabId:1});
 const result=await s.send({type:'DISABLE_SITE',tabId:1});
 assert.equal(result.ok,true);assert.equal(result.granted,false);assert.equal(result.enabled,false);
 assert.equal(s.registrations.size,0);
 for(const tabId of [1,3])assert.ok(s.sent.some(v=>v.id===tabId && v.msg.type==='FLOAT_MODE' && v.msg.revoke && v.msg.pattern==='https://videos.example.net/*'));
});
test('browser permission removal unregisters scripts and broadcasts the permission pattern',async()=>{
 const s=setup({tabURL:'https://videos.example.net:8443/watch',enabled:true});
 await s.send({type:'ENABLE_SITE',tabId:1});s.grant(false);
 await s.permissionRemoved({origins:['https://videos.example.net/*']});
 assert.equal(s.registrations.size,0);
 assert.ok(s.sent.some(v=>v.msg.type==='FLOAT_MODE' && v.msg.revoke && v.msg.pattern==='https://videos.example.net/*'));
});
test('a granted site without registered scripts can be revoked and reports no remaining access',async()=>{
 const s=setup({tabURL:'https://videos.example.net/watch',enabled:true});
 const before=await s.send({type:'SITE_STATUS',tabId:1});assert.equal(before.granted,true);assert.equal(before.enabled,false);
 const result=await s.send({type:'DISABLE_SITE',tabId:1});
 assert.equal(result.ok,true);assert.equal(result.granted,false);assert.equal(result.enabled,false);
 const after=await s.send({type:'SITE_STATUS',tabId:1});assert.equal(after.granted,false);assert.equal(after.enabled,false);
});
test('fixed X permissions are reported and cannot be removed by site toggle',async()=>{
 const s=setup();const status=await s.send({type:'SITE_STATUS',tabId:1});assert.equal(status.fixed,true);assert.equal(status.enabled,true);
 assert.equal((await s.send({type:'DISABLE_SITE',tabId:1})).ok,false);
});
test('LinkedIn late activation fetches only the current public HTML without credentials',async()=>{
 const s=setup({tabURL:linkedinPage,found:false});const result=await s.send({type:'PREPARE',tabId:1});
 assert.equal(result.ok,true);assert.equal(s.fetches.length,1);assert.equal(s.fetches[0].url,linkedinPage);
 const options=s.fetches[0].options;assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
 assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.cache,'no-store');assert.ok(!options.method || options.method==='GET');
 assert.ok(options.signal,'public HTML fetch must be abortable');assert.equal(options.headers?.Cookie,undefined);assert.equal(options.headers?.Authorization,undefined);
 const delivered=s.sent.find(value=>value.id===1 && value.msg.type==='LINKEDIN_HTML');
 assert.ok(delivered);assert.equal(delivered.msg.pageKey,linkedinPage);assert.equal(delivered.msg.html,linkedinHTML);
 assert.ok(s.executions.some(value=>value.world==='ISOLATED' && value.files.includes('linkedin.js')));
});
test('LinkedIn already-discovered direct media skips public HTML fetch',async()=>{
 const s=setup({tabURL:linkedinPage,mediaURL:linkedinURL});const result=await s.send({type:'PREPARE',tabId:1});
 assert.equal(result.ok,true);assert.equal(s.fetches.length,0);assert.equal(s.sent.some(value=>value.msg.type==='LINKEDIN_HTML'),false);
});
test('explicit LinkedIn re-detection refreshes public media even when a signed candidate is cached',async()=>{
 const s=setup({tabURL:linkedinPage,mediaURL:linkedinURL});const result=await s.send({type:'PREPARE',tabId:1,refreshLinkedIn:true});
 assert.equal(result.ok,true);assert.equal(s.fetches.length,1);assert.ok(s.sent.some(v=>v.msg.type==='LINKEDIN_HTML'));
});
test('public HTML fallback is never requested for other platforms or LinkedIn pages without visible post candidates',async()=>{
 for(const tabURL of ['https://x.com/u/status/123','https://www.instagram.com/reel/Abc/','https://videos.example.net/watch','https://www.linkedin.com/feed/','https://www.linkedin.com/company/example/']) {
  const s=setup({tabURL,found:false});const result=await s.send({type:'PREPARE',tabId:1});assert.equal(result.ok,true);
  assert.equal(s.fetches.length,0,tabURL);assert.equal(s.sent.some(value=>value.msg.type==='LINKEDIN_HTML'),false,tabURL);
 }
});
test('a LinkedIn navigation during HTML fetch discards the old page payload',async()=>{
 const s=setup({tabURL:linkedinPage,found:false,navigateDuringFetch:true});const result=await s.send({type:'PREPARE',tabId:1});
 assert.equal(result.ok,true);assert.equal(s.fetches.length,1);assert.equal(s.sent.some(value=>value.msg.type==='LINKEDIN_HTML'),false);
 assert.ok(typeof result.warning==='string' && result.warning.length);
});
test('a LinkedIn navigation during its initial snapshot prevents a fallback request for the old page',async()=>{
 const s=setup({tabURL:linkedinPage,found:false,navigateDuringSnapshot:true});const result=await s.send({type:'PREPARE',tabId:1});
 assert.equal(result.ok,true);assert.equal(s.fetches.length,0);assert.equal(s.sent.some(value=>value.msg.type==='LINKEDIN_HTML'),false);
 assert.ok(typeof result.warning==='string' && result.warning.length);
});
test('LinkedIn HTML failures and non-HTML responses return a warning without breaking popup preparation',async()=>{
 for(const options of [{fetchError:'Failed to fetch'},{fetchStatus:403},{fetchType:'application/json'},{fetchDeclaredSize:2*1024*1024+1},{fetchBody:'a'.repeat(2*1024*1024+1)},{fetchBody:'中'.repeat(700000)}]) {
  const s=setup({tabURL:linkedinPage,found:false,...options});const result=await s.send({type:'PREPARE',tabId:1});
  assert.equal(result.ok,true);assert.ok(typeof result.warning==='string' && result.warning.length,JSON.stringify(options).slice(0,100));
  assert.equal(s.sent.some(value=>value.msg.type==='LINKEDIN_HTML'),false);
 }
});
test('LinkedIn selected signed MP4 is revalidated and saved while spoofed CDN is rejected',async()=>{
 const s=setup({tabURL:linkedinPage,mediaURL:linkedinURL});assert.equal((await s.send(s.save)).ok,true);assert.equal(s.args().url,linkedinURL);
 const bad=setup({tabURL:linkedinPage,mediaURL:'https://dms.licdn.com.evil.net/target.mp4'});
 assert.equal((await bad.send(bad.save)).ok,false);assert.equal(bad.args(),undefined);
});
test('LinkedIn feed fetches at most five unique visible activities sequentially using internally constructed same-origin URLs',async()=>{
 const ids=['7472423970055647232','7472423970055647233','7472423970055647234','7472423970055647235','7472423970055647236','7472423970055647237'];
 const posts=[{id:ids[0],url:'https://evil.net/private'},{id:ids[0],url:'https://www.linkedin.com/other'},...ids.slice(1).map(id=>({id,url:'https://evil.net/ignore-me'})),{id:'urn:li:activity:999'},{id:'123bad'}];
 const page='https://www.linkedin.com/feed/';const s=setup({tabURL:page,found:false,snapshotPosts:posts});
 const result=await s.send({type:'PREPARE',tabId:1});assert.equal(result.ok,true);assert.equal(s.fetches.length,5);assert.equal(s.fetchStats.max,1);
 assert.deepEqual(s.fetches.map(value=>value.url),ids.slice(0,5).map(id=>`https://www.linkedin.com/feed/update/urn:li:activity:${id}/`));
 for(const value of s.fetches){assert.equal(value.options.credentials,'omit');assert.equal(value.options.redirect,'error');assert.equal(value.options.referrerPolicy,'no-referrer');}
 const delivered=s.sent.filter(value=>value.msg.type==='LINKEDIN_HTML');assert.equal(delivered.length,5);
 assert.deepEqual(delivered.map(value=>value.msg.ownerId),ids.slice(0,5));assert.ok(delivered.every(value=>value.msg.pageKey===page && value.id===1));
});
test('a failed LinkedIn feed post leaves other visible videos detectable',async()=>{
 const page='https://www.linkedin.com/feed/',ids=['7472423970055647232','7472423970055647233'];
 const s=setup({tabURL:page,found:false,snapshotPosts:ids.map(id=>({id})),fetchOutcomes:[{status:403},{body:linkedinHTML}]});
 const result=await s.send({type:'PREPARE',tabId:1});assert.equal(result.ok,true);assert.equal(s.fetches.length,2);
 const delivered=s.sent.filter(value=>value.msg.type==='LINKEDIN_HTML');assert.equal(delivered.length,1);assert.equal(delivered[0].msg.ownerId,ids[1]);
 assert.ok(typeof result.warning==='string' && result.warning.length);
});
test('feed navigation during public HTML read prevents old-post payloads and additional reads',async()=>{
 const s=setup({tabURL:'https://www.linkedin.com/feed/',found:false,snapshotPosts:[{id:'7472423970055647232'},{id:'7472423970055647233'}],navigateDuringFetch:true});
 const result=await s.send({type:'PREPARE',tabId:1});assert.equal(result.ok,true);assert.equal(s.fetches.length,1);
 assert.equal(s.sent.some(value=>value.msg.type==='LINKEDIN_HTML'),false);assert.ok(result.warning);
});
