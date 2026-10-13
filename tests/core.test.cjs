const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const context=vm.createContext({URL});vm.runInContext(fs.readFileSync(path.join(__dirname,'../core.js'),'utf8'),context);
const C=context.XClipCore;
const url='https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/1280x720/a.mp4?tag=12';
const low='https://video.twimg.com/ext_tw_video/123/pu/vid/320x180/b.mp4';
const igURL='https://scontent.cdninstagram.com/v/t50.2886-16/clip.mp4?token=A%2FB&expires=9999999999';
const ttURL='https://v16-web.tiktokcdn.com/video/tos/direct?token=a%2Fb&expires=9999999999';
const webURL='https://media.example.net/clip.webm?signature=a%2Fb';
const mainMedia={id_str:'m1',type:'video',video_info:{variants:[{url,bitrate:2176000,content_type:'video/mp4'},{url:low,bitrate:256000,content_type:'video/mp4'},{url:'https://video.twimg.com/a.m3u8',content_type:'application/x-mpegURL'}]}};
const quotedMedia={id_str:'q1',type:'video',video_info:{variants:[{url:low}]}};
const fixture={data:{tweet:{rest_id:'123',legacy:{extended_entities:{media:[mainMedia]}},quoted_status_result:{result:{rest_id:'999',legacy:{extended_entities:{media:[quotedMedia]}}}}}}};
test('X URL regression: strict tweet URLs including /i/web/status',()=>{
  assert.equal(C.statusId('https://x.com/user/status/123/video/1'),'123');
  assert.equal(C.statusId('https://twitter.com/i/web/status/123'),'123');
  for(const s of ['https://x.com/home','https://x.com/user/status/123oops','https://x.com.evil/user/status/123','http://x.com/a/status/123','garbage']) assert.equal(C.statusId(s),null);
});
test('pageInfo identifies X, Instagram, TikTok and ordinary web pages',()=>{
  for(const [value,platform,id] of [
    ['https://x.com/user/status/123','x','123'],['https://twitter.com/i/web/status/123','x','123'],
    ['https://www.instagram.com/reel/Abc_12/','instagram','Abc_12'],['https://www.instagram.com/p/Abc_12/','instagram','Abc_12'],
    ['https://www.tiktok.com/@user/video/123456789','tiktok','123456789'],
    ['https://videos.example.net/watch?id=2#chapter','web',null]]) {
    const info=C.pageInfo(value);assert.equal(info.platform,platform);if(id!==null)assert.equal(info.id,id);
    assert.equal(info.origin,new URL(value).origin);assert.equal(typeof info.key,'string');assert.ok(info.label);
  }
  assert.equal(C.pageInfo('https://videos.example.net/watch#one').key,'https://videos.example.net/watch#one');
  for(const value of ['chrome://extensions/','file:///tmp/test.html','javascript:alert(1)','https://user:pass@example.net/video','not a url'])assert.equal(C.pageInfo(value),null);
});
test('X CDN validation rejects credentials, spoofed hosts, protocols, HLS and ports',()=>{
  assert.equal(C.mediaURL(url),url);
  for(const s of ['https://video.twimg.com.evil/a.mp4','https://user@video.twimg.com/a.mp4','https://video.twimg.com:444/a.mp4','http://video.twimg.com/a.mp4','blob:https://x.com/a','https://video.twimg.com/a.m3u8','https://evil.com/a.mp4']) assert.equal(C.mediaURL(s),null);
});
test('platform media keeps signed query parameters and supports extensionless typed video',()=>{
  assert.equal(C.mediaURL(igURL,'instagram','video/mp4'),igURL);
  assert.equal(C.mediaURL(ttURL,'tiktok','video/mp4'),ttURL);
  assert.equal(C.mediaURL(webURL,'web','video/webm'),webURL);
  const signed='https://cdn.example.net/media?id=7&token=A%2FB%2BC';
  assert.equal(C.mediaURL(signed,'web','video/mp4'),signed);
  assert.equal(C.mediaURL(signed,'web'),null);
});
test('ordinary web validation refuses blob, HLS, credentials, unknown MIME and private networks',()=>{
  for(const value of ['blob:https://example.net/a','data:video/mp4;base64,AA','https://example.net/a.m3u8','https://example.net/a.mpd',
    'https://user:pass@example.net/a.mp4','https://localhost/a.mp4','https://localhost.localdomain/a.mp4','https://127.0.0.1/a.mp4',
    'https://10.0.0.2/a.mp4','https://172.16.1.1/a.mp4','https://192.168.1.1/a.mp4','https://169.254.169.254/a.mp4','https://[::1]/a.mp4','https://[fc00::1]/a.mp4']) {
    assert.equal(C.mediaURL(value,'web','video/mp4'),null,value);
  }
  assert.equal(C.mediaURL('https://example.net/video','web','text/html'),null);
  assert.equal(C.mediaURL('https://example.net/a.m3u8','web','video/mp4'),null);
  assert.equal(C.mediaURL('https://example.net/a.mp4','web','application/x-mpegURL'),null);
});
test('X variant sorting, dimensions, dedupe and MIME checks',()=>{
  const vv=C.variants([{url:low,bitrate:256000},{url,bitrate:2176000},{url:low,bitrate:256000},{url,content_type:'text/html'}]);
  assert.equal(vv.length,2);assert.equal(vv[0].height,720);assert.equal(vv[0].url,url);
  assert.equal(C.choose(vv,'best').url,url);assert.equal(C.choose(vv,'smallest').url,low);
  assert.equal(C.choose(vv,'missing'),null);assert.equal(C.choose([], 'best'),null);
});
test('generic variants preserve metadata and WebM extension through explicit quality selection',()=>{
  const vv=C.variants([{url:webURL,mime:'video/webm',width:1920,height:1080},{url:'https://media.example.net/low.mp4',content_type:'video/mp4',width:640,height:360}], 'web');
  assert.equal(vv.length,2);assert.equal(vv[0].url,webURL);assert.equal(vv[0].height,1080);assert.equal(vv[0].ext,'webm');
  assert.equal(C.choose(vv,'best','web').url,webURL);assert.equal(C.choose(vv,'smallest','web').height,360);
  assert.equal(C.choose(vv,webURL,'web').mime,'video/webm');
});
test('tweet ownership excludes quoted tweets and replies',()=>{
  const media=C.extract(fixture,'123');assert.equal(media.length,1);assert.equal(media[0].key,'m1');assert.equal(media[0].hls,true);assert.equal(media[0].variants.length,2);
  assert.equal(C.extract(fixture,'999')[0].key,'q1');assert.equal(C.extract(fixture,'456').length,0);
  assert.equal(C.extractPlatform(fixture,C.pageInfo('https://x.com/u/status/123'))[0].key,'m1');
});
test('legacy shapes, animated GIF, multiple video and HLS only',()=>{
  const f={id_str:'5',extended_entities:{media:[{type:'animated_gif',id_str:'a',video_info:{variants:[{url}]}},{type:'video',id_str:'b',video_info:{variants:[{url:'https://video.twimg.com/a.m3u8',content_type:'application/x-mpegURL'}]}}]}};
  const m=C.extract(f,'5');assert.equal(m.length,2);assert.equal(m[0].type,'animated_gif');assert.equal(m[1].variants.length,0);assert.equal(m[1].hls,true);
});
test('Instagram extraction attributes shortcode and excludes neighboring posts',()=>{
  const data={items:[{id:'ig1',shortcode:'Abc_12',is_video:true,video_url:igURL},{id:'other',shortcode:'Other',is_video:true,video_url:'https://scontent.cdninstagram.com/other.mp4'}]};
  const result=C.extractPlatform(data,C.pageInfo('https://www.instagram.com/reel/Abc_12/'));
  assert.equal(result.length,1);assert.equal(result[0].variants[0].url,igURL);
  assert.equal(C.extractPlatform(data,C.pageInfo('https://www.instagram.com/reel/Missing/')).length,0);
});
test('Instagram sidecars preserve multiple child videos under matched owner',()=>{
  const data={shortcode:'Abc_12',edge_sidecar_to_children:{edges:[{node:{id:'child1',is_video:true,video_url:igURL}},{node:{id:'photo',is_video:false}},{node:{id:'child2',is_video:true,video_url:'https://scontent.cdninstagram.com/second.mp4'}}]}};
  const result=C.extractPlatform(data,C.pageInfo('https://www.instagram.com/p/Abc_12/'));
  assert.equal(result.length,2);assert.equal(new Set(result.map(m=>m.key)).size,2);
});
test('TikTok extraction follows matching item ID and video address fields',()=>{
  const data={items:[{id:'123456789',video:{playAddr:ttURL,downloadAddr:'https://v16-web.tiktokcdn.com/download.mp4',width:720,height:1280}},{id:'888',video:{playAddr:'https://v16-web.tiktokcdn.com/unrelated.mp4'}}]};
  const result=C.extractPlatform(data,C.pageInfo('https://www.tiktok.com/@user/video/123456789'));
  assert.equal(result.length,1);assert.ok(result[0].variants.some(v=>v.url===ttURL));assert.equal(result[0].variants.length,2);
  assert.equal(C.extractPlatform(data,C.pageInfo('https://www.tiktok.com/@user/video/777')).length,0);
});
test('Instagram code/carousel and TikTok adaptive address objects preserve available quality',()=>{
 const ig={code:'Abc_12',carousel_media:[{pk:'one',media_type:2,video_versions:[{url:igURL,width:1080,height:1920},{url:'https://scontent.cdninstagram.com/low.mp4',width:360,height:640}]}]};
 const media=C.extractPlatform(ig,C.pageInfo('https://www.instagram.com/p/Abc_12/'));assert.equal(media.length,1);assert.equal(media[0].variants.length,2);assert.equal(media[0].variants[0].height,1920);
 const tt={aweme_id:'123456789',video:{play_addr:{url_list:[ttURL],width:720,height:1280},bitrate_info:[{Bitrate:3000000,PlayAddr:{UrlList:['https://v16-web.tiktokcdn.com/high.mp4'],Width:1080,Height:1920}}]}};
 const variants=C.extractPlatform(tt,C.pageInfo('https://www.tiktok.com/@user/video/123456789'))[0].variants;
 assert.equal(variants.length,2);assert.equal(variants[0].height,1920);assert.equal(variants[0].bitrate,3000000);
});
test('platform extractors do not harvest arbitrary sibling URL fields or spoofed CDNs',()=>{
 const ig={shortcode:'Abc_12',is_video:true,url:igURL,video_url:'https://cdninstagram.com.evil.net/a.mp4'};
 assert.equal(C.extractPlatform(ig,C.pageInfo('https://www.instagram.com/p/Abc_12/'))[0].variants.length,0);
 const tt={id:'123456789',video:{url:ttURL,playAddr:'https://tiktokcdn.com.evil.net/a.mp4'}};
 assert.equal(C.extractPlatform(tt,C.pageInfo('https://www.tiktok.com/@u/video/123456789'))[0].variants.length,0);
});
test('filenames preserve Unicode, reject traversal and follow selected media extension',()=>{
  assert.equal(C.filename('旅行片段.mp4'),'旅行片段.mp4');assert.equal(C.filename('../a/b\\c'),' -a-b-c.mp4'.trim());
  assert.equal(C.filename('CON'),'_CON.mp4');assert.equal(C.filename('  '),'video.mp4');assert.equal(C.filename('a'.repeat(300)).length,104);
  assert.equal(C.filename('a\u0000b'),'a-b.mp4');assert.equal(C.filename('name... '),'name.mp4');
  assert.equal(C.filename('旅行片段.mp4','video','webm'),'旅行片段.webm');assert.equal(C.filename('旅行片段.webm','video','webm'),'旅行片段.webm');
  assert.equal(C.filename('旅行片段.mp4 '),'旅行片段.mp4');
  assert.equal(C.filename('\u3000旅行片段.webm\u00a0\u3000','video','webm'),'旅行片段.webm');
  assert.equal(C.filename('旅行片段.mp4\t\n','video','webm'),'旅行片段.webm');
  assert.equal(C.filename('','short-123','webm'),'short-123.webm');
});
test('malformed payload and bounded recursion do not throw',()=>{
  for(const x of [null,{},[],{rest_id:'123',legacy:{extended_entities:{media:{}}}}]) assert.equal(C.extract(x,'123').length,0);
  let deep={};for(let i=0;i<100;i++)deep={deep};assert.equal(C.extract(deep,'123').length,0);
  for(const platform of ['instagram','tiktok','web'])assert.equal(C.extractPlatform(deep,{platform,id:'123'}).length,0);
});
module.exports={fixture,url,low,igURL,ttURL,webURL};
