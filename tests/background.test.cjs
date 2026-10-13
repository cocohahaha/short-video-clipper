const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),url='https://video.twimg.com/a.mp4',webURL='https://media.example.net/video.webm?token=a%2Fb';
const plain=value=>JSON.parse(JSON.stringify(value));
function setup({tabURL='https://x.com/u/status/123',found=true,fail=false,snapshotURL,mediaURL=url,mime='video/mp4',source='page',enabled=false,navigateDuringSnapshot=false}={}) {
 let listener,changed,permissionRemoved,store={},downloadArgs,grant=enabled;
 const registrations=new Map(),executions=[],sent=[];
 const tabs=[{id:1,url:tabURL},{id:2,url:'https://x.com/u/status/123'}];
 const chrome={runtime:{id:'self',getURL:name=>'chrome-extension://self/'+name,onMessage:{addListener:f=>listener=f},onInstalled:{addListener:()=>{}},onStartup:{addListener:()=>{}}},
   tabs:{get:async id=>{const t=tabs.find(t=>t.id===id);if(!t)throw Error('No tab');return t;},query:async query=>query.active?[tabs[0]]:tabs,sendMessage:async(id,msg)=>{
     sent.push({id,msg});if(msg.type!=='SNAPSHOT')return {ok:true};const info=ctx.XClipCore.pageInfo(snapshotURL || tabs.find(t=>t.id===id).url);
     if(navigateDuringSnapshot)tabs.find(t=>t.id===id).url='https://x.com/u/status/999';
     return {ok:true,pageKey:info.key,platform:info.platform,id:info.id,label:info.label,filename:'sample',media:found?[{key:'m1',source,variants:[{url:mediaURL,mime,width:1920,height:1080}]}]:[]};
   }},
   scripting:{executeScript:async args=>{executions.push(plain(args));return [];},getRegisteredContentScripts:async()=>[...registrations.values()],
     registerContentScripts:async list=>{for(const item of list){if(registrations.has(item.id))throw Error('Duplicate script');registrations.set(item.id,plain(item));}},
     unregisterContentScripts:async({ids}={})=>{if(ids)for(const id of ids)registrations.delete(id);else registrations.clear();}},
   permissions:{contains:async()=>grant,getAll:async()=>({origins:grant?[new URL(tabURL).origin+'/*']:[]}),remove:async()=>{grant=false;return true;},
     onRemoved:{addListener:f=>permissionRemoved=f},onAdded:{addListener:()=>{}}},
   downloads:{download:async args=>{downloadArgs=args;if(fail)throw Error('USER_CANCELED');return 5;},search:async()=>[{state:'complete'}],onChanged:{addListener:f=>changed=f}},
   storage:{local:{set:async value=>Object.assign(store,value),get:async()=>store}}};
 const ctx=vm.createContext({chrome,URL,Date,console});ctx.importScripts=name=>vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),ctx);
 vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),ctx);
 const send=(msg,sender={id:'self',url:'chrome-extension://self/popup.html'})=>new Promise(resolve=>{const result=listener(msg,sender,resolve);if(result!==true)resolve(undefined);});
 const save={type:'SAVE',tabId:1,pageKey:ctx.XClipCore.pageInfo(tabURL).key,mediaKey:'m1',url:mediaURL,filename:'../clip',saveAs:false};
 return {send,save,store,tabs,executions,sent,registrations,grant:value=>grant=value,args:()=>downloadArgs,changed,permissionRemoved};
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
