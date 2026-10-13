const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
assert.equal(manifest.manifest_version,3);
assert.deepEqual([...manifest.permissions].sort(),['activeTab','downloads','scripting','storage'].sort());
assert.deepEqual(manifest.host_permissions,['https://x.com/*','https://twitter.com/*']);
assert.deepEqual([...manifest.optional_host_permissions].sort(),['http://*/*','https://*/*'].sort());
assert(!manifest.permissions.includes('webRequest'),'No broad network interception permission');
assert(!manifest.host_permissions.includes('<all_urls>'),'No mandatory all-sites permission');
for(const script of manifest.content_scripts) {
  assert.deepEqual(script.matches,manifest.host_permissions,'Static content scripts stay limited to X');
  assert(!script.all_frames,'No automatic subframe access');
}
assert.equal(fs.readFileSync(path.join(root,'core-main.js'),'utf8'),fs.readFileSync(path.join(root,'core.js'),'utf8'));
for(const name of ['core-main.js','core.js','observer.js','content.js','background.js','popup.js']) new vm.Script(fs.readFileSync(path.join(root,name),'utf8'),{filename:name});
const referenced=[manifest.background.service_worker,manifest.action.default_popup,...Object.values(manifest.icons),...manifest.content_scripts.flatMap(c=>c.js)];
for(const file of referenced) assert(fs.existsSync(path.join(root,file)),`missing ${file}`);
assert(!/https?:\/\//.test(fs.readFileSync(path.join(root,'popup.html'),'utf8')),'remote resources in popup');
console.log('Manifest, permissions, local resources and JavaScript syntax: PASS');
