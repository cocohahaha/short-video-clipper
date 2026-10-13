/* Pure shared functions. Page JSON and messages are always untrusted input. */
(() => {
  const MIME_EXT = Object.freeze({'video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov','video/x-m4v':'m4v','video/ogg':'ogv'});
  const EXT_MIME = Object.freeze({mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime',m4v:'video/x-m4v',ogv:'video/ogg'});
  const CDN = Object.freeze({instagram:['cdninstagram.com','fbcdn.net'],tiktok:['tiktokcdn.com','tiktokcdn-us.com','tiktokcdn-eu.com','tiktokv.com','tiktok.com','byteoversea.com','ibytedtos.com','bytefcdn-oversea.com','muscdn.com','akamaized.net']});
  const suffix = (host,domain) => host === domain || host.endsWith('.' + domain);
  const has = (object,key) => Object.prototype.hasOwnProperty.call(object,key);
  const cleanMime = value => typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : '';
  const safeLabel = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,80) : '';
  function statusId(value) {
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' || !['x.com','twitter.com'].includes(u.hostname) || u.username || u.password || u.port) return null;
      return u.pathname.match(/^\/(?:[^/]+\/status|i\/web\/status)\/(\d+)(?:\/|$)/)?.[1] || null;
    } catch { return null; }
  }
  // Page keys keep query strings; generic sites may route using fragments.
  function pageInfo(value) {
    try {
      const u = new URL(value);
      if (!['http:','https:'].includes(u.protocol) || u.username || u.password) return null;
      let platform = 'web', id = '', label = u.hostname, detail = true;
      if (['x.com','twitter.com','www.x.com','www.twitter.com'].includes(u.hostname)) {
        platform = 'x'; label = 'X'; id = u.protocol === 'https:' && !u.port ? u.pathname.match(/^\/(?:[^/]+\/status|i\/web\/status)\/(\d+)(?:\/|$)/)?.[1] || '' : ''; detail = !!id;
      } else if (['instagram.com','www.instagram.com'].includes(u.hostname)) {
        platform = 'instagram'; label = 'Instagram';
        id = u.pathname.match(/^\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1] || ''; detail = !!id;
      } else if (['tiktok.com','www.tiktok.com'].includes(u.hostname)) {
        platform = 'tiktok'; label = 'TikTok';
        id = u.pathname.match(/^\/@[^/]+\/video\/(\d+)(?:\/|$)/)?.[1] || ''; detail = !!id;
      }
      if (platform !== 'web') u.hash = '';
      return {key:u.href,platform,id,origin:u.origin,label,detail};
    } catch { return null; }
  }
  function publicHost(host) {
    const h = host.toLowerCase().replace(/\.$/,'');
    if (!h || h.includes(':') || h.startsWith('[')) return false; // No IPv6 literals or mapped addresses.
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
      const p = h.split('.').map(Number);
      if (p.some(n => n > 255)) return false;
      const [a,b,c] = p;
      return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
        (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
    }
    if (!h.includes('.') || !/^[a-z0-9.-]+$/.test(h) || h.split('.').some(p => !p || p.startsWith('-') || p.endsWith('-'))) return false;
    return !['localhost','localdomain','local','internal','lan','home','home.arpa','test','invalid','example','onion'].some(domain => suffix(h,domain));
  }
  // Extensionless links require a known video MIME supplied by a video field/element.
  function mediaURL(value,platform = 'x',mime = '') {
    try {
      if (typeof value !== 'string' || !value || value.length > 8192) return null;
      const u = new URL(value);
      if (u.username || u.password || u.port) return null;
      const supplied = cleanMime(mime);
      if (platform === 'x') {
        if (u.protocol !== 'https:' || u.hostname !== 'video.twimg.com' || !/\.mp4$/i.test(u.pathname) || (supplied && supplied !== 'video/mp4')) return null;
        return u.href;
      }
      if (!['web','instagram','tiktok'].includes(platform) || !['http:','https:'].includes(u.protocol) || !publicHost(u.hostname)) return null;
      if (platform !== 'web' && (u.protocol !== 'https:' || !CDN[platform].some(domain => suffix(u.hostname,domain)))) return null;
      const path = u.pathname.toLowerCase();
      if (/\.(?:m3u8|mpd|m4s|ts)(?:\/|$)/.test(path)) return null;
      const extension = path.match(/\.([a-z0-9]{1,10})$/)?.[1] || '';
      if (extension ? !has(EXT_MIME,extension) : !has(MIME_EXT,supplied)) return null;
      if (supplied && !has(MIME_EXT,supplied)) return null;
      // MP4/M4V share a container; other explicit extension/MIME conflicts fail closed.
      if (extension && supplied && MIME_EXT[supplied] !== extension && !(['mp4','m4v'].includes(extension) && ['mp4','m4v'].includes(MIME_EXT[supplied]))) return null;
      return u.href;
    } catch { return null; }
  }
  const dimension = value => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.round(n) : 0;
  };
  function variant(v,platform = 'x') {
    if (!v || typeof v !== 'object') return null;
    const mime = cleanMime(v.content_type || v.mime || v.mimeType);
    const url = mediaURL(v.url,platform,mime);
    if (!url) return null;
    const path = new URL(url).pathname;
    const size = path.match(/\/(\d{2,5})x(\d{2,5})\//);
    const ext = path.match(/\.(mp4|webm|mov|m4v|ogv)$/i)?.[1].toLowerCase() || MIME_EXT[mime];
    const bitrate = Number(v.bitrate);
    return {url,bitrate:Number.isFinite(bitrate) && bitrate > 0 ? Math.min(bitrate,1e9) : 0,
      width:dimension(v.width) || (size ? +size[1] : 0),height:dimension(v.height) || (size ? +size[2] : 0),ext,mime:mime || EXT_MIME[ext],sourceLabel:safeLabel(v.sourceLabel || v.label)};
  }
  function variants(list,platform = 'x') {
    if (!Array.isArray(list)) return [];
    const unique = new Map();
    for (const raw of list.slice(0,100)) {
      const v = variant(raw,platform);
      if (!v) continue;
      const old = unique.get(v.url);
      if (!old || v.bitrate > old.bitrate || v.width*v.height > old.width*old.height) unique.set(v.url,v);
    }
    return [...unique.values()].sort((a,b) => b.bitrate-a.bitrate || b.width*b.height-a.width*a.height);
  }
  // Traverse to locate exact post ownership; video fields are parsed by an adapter.
  function visit(data,onNode) {
    const stack = [{node:data,depth:0}], seen = new Set(); let visited = 0;
    while (stack.length && visited++ < 30000) {
      const {node,depth} = stack.pop();
      if (!node || typeof node !== 'object' || depth > 40 || seen.has(node)) continue;
      seen.add(node); onNode(node);
      for (const child of Object.values(node)) if (child && typeof child === 'object') stack.push({node:child,depth:depth+1});
    }
  }
  function extract(data,target) {
    const found = new Map();
    if (!target || typeof target !== 'string') return [];
    visit(data,node => {
      if (String(node.rest_id || node.id_str || '') !== target) return;
      const legacy = node.legacy || node, media = legacy.extended_entities?.media || legacy.entities?.media || [];
      if (Array.isArray(media)) media.slice(0,16).forEach((m,i) => {
        if (!m?.video_info || !['video','animated_gif'].includes(m.type)) return;
        const key = String(m.media_key || m.id_str || i).slice(0,100);
        found.set(key,{key,type:m.type,variants:variants(m.video_info.variants),
          hls:Array.isArray(m.video_info.variants) && m.video_info.variants.some(v => /mpegurl/i.test(v?.content_type || ''))});
      });
    });
    return [...found.values()].slice(0,16);
  }
  const streaming = value => typeof value === 'string' && /\.m3u8(?:[?#]|$)/i.test(value);
  function extractInstagram(data,info) {
    const found = new Map();
    function add(node,index) {
      if (!node || typeof node !== 'object') return;
      const raw = [], width = node.original_width || node.dimensions?.width || node.width, height = node.original_height || node.dimensions?.height || node.height;
      if (typeof node.video_url === 'string') raw.push({url:node.video_url,content_type:'video/mp4',width,height});
      if (Array.isArray(node.video_versions)) for (const v of node.video_versions.slice(0,100)) {
        if (v && typeof v.url === 'string') raw.push({url:v.url,content_type:'video/mp4',bitrate:v.bitrate,width:v.width || width,height:v.height || height});
      }
      if (!raw.length && !node.is_video && node.media_type !== 2) return;
      const key = 'instagram:' + info.id + ':' + String(node.id || node.pk || index).slice(0,100);
      found.set(key,{key,type:'video',variants:variants(raw,'instagram'),hls:raw.some(v => streaming(v.url)),source:'page'});
    }
    visit(data,node => {
      if (String(node.shortcode || node.code || '') !== info.id) return;
      add(node,0);
      if (Array.isArray(node.carousel_media)) node.carousel_media.slice(0,16).forEach((m,i) => add(m,i+1));
      const edges = node.edge_sidecar_to_children?.edges;
      if (Array.isArray(edges)) edges.slice(0,16).forEach((e,i) => add(e?.node,i+1));
    });
    return [...found.values()].slice(0,16);
  }
  function extractTikTok(data,info) {
    const found = new Map();
    visit(data,node => {
      if (String(node.id || node.aweme_id || '') !== info.id || !node.video || typeof node.video !== 'object') return;
      const video = node.video, raw = [];
      function add(address,bitrate = 0,metadata = video,sourceLabel = '播放版本') {
        if (!address) return;
        const urls = typeof address === 'string' ? [address] : address.urlList || address.UrlList || address.url_list;
        if (!Array.isArray(urls)) return;
        const width = address.width || address.Width || metadata.width || metadata.Width || video.width || video.Width;
        const height = address.height || address.Height || metadata.height || metadata.Height || video.height || video.Height;
        for (const url of urls.slice(0,20)) if (typeof url === 'string') raw.push({url,bitrate,content_type:'video/mp4',width,height,sourceLabel});
      }
      add(video.playAddr || video.play_addr,video.bitrate || video.bitRate || 0);
      add(video.downloadAddr || video.download_addr,video.bitrate || video.bitRate || 0,video,'下载版本（可能含水印）');
      const rates = video.bitrateInfo || video.bitrate_info || video.bit_rate;
      if (Array.isArray(rates)) for (const rate of rates.slice(0,50)) if (rate && typeof rate === 'object') {
        add(rate.PlayAddr || rate.playAddr || rate.play_addr,rate.Bitrate || rate.bitrate || rate.bit_rate,rate);
      }
      const key = 'tiktok:' + info.id;
      found.set(key,{key,type:'video',variants:variants(raw,'tiktok'),hls:raw.some(v => streaming(v.url)),source:'page'});
    });
    return [...found.values()].slice(0,16);
  }
  function extractPlatform(data,info) {
    if (!info?.detail || typeof info.id !== 'string' || !info.id) return [];
    if (info.platform === 'x') return extract(data,info.id);
    if (info.platform === 'instagram') return extractInstagram(data,info);
    if (info.platform === 'tiktok') return extractTikTok(data,info);
    return []; // Generic sites use explicit DOM video sources, never arbitrary JSON URLs.
  }
  function filename(value,fallback = 'video',ext = 'mp4') {
    ext = typeof ext === 'string' && has(EXT_MIME,ext.toLowerCase()) ? ext.toLowerCase() : 'mp4';
    let s = typeof value === 'string' ? value : '';
    const clean = value => value.normalize('NFC').trim().replace(/\.(?:mp4|webm|mov|m4v|ogv)$/i,'').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g,'-').replace(/^\.+/,'').replace(/[. ]+$/,'').trim();
    s = [...clean(s)].slice(0,100).join('');
    if (!s) s = [...clean(typeof fallback === 'string' ? fallback : '')].slice(0,100).join('') || 'video';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)) s = '_' + s;
    return s + '.' + ext;
  }
  function choose(list,quality,platform = 'x') {
    const vv = variants(list,platform);
    if (quality === 'best') return vv[0] || null;
    if (quality === 'smallest') return vv.at(-1) || null;
    return vv.find(v => v.url === quality) || null;
  }
  function label(v) {
    return `${v.width && v.height ? `${v.width} × ${v.height}` : '分辨率未知'}${v.bitrate ? ` · ${(v.bitrate/1e6).toFixed(2)} Mbps` : ''}${v.ext && v.ext !== 'mp4' ? ` · ${v.ext.toUpperCase()}` : ''}${safeLabel(v.sourceLabel || v.label) ? ' · ' + safeLabel(v.sourceLabel || v.label) : ''}`;
  }
  function downloadError(code) {
    const known = {USER_CANCELED:'已取消保存。',NETWORK_FAILED:'网络连接失败，请重新检测并重试。',NETWORK_TIMEOUT:'下载超时，请重新检测并重试。',SERVER_FORBIDDEN:'媒体服务器拒绝访问，地址可能过期或需要权限。',SERVER_UNAUTHORIZED:'媒体服务器要求认证，无法直接保存。',SERVER_BAD_CONTENT:'服务器返回的内容不可下载。',SERVER_FAILED:'媒体服务器错误，请稍后重试。',FILE_ACCESS_DENIED:'无法写入所选位置，请更换保存位置。',FILE_NO_SPACE:'磁盘空间不足。',FILE_BLOCKED:'Chrome 或系统阻止了下载，请查看下载记录。'};
    return known[code] || (typeof code === 'string' && /cancel/i.test(code) ? '已取消保存。' : code || '未知下载错误');
  }
  globalThis.XClipCore = Object.freeze({statusId,pageInfo,mediaURL,variant,variants,extract,extractPlatform,filename,choose,label,downloadError});
})();
