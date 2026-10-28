/* Runs inside the page so it can see the video data the site itself loads. Read only;
   content.js checks everything it receives from here. */
(() => {
  const C = globalThis.ClipCore, start = C?.pageInfo(location.href);
  if (!start || start.platform === 'web' || globalThis.__clipPage) return;
  globalThis.__clipPage = true;
  const LIMIT = 5 * 1024 * 1024;
  const API = {x: ['x.com', 'twitter.com'], instagram: ['instagram.com'], tiktok: ['tiktok.com']};
  let cacheKey = '', cache = new Map();

  function remember(data, info) {
    if (info.key !== C.pageInfo(location.href)?.key) return; // the user has already moved on
    if (info.key !== cacheKey) { cacheKey = info.key; cache = new Map(); }
    try { for (const m of C.extract(data, info)) cache.set(m.key, m); } catch {}
    while (cache.size > 64) cache.delete(cache.keys().next().value);
  }
  function rememberText(text, info) {
    if (typeof text === 'string' && text.length <= LIMIT) try { remember(JSON.parse(text), info); } catch {}
  }
  function watched(url, info, type) {
    if (!/json/i.test(type || '')) return false;
    try {
      const host = new URL(url).hostname;
      return API[info.platform].some(domain => host === domain || host.endsWith('.' + domain));
    } catch { return false; }
  }

  // X, Instagram and TikTok deliver video addresses in their own JSON responses.
  if (API[start.platform]) {
    const pageFetch = window.fetch;
    window.fetch = function (...args) {
      const info = C.pageInfo(location.href), request = pageFetch.apply(this, args);
      request.then(response => {
        if (watched(response.url, info, response.headers.get('content-type'))) return response.clone().text().then(text => rememberText(text, info));
      }).catch(() => {});
      return request;
    };
    const pageSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (...args) {
      const info = C.pageInfo(location.href);
      this.addEventListener('load', () => {
        if (!watched(this.responseURL, info, this.getResponseHeader('content-type'))) return;
        if (this.responseType === 'json') remember(this.response, info);
        else if (!this.responseType || this.responseType === 'text') rememberText(this.responseText, info);
      }, {once: true});
      return pageSend.apply(this, args);
    };
  }

  const onScreen = element => {
    const r = element.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  };
  // LinkedIn's <video> plays a blob; the player behind it still lists the MP4 files.
  function linkedInPlayers() {
    const found = [];
    [...document.querySelectorAll('video')].slice(0, 100).forEach((video, index) => {
      if (found.length >= 16 || !onScreen(video)) return;
      try {
        const sources = (video.player || video.parentElement?.player)?.currentSources?.();
        const vv = C.variants(Array.isArray(sources) ? sources.map(s => ({url: s?.src, type: s?.type, bitrate: s?.['data-bitrate'], width: s?.width, height: s?.height})) : [], 'linkedin');
        if (vv.length) found.push({index, variants: vv});
      } catch {}
    });
    return found;
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.clip !== 'request') return;
    const info = C.pageInfo(location.href);
    if (!info) return;
    // Instagram and TikTok embed the first post's data in the HTML.
    if (info.platform === 'instagram' || info.platform === 'tiktok') {
      for (const script of [...document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]')].slice(0, 100)) rememberText(script.textContent, info);
    }
    const media = info.platform === 'linkedin' ? linkedInPlayers() : cacheKey === info.key ? [...cache.values()] : [];
    window.postMessage({clip: 'media', key: info.key, media}, location.origin);
  });
})();
