/* Shared helpers, loaded in the page (page.js), beside it (content.js) and in the popup. */
(() => {
  const TYPES = {mp4: 'video/mp4', m4v: 'video/x-m4v', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg'};
  const EXTS = Object.fromEntries(Object.entries(TYPES).map(([ext, type]) => [type, ext]));
  // Platform videos must come from the platform's own CDN.
  const CDN = {
    instagram: ['cdninstagram.com', 'fbcdn.net'],
    tiktok: ['tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'tiktokv.com', 'tiktok.com', 'byteoversea.com', 'ibytedtos.com', 'bytefcdn-oversea.com', 'muscdn.com', 'akamaized.net'],
    linkedin: ['licdn.com']
  };
  const under = (host, domain) => host === domain || host.endsWith('.' + domain);
  const mimeOf = value => typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : '';
  const number = value => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };
  const list = value => Array.isArray(value) ? value : [];

  // Platform of a page and, on single-post pages, the post ID.
  function pageInfo(href) {
    try {
      const u = new URL(href);
      if (!/^https?:$/.test(u.protocol)) return null;
      const host = u.hostname.replace(/^www\./, ''), path = decodeURIComponent(u.pathname);
      let platform = 'web', id;
      if (host === 'x.com' || host === 'twitter.com') { platform = 'x'; id = path.match(/^\/(?:[^/]+\/status|i\/web\/status)\/(\d+)/)?.[1]; }
      else if (host === 'instagram.com') { platform = 'instagram'; id = path.match(/^\/(?:p|reels?)\/([\w-]+)/)?.[1]; }
      else if (host === 'tiktok.com') { platform = 'tiktok'; id = path.match(/^\/@[^/]+\/video\/(\d+)/)?.[1]; }
      else if (host === 'linkedin.com') { platform = 'linkedin'; id = path.match(/^\/feed\/update\/urn:li:activity:(\d+)/)?.[1] || path.match(/^\/posts\/[^/]+-activity-(\d+)/)?.[1]; }
      if (platform !== 'web') u.hash = '';
      return {platform, id: id || '', key: u.href, host: u.hostname};
    } catch { return null; }
  }

  // Only complete files: a video extension, or no extension plus a video MIME type. Streams never pass.
  function mediaURL(value, platform, type) {
    if (typeof value !== 'string' || value.length > 8192) return null;
    let u;
    try { u = new URL(value); } catch { return null; }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
    if (platform === 'x') return u.hostname === 'video.twimg.com' && /\.mp4$/i.test(u.pathname) ? u.href : null;
    if (CDN[platform] && !CDN[platform].some(domain => under(u.hostname, domain))) return null;
    const ext = u.pathname.toLowerCase().match(/\.(\w{1,5})$/)?.[1];
    return (ext ? TYPES[ext] : EXTS[mimeOf(type)]) ? u.href : null;
  }

  function variant(raw, platform) {
    const type = mimeOf(raw?.type || raw?.content_type);
    const url = mediaURL(raw?.url, platform, type);
    if (!url) return null;
    const path = new URL(url).pathname;
    const ext = path.toLowerCase().match(/\.(\w{1,5})$/)?.[1] || EXTS[type];
    const size = path.match(/\/(\d{2,5})x(\d{2,5})\//); // X: /1280x720/
    const hint = path.match(/\/mp4-(\d{3,4})p-/);       // LinkedIn: /mp4-720p-
    return {url, ext, type: TYPES[ext], bitrate: number(raw.bitrate),
      width: number(raw.width) || number(size?.[1]), height: number(raw.height) || number(size?.[2]) || number(hint?.[1]),
      note: typeof raw.note === 'string' ? raw.note.slice(0, 40) : ''};
  }

  // Valid versions without duplicates, best first.
  function variants(raw, platform) {
    const unique = new Map();
    for (const item of list(raw).slice(0, 100)) {
      const v = variant(item, platform);
      if (v && !unique.has(v.url)) unique.set(v.url, v);
    }
    return [...unique.values()].sort((a, b) => b.bitrate - a.bitrate || b.width * b.height - a.width * a.height || b.height - a.height);
  }

  function visit(data, onNode) {
    const stack = [data], seen = new Set();
    while (stack.length && seen.size < 30000) {
      const node = stack.pop();
      if (!node || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);
      onNode(node);
      for (const child of Object.values(node)) if (child && typeof child === 'object') stack.push(child);
    }
  }

  // A video belongs to the post node that carries it, never to an outer timeline entry.
  function extractX(data) {
    const found = new Map();
    visit(data, node => {
      const owner = String(node.rest_id || node.id_str || ''), legacy = node.legacy || node;
      const media = legacy.extended_entities?.media || legacy.entities?.media;
      if (!/^\d+$/.test(owner) || !Array.isArray(media)) return;
      media.slice(0, 16).forEach((m, i) => {
        if (!m?.video_info || !['video', 'animated_gif'].includes(m.type)) return;
        const key = `x:${owner}:${m.media_key || m.id_str || i}`;
        found.set(key, {key, owner, variants: variants((found.get(key)?.variants || []).concat(m.video_info.variants || []), 'x')});
      });
    });
    return [...found.values()];
  }

  function extractInstagram(data, code) {
    const found = new Map();
    function add(node, index) {
      if (!node || typeof node !== 'object') return;
      const width = node.original_width || node.dimensions?.width, height = node.original_height || node.dimensions?.height;
      const raw = list(node.video_versions).map(v => ({width, height, ...v, type: 'video/mp4'}));
      if (typeof node.video_url === 'string') raw.push({url: node.video_url, type: 'video/mp4', width, height});
      const vv = variants(raw, 'instagram'), key = `instagram:${node.id || node.pk || index}`;
      if (vv.length) found.set(key, {key, variants: vv});
    }
    visit(data, node => {
      if (String(node.shortcode || node.code || '') !== code) return;
      add(node, 0);
      list(node.carousel_media).slice(0, 16).forEach((m, i) => add(m, i + 1));
      list(node.edge_sidecar_to_children?.edges).slice(0, 16).forEach((e, i) => add(e?.node, i + 1));
    });
    return [...found.values()];
  }

  function extractTikTok(data, id) {
    const found = [];
    visit(data, node => {
      const video = node.video;
      if (found.length || String(node.id || node.aweme_id || '') !== id || !video || typeof video !== 'object') return;
      const raw = [];
      function add(address, extra) {
        if (!address) return;
        const urls = typeof address === 'string' ? [address] : list(address.urlList || address.UrlList || address.url_list);
        for (const url of urls.slice(0, 20)) raw.push({url, type: 'video/mp4', bitrate: video.bitrate || video.bitRate,
          width: address.width || address.Width || video.width, height: address.height || address.Height || video.height, ...extra});
      }
      add(video.playAddr || video.play_addr);
      add(video.downloadAddr || video.download_addr, {note: '下载版，可能带水印'});
      for (const rate of list(video.bitrateInfo || video.bitrate_info || video.bit_rate).slice(0, 50)) {
        add(rate?.PlayAddr || rate?.playAddr || rate?.play_addr, {bitrate: rate?.Bitrate || rate?.bitrate || rate?.bit_rate});
      }
      const vv = variants(raw, 'tiktok');
      if (vv.length) found.push({key: `tiktok:${id}`, variants: vv});
    });
    return found;
  }

  // Videos in page JSON (X, Instagram, TikTok). On a single-post page, only that post's videos.
  function extract(data, info) {
    if (info.platform === 'x') return extractX(data).filter(m => !info.id || m.owner === info.id);
    if (info.platform === 'instagram' && info.id) return extractInstagram(data, info.id);
    if (info.platform === 'tiktok' && info.id) return extractTikTok(data, info.id);
    return [];
  }

  // LinkedIn marks each post with its activity URN and lists file versions in video[data-sources].
  function linkedInActivity(element) {
    const post = element.closest('[data-activity-urn],[data-featured-activity-urn]');
    const urn = post?.getAttribute('data-activity-urn') || post?.getAttribute('data-featured-activity-urn') || '';
    return urn.match(/^urn:li:activity:(\d+)$/)?.[1] || '';
  }
  function linkedInSources(root) {
    const found = [];
    for (const video of [...root.querySelectorAll('video[data-sources]')].slice(0, 50)) {
      let sources;
      try { sources = JSON.parse(video.getAttribute('data-sources')); } catch { continue; }
      const vv = variants(list(sources).map(s => ({url: s?.src, type: s?.type, bitrate: s?.['data-bitrate'], width: s?.width, height: s?.height})), 'linkedin');
      const owner = linkedInActivity(video);
      if (owner && vv.length) found.push({video, owner, variants: vv});
    }
    return found;
  }

  globalThis.ClipCore = Object.freeze({pageInfo, variants, extract, linkedInActivity, linkedInSources});
})();
