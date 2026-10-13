const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup({granted=true}={}) {
 const elements=new Map(),sent=[];
 function element(){return {value:'',checked:false,hidden:false,disabled:false,textContent:'',listeners:{},
   addEventListener(type,listener){this.listeners[type]=listener;},replaceChildren(){},append(){}};}
 const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 const status=()=>({ok:true,origin:'https://videos.example.net',pattern:'https://videos.example.net/*',fixed:false,granted,enabled:false});
 const ctx=vm.createContext({URL,document:{getElementById:get,createElement:element},chrome:{
   tabs:{query:async()=>[{id:1,url:'https://videos.example.net/watch'}]},
   runtime:{sendMessage:async message=>{sent.push(message);
     if(message.type==='SITE_STATUS')return status();
     if(message.type==='PREPARE')return {ok:false,error:'合成注入失败'};
     if(message.type==='ENABLE_SITE')return {ok:false,error:'合成注册失败'};
     if(message.type==='DISABLE_SITE'){granted=false;return status();}
   }},permissions:{request:async()=>{granted=true;return true;}},
   storage:{local:{get:async defaults=>typeof defaults==='object'?defaults:{},set:async()=>{}},onChanged:{addListener(){}}}
 }});
 vm.runInContext(fs.readFileSync(path.join(root,'core.js'),'utf8'),ctx);
 vm.runInContext(fs.readFileSync(path.join(root,'popup.js'),'utf8'),ctx);
 return {get,sent};
}
test('existing access remains revocable when initial page injection fails',async()=>{
 const s=setup();await tick();
 assert.equal(s.get('status').textContent,'合成注入失败');assert.equal(s.get('revokeAccess').hidden,false);
 await s.get('revokeAccess').listeners.click();
 assert.ok(s.sent.some(m=>m.type==='DISABLE_SITE' && m.tabId===1));
 assert.equal(s.get('revokeAccess').hidden,true);assert.match(s.get('status').textContent,/已撤销/);
});
test('grant followed by registration failure exposes a separate revoke action',async()=>{
 const s=setup({granted:false});await tick();assert.equal(s.get('revokeAccess').hidden,true);
 await s.get('siteAccess').listeners.click();
 assert.equal(s.get('status').textContent,'合成注册失败');assert.equal(s.get('revokeAccess').hidden,false);
 await s.get('revokeAccess').listeners.click();assert.equal(s.get('revokeAccess').hidden,true);
});
