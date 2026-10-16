const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const core=fs.readFileSync(path.join(__dirname,'../core-main.js'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../linkedin-player.js'),'utf8');
const mp4='https://dms.licdn.com/playlist/vid/v2/asset/mp4-720p-30fp-crf28/token/0/1781564698898?e=2147483647';
function video(sources,{id='player-one',src='blob:https://www.linkedin.com/one',top=20,left=0,parent=false}={}){
 const player={currentSources:()=>sources,options(){throw Error('Must not read player options');}};
 const v={id,getAttribute:name=>name==='src'?src:null,rect:{top,left,bottom:top+100,right:left+200,width:200,height:100},getBoundingClientRect(){return this.rect;},parentElement:{}};
 if(parent)v.parentElement.player=player;else v.player=player;
 return v;
}
function setup(videos=[],href='https://www.linkedin.com/feed/'){
 const emitted=[],handlers=new Map(),location={href,get origin(){return new URL(this.href).origin;}};
 const originalFetch=()=>{},send=()=>{};
 const ctx={URL,location,innerWidth:1200,innerHeight:900,fetch:originalFetch,XMLHttpRequest:function(){},
  document:{readyState:'complete',querySelectorAll:selector=>{assert.equal(selector,'video');return videos;},addEventListener:()=>{}},
  postMessage:(body,target)=>{assert.equal(target,location.origin);emitted.push(JSON.parse(JSON.stringify(body)));},
  addEventListener:(type,fn)=>{const list=handlers.get(type)||[];list.push(fn);handlers.set(type,list);}};
 ctx.XMLHttpRequest.prototype.send=send;ctx.window=ctx;vm.createContext(ctx);vm.runInContext(core,ctx);vm.runInContext(script,ctx);
 ctx.__dispatch=(body,origin,source)=>{for(const fn of handlers.get('message')||[])fn({data:body,origin,source});};
 function message(body,origin=location.origin,own=true){ctx.__body=body;ctx.__origin=origin;ctx.__own=own;vm.runInContext('__dispatch(__body,__origin,__own?window:{})',ctx);}
 return {ctx,emitted,location,videos,message,reinject:()=>vm.runInContext(script,ctx),originalFetch,send,handlers};
}
test('LinkedIn currentSources yields direct MP4 variants without bridging data or adaptive URLs',()=>{
 const s=setup([video([{src:'data:application/dash+xml,'+'x'.repeat(200000),type:'application/dash+xml'},
  {src:'https://dms.licdn.com/adaptive/master',type:'application/vnd.apple.mpegURL'},
  {src:mp4,type:'video/mp4','data-bitrate':953708}])]);
 const msg=s.emitted.at(-1),m=msg.media[0];assert.equal(msg.channel,'vclip:linkedin-players:v1');assert.equal(msg.pageKey,s.location.href);
 assert.equal(m.variants.length,1);assert.equal(m.variants[0].url,mp4);assert.equal(m.variants[0].height,720);assert.equal(m.variants[0].width,0);
 assert.match(m.variants[0].sourceLabel,/推测/);assert.equal(m.hls,true);assert.equal(m.source,'player');
 assert.ok(JSON.stringify(msg).length<5000);assert.ok(!JSON.stringify(msg).includes('data:'));
 assert.equal(s.ctx.fetch,s.originalFetch);assert.equal(s.ctx.XMLHttpRequest.prototype.send,s.send);
});
test('LinkedIn bridge retains bounded DOM identity and supports immediate parent player',()=>{
 const s=setup([video([{src:mp4,type:'video/mp4',width:1440,height:720}],{id:'v'.repeat(300),src:'blob:'+ 'b'.repeat(600),parent:true})]);
 const m=s.emitted.at(-1).media[0];assert.equal(m.videoIndex,0);assert.equal(m.elementId.length,256);assert.equal(m.elementSrc.length,512);
 assert.equal(m.key,'linkedin-player:0:'+m.elementId);assert.match(m.label,/屏幕播放器 1.*请核对画面/);assert.equal(m.variants[0].width,1440);
 assert.doesNotMatch(m.variants[0].sourceLabel,/推测/);
});
test('LinkedIn scan follows current viewport after scroll and current page key after navigation',()=>{
 const a=video([{src:mp4,type:'video/mp4'}]),b=video([{src:mp4.replace('asset','other'),type:'video/mp4'}],{id:'two',top:1000});
 const s=setup([a,b]);assert.deepEqual(s.emitted.at(-1).media.map(m=>m.videoIndex),[0]);
 a.rect.top=-150;a.rect.bottom=-50;b.rect.top=20;b.rect.bottom=120;
 s.location.href='https://www.linkedin.com/feed/?view=next';s.message({channel:'vclip:request:v2'});
 assert.deepEqual(s.emitted.at(-1).media.map(m=>m.videoIndex),[1]);assert.equal(s.emitted.at(-1).pageKey,s.location.href);
});
test('LinkedIn pause, re-enable and reinjection keep a single observer without page hooks',()=>{
 const s=setup([video([{src:mp4,type:'video/mp4'}])]);const n=s.emitted.length;
 s.message({channel:'vclip:observe-mode:v2',enabled:false});s.message({channel:'vclip:request:v2'});assert.equal(s.emitted.length,n);
 s.message({channel:'vclip:observe-mode:v2',enabled:true});assert.equal(s.emitted.length,n+1);
 const handlers=s.handlers.get('message').length;s.reinject();assert.equal(s.handlers.get('message').length,handlers);assert.equal(s.emitted.length,n+1);
 s.message({channel:'vclip:request:v2'},'https://evil.net');s.message({channel:'vclip:request:v2'},s.location.origin,false);assert.equal(s.emitted.length,n+1);
});
test('LinkedIn rejects data-only, spoofed CDN and broken players, and bounds current source enumeration',()=>{
 const s=setup([video([{src:'data:application/dash+xml,xxx',type:'application/dash+xml'}]),
  video([{src:'https://dms.licdn.com.evil.net/video',type:'video/mp4'}]),{...video([]),player:{currentSources(){throw Error('broken');}}},
  video(Array.from({length:120},(_,i)=>({src:mp4+'&n='+i,type:'video/mp4'})),{id:'good'})]);
 assert.equal(s.emitted.at(-1).media.length,1);assert.equal(s.emitted.at(-1).media[0].variants.length,100);
 const generic=setup([video([{src:mp4,type:'video/mp4'}])],'https://www.example.net/watch');assert.equal(generic.emitted.length,0);assert.equal(generic.handlers.get('message'),undefined);
});
test('LinkedIn limits visible players to sixteen and keeps original indexes below one hundred',()=>{
 const many=Array.from({length:110},(_,i)=>video([{src:mp4,type:'video/mp4'}],{id:'v'+i}));
 const s=setup(many);assert.equal(s.emitted.at(-1).media.length,16);
 for(const v of many.slice(0,100)){v.rect.top=1000;v.rect.bottom=1100;}
 s.message({channel:'vclip:request:v2'});assert.equal(s.emitted.at(-1).media.length,0);
});
