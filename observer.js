/* MAIN world: observe page-owned responses and JSON. Never call a platform API. */
(() => {
  if (globalThis.__vclipObserverV2 || !globalThis.XClipCore) return;
  const initial = globalThis.XClipCore.pageInfo(location.href);
  if (!initial || initial.platform === 'web') return; // Generic sites do not need network hooks.
  Object.defineProperty(globalThis,'__vclipObserverV2',{value:true});
  const core = globalThis.XClipCore, MAX = 5*1024*1024;
  const cache = new Map(); let currentKey = '', active = true;
  const emit = (pageKey,media) => window.postMessage({channel:'vclip:media:v2',pageKey,media},location.origin);
  function currentPage() {
    const info = core.pageInfo(location.href), key = info?.key || '';
    if (key !== currentKey) { currentKey = key; cache.clear(); }
    return info;
  }
  function inspect(data,pageKey) {
    const info = currentPage();
    if (!active || !info?.detail || info.platform === 'web' || info.key !== pageKey) return;
    const media = core.extractPlatform(data,info);
    if (!media.length) return;
    for (const m of media) cache.set(m.key,m);
    while (cache.size > 16) cache.delete(cache.keys().next().value);
    emit(info.key,[...cache.values()]);
  }
  // Response hosts are platform-owned; media CDNs are validated separately in core.
  function allowed(raw,info) {
    if (!info || !info.detail || info.platform === 'web') return false;
    try {
      const u = new URL(raw,location.href);
      if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
      if (info.platform === 'x') return ['x.com','twitter.com','api.x.com','api.twitter.com'].includes(u.hostname);
      const domain = info.platform === 'instagram' ? 'instagram.com' : 'tiktok.com';
      return u.hostname === domain || u.hostname.endsWith('.' + domain);
    } catch { return false; }
  }
  async function observe(response,info) {
    if (!active || info?.key !== currentPage()?.key || !allowed(response.url,info) || !/json/i.test(response.headers.get('content-type') || '')) return;
    if (+response.headers.get('content-length') > MAX) return;
    const copy = response.clone(), reader = copy.body?.getReader();
    if (!reader) return;
    let total = 0; const chunks = [];
    try {
      while (true) {
        if (!active || info.key !== currentPage()?.key) { await reader.cancel(); return; }
        const {value,done} = await reader.read(); if (done) break;
        total += value.byteLength;
        if (total > MAX) { await reader.cancel(); return; }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
      inspect(JSON.parse(new TextDecoder().decode(bytes)),info.key);
    } finally { reader.releaseLock(); }
  }
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') window.fetch = function(...args) {
    const info = currentPage(), result = Reflect.apply(originalFetch,this,args);
    // Return the original promise unchanged so page error and streaming behavior survive.
    result.then(response => observe(response,info).catch(() => {}),() => {});
    return result;
  };
  if (typeof XMLHttpRequest !== 'undefined') {
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(...args) {
      const info = currentPage();
      this.addEventListener('load',() => {
        try {
          if (!active || info?.key !== currentPage()?.key || !allowed(this.responseURL,info) || !/json/i.test(this.getResponseHeader('content-type') || '')) return;
          if (+this.getResponseHeader('content-length') > MAX) return;
          if (this.responseType === 'json') {
            // XHR has already decoded its response. Bound it again before traversal.
            const text = JSON.stringify(this.response);
            if (typeof text === 'string' && text.length <= MAX && new TextEncoder().encode(text).byteLength <= MAX) inspect(this.response,info.key);
          } else if (!this.responseType || this.responseType === 'text') {
            const text = this.responseText;
            if (text.length <= MAX && new TextEncoder().encode(text).byteLength <= MAX) inspect(JSON.parse(text),info.key);
          }
        } catch { /* Unsupported response data must not interfere with its website. */ }
      },{once:true});
      return Reflect.apply(originalSend,this,args);
    };
  }
  function scanScripts() {
    const info = currentPage();
    if (!active || !info?.detail || info.platform === 'web') return;
    // TikTok's hydration data often precedes extension activation. Only parse JSON,
    // never execute script text or read arbitrary globals/cookies/local storage.
    const scripts = document.querySelectorAll('script[type="application/json"],script[type="application/ld+json"],script#SIGI_STATE,script#__UNIVERSAL_DATA_FOR_REHYDRATION__');
    let budget = MAX;
    for (const script of [...scripts].slice(0,100)) {
      const text = script.textContent || '';
      if (!text.trim() || text.length > budget) continue;
      const bytes = new TextEncoder().encode(text).byteLength;
      if (bytes > budget) continue;
      budget -= bytes;
      try { inspect(JSON.parse(text),info.key); } catch { /* Not JSON. */ }
      if (!budget) break;
    }
  }
  window.addEventListener('message',event => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.channel === 'vclip:observe-mode:v2') {
      if (typeof event.data.enabled !== 'boolean') return;
      active = event.data.enabled;
      if (active) scanScripts(); else cache.clear();
      return;
    }
    if (!active || event.data?.channel !== 'vclip:request:v2') return;
    const info = currentPage();
    if (!info?.detail || info.platform === 'web') return;
    scanScripts();
    if (cache.size) emit(info.key,[...cache.values()]);
  });
  window.addEventListener('popstate',currentPage);
  window.addEventListener('hashchange',currentPage);
  // History navigation emits no standard pushState event. Clear cache without
  // wrapping page history methods; requests and responses also recheck the key.
  setInterval(currentPage,1000);
  scanScripts();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',scanScripts,{once:true});
})();
