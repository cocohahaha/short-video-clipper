const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),core=fs.readFileSync(path.join(root,'core.js'),'utf8'),source=fs.readFileSync(path.join(root,'content.js'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function setup() {
 const location={href:'https://x.com/home',get origin(){return new URL(this.href).origin;}},videos=[],messages=[],listeners=[];
 const node=()=>({hidden:false,isConnected:false,setAttribute(){},addEventListener(){},attachShadow:()=>({append(){}})});
 const ctx={URL,location,innerWidth:1280,innerHeight:900,setInterval:()=>1,setTimeout:fn=>fn(),getComputedStyle:()=>({display:'block'}),
  postMessage(){},addEventListener:(type,fn)=>{if(type==='message')messages.push(fn);},
  document:{readyState:'complete',createElement:node,addEventListener(){},querySelectorAll:selector=>['video','article[data-testid="tweet"] video'].includes(selector)?videos:[],querySelector:()=>null,body:{append:element=>{element.isConnected=true;}}},
  chrome:{runtime:{id:'self',onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:async()=>({ok:true,enabled:true})},storage:{local:{get:async()=>({quality:'best',saveAs:true})}}}};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(core,ctx);vm.runInContext(source,ctx);
 const addVideo=(id,rect={top:100,bottom:500,left:100,right:500,width:400,height:400})=>{
  const article={querySelectorAll:()=>links},link={href:`https://x.com/user/status/${id}`,querySelector:selector=>selector==='time'?{}:null,closest:()=>article},links=[link];
  const video={rect,currentSrc:'https://video.twimg.com/direct.mp4',src:'',getBoundingClientRect(){return this.rect;},closest:()=>article};
  videos.push(video);return {video,article,links,link};
 };
 ctx.__bridge=body=>{for(const fn of messages)fn(body);};
 const publish=items=>{
  // Execute in the page realm so event.source is precisely its window object.
  ctx.__items=items;
  vm.runInContext("__bridge({source:window,origin:location.origin,data:{channel:'vclip:media:v2',pageKey:location.href,media:__items}})",ctx);
 };
 const snapshot=()=>{let response;listeners[0]({type:'SNAPSHOT'},{id:'self'},value=>{response=value;});return plain(response);};
 return {ctx,location,addVideo,publish,snapshot};
}
const item=id=>({key:`x:${id}:media`,ownerId:id,type:'video',variants:[{url:`https://video.twimg.com/${id}.mp4`,content_type:'video/mp4'}]});
test('X feed snapshots expose only structured media owned by a visible player article',()=>{
 const s=setup();s.addVideo('101');s.addVideo('202',{top:1000,bottom:1400,left:100,right:500,width:400,height:400});
 s.publish([item('101'),item('202'),item('303')]);
 const result=s.snapshot();assert.equal(result.ok,true);assert.equal(result.platform,'x');assert.deepEqual(result.media.map(m=>m.ownerId),['101']);
});
test('scrolling filters old X feed media immediately without waiting for new JSON',()=>{
 const s=setup(),first=s.addVideo('101'),second=s.addVideo('202',{top:1000,bottom:1400,left:100,right:500,width:400,height:400});
 s.publish([item('101'),item('202')]);assert.deepEqual(s.snapshot().media.map(m=>m.ownerId),['101']);
 first.video.rect={top:-500,bottom:-100,left:100,right:500,width:400,height:400};second.video.rect={top:100,bottom:500,left:100,right:500,width:400,height:400};
 assert.deepEqual(s.snapshot().media.map(m=>m.ownerId),['202']);
 second.video.rect={top:1000,bottom:1400,left:100,right:500,width:400,height:400};assert.deepEqual(s.snapshot().media,[]);
});
test('players outside each viewport edge or with zero area do not qualify as visible',()=>{
 const s=setup(),rectangles=[
  {top:-400,bottom:0,left:100,right:500,width:400,height:400},
  {top:900,bottom:1300,left:100,right:500,width:400,height:400},
  {top:100,bottom:500,left:-400,right:0,width:400,height:400},
  {top:100,bottom:500,left:1280,right:1680,width:400,height:400},
  {top:100,bottom:500,left:100,right:100,width:0,height:400}
 ];
 rectangles.forEach((rect,i)=>s.addVideo(String(100+i),rect));s.publish(rectangles.map((_,i)=>item(String(100+i))));assert.deepEqual(s.snapshot().media,[]);
});
test('X feed timestamp ownership ignores links from nested neighbouring articles',()=>{
 const s=setup(),own=s.addVideo('101'),neighbour=s.addVideo('202',{top:1000,bottom:1400,left:100,right:500,width:400,height:400});
 own.links.unshift(neighbour.link);s.publish([item('101'),item('202')]);assert.deepEqual(s.snapshot().media.map(m=>m.ownerId),['101']);
 own.links.length=0;assert.deepEqual(s.snapshot().media,[]);
});
test('X feed never saves an unowned DOM URL and clears old observations after navigation',()=>{
 const s=setup();s.addVideo('101');assert.deepEqual(s.snapshot().media,[]);
 s.publish([item('101'),{...item('202'),ownerId:'invalid'}]);assert.equal(s.snapshot().media.length,1);
 s.location.href='https://x.com/search?q=video';assert.deepEqual(s.snapshot().media,[]);
});
