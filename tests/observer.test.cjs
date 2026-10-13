const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const core=fs.readFileSync(path.join(__dirname,'../core-main.js'),'utf8');
const observer=fs.readFileSync(path.join(__dirname,'../observer.js'),'utf8');
const data=id=>({rest_id:id,legacy:{extended_entities:{media:[{id_str:'m'+id,type:'video',video_info:{variants:[{url:'https://video.twimg.com/'+id+'.mp4'}]}}]}}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(href='https://x.com/u/status/123',initial=[]) {
 const emitted=[],handlers=new Map(),scripts=initial.map(value=>({textContent:JSON.stringify(value)}));
 const location={href,get origin(){return new URL(this.href).origin;}};
 let pending=Promise.resolve(response(data('123')));
 const originalFetch=()=>pending;
 const ctx={URL,Uint8Array,TextEncoder,TextDecoder,location,setInterval:()=>1,fetch:originalFetch,
   document:{readyState:'complete',querySelectorAll:()=>scripts,addEventListener:()=>{}},
   postMessage:msg=>emitted.push(JSON.parse(JSON.stringify(msg))),
   addEventListener:(type,listener)=>{const list=handlers.get(type)||[];list.push(listener);handlers.set(type,list);}};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(core,ctx);vm.runInContext(observer,ctx);
 ctx.__dispatch=(body,source,origin)=>{for(const handler of handlers.get('message')||[])handler({source,origin,data:body});};
 const message=(body,origin=location.origin)=>{ctx.__testData=body;ctx.__testOrigin=origin;vm.runInContext('__dispatch(__testData,window,__testOrigin)',ctx);};
 return {ctx,location,emitted,scripts,message,originalFetch,setPending:value=>pending=value,reinject:()=>vm.runInContext(observer,ctx)};
}
function response(payload,{url='https://x.com/response.json',length='0',mime='application/json'}={}) {
 const bytes=new TextEncoder().encode(JSON.stringify(payload));let i=0;
 return {url,headers:{get:key=>key==='content-type'?mime:key==='content-length'?length:null},
   clone:()=>({body:{getReader:()=>({read:async()=>i++?{done:true}:{done:false,value:bytes},cancel:async()=>{},releaseLock:()=>{}})}})};
}
test('MAIN observer preserves original fetch promise and ignores generic web hooks',async()=>{
 const s=setup();const promise=Promise.resolve(response(data('123')));s.setPending(promise);
 assert.equal(s.ctx.fetch('/response.json'),promise);await tick();assert.equal(s.emitted.at(-1).media[0].key,'m123');
 const generic=setup('https://videos.example.net/watch');assert.equal(generic.ctx.fetch,generic.originalFetch);assert.equal(generic.ctx.__vclipObserverV2,undefined);
});
test('in-flight response from a prior page is never added to current page media',async()=>{
 const s=setup();let resolve;const promise=new Promise(r=>resolve=r);s.setPending(promise);s.ctx.fetch('/response.json');
 s.location.href='https://x.com/u/status/456';resolve(response(data('123')));await tick();assert.equal(s.emitted.length,0);
 s.setPending(Promise.resolve(response(data('456'))));s.ctx.fetch('/response.json');await tick();assert.equal(s.emitted.at(-1).pageKey,s.location.href);assert.equal(s.emitted.at(-1).media[0].key,'m456');
});
test('cache is cleared on page-key change even when post ID stays the same',()=>{
 const s=setup('https://x.com/u/status/123?view=one',[data('123')]);assert.equal(s.emitted.length,1);s.scripts.length=0;
 s.location.href='https://x.com/u/status/123?view=two';s.message({channel:'vclip:request:v2'});assert.equal(s.emitted.length,1);
});
test('pause clears cached media and blocks observation until explicitly resumed',async()=>{
 const s=setup('https://www.instagram.com/reel/Abc_12/',[{shortcode:'Abc_12',video_url:'https://scontent.cdninstagram.com/a.mp4'}]);
 assert.equal(s.emitted.length,1);s.message({channel:'vclip:observe-mode:v2',enabled:false});s.message({channel:'vclip:request:v2'});assert.equal(s.emitted.length,1);
 s.message({channel:'vclip:observe-mode:v2',enabled:true});assert.equal(s.emitted.length,2);
});
test('duplicate injection keeps one fetch wrapper and one message listener',()=>{
 const s=setup();const wrapper=s.ctx.fetch;s.reinject();assert.equal(s.ctx.fetch,wrapper);assert.equal(s.ctx.__vclipObserverV2,true);
});
test('oversized, non-JSON and third-party responses are ignored without affecting callers',async()=>{
 const s=setup();for(const options of [{length:String(6*1024*1024)},{mime:'text/html'},{url:'https://unrelated.example.net/response.json'}]) {
  const promise=Promise.resolve(response(data('123'),options));s.setPending(promise);assert.equal(s.ctx.fetch('/response.json'),promise);await tick();
 }
 assert.equal(s.emitted.length,0);
});
