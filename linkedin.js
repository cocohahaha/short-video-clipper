/* LinkedIn public-page adapter. It reads existing, exactly attributed video fields only. */
(() => {
  const ATTRIBUTE_LIMIT = 128 * 1024, HTML_LIMIT = 2 * 1024 * 1024;
  const encoder = new TextEncoder();
  const within = (text,limit) => typeof text === 'string' && text.length <= limit && encoder.encode(text).byteLength <= limit;
  const validInfo = info => info?.platform === 'linkedin' && info.detail === true && typeof info.id === 'string' && /^\d{1,30}$/.test(info.id);
  const mime = value => typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : '';
  const dimension = value => {
    if (!['string','number'].includes(typeof value)) return 0;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.round(n) : 0;
  };
  function activityId(video) {
    const owner = video.closest('[data-activity-urn],[data-featured-activity-urn]');
    if (!owner) return null;
    const values = ['data-activity-urn','data-featured-activity-urn'].map(name => owner.getAttribute(name)).filter(Boolean);
    // A nearer neighboring or reshared activity must never inherit the outer post's ownership.
    if (!values.length || !values.every(value => value === values[0])) return null;
    return values[0].match(/^urn:li:activity:(\d{1,30})$/)?.[1] || null;
  }
  function visibleRect(video,root) {
    const view = root.defaultView || root.ownerDocument?.defaultView || globalThis;
    if (typeof video.getBoundingClientRect !== 'function' || !(view.innerWidth > 0 && view.innerHeight > 0)) return null;
    const rect = video.getBoundingClientRect();
    if (![rect.width,rect.height,rect.top,rect.bottom,rect.left,rect.right].every(Number.isFinite)) return null;
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < view.innerHeight && rect.right > 0 && rect.left < view.innerWidth ? rect : null;
  }
  function getVisiblePosts(root,info) {
    if (info?.platform !== 'linkedin' || (!validInfo(info) && info.detail !== false) || typeof root?.querySelectorAll !== 'function') return [];
    try {
      const candidates = [], videos = root.querySelectorAll('video');
      for (let i = 0; i < Math.min(videos.length,1000); i++) {
        const video = videos[i], rect = visibleRect(video,root);
        if (!rect) continue;
        const id = activityId(video);
        if (!id || (info.detail && id !== info.id)) continue;
        candidates.push({id,top:rect.top,left:rect.left});
      }
      candidates.sort((a,b) => a.top-b.top || a.left-b.left);
      const found = new Map();
      for (const candidate of candidates) {
        const url = 'https://www.linkedin.com/feed/update/urn:li:activity:' + candidate.id + '/';
        if (!found.has(candidate.id)) found.set(candidate.id,{id:candidate.id,key:url,url});
        if (found.size >= 5) break;
      }
      return [...found.values()];
    } catch { return []; }
  }
  function streamingSource(source) {
    try {
      if (typeof source.src !== 'string' || source.src.length > 8192) return false;
      const u = new URL(source.src);
      if (u.protocol !== 'https:' || u.username || u.password || u.port || !(u.hostname === 'licdn.com' || u.hostname.endsWith('.licdn.com'))) return false;
      return /(?:mpegurl|dash\+xml)/i.test(mime(source.type)) || /\.(?:m3u8|mpd)(?:\/|$)/i.test(u.pathname);
    } catch { return false; }
  }
  function parseDocument(root,info) {
    const C = globalThis.XClipCore;
    const feed = info?.platform === 'linkedin' && info.detail === false;
    if ((!validInfo(info) && !feed) || !C || typeof root?.querySelectorAll !== 'function') return [];
    const found = new Map(), visible = feed ? new Set(getVisiblePosts(root,info).map(post => post.id)) : null;
    if (feed && !visible.size) return [];
    try {
      const videos = root.querySelectorAll('video[data-sources]');
      const selected = [];
      for (let index = 0; index < Math.min(videos.length,feed ? 1000 : 16); index++) {
        const video = videos[index], ownerId = activityId(video);
        if (!ownerId || (feed ? !visible.has(ownerId) : ownerId !== info.id)) continue;
        const rect = feed ? visibleRect(video,root) : null;
        if (feed && !rect) continue;
        selected.push({video,ownerId,index,top:rect?.top || 0,left:rect?.left || 0});
      }
      if (feed) selected.sort((a,b) => a.top-b.top || a.left-b.left);
      for (const {video,ownerId,index} of selected.slice(0,16)) {
        const text = video.getAttribute('data-sources');
        if (!within(text,ATTRIBUTE_LIMIT)) continue;
        let sources;
        try { sources = JSON.parse(text); } catch { continue; }
        if (!Array.isArray(sources)) continue;
        const raw = []; let hls = false;
        for (const source of sources.slice(0,100)) {
          if (!source || typeof source !== 'object' || Array.isArray(source) || typeof source.src !== 'string') continue;
          hls ||= streamingSource(source);
          const width = dimension(source.width || source['data-width']);
          const actualHeight = dimension(source.height || source['data-height']);
          let hintedHeight = 0;
          try { hintedHeight = dimension(new URL(source.src).pathname.match(/\/mp4-(\d{2,5})p-/i)?.[1]); } catch {}
          raw.push({url:source.src,content_type:mime(source.type),bitrate:source['data-bitrate'],width,
            height:actualHeight || hintedHeight,
            sourceLabel:!actualHeight && hintedHeight ? `URL 标记 ${hintedHeight}p（推测，非实测尺寸）` : ''});
        }
        const variants = C.variants(raw,'linkedin');
        if (!variants.length && !hls) continue;
        const asset = video.getAttribute('data-digitalmedia-asset-urn')?.match(/^urn:li:digitalmediaAsset:([A-Za-z0-9_-]{1,100})$/)?.[1];
        const key = 'linkedin:' + ownerId + ':' + (asset || index);
        const old = found.get(key);
        if (old) {
          old.variants = C.variants([...old.variants,...variants],'linkedin');
          old.hls ||= hls;
        } else {
          found.set(key,{key,ownerId,type:'video',source:'page',label:`视频 ${found.size + 1} · LinkedIn 完整文件${feed ? ' · 活动 ' + ownerId : ''}`,variants,hls});
        }
      }
    } catch { return [...found.values()]; }
    return [...found.values()];
  }
  function parseHTML(html,info) {
    if (!validInfo(info) || !within(html,HTML_LIMIT) || typeof globalThis.document?.createElement !== 'function') return [];
    try {
      // Template contents stay detached: scripts do not execute and media does not load.
      const template = document.createElement('template');
      template.innerHTML = html;
      return parseDocument(template.content,info);
    } catch { return []; }
  }
  globalThis.XClipLinkedIn = Object.freeze({parseDocument,parseHTML,getVisiblePosts});
})();
