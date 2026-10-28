const C = ClipCore, $ = id => document.getElementById(id);
const say = text => { $('status').textContent = text; };
const ERRORS = {
  NETWORK_FAILED: '网络连接失败。', NETWORK_TIMEOUT: '网络超时。', SERVER_FORBIDDEN: '服务器拒绝访问，地址可能已过期，请重新检测。',
  SERVER_UNAUTHORIZED: '服务器要求登录，无法直接保存。', SERVER_BAD_CONTENT: '服务器没有返回视频文件。',
  FILE_NO_SPACE: '磁盘空间不足。', FILE_ACCESS_DENIED: '无法写入所选位置。'
};
const reason = code => /cancel/i.test(code) ? '已取消。' : ERRORS[code] || code || '原因未知。';
let videos = [];

function describe(v) {
  const size = v.width && v.height ? `${v.width} × ${v.height}` : v.height ? `${v.height}p` : '尺寸未知';
  return [size, v.bitrate && `${(v.bitrate / 1e6).toFixed(1)} Mbps`, v.ext !== 'mp4' && v.ext.toUpperCase(), v.note].filter(Boolean).join(' · ');
}

function filename(name, fallback, ext) {
  const clean = value => [...String(value || '').normalize('NFC').replace(/\.(mp4|m4v|webm|mov|ogv)$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-').trim()].slice(0, 100).join('').replace(/^[.\s]+|[.\s]+$/g, '');
  let base = clean(name) || clean(fallback) || 'video';
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(base)) base = '_' + base; // Windows device names
  return `${base}.${ext}`;
}

// A LinkedIn post's public page lists its MP4 files. Read without cookies.
async function linkedInPublic(id) {
  try {
    const response = await fetch(`https://www.linkedin.com/feed/update/urn:li:activity:${id}/`, {credentials: 'omit', signal: AbortSignal.timeout(10000)});
    if (!response.ok) return [];
    const html = new DOMParser().parseFromString(await response.text(), 'text/html');
    return C.linkedInSources(html).filter(s => s.owner === id).map(s => ({owner: id, variants: s.variants}));
  } catch { return []; }
}

const chosen = () => videos[$('media').value];
const version = () => chosen().variants[$('quality').value];
function showVideo() {
  $('quality').replaceChildren(...chosen().variants.map((v, i) => new Option(describe(v), i)));
  $('filename').value = chosen().name;
  $('ext').textContent = '.' + version().ext;
}

async function scan() {
  $('form').hidden = true;
  $('rescan').disabled = true;
  say('正在检测…');
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    const info = C.pageInfo(tab?.url || '');
    if (!info) throw Error('此页面不支持，请在普通网页上使用。');
    // On the four platforms page.js is already running from page load; elsewhere it starts now.
    await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', files: ['core.js', 'page.js']});
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['core.js', 'content.js']});
    const page = await chrome.tabs.sendMessage(tab.id, {type: 'snapshot'});
    const media = [...page.media, ...(await Promise.all(page.missing.map(linkedInPublic))).flat()];
    const prefix = page.platform === 'web' ? page.host : page.platform;
    videos = media.map((m, i) => ({...m, name: `${prefix}-${m.owner || page.id || 'video'}${media.length > 1 && !m.owner ? '-' + (i + 1) : ''}`}));
    if (!videos.length) throw Error('没有找到可保存的视频文件。请让视频出现在屏幕中并播放几秒，再重新检测。分段流、直播和加密视频无法保存。');
    $('media').replaceChildren(...videos.map((v, i) => new Option(`视频 ${i + 1}`, i)));
    $('mediaRow').hidden = videos.length < 2;
    showVideo();
    $('form').hidden = false;
    say(videos.length > 1 ? `找到 ${videos.length} 个视频，按页面顺序排列。` : '找到 1 个视频。');
  } catch (e) {
    say(/Cannot access|cannot be scripted|Receiving end/i.test(e.message) ? 'Chrome 不允许读取此页面，或页面尚未加载完成。请刷新页面后再试。' : e.message);
  } finally {
    $('rescan').disabled = false;
  }
}

$('form').addEventListener('submit', async event => {
  event.preventDefault();
  const v = version();
  localStorage.saveAs = $('saveAs').checked ? 'yes' : 'no';
  $('save').disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({type: 'download', url: v.url, filename: filename($('filename').value, chosen().name, v.ext), saveAs: $('saveAs').checked});
    if (!result?.ok) throw Error(result?.error);
    say('已开始下载。');
    chrome.downloads.onChanged.addListener(delta => {
      if (delta.id !== result.id) return;
      if (delta.state?.current === 'complete') say('下载完成。');
      if (delta.error) say(`下载未完成：${reason(delta.error.current)}`);
    });
  } catch (e) {
    say(`无法下载：${reason(e.message)}`);
  } finally {
    $('save').disabled = false;
  }
});
$('media').addEventListener('change', showVideo);
$('quality').addEventListener('change', () => { $('ext').textContent = '.' + version().ext; });
$('rescan').addEventListener('click', scan);
$('saveAs').checked = localStorage.saveAs !== 'no';
scan();
