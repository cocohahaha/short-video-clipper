/* Runs beside the page. Tells the popup which video files the page offers. */
(() => {
  if (globalThis.__clipContent) return;
  globalThis.__clipContent = true;
  const C = ClipCore;
  let fromPage = {key: '', media: []};

  window.addEventListener('message', event => {
    if (event.source === window && event.data?.clip === 'media' && Array.isArray(event.data.media)) {
      fromPage = {key: event.data.key, media: event.data.media.slice(0, 64)};
    }
  });

  const onScreen = element => {
    const r = element.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  };
  const absolute = value => { try { return typeof value === 'string' ? new URL(value, location.href).href : ''; } catch { return ''; } };

  // X timeline: posts whose video is on screen, top to bottom.
  function xVideos(info, media) {
    if (info.id) return media;
    const order = [];
    for (const video of document.querySelectorAll('article[data-testid="tweet"] video')) {
      if (!onScreen(video)) continue;
      const article = video.closest('article[data-testid="tweet"]');
      const link = [...article.querySelectorAll('a[href*="/status/"]')].find(a => a.querySelector('time') && a.closest('article[data-testid="tweet"]') === article);
      const id = C.pageInfo(link?.href || '')?.id;
      if (id && !order.includes(id)) order.push(id);
    }
    return media.filter(m => order.includes(m.owner)).sort((a, b) => order.indexOf(a.owner) - order.indexOf(b.owner));
  }

  // LinkedIn: on-screen players first, then data-sources. Posts with neither go to the popup,
  // which reads their public page.
  function linkedInVideos(info, players) {
    const videos = [...document.querySelectorAll('video')], found = [];
    for (const p of players) {
      const video = videos[p.index], owner = video ? C.linkedInActivity(video) : '';
      if (video && onScreen(video) && (!info.id || !owner || owner === info.id)) found.push({owner, variants: p.variants});
    }
    for (const s of C.linkedInSources(document)) {
      if (info.id ? s.owner === info.id : onScreen(s.video)) found.push({owner: s.owner, variants: s.variants});
    }
    const shown = info.id ? [info.id] : [...new Set(videos.filter(onScreen).map(C.linkedInActivity).filter(Boolean))];
    const missing = info.id ? (found.length ? [] : shown) : shown.filter(id => !found.some(m => m.owner === id));
    return {found, missing: missing.slice(0, 5)};
  }

  // Any other page: its <video> elements, then video metadata.
  function pageVideos() {
    const found = [];
    for (const video of [...document.querySelectorAll('video')].slice(0, 50)) {
      const r = video.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const sources = [...video.querySelectorAll('source')].map(s => ({url: s.src, type: s.type}));
      found.push({variants: C.variants([{url: video.currentSrc || video.src, width: video.videoWidth, height: video.videoHeight}, ...sources], 'web')});
    }
    if (found.some(m => m.variants.length)) return found;
    const meta = document.querySelector('meta[property="og:video:secure_url"], meta[property="og:video:url"], meta[property="og:video"]');
    if (meta) found.push({variants: C.variants([{url: absolute(meta.content), type: document.querySelector('meta[property="og:video:type"]')?.content}], 'web')});
    for (const script of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 10)) {
      try {
        const data = JSON.parse(script.textContent);
        for (const node of [data, ...(Array.isArray(data) ? data : []), ...(Array.isArray(data?.['@graph']) ? data['@graph'] : [])]) {
          if ([].concat(node?.['@type']).includes('VideoObject')) found.push({variants: C.variants([{url: absolute(node.contentUrl), type: node.encodingFormat}], 'web')});
        }
      } catch {}
    }
    return found;
  }

  function snapshot() {
    const info = C.pageInfo(location.href);
    if (!info) return {media: [], missing: []};
    const page = fromPage.key !== info.key ? [] : fromPage.media.map(m => ({
      owner: /^\d+$/.test(m?.owner) ? m.owner : '', index: m?.index, variants: C.variants(m?.variants, info.platform)}));
    let media, missing = [];
    if (info.platform === 'x') media = xVideos(info, page);
    else if (info.platform === 'linkedin') ({found: media, missing} = linkedInVideos(info, page));
    else media = page.some(m => m.variants.length) ? page : pageVideos();
    const seen = new Set();
    media = media.map(m => ({owner: m.owner || '', variants: m.variants.filter(v => !seen.has(v.url) && seen.add(v.url))}))
      .filter(m => m.variants.length).slice(0, 16);
    return {platform: info.platform, id: info.id, host: info.host, media, missing};
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== 'snapshot') return;
    window.postMessage({clip: 'request'}, location.origin);
    setTimeout(() => reply(snapshot()), 150); // page.js answers the request first
    return true;
  });
})();
