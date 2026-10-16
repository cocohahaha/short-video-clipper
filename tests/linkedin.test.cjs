const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {TextEncoder}=require('node:util');
const context=vm.createContext({URL,TextEncoder});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../core.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../linkedin.js'),'utf8'),context);
const L=context.XClipLinkedIn;
const id='7472423970055647232',urn='urn:li:activity:'+id;
const info={platform:'linkedin',detail:true,id,key:'https://www.linkedin.com/feed/update/'+urn+'/'};
const high='https://dms.licdn.com/playlist/vid/v2/D5605AQFX-1X-zzIMEQ/mp4-720p-30fp-crf28/variant/0/1781564698898?e=2147483647&v=beta&t=high';
const low=high.replace('720p','640p').replace('t=high','t=low');
const sources=[{src:low,type:'video/mp4','data-bitrate':734663},{src:high,type:'video/mp4','data-bitrate':953708}];
function element(attrs,owner){return {getAttribute:name=>attrs[name]??null,closest:selector=>owner};}
function owner(attrs={}){return element({'data-activity-urn':urn,...attrs},null);}
function video(list=sources,attrs={},parent=owner()){
  return element({'data-sources':JSON.stringify(list),'data-digitalmedia-asset-urn':'urn:li:digitalmediaAsset:D5605AQFX-1X-zzIMEQ',...attrs},parent);
}
const doc=(...videos)=>({querySelectorAll:selector=>{assert.equal(selector,'video[data-sources]');return videos;}});
const feedInfo={platform:'linkedin',detail:false,id:'',key:'https://www.linkedin.com/feed/'};
function visibleVideo(activityId,top=20,left=0,attrs={}){
  const v=video(sources,attrs,owner({'data-activity-urn':'urn:li:activity:'+activityId}));
  v.getBoundingClientRect=()=>({top,left,bottom:top+100,right:left+200,width:200,height:100});
  return v;
}
function feedDoc(...videos){return {defaultView:{innerWidth:1200,innerHeight:900},querySelectorAll:selector=>{
  assert.ok(['video','video[data-sources]'].includes(selector));return videos;
}};}
test('LinkedIn public video data-sources exposes extensionless typed quality variants',()=>{
  const media=L.parseDocument(doc(video()),info);
  assert.equal(media.length,1);assert.equal(media[0].key,'linkedin:'+id+':D5605AQFX-1X-zzIMEQ');
  assert.equal(media[0].type,'video');assert.equal(media[0].source,'page');assert.match(media[0].label,/LinkedIn 完整文件/);
  assert.equal(media[0].variants.length,2);assert.equal(media[0].variants[0].url,high);
  assert.equal(media[0].variants[0].bitrate,953708);assert.equal(media[0].variants[0].height,720);
  assert.equal(media[0].variants[0].width,0);assert.match(media[0].variants[0].sourceLabel,/推测/);
});
test('LinkedIn ownership requires exact nearest activity URN and rejects nested neighbors',()=>{
  const bad=owner({'data-activity-urn':'urn:li:activity:999'});
  const mixed=owner({'data-featured-activity-urn':'urn:li:activity:999'});
  const partial=owner({'data-activity-urn':urn+'0'});
  const ugc=owner({'data-activity-urn':'urn:li:ugcPost:'+id});
  for(const parent of [null,bad,mixed,partial,ugc])assert.equal(L.parseDocument(doc(video(sources,{},parent)),info).length,0);
  const featured=element({'data-featured-activity-urn':urn},null);
  assert.equal(L.parseDocument(doc(video(sources,{},featured)),info).length,1);
  assert.equal(L.parseDocument(doc(video(sources,{},bad),video()),info).length,1);
});
test('LinkedIn rejects wrong page types and does not guess an unowned single video',()=>{
  for(const value of [null,{}, {...info,platform:'web'},{...info,detail:false},{...info,id:''},{...info,id:'12bad'}])
    assert.equal(L.parseDocument(doc(video()),value).length,0);
  assert.equal(L.parseDocument(doc(video(sources,{},null)),info).length,0);
});
test('LinkedIn keeps actual width and height metadata ahead of URL quality hints',()=>{
  const media=L.parseDocument(doc(video([{src:high,type:'video/mp4',width:1440,height:720,'data-bitrate':'500000'}])),info);
  const v=media[0].variants[0];assert.equal(v.width,1440);assert.equal(v.height,720);assert.equal(v.bitrate,500000);
  assert.doesNotMatch(v.sourceLabel,/推测/);
});
test('LinkedIn invalid CDN, spoofed hosts, MIME conflicts and non-files never become variants',()=>{
  for(const raw of [{src:'https://dms.licdn.com.evil.net/video',type:'video/mp4'},{src:'http://dms.licdn.com/video',type:'video/mp4'},
    {src:'https://evil.net/video.mp4',type:'video/mp4'},{src:'blob:https://www.linkedin.com/id',type:'video/mp4'},
    {src:high,type:'text/html'},{src:high},{src:'https://dms.licdn.com/a.webm',type:'video/mp4'}]){
    assert.equal(L.parseDocument(doc(video([raw])),info).length,0);
  }
});
test('LinkedIn reports an owned HLS source without treating it as a downloadable file',()=>{
  const media=L.parseDocument(doc(video([{src:'https://dms.licdn.com/playlist/vid/dynamic/asset/master.m3u8',type:'application/vnd.apple.mpegURL'}])),info);
  assert.equal(media.length,1);assert.equal(media[0].hls,true);assert.equal(media[0].variants.length,0);
});
test('LinkedIn bounds source attributes, arrays and video elements and tolerates malformed JSON',()=>{
  for(const value of ['not JSON','{}','null','[]',' '.repeat(128*1024+1)])
    assert.equal(L.parseDocument(doc(video([],{'data-sources':value})),info).length,0);
  const list=Array.from({length:120},(_,i)=>({src:high.replace('t=high','t='+i),type:'video/mp4'}));
  assert.equal(L.parseDocument(doc(video(list)),info)[0].variants.length,100);
  const many=Array.from({length:20},(_,i)=>video(sources,{'data-digitalmedia-asset-urn':'urn:li:digitalmediaAsset:asset'+i}));
  assert.equal(L.parseDocument(doc(...many),info).length,16);
});
test('LinkedIn duplicate video assets merge variants and use a stable page-specific key',()=>{
  const media=L.parseDocument(doc(video([sources[0]]),video([sources[1]])),info);
  assert.equal(media.length,1);assert.equal(media[0].variants.length,2);
  assert.equal(media[0].key,'linkedin:'+id+':D5605AQFX-1X-zzIMEQ');
  const indexed=L.parseDocument(doc(video(sources,{'data-digitalmedia-asset-urn':''})),info);
  assert.equal(indexed[0].key,'linkedin:'+id+':0');
});
test('LinkedIn parseHTML uses a detached template and rejects oversized input before parsing',()=>{
  let assigned='',created=0;
  context.document={createElement:tag=>{assert.equal(tag,'template');created++;return {content:doc(video()),set innerHTML(value){assigned=value;}};}};
  const html='<article data-activity-urn="'+urn+'"><video data-sources="[]"></video><script>throw 1</script></article>';
  assert.equal(L.parseHTML(html,info).length,1);assert.equal(assigned,html);assert.equal(created,1);
  assert.equal(L.parseHTML(' '.repeat(2*1024*1024+1),info).length,0);assert.equal(created,1);
  assert.equal(L.parseHTML('\u4e00'.repeat(700000),info).length,0);assert.equal(created,1);
  assert.equal(L.parseHTML(null,info).length,0);
});
test('LinkedIn feed discovers visible posts by exact nearest video ownership in screen order',()=>{
  const root=feedDoc(visibleVideo('22',400),visibleVideo('11',20),visibleVideo('11',250),visibleVideo('33',1000),visibleVideo('44',-150),visibleVideo('55',10,1400));
  const posts=L.getVisiblePosts(root,feedInfo);
  assert.deepEqual(Array.from(posts,p=>p.id),['11','22']);
  assert.equal(posts[0].url,'https://www.linkedin.com/feed/update/urn:li:activity:11/');assert.equal(posts[0].key,posts[0].url);
  assert.equal(L.getVisiblePosts(root,{...feedInfo,platform:'web'}).length,0);
});
test('LinkedIn feed limits visible posts to five and rejects zero-area or unowned video',()=>{
  const zero=visibleVideo('77',10);zero.getBoundingClientRect=()=>({top:10,left:0,bottom:110,right:0,width:0,height:100});
  const missing=visibleVideo('88',20);missing.closest=()=>null;
  const mixed=visibleVideo('99',30);mixed.closest=()=>owner({'data-activity-urn':'urn:li:activity:99','data-featured-activity-urn':'urn:li:activity:100'});
  const root=feedDoc(zero,missing,mixed,...Array.from({length:7},(_,i)=>visibleVideo(String(i+1),i*100)));
  assert.deepEqual(Array.from(L.getVisiblePosts(root,feedInfo),p=>p.id),['1','2','3','4','5']);
});
test('LinkedIn feed parsing associates only visible direct media with its own activity ID',()=>{
  const root=feedDoc(visibleVideo('22',400),visibleVideo('11',20),visibleVideo('33',1000));
  const media=L.parseDocument(root,feedInfo);
  assert.equal(media.length,2);assert.deepEqual(Array.from(media,m=>m.ownerId),['11','22']);
  assert.ok(media.every(m=>m.key.startsWith('linkedin:'+m.ownerId+':') && m.label.includes(m.ownerId)));
  assert.equal(L.parseHTML('anything',feedInfo).length,0);
});
