const $=id=>document.getElementById(id), C=XClipCore;
let snapshot,tabId,site,loading=false,saving=false,prefs={quality:'best',saveAs:true};
let choiceKey='',choices=new Map();
function remember(){if(choiceKey)choices.set(choiceKey,{quality:$('quality').value,filename:$('filename').value});}
function option(value,text){const o=document.createElement('option');o.value=value;o.textContent=text;return o;}
function chosen(){const m=snapshot?.media.find(m=>m.key===$('media').value);return {m,v:C.choose(m?.variants,$('quality').value,m?.source==='dom'?'web':snapshot?.platform)};}
function suffix(){const {v}=chosen();$('extension').textContent=`.${v?.ext || 'mp4'}`;}
function qualities(){
  const m=snapshot?.media.find(m=>m.key===$('media').value),vv=C.variants(m?.variants,m?.source==='dom'?'web':snapshot?.platform);
  const index=snapshot?.media.indexOf(m) || 0;
  choiceKey=m?.key || '';
  const stored=choices.get(choiceKey),quality=stored?.quality || (prefs.quality==='smallest'?'smallest':'best');
  $('quality').replaceChildren(option('best','最高已发现质量'),option('smallest','最低已发现质量'),...vv.map(v=>option(v.url,C.label(v))));
  if(!['best','smallest'].includes(quality) && !vv.some(v=>v.url===quality))$('quality').append(option(quality,'所选版本已失效，请重新选择'));
  $('quality').value=quality;
  $('filename').value=stored?.filename || m?.filename || (m?.ownerId?`video-${snapshot.platform}-${m.ownerId}`:`${snapshot?.filename || 'video'}${snapshot?.media.length>1?`-${index+1}`:''}`);
  $('quality').disabled=!vv.length;$('save').disabled=!C.choose(vv,quality,m?.source==='dom'?'web':snapshot?.platform);suffix();
}
function permissionUI(){
  if(!site){$('siteAccess').disabled=true;$('revokeAccess').hidden=true;return;}
  $('siteAccess').disabled=site.fixed;
  $('revokeAccess').hidden=site.fixed || site.enabled || !site.granted;
  $('siteAccess').textContent=site.fixed?'X 已启用自动检测':site.enabled?'关闭此网站的悬浮按钮与访问':'为此网站启用悬浮按钮';
  $('permissionNote').textContent=site.fixed?'X 信息流与单条帖子自动检测；请将视频滚动到屏幕中。':site.enabled?'已授权此网站。刷新后可以提前检测视频；可随时关闭。':'当前仅在点击工具栏时检测。启用按钮时，Chrome 会请求访问这个网站。';
}
async function scan(refreshLinkedIn=false){
  if(loading || saving)return;remember();const oldPage=snapshot?.pageKey,oldChoice=choiceKey;site=null;permissionUI();loading=true;$('save').disabled=true;$('refresh').disabled=true;$('status').textContent='正在寻找视频…';
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});tabId=tab?.id;
    const info=C.pageInfo(tab?.url);if(!info)throw Error('请打开包含视频的普通网页。Chrome 内部页与应用商店不支持。');
    if(info.platform==='linkedin')$('status').textContent='正在检测 LinkedIn 视频…';
    const access=await chrome.runtime.sendMessage({type:'SITE_STATUS',tabId});
    if(access?.ok){site=access;permissionUI();}
    const prep=await chrome.runtime.sendMessage({type:'PREPARE',tabId,refreshLinkedIn:refreshLinkedIn===true});
    if(!prep?.ok)throw Error(prep?.error || '无法连接页面。');site=prep.site;permissionUI();
    snapshot=await chrome.tabs.sendMessage(tabId,{type:'SNAPSHOT'});
    if(snapshot?.pageKey!==oldPage){choices.clear();choiceKey='';}
    if(!snapshot?.ok)throw Error(snapshot?.error || '未收到页面信息。');
    $('tweet').textContent=snapshot.label;$('platform').textContent={x:'X',instagram:'IG',tiktok:'TikTok',linkedin:'in',web:'网页'}[snapshot.platform] || '视频';
    $('media').replaceChildren(...snapshot.media.map((m,i)=>option(m.key,`${m.label || `视频 ${i+1}`}${!m.variants.length?' · 无完整文件':''}`)));
    const first=snapshot.media.find(m=>m.variants.length);if(oldPage===snapshot.pageKey && snapshot.media.some(m=>m.key===oldChoice))$('media').value=oldChoice;else if(first)$('media').value=first.key;
    $('media').disabled=!snapshot.media.length;qualities();
    $('status').textContent=first ? ['dom','player'].includes(first.source)?'已发现当前播放器提供的文件。请核对视频，再选择质量保存。':'已发现页面提供的视频文件。选择质量后，交给 Chrome 保存。' : prep.warning || snapshot.error;
  }catch(e){snapshot=null;$('media').replaceChildren();$('quality').replaceChildren();$('media').disabled=$('quality').disabled=true;$('status').textContent=/Receiving end|Cannot access|Missing host permission/i.test(e.message)?'页面尚未就绪或没有访问权限，请重新打开工具栏后再检测。':e.message;}
  finally{loading=false;$('refresh').disabled=false;}
}
$('siteAccess').addEventListener('click',async()=>{
  if(!site || site.fixed || !tabId)return;
  $('siteAccess').disabled=true;
  try{
    if(site.enabled){
      const res=await chrome.runtime.sendMessage({type:'DISABLE_SITE',tabId});if(!res?.ok)throw Error(res?.error);site=res;
      $('status').textContent='已关闭此网站的悬浮按钮并撤销访问；工具栏仍可按次检测。';
    }else{
      // Call directly in this click's user gesture; never request all optional sites.
      const granted=await chrome.permissions.request({origins:[site.pattern]});
      if(!granted){$('status').textContent='未授权；仍可从工具栏按次检测。';return;}
      const res=await chrome.runtime.sendMessage({type:'ENABLE_SITE',tabId});if(!res?.ok)throw Error(res?.error);site=res;
      $('status').textContent='已为此网站启用悬浮按钮。刷新网页可提前检测页面媒体信息。';
    }
  }catch(e){$('status').textContent=e.message || '网站权限设置未完成。';const current=await chrome.runtime.sendMessage({type:'SITE_STATUS',tabId}).catch(()=>null);if(current?.ok)site=current;}finally{permissionUI();}
});
$('revokeAccess').addEventListener('click',async()=>{
  if(!site || site.fixed || !tabId)return;
  try{const res=await chrome.runtime.sendMessage({type:'DISABLE_SITE',tabId});if(!res?.ok)throw Error(res?.error);site=res;$('status').textContent='已撤销此网站访问。仍可从工具栏按次检测。';}
  catch(e){$('status').textContent=e.message;}finally{permissionUI();}
});
$('media').addEventListener('change',()=>{remember();qualities();});$('quality').addEventListener('change',()=>{suffix();remember();$('save').disabled=!chosen().v;});$('filename').addEventListener('input',remember);$('refresh').addEventListener('click',()=>scan(true));
$('form').addEventListener('submit',async e=>{
  e.preventDefault();if(saving || !snapshot)return;const {m,v}=chosen();
  if(!v){$('status').textContent='所选质量不可用，请重新检测。';return;}
  saving=true;$('save').disabled=true;
  try{
    const quality=$('quality').value;const savedQuality=quality==='smallest'?'smallest':'best';
    await chrome.storage.local.set({quality:savedQuality,saveAs:$('saveAs').checked});prefs.quality=savedQuality;
    const name=C.filename($('filename').value,snapshot.filename,v.ext);$('filename').value=name.slice(0,-v.ext.length-1);remember();
    const res=await chrome.runtime.sendMessage({type:'SAVE',tabId,pageKey:snapshot.pageKey,mediaKey:m.key,url:v.url,filename:name,saveAs:$('saveAs').checked});
    if(!res?.ok)throw Error(res?.error || '下载启动失败。');$('status').textContent='已提交给 Chrome；这不代表下载已完成。请查看浏览器下载记录。';
  }catch(e){$('status').textContent=e.message;}finally{saving=false;$('save').disabled=!chosen().v;}
});
function downloadText(d){$('download').textContent=d?`最近下载：${d.state==='complete'?'已完成':d.state==='interrupted'?`中断（${C.downloadError(d.error)}）`:'进行中，请查看 Chrome 下载记录'}`:'';}
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local' && changes.lastDownload)downloadText(changes.lastDownload.newValue);});
(async()=>{prefs=await chrome.storage.local.get(prefs);$('saveAs').checked=prefs.saveAs;downloadText((await chrome.storage.local.get('lastDownload')).lastDownload);await scan();})().catch(e=>{$('status').textContent=e.message;});
