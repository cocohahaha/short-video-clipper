const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const coreSource=fs.readFileSync(path.join(__dirname,'../core.js'),'utf8');
const observerSource=fs.readFileSync(path.join(__dirname,'../observer.js'),'utf8');
const coreContext={URL};vm.createContext(coreContext);vm.runInContext(coreSource,coreContext);
const C=coreContext.XClipCore,plain=value=>JSON.parse(JSON.stringify(value));
const media=(key='shared',variants=[{url:'https://video.twimg.com/vid/720x1280/clip.mp4',content_type:'video/mp4',bitrate:2000000}])=>({media_key:key,type:'video',video_info:{variants}});
const tweet=(id,key='shared')=>({rest_id:id,legacy:{id_str:id,extended_entities:{media:[media(key)]}}});
const feed=C.pageInfo('https://x.com/home');
test('X feed media retain their own post ownership across quotes, replies, and neighbours',()=>{
 const parent=tweet('101');parent.quoted_status_result={result:tweet('202')};parent.in_reply_to_status_result={result:tweet('303')};
 const entries=plain(C.extractPlatform({timeline:[parent,tweet('404')]},feed));
 assert.equal(entries.length,4);
 assert.deepEqual(entries.map(m=>m.ownerId).sort(),['101','202','303','404']);
 assert.deepEqual(entries.map(m=>m.key).sort(),['x:101:shared','x:202:shared','x:303:shared','x:404:shared']);
 assert.ok(entries.every(m=>m.source==='page'&&m.variants.length===1));
});
test('X feed rejects missing or nonnumeric owners and does not inherit parent ownership',()=>{
 const parent={rest_id:'101',quoted_status_result:{result:{legacy:{extended_entities:{media:[media()]}}}}};
 const values=[parent,{rest_id:'not-a-post',legacy:{extended_entities:{media:[media()]}}},{extended_entities:{media:[media()]}}];
 assert.deepEqual(plain(C.extractPlatform(values,feed)),[]);
});
test('single X posts keep existing media keys and exact-post filtering',()=>{
 const parent=tweet('101');parent.quoted_status_result={result:tweet('202','quote-only')};
 const entries=plain(C.extractPlatform([parent,tweet('303','neighbour-only')],C.pageInfo('https://x.com/u/status/101')));
 assert.equal(entries.length,1);assert.equal(entries[0].key,'shared');assert.equal(entries[0].ownerId,undefined);
});
test('X feed validates MP4 CDN URLs and reports HLS without accepting it',()=>{
 const value=tweet('101');value.legacy.extended_entities.media[0]=media('formats',[
  {url:'https://video.twimg.com/a.mp4',content_type:'video/mp4'},
  {url:'https://video.twimg.com/a.m3u8',content_type:'application/x-mpegURL'},
  {url:'https://unrelated.example.net/a.mp4',content_type:'video/mp4'},
  {url:'http://video.twimg.com/a.mp4',content_type:'video/mp4'},
  {url:'blob:https://x.com/a',content_type:'video/mp4'}
 ]);
 const [entry]=plain(C.extractPlatform(value,feed));assert.equal(entry.hls,true);assert.equal(entry.variants.length,1);assert.equal(entry.variants[0].url,'https://video.twimg.com/a.mp4');
});
test('X feed bounds results to 16 and merges duplicate representations without losing quality',()=>{
 const first=tweet('101');first.legacy.extended_entities.media[0]=media('shared',[{url:'https://video.twimg.com/high.mp4',bitrate:2000000}]);
 const second=tweet('101');second.legacy.extended_entities.media[0]=media('shared',[{url:'https://video.twimg.com/low.mp4',bitrate:1000000}]);
 const merged=plain(C.extractPlatform([first,second],feed));assert.equal(merged.length,1);assert.equal(merged[0].variants.length,2);
 const entries=plain(C.extractPlatform(Array.from({length:40},(_,i)=>tweet(String(1000+i))),feed));assert.equal(entries.length,16);assert.equal(new Set(entries.map(m=>m.key)).size,16);
});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function response(payload) {
 const bytes=new TextEncoder().encode(JSON.stringify(payload));let read=false;
 return {url:'https://x.com/owned-response',headers:{get:key=>key==='content-type'?'application/json':null},clone:()=>({body:{getReader:()=>({read:async()=>read?{done:true}:(read=true,{done:false,value:bytes}),cancel:async()=>{},releaseLock:()=>{}})}})};
}
function setup(href='https://x.com/home',initial=[]) {
 const emitted=[],handlers=new Map(),scripts=initial.map(value=>({textContent:JSON.stringify(value)}));
 const location={href,get origin(){return new URL(this.href).origin;}};let pending=Promise.resolve(response(tweet('101')));
 const originalFetch=()=>pending;
 const ctx={URL,Uint8Array,TextEncoder,TextDecoder,location,setInterval:()=>1,fetch:originalFetch,
  document:{readyState:'complete',querySelectorAll:()=>scripts,addEventListener:()=>{}},
  postMessage:message=>emitted.push(plain(message)),addEventListener:(type,listener)=>{const list=handlers.get(type)||[];list.push(listener);handlers.set(type,list);}};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(coreSource,ctx);vm.runInContext(observerSource,ctx);
 ctx.__dispatch=(body,source,origin)=>{for(const handler of handlers.get('message')||[])handler({data:body,source,origin});};
 const request=()=>vm.runInContext("__dispatch({channel:'vclip:request:v2'},window,location.origin)",ctx);
 return {ctx,location,scripts,emitted,request,originalFetch,setPending:value=>pending=value};
}
test('MAIN observer discovers X home feed JSON and preserves original fetch promise',async()=>{
 const s=setup(),promise=Promise.resolve(response({entries:[tweet('101'),tweet('202')]}));s.setPending(promise);
 assert.equal(s.ctx.fetch('/owned-response'),promise);await tick();assert.equal(s.emitted.length,1);assert.equal(s.emitted[0].pageKey,'https://x.com/home');
 assert.deepEqual(s.emitted[0].media.map(m=>m.ownerId).sort(),['101','202']);
});
test('X feed cache remains bounded and is cleared on browsing-page changes',async()=>{
 const s=setup();
 for(let batch=0;batch<3;batch++) {
  s.setPending(Promise.resolve(response(Array.from({length:10},(_,i)=>tweet(String(batch*10+i+1000))))));s.ctx.fetch('/owned-response');await tick();
 }
 assert.equal(s.emitted.at(-1).media.length,16);
 const count=s.emitted.length;s.location.href='https://x.com/search?q=video';s.request();assert.equal(s.emitted.length,count);
});
test('X feed discards late responses after navigation and accepts the current page response',async()=>{
 const s=setup();let resolve;s.setPending(new Promise(done=>resolve=done));s.ctx.fetch('/owned-response');
 s.location.href='https://x.com/search?q=current';resolve(response(tweet('101')));await tick();assert.equal(s.emitted.length,0);
 s.setPending(Promise.resolve(response(tweet('202'))));s.ctx.fetch('/owned-response');await tick();assert.equal(s.emitted[0].media[0].ownerId,'202');
});
test('X feed script discovery works while LinkedIn still installs no network observer',()=>{
 const s=setup('https://x.com/home',[tweet('101')]);assert.equal(s.emitted.length,1);assert.equal(s.emitted[0].media[0].key,'x:101:shared');
 const linkedIn=setup('https://www.linkedin.com/feed/',[tweet('101')]);assert.equal(linkedIn.ctx.fetch,linkedIn.originalFetch);assert.equal(linkedIn.ctx.__vclipObserverV2,undefined);assert.equal(linkedIn.emitted.length,0);
});
