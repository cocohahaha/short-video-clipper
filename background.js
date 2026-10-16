importScripts('core.js');
const C = XClipCore;
const patternFor = origin => {const u = new URL(origin); return `${u.protocol}//${u.hostname}/*`;};
const fixed = info => info.platform === 'x';
function scriptIds(pattern) {
  let hash=2166136261;
  for(const char of pattern) hash=Math.imul(hash^char.charCodeAt(0),16777619);
  return [`vclip-${(hash>>>0).toString(16)}-main`,`vclip-${(hash>>>0).toString(16)}-content`];
}
async function status(info) {
  const pattern=patternFor(info.origin);
  const granted=await chrome.permissions.contains({origins:[pattern]});
  const scripts=await chrome.scripting.getRegisteredContentScripts();
  const count=scripts.filter(s=>s.id.startsWith('vclip-') && s.matches?.includes(pattern)).length;
  return {origin:info.origin,pattern,fixed:fixed(info),granted,enabled:fixed(info) || (granted && count===2)};
}
async function getTab(msg,sender) {
  // Page-originated SAVE always stays tied to the sending tab.
  const fromPage=C.pageInfo(sender.url || sender.tab?.url);
  const id=fromPage && sender.tab ? sender.tab.id : msg.tabId;
  if(!Number.isInteger(id)) throw Error('当前页面不可用，请重新打开工具栏。');
  const tab=await chrome.tabs.get(id);
  const info=C.pageInfo(tab.url);
  if(!info) throw Error('只能检测普通 HTTP(S) 网页；Chrome 内部页和应用商店不支持。');
  return {tab,info};
}
async function inject(tabId,site) {
  await chrome.scripting.executeScript({target:{tabId},world:'MAIN',files:['core-main.js','linkedin-player.js','observer.js']});
  await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',files:['core.js','linkedin.js','content.js']});
  await chrome.tabs.sendMessage(tabId,{type:'OBSERVE_MODE',enabled:true});
  await chrome.tabs.sendMessage(tabId,{type:'FLOAT_MODE',enabled:site.enabled});
}
async function linkedInPublicPost(tab,page,post,timeoutMs) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs),MAX=2*1024*1024;
  try {
    if(C.pageInfo((await chrome.tabs.get(tab.id)).url)?.key!==page.key) throw Error('页面已变化，请重新检测。');
    const response=await fetch(post.key,{credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',signal:controller.signal});
    if(!response.ok || !/^text\/html(?:;|$)/i.test(response.headers.get('content-type') || '')) throw Error('公开页面暂时无法读取。');
    if(response.url && (C.pageInfo(response.url)?.id!==post.id || new URL(response.url).origin!==post.origin)) throw Error('返回的公开页面与当前帖子不符。');
    if(Number(response.headers.get('content-length'))>MAX) throw Error('公开页面超过检测大小限制。');
    const reader=response.body?.getReader();if(!reader) throw Error('公开页面没有可读取内容。');
    let total=0;const chunks=[];
    try {
      while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX){await reader.cancel();throw Error('公开页面超过检测大小限制。');}chunks.push(value);}
    } finally {reader.releaseLock();}
    if(C.pageInfo((await chrome.tabs.get(tab.id)).url)?.key!==page.key) throw Error('页面已变化，请重新检测。');
    const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const result=await chrome.tabs.sendMessage(tab.id,{type:'LINKEDIN_HTML',pageKey:page.key,ownerId:post.id,html:new TextDecoder().decode(bytes)});
    if(!result?.ok) throw Error(result?.error || '公开页面未提供当前帖子可保存的完整视频。');
  } finally {clearTimeout(timer);}
}
async function linkedInVisiblePosts(tab,info,refresh=false) {
  const existing=await chrome.tabs.sendMessage(tab.id,{type:'SNAPSHOT'});
  if(existing?.pageKey!==info.key || C.pageInfo((await chrome.tabs.get(tab.id)).url)?.key!==info.key) throw Error('页面已变化，请重新检测。');
  const ids=info.detail?[info.id]:[...new Set((existing.posts || []).map(p=>p?.id).filter(id=>typeof id==='string' && /^\d{1,30}$/.test(id)))].slice(0,5);
  const deadline=Date.now()+20000,warnings=[];
  for(const id of ids) {
    if(C.pageInfo((await chrome.tabs.get(tab.id)).url)?.key!==info.key){warnings.push('页面已变化，请重新检测。');break;}
    if(existing.media?.some(m=>(info.detail || m.ownerId===id) && (m.source==='player' || !refresh) && C.variants(m.variants,'linkedin').length)) continue;
    const remaining=deadline-Date.now();if(remaining<500){warnings.push('本次检测超时，请重新检测。');break;}
    const post=info.detail?info:C.pageInfo(`${info.origin}/feed/update/urn:li:activity:${id}/`);
    try {await linkedInPublicPost(tab,info,post,Math.min(10000,remaining));}
    catch(e) {warnings.push(e.name==='AbortError'?'LinkedIn 检测超时，请重新检测。':`LinkedIn 检测未完成：${e.message}`);}
  }
  return [...new Set(warnings)].join(' ');
}

async function unregister(pattern) {
  const scripts=await chrome.scripting.getRegisteredContentScripts();
  const ids=scripts.filter(s=>s.id.startsWith('vclip-') && s.matches?.includes(pattern)).map(s=>s.id);
  if(ids.length) await chrome.scripting.unregisterContentScripts({ids});
}
async function broadcastHide(origin) {
  const tabs=await chrome.tabs.query({});
  await Promise.allSettled(tabs.filter(t=>Number.isInteger(t.id)).map(t=>chrome.tabs.sendMessage(t.id,{type:'FLOAT_MODE',origin,pattern:origin?patternFor(origin):undefined,enabled:false,revoke:true})));
}
chrome.runtime.onMessage.addListener((msg,sender,reply) => {
  if(sender.id!==chrome.runtime.id || !['PREPARE','SITE_STATUS','ENABLE_SITE','DISABLE_SITE','SAVE'].includes(msg?.type)) return;
  // Only the local popup can inject scripts or change permanent site access.
  if(['PREPARE','ENABLE_SITE','DISABLE_SITE'].includes(msg.type) && !sender.url?.startsWith(chrome.runtime.getURL('popup.html'))) {
    reply({ok:false,error:'此操作需要从工具栏界面发起。'}); return;
  }
  (async()=>{
    const {tab,info}=await getTab(msg,sender);
    const site=await status(info);
    if(msg.type==='SITE_STATUS') return {ok:true,...site};
    if(msg.type==='PREPARE') {
      await inject(tab.id,site);let warning='';
      if(info.platform==='linkedin') try {warning=await linkedInVisiblePosts(tab,info,msg.refreshLinkedIn===true);} catch(e) {warning=e.name==='AbortError'?'LinkedIn 检测超时，请重新检测。':`LinkedIn 检测未完成：${e.message}`;}
      return {ok:true,site,warning};
    }
    if(msg.type==='ENABLE_SITE') {
      if(site.fixed) return {ok:true,...site};
      // The popup requests the current origin in a user gesture before this message.
      if(!await chrome.permissions.contains({origins:[site.pattern]})) throw Error('尚未获得此网站访问权限，请重新点击启用。');
      await unregister(site.pattern);
      const [main,content]=scriptIds(site.pattern);
      await chrome.scripting.registerContentScripts([
        {id:main,matches:[site.pattern],js:['core-main.js','linkedin-player.js','observer.js'],world:'MAIN',runAt:'document_start',persistAcrossSessions:true},
        {id:content,matches:[site.pattern],js:['core.js','linkedin.js','content.js'],world:'ISOLATED',runAt:'document_start',persistAcrossSessions:true}
      ]);
      const enabledSite={...site,granted:true,enabled:true};
      await inject(tab.id,enabledSite);
      return {ok:true,...enabledSite};
    }
    if(msg.type==='DISABLE_SITE') {
      if(site.fixed) throw Error('X 的自动检测属于固定站点配置。');
      await unregister(site.pattern);
      await chrome.permissions.remove({origins:[site.pattern]});
      await broadcastHide(site.origin);
      return {ok:true,...site,granted:false,enabled:false};
    }
    if(info.key!==msg.pageKey) throw Error('页面已变化，请重新检测。');
    const data=await chrome.tabs.sendMessage(tab.id,{type:'SNAPSHOT'});
    if(!data?.ok || data.pageKey!==msg.pageKey || data.platform!==info.platform) throw Error('视频或页面已变化，请重新检测。');
    const media=data.media?.find(m=>m.key===msg.mediaKey);
    const v=C.variants(media?.variants,media?.source==='dom'?'web':info.platform).find(v=>v.url===msg.url);
    if(!v) throw Error('所选地址已失效或不属于当前检测结果，请重新检测。');
    // Re-check navigation after the asynchronous snapshot response.
    const latest=await chrome.tabs.get(tab.id);
    if(C.pageInfo(latest.url)?.key!==msg.pageKey) throw Error('页面已变化，请重新检测。');
    const id=await chrome.downloads.download({url:v.url,filename:C.filename(msg.filename,`video-${info.platform}-${info.id || 'page'}`,v.ext),
      saveAs:msg.saveAs!==false,conflictAction:'uniquify'});
    await chrome.storage.local.set({lastDownload:{id,at:Date.now(),state:'in_progress'}});
    const [item]=await chrome.downloads.search({id});
    if(item) await chrome.storage.local.set({lastDownload:{id,at:Date.now(),state:item.state,error:item.error || ''}});
    return {ok:true,downloadId:id};
  })().then(reply,e=>reply({ok:false,error:C.downloadError(e.message)}));
  return true;
});
chrome.downloads.onChanged.addListener(delta=>{
  if(!delta.state && !delta.error) return;
  chrome.storage.local.get('lastDownload').then(({lastDownload})=>{
    if(lastDownload?.id!==delta.id) return;
    return chrome.storage.local.set({lastDownload:{...lastDownload,state:delta.state?.current || lastDownload.state,error:delta.error?.current || ''}});
  }).catch(()=>{});
});
// Browser permission revocation must also remove registrations and hide stale buttons.
chrome.permissions.onRemoved.addListener(async removed=>{
  try {
    const scripts=await chrome.scripting.getRegisteredContentScripts();
    for(const pattern of new Set(scripts.filter(s=>s.id.startsWith('vclip-')).flatMap(s=>s.matches || []))) {
      if(!await chrome.permissions.contains({origins:[pattern]})) await unregister(pattern);
    }
    for(const pattern of removed.origins || []) {
      if(/^https?:\/\/[^*]+\/\*$/.test(pattern)) await broadcastHide(pattern.slice(0,-2));
      else await broadcastHide();
    }
  } catch { /* No registrations to reconcile when extension is disabled/reloaded. */ }
});
