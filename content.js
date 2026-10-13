(() => {
  if(globalThis.__vclipContentV2) return;
  globalThis.__vclipContentV2=true;
  const C=XClipCore;
  let current=null, structured=[],host,button,note,busy=false,showFloat=false;
  const request=()=>window.postMessage({channel:'vclip:request:v2'},location.origin);
  function reset() {
    const info=C.pageInfo(location.href);
    if(info?.key!==current) {current=info?.key || null;structured=[];if(note)note.textContent='';request();}
    return info;
  }
  window.addEventListener('message',e=>{
    if(e.source!==window || e.origin!==location.origin || e.data?.channel!=='vclip:media:v2') return;
    const info=reset();
    if(!info || e.data.pageKey!==info.key || !Array.isArray(e.data.media)) return;
    structured=e.data.media.slice(0,24).map((m,i)=>({key:typeof m?.key==='string'?m.key.slice(0,100):`page-${i}`,
      type:m?.type==='animated_gif'?'animated_gif':'video',source:'page',label:`视频 ${i+1} · 页面数据`,
      variants:C.variants(m?.variants,info.platform),hls:m?.hls===true}));
  });
  function domMedia(info) {
    if(info.platform==='x') return []; // Keep tweet attribution strict.
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
    if(info.platform==='x' && !info.detail) return {ok:false,error:'请打开 X 的单条视频推文页面。'};
    const result=structured.some(m=>m.variants.length)?structured: [...structured,...domMedia(info)];
    const seen=new Set();const media=result.filter(m=>{if(seen.has(m.key))return false;seen.add(m.key);return true;});
    const direct=media.some(m=>m.variants.length);
    const blocked=[...document.querySelectorAll('video')].some(v=>/^blob:/.test(v.currentSrc || v.src)) || media.some(m=>m.hls);
    return {ok:true,pageKey:info.key,platform:info.platform,id:info.id,label:info.label,
      filename:`video-${info.platform}-${info.id || new URL(info.origin).hostname}`,media,
      error:direct?'':blocked?'播放器使用 blob 或分片流，目前没有发现完整视频文件。请播放后重新检测；若仍不可用，此版本无法保存。':
        '没有发现可直接保存的视频。请先播放后重新检测；嵌入播放器可打开其网页再试。登录限制、分片流、DRM 或站点变化可能导致无法保存。'};
  }
  function visibility(){
    if(!host) return;
    const info=C.pageInfo(location.href);
    host.hidden=!showFloat || !info || (info.platform==='x'?!info.detail:!snapshot().media.some(m=>m.variants.length));
  }
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
    if(sender.id!==chrome.runtime.id) return;
    if(msg?.type==='SNAPSHOT'){request();setTimeout(()=>reply(snapshot()),100);return true;}
    if(msg?.type==='OBSERVE_MODE'){window.postMessage({channel:'vclip:observe-mode:v2',enabled:msg.enabled===true},location.origin);reply({ok:true});}
    if(msg?.type==='FLOAT_MODE'){
      const info=C.pageInfo(location.href);
      if(msg.pattern){const u=new URL(location.href);if(`${u.protocol}//${u.hostname}/*`!==msg.pattern)return;}
      else if(msg.origin && info?.origin!==msg.origin)return;
      if(!msg.enabled && info?.platform==='x') return;
      showFloat=msg.enabled===true;
      if(msg.revoke){structured=[];window.postMessage({channel:'vclip:observe-mode:v2',enabled:false},location.origin);}
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
    const style=document.createElement('style');style.textContent=`:host{position:fixed;right:24px;bottom:24px;z-index:2147483646;font-family:system-ui,sans-serif;color:#26332d}:host([hidden]){display:none}button{font:600 14px system-ui;border:1px solid #d2ded5;background:#f6faf6;color:#213d2d;box-shadow:0 4px 20px #0002;border-radius:24px;padding:12px 18px;cursor:pointer}button:focus-visible{outline:3px solid #399d70}button:disabled{opacity:.6}p{box-sizing:border-box;max-width:290px;background:#f6faf6;border-radius:12px;font-size:12px;line-height:1.6;padding:12px;box-shadow:0 4px 20px #0002}p:empty{display:none}`;
    button=document.createElement('button');button.textContent='↓ 保存视频';button.addEventListener('click',save);
    note=document.createElement('p');note.setAttribute('role','status');note.setAttribute('aria-live','polite');root.append(style,button,note);
    document.body.append(host);reset();visibility();
  }
  setInterval(()=>{reset();mount();visibility();},1500);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  showFloat=C.pageInfo(location.href)?.platform==='x';reset();request();
  chrome.runtime.sendMessage({type:'SITE_STATUS'}).then(s=>{if(s?.ok){showFloat=s.enabled;visibility();}}).catch(()=>{});
})();
