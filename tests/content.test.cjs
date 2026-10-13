const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'content.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(href='https://videos.example.net:8443/watch') {
 const posted=[],listeners=[],timers=[],hosts=[];
 const location={href,get origin(){return new URL(this.href).origin;}};
 const video={currentSrc:'https://media.example.net/clip.mp4',src:'',videoWidth:720,videoHeight:1280,
   getBoundingClientRect:()=>({width:360,height:640}),getAttribute:()=>'',querySelectorAll:()=>[]};
 const node=()=>({hidden:false,isConnected:false,setAttribute(){},addEventListener(){},
   attachShadow:()=>({append(){}})});
 const ctx={URL,location,setInterval:f=>{timers.push(f);return timers.length;},setTimeout:f=>f(),
   getComputedStyle:()=>({display:'block'}),postMessage:msg=>posted.push(JSON.parse(JSON.stringify(msg))),
   addEventListener(){},document:{readyState:'complete',createElement:node,addEventListener(){},
     querySelectorAll:selector=>selector==='video'?[video]:[],querySelector:()=>null,
     body:{append:element=>{element.isConnected=true;hosts.push(element);}}},
   chrome:{runtime:{id:'self',onMessage:{addListener:f=>listeners.push(f)},
     sendMessage:async()=>({ok:true,enabled:true})},storage:{local:{get:async()=>({quality:'best',saveAs:true})}}}};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'core.js'),'utf8'),ctx);vm.runInContext(source,ctx);
 const send=message=>{let response;listeners[0](message,{id:'self'},value=>response=value);return response;};
 return {ctx,posted,listeners,timers,hosts,send,reinject:()=>vm.runInContext(source,ctx)};
}
test('revocation hides all same-host pages even when their ports differ from the requesting origin',async()=>{
 for(const port of ['8443','9443']) {
   const s=setup(`https://videos.example.net:${port}/watch`);await tick();assert.equal(s.hosts[0].hidden,false);s.posted.length=0;
   const reply=s.send({type:'FLOAT_MODE',origin:'https://videos.example.net:8443',pattern:'https://videos.example.net/*',enabled:false,revoke:true});
   assert.equal(reply.ok,true);assert.equal(s.hosts[0].hidden,true);
   assert.ok(s.posted.some(m=>m.channel==='vclip:observe-mode:v2' && m.enabled===false));
 }
});
test('browser revocation with a portless pattern stops the existing page observer',async()=>{
 const s=setup();await tick();s.posted.length=0;
 s.send({type:'FLOAT_MODE',origin:'https://videos.example.net',pattern:'https://videos.example.net/*',enabled:false,revoke:true});
 assert.equal(s.hosts[0].hidden,true);assert.ok(s.posted.some(m=>m.channel==='vclip:observe-mode:v2' && !m.enabled));
});
test('revoking a different host or scheme leaves this site enabled',async()=>{
 const s=setup();await tick();s.posted.length=0;
 for(const pattern of ['https://other.example.net/*','http://videos.example.net/*']) {
   s.send({type:'FLOAT_MODE',pattern,enabled:false,revoke:true});
   assert.equal(s.hosts[0].hidden,false);
 }
 assert.equal(s.posted.length,0);
});
test('duplicate isolated content injection keeps one button, message listener and timer',async()=>{
 const s=setup();await tick();s.reinject();
 assert.equal(s.hosts.length,1);assert.equal(s.listeners.length,1);assert.equal(s.timers.length,1);
});
