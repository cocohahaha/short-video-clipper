/* MAIN world: read only the public source list of visible LinkedIn players. */
(() => {
  const C = globalThis.XClipCore;
  if (globalThis.__vclipLinkedInPlayersV1 || !C || C.pageInfo(location.href)?.platform !== 'linkedin') return;
  Object.defineProperty(globalThis,'__vclipLinkedInPlayersV1',{value:true});
  let active = true;
  const bounded = (value,max) => typeof value === 'string' ? value.slice(0,max) : '';
  const mime = value => typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : '';
  const dimension = value => {
    if (!['number','string'].includes(typeof value)) return 0;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.round(n) : 0;
  };
  function visible(video) {
    const r = video.getBoundingClientRect();
    return [r.width,r.height,r.top,r.bottom,r.left,r.right].every(Number.isFinite) && r.width > 0 && r.height > 0 &&
      r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  }
  function adaptive(source,type) {
    try {
      const u = new URL(source);
      return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
        (u.hostname === 'licdn.com' || u.hostname.endsWith('.licdn.com')) &&
        (/(?:mpegurl|dash\+xml)/i.test(type) || /\.(?:m3u8|mpd)(?:\/|$)/i.test(u.pathname));
    } catch { return false; }
  }
  function scan() {
    const info = C.pageInfo(location.href);
    if (!active || info?.platform !== 'linkedin') return;
    const media = [];
    try {
      const videos = document.querySelectorAll('video'); let visibleCount = 0;
      for (let videoIndex = 0; videoIndex < Math.min(videos.length,100); videoIndex++) {
        const video = videos[videoIndex];
        try {
          if (!visible(video)) continue;
          if (++visibleCount > 16) break;
          const player = video.player || video.parentElement?.player;
          if (typeof player?.currentSources !== 'function') continue;
          const sources = player.currentSources();
          if (!Array.isArray(sources)) continue;
          const raw = []; let hls = false;
          for (const source of sources.slice(0,100)) {
            if (!source || typeof source !== 'object' || Array.isArray(source) || typeof source.src !== 'string' || source.src.length > 8192) continue;
            // Inline VHS/DASH payloads can be very large; never copy them into bridge messages.
            if (!source.src.startsWith('https://')) continue;
            const type = mime(source.type);
            hls ||= adaptive(source.src,type);
            if(type !== 'video/mp4') continue;
            const width = dimension(source.width), actualHeight = dimension(source.height);
            let hintedHeight = 0;
            try { hintedHeight = dimension(new URL(source.src).pathname.match(/\/mp4-(\d{2,5})p-/i)?.[1]); } catch {}
            raw.push({url:source.src,content_type:type,bitrate:source['data-bitrate'],width,height:actualHeight || hintedHeight,
              sourceLabel:!actualHeight && hintedHeight ? `URL 标记 ${hintedHeight}p（推测，非实测尺寸）` : ''});
          }
          const variants = C.variants(raw,'linkedin');
          if (!variants.length && !hls) continue;
          const elementId = bounded(video.id,256), elementSrc = bounded(video.getAttribute('src') || '',512);
          media.push({videoIndex,elementId,elementSrc,key:'linkedin-player:' + videoIndex + ':' + elementId,type:'video',source:'player',
            label:`屏幕播放器 ${videoIndex + 1} · LinkedIn · 请核对画面`,variants,hls});
        } catch { /* A disposed or incompatible website player must not break its neighbors. */ }
      }
    } catch { /* The document can change while scanning. */ }
    if (!active || C.pageInfo(location.href)?.key !== info.key) return;
    window.postMessage({channel:'vclip:linkedin-players:v1',pageKey:info.key,media},location.origin);
  }
  window.addEventListener('message',event => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.channel === 'vclip:observe-mode:v2') {
      if (typeof event.data.enabled !== 'boolean') return;
      active = event.data.enabled;
      if (active) scan();
      return;
    }
    if (event.data?.channel === 'vclip:request:v2') scan();
  });
  scan();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',scan,{once:true});
})();
