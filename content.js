(() => {
  if(globalThis.__vclipContentV2) return;
  globalThis.__vclipContentV2=true;
  const C=XClipCore;
  let current=null, structured=[],linkedIn=[],players=[],host,button,note,busy=false,showFloat=false;
  const request=()=>window.postMessage({channel:'vclip:request:v2'},location.origin);
  function reset() {
    const info=C.pageInfo(location.href);
    if(info?.key!==current) {current=info?.key || null;structured=[];linkedIn=[];players=[];if(note)note.textContent='';request();}
    return info;
  }
  window.addEventListener('message',e=>{
    if(e.source===window && e.origin===location.origin && e.data?.channel==='vclip:linkedin-players:v1'){
      const info=reset();if(info?.platform!=='linkedin' || e.data.pageKey!==info.key || !Array.isArray(e.data.media))return;
      players=e.data.media.slice(0,16).filter(playerVisible).map(m=>({videoIndex:m.videoIndex,elementId:m.elementId,elementSrc:m.elementSrc,hls:m.hls===true,key:`linkedin-player:${m.videoIndex}:${m.elementId}`,source:'player',type:'video',label:`屏幕播放器 ${m.videoIndex+1} · LinkedIn · 请核对画面`,variants:C.variants(m.variants,'linkedin'),filename:`video-linkedin-screen-${m.videoIndex+1}`}));return;
    }
    if(e.source!==window || e.origin!==location.origin || e.data?.channel!=='vclip:media:v2') return;
    const info=reset();
    if(!info || e.data.pageKey!==info.key || !Array.isArray(e.data.media)) return;
    structured=e.data.media.slice(0,24).map((m,i)=>({key:typeof m?.key==='string'?m.key.slice(0,100):`page-${i}`,
      ownerId:typeof m?.ownerId==='string' && /^\d{1,30}$/.test(m.ownerId)?m.ownerId:'',type:m?.type==='animated_gif'?'animated_gif':'video',source:'page',label:`视频 ${i+1} · 页面数据${m?.ownerId?' · 帖子 '+String(m.ownerId).slice(0,30):''}`,
      variants:C.variants(m?.variants,info.platform),hls:m?.hls===true}));
  });
  function playerVisible(m){
    if(!Number.isInteger(m?.videoIndex) || m.videoIndex<0 || m.videoIndex>=100 || typeof m.elementId!=='string' || m.elementId.length>256 || typeof m.elementSrc!=='string' || m.elementSrc.length>512)return false;
    const v=document.querySelectorAll('video')[m.videoIndex];if(!v || v.id!==m.elementId || (v.getAttribute('src') || '')!==m.elementSrc)return false;
    const r=v.getBoundingClientRect();return r.width>0 && r.height>0 && r.bottom>0 && r.top<innerHeight && r.right>0 && r.left<innerWidth;
  }
  function visibleXIds(){
    const ids=new Set();
    for(const video of [...document.querySelectorAll('article[data-testid="tweet"] video')].slice(0,100)){
      const r=video.getBoundingClientRect();if(!r.width || !r.height || r.bottom<=0 || r.top>=innerHeight || r.right<=0 || r.left>=innerWidth)continue;
      const article=video.closest('article[data-testid="tweet"]');
      const link=[...article.querySelectorAll('a[href*="/status/"]')].find(a=>a.querySelector('time') && a.closest('article[data-testid="tweet"]')===article);
      const id=C.pageInfo(link?.href)?.id;if(id)ids.add(id);
    }
    return ids;
  }
  function domMedia(info) {
    if(['x','linkedin'].includes(info.platform)) return []; // Keep post attribution strict; never select a neighbor's video.
    const found=[];const seen=new Set();
    function add(key,label,list) {
      const resolved=list.map(v=>{try{return {...v,url:new URL(v.url,location.href).href};}catch{return v;}});
      const vv=C.variants(resolved,'web').filter(v=>{if(seen.has(v.url))return false;seen.add(v.url);return true;});
      if(vv.length) found.push({key,label,type:'video',source:'dom',variants:vv,hls:false});
    }
    const videos=[...document.querySelectorAll('video')].slice(0,24);
    videos.forEach((video,i)=>{
      const rect=video.getBoundingClientRect();
      // Ignore hidden preloaded players; explicit visible page-player choices remain separate.
      if(!rect.width || !rect.height || getComputedStyle(video).display==='none') return;
      const list=[{url:video.currentSrc || video.src,content_type:video.getAttribute('type') || '',width:video.videoWidth,height:video.videoHeight},
        ...[...video.querySelectorAll('source')].map(s=>({url:s.src,content_type:s.type}))];
      add(`dom-video-${i}`,`页面播放器 ${i+1} · 请核对画面`,list);
    });
    if(!found.length) {
      // Only explicit video metadata; do not harvest arbitrary JSON/network URLs.
      const meta=document.querySelector('meta[property="og:video:secure_url"],meta[property="og:video:url"],meta[property="og:video"]');
      const mime=document.querySelector('meta[property="og:video:type"]')?.content || '';
      if(meta) add('dom-meta','页面视频 · 网页元数据',[{url:meta.content,content_type:mime}]);
      for(const script of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0,8)) {
        if(script.textContent.length>1024*1024) continue;
        try {
          const parsed=JSON.parse(script.textContent);const nodes=Array.isArray(parsed)?parsed:[parsed,...(Array.isArray(parsed?.['@graph'])?parsed['@graph']:[])];
          for(const node of nodes.slice(0,20)) if(node?.['@type']==='VideoObject' || (Array.isArray(node?.['@type']) && node['@type'].includes('VideoObject')))
            add(`dom-ld-${found.length}`,'页面视频 · VideoObject',[{url:node.contentUrl,content_type:node.encodingFormat || ''}]);
        } catch { /* Non-JSON metadata is ignored. */ }
      }
    }
    return found;
  }
  function snapshot() {
    const info=reset();
    if(!info) return {ok:false,error:'只能检测普通 HTTP(S) 网页。'};
    const posts=info.platform==='linkedin'?(globalThis.XClipLinkedIn?.getVisiblePosts(document,info) || []):[];
    const visibleIds=new Set(posts.map(p=>p.id));
    const visiblePlayers=players.filter(playerVisible),playerURLs=new Set(visiblePlayers.flatMap(m=>m.variants.map(v=>v.url)));
    const result=info.platform==='linkedin'?[...visiblePlayers,...[...linkedIn.filter(m=>info.detail || visibleIds.has(m.ownerId)),...(globalThis.XClipLinkedIn?.parseDocument(document,info) || [])].filter(m=>!m.variants.some(v=>playerURLs.has(v.url)))]:info.platform==='x' && !info.detail?structured.filter(m=>visibleXIds().has(m.ownerId)):structured.some(m=>m.variants.length)?structured: [...structured,...domMedia(info)];
    const seen=new Set();const media=result.filter(m=>{if(seen.has(m.key))return false;seen.add(m.key);return true;});
    const direct=media.some(m=>m.variants.length);
    const blocked=[...document.querySelectorAll('video')].some(v=>/^blob:/.test(v.currentSrc || v.src)) || media.some(m=>m.hls);
    return {ok:true,pageKey:info.key,platform:info.platform,id:info.id,label:info.label,posts,
      filename:`video-${info.platform}-${info.id || new URL(info.origin).hostname}`,media,
      error:direct?'':info.platform==='linkedin' && !info.detail?'没有找到屏幕中可保存的视频。请将视频滚动到屏幕中后重新检测；未公开完整文件或帖子身份的播放器可能无法保存。':blocked?'播放器使用 blob 或分片流，目前没有发现完整视频文件。请播放后重新检测；若仍不可用，此版本无法保存。':
        '没有发现可直接保存的视频。请先播放后重新检测；嵌入播放器可打开其网页再试。登录限制、分片流、DRM 或站点变化可能导致无法保存。'};
  }
  function visibility(){
    if(!host) return;
    const info=C.pageInfo(location.href);
    host.hidden=!showFloat || !info || (info.platform==='x' && info.detail?false:!snapshot().media.some(m=>m.variants.length));
  }
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
    if(sender.id!==chrome.runtime.id) return;
    if(msg?.type==='LINKEDIN_HTML'){
      const info=reset();
      const ownerId=info?.detail?info.id:msg.ownerId;
      const visible=info?.detail || globalThis.XClipLinkedIn?.getVisiblePosts(document,info).some(p=>p.id===ownerId);
      if(info?.platform!=='linkedin' || !visible || !/^\d{1,30}$/.test(ownerId || '') || msg.pageKey!==info.key){reply({ok:false,error:'视频已离开当前画面或页面已变化，请重新检测。'});return;}
      const postInfo=info.detail?info:C.pageInfo(`${info.origin}/feed/update/urn:li:activity:${ownerId}/`);
      const parsed=globalThis.XClipLinkedIn?.parseHTML(msg.html,postInfo) || [];
      linkedIn=[...linkedIn.filter(m=>m.ownerId!==ownerId),...parsed].slice(-80);visibility();
      reply({ok:parsed.some(m=>m.variants.length),error:'LinkedIn 公开页面没有当前帖子的完整视频文件；登录专属或仅分片流的视频暂不支持。'});return;
    }
    if(msg?.type==='SNAPSHOT'){request();setTimeout(()=>reply(snapshot()),100);return true;}
    if(msg?.type==='OBSERVE_MODE'){window.postMessage({channel:'vclip:observe-mode:v2',enabled:msg.enabled===true},location.origin);reply({ok:true});}
    if(msg?.type==='FLOAT_MODE'){
      const info=C.pageInfo(location.href);
      if(msg.pattern){const u=new URL(location.href);if(`${u.protocol}//${u.hostname}/*`!==msg.pattern)return;}
      else if(msg.origin && info?.origin!==msg.origin)return;
      if(!msg.enabled && info?.platform==='x') return;
      showFloat=msg.enabled===true;
      if(msg.revoke){structured=[];linkedIn=[];players=[];window.postMessage({channel:'vclip:observe-mode:v2',enabled:false},location.origin);}
      visibility();reply({ok:true});
    }
  });
  async function save(){
    if(busy)return;busy=true;button.disabled=true;
    try{
      const data=snapshot();const media=data.media?.filter(m=>m.variants.length) || [];
      if(!data.ok || !media.length) throw Error(data.error);
      if(media.length>1) throw Error('页面有多个视频，请从工具栏选择要保存的播放器或视频。');
      const prefs=await chrome.storage.local.get({quality:'best',saveAs:true});
      const v=C.choose(media[0].variants,prefs.quality,media[0].source==='dom'?'web':data.platform);
      if(!v)throw Error('所选质量不可用，请从工具栏重新选择。');
      const res=await chrome.runtime.sendMessage({type:'SAVE',pageKey:data.pageKey,mediaKey:media[0].key,url:v.url,filename:data.filename,saveAs:prefs.saveAs});
      if(!res?.ok)throw Error(res?.error || '扩展未响应，请刷新页面。');
      note.textContent='已提交给 Chrome。完成状态请查看浏览器下载记录。';
    }catch(e){note.textContent=e.message;}finally{busy=false;button.disabled=false;}
  }
  function mount(){
    if(!document.body || host?.isConnected)return;
    host=document.createElement('div');host.id='vclip-floating';const root=host.attachShadow({mode:'closed'});
    const style=document.createElement('style');style.textContent=`:host{position:fixed;right:24px;bottom:24px;z-index:2147483646;display:flex;flex-direction:column;align-items:flex-end;gap:8px;font-family:-apple-system,BlinkMacSystemFont,Inter,'PingFang SC','Segoe UI','Microsoft YaHei',sans-serif;color:#1c2832}:host([hidden]){display:none}button{font-family:inherit;font-size:13px;font-weight:600;line-height:1;letter-spacing:.3px;color:#22465c;cursor:pointer;padding:12px 18px;border-radius:999px;border:1px solid rgba(255,255,255,.95);background:linear-gradient(180deg,rgba(255,255,255,.86),rgba(230,238,243,.78));-webkit-backdrop-filter:blur(16px) saturate(1.3);backdrop-filter:blur(16px) saturate(1.3);box-shadow:0 0 0 1px rgba(61,109,139,.18),inset 0 1px 0 #fff,0 10px 28px rgba(34,70,92,.20);transition:transform .15s,box-shadow .15s,background .15s}button:hover{background:linear-gradient(180deg,#fff,rgba(230,238,243,.92));box-shadow:0 0 0 1px rgba(61,109,139,.28),inset 0 1px 0 #fff,0 12px 32px rgba(34,70,92,.26);transform:translateY(-1px)}button:active{transform:translateY(0)}button:focus-visible{outline:2px solid #3d6d8b;outline-offset:3px}button:disabled{opacity:.6;cursor:default;transform:none}p{box-sizing:border-box;margin:0;max-width:290px;font-size:12px;line-height:1.6;padding:10px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.95);background:rgba(246,249,251,.9);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);box-shadow:0 0 0 1px rgba(61,109,139,.16),0 8px 24px rgba(34,70,92,.16)}p:empty{display:none}`;
    button=document.createElement('button');button.textContent='↓ 保存视频';button.addEventListener('click',save);
    note=document.createElement('p');note.setAttribute('role','status');note.setAttribute('aria-live','polite');root.append(style,button,note);
    document.body.append(host);reset();visibility();
  }
  setInterval(()=>{reset();mount();visibility();if(C.pageInfo(location.href)?.platform==='linkedin')request();},1500);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  showFloat=C.pageInfo(location.href)?.platform==='x';reset();request();
  chrome.runtime.sendMessage({type:'SITE_STATUS'}).then(s=>{if(s?.ok){showFloat=s.enabled;visibility();}}).catch(()=>{});
})();
