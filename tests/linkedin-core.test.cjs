const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ctx=vm.createContext({URL});vm.runInContext(fs.readFileSync(path.join(__dirname,'../core.js'),'utf8'),ctx);const C=ctx.XClipCore;
test('LinkedIn recognizes exact HTTPS single activity URL and public post alias',()=>{
  for(const url of ['https://www.linkedin.com/feed/update/urn:li:activity:7472423970055647232/','https://linkedin.com/feed/update/urn%3Ali%3Aactivity%3A7472423970055647232/','https://www.linkedin.com/posts/example_motion-activity-7472423970055647232-Abcd']){
    const p=C.pageInfo(url);assert.equal(p.platform,'linkedin');assert.equal(p.detail,true);assert.equal(p.id,'7472423970055647232');
  }
  for(const url of ['https://www.linkedin.com/feed/','https://www.linkedin.com/feed/update/urn:li:activity:123/fake','http://www.linkedin.com/feed/update/urn:li:activity:123/','https://www.linkedin.com:8443/feed/update/urn:li:activity:123/'])assert.equal(C.pageInfo(url).detail,false,url);
  assert.equal(C.pageInfo('https://www.linkedin.com.evil.net/feed/update/urn:li:activity:123/').platform,'web');
});
test('LinkedIn signed extensionless MP4 requires typed licdn HTTPS and preserves the signature',()=>{
  const url='https://dms.licdn.com/playlist/vid/v2/asset/mp4-720p-30fp-crf28/id/0/1781564698898?e=2147483647&v=beta&t=abc%2Fdef';
  assert.equal(C.mediaURL(url,'linkedin','video/mp4'),url);assert.equal(C.mediaURL(url,'linkedin'),null);
  for(const bad of [url.replace('dms.licdn.com','dms.licdn.com.evil.net'),url.replace('https:','http:'),'https://dms.licdn.com/stream.m3u8','https://dms.licdn.com/dash.mpd','blob:https://www.linkedin.com/abc'])assert.equal(C.mediaURL(bad,'linkedin','video/mp4'),null);
  assert.equal(C.variant({url,content_type:'video/mp4',bitrate:953708},'linkedin').ext,'mp4');
});
test('LinkedIn automatic quality uses known height hints while exact unknown versions remain selectable',()=>{
  const vv=[{url:'https://dms.licdn.com/hi',mime:'video/mp4',height:720},{url:'https://dms.licdn.com/mid',mime:'video/mp4',height:640},{url:'https://dms.licdn.com/unknown',mime:'video/mp4'},{url:'https://dms.licdn.com/low',mime:'video/mp4',height:360}];
  assert.equal(C.choose(vv,'best','linkedin').height,720);assert.equal(C.choose(vv,'smallest','linkedin').height,360);
  assert.equal(C.choose(vv,'https://dms.licdn.com/unknown','linkedin').url,'https://dms.licdn.com/unknown');
});
