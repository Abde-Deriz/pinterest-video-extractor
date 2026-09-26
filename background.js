/* Pinterest Video Extractor — background service worker (MV3 classic) */
importScripts('lib/jszip.min.js'); // provide JSZip v3.x here

// Cache HTML per pin URL
const htmlCache = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'BG_FETCH_DETAILS') {
    (async () => {
      const { pinUrls } = msg.payload;
      const results = [];
      let processed = 0;

      for (const pinUrl of pinUrls) {
        try {
          const html = await fetchPinHtml(pinUrl);
          const { mp4, title, thumb } = extractMp4AndTitleFromHtml(html);

          if (mp4 && mp4.endsWith('.mp4')) {
            results.push({ pinUrl, videoUrl: mp4, title: title || '', thumb: thumb || '', ok: true });
          } else {
            results.push({ pinUrl, videoUrl: '', title: title || '', thumb: thumb || '', ok: false, reason: 'No MP4 found' });
          }
        } catch (e) {
          results.push({ pinUrl, videoUrl: '', title: '', ok: false, reason: e?.message || 'Fetch/parse error' });
        }
        processed++;
        chrome.runtime.sendMessage({ type: 'BG_PROGRESS', payload: { processed, total: pinUrls.length } });
      }

      sendResponse({ ok: true, results });
    })();
    return true; // async
  }

  if (msg?.type === 'BG_ZIP_AND_DOWNLOAD') {
    (async () => {
      try {
        const { items } = msg.payload; // [{pinUrl, videoUrl, title}]
        if (typeof JSZip === 'undefined') throw new Error('JSZip not found. Place lib/jszip.min.js');
        const zip = new JSZip();
        let done = 0;

        for (const item of items) {
          try {
            const ab = await fetchAsArrayBuffer(item.videoUrl);
            const safeName = sanitizeFilename(suggestFileName(item));
            zip.file(safeName, ab);
            done++;
            chrome.runtime.sendMessage({ type: 'BG_ZIP_PROGRESS', payload: { done, total: items.length } });
          } catch (e) {
            chrome.runtime.sendMessage({ type: 'BG_ZIP_PROGRESS', payload: { done, total: items.length, error: `Failed: ${item.videoUrl}` } });
          }
        }

        const base64 = await zip.generateAsync({ type: 'base64' });
        const url = `data:application/zip;base64,${base64}`;
        const when = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
        await chrome.downloads.download({ url, filename: `pinterest-videos-${when}.zip`, saveAs: true });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || 'ZIP error' });
      }
    })();
    return true; // async
  }

  if (msg?.type === 'BG_DOWNLOAD_INDIVIDUAL') {
    (async () => {
      try {
        const { items } = msg.payload;
        let done = 0;
        for (const item of items) {
          const filename = sanitizeFilename(suggestFileName(item));
          await chrome.downloads.download({ url: item.videoUrl, filename, saveAs: false });
          done++;
          chrome.runtime.sendMessage({ type: 'BG_DL_PROGRESS', payload: { done, total: items.length } });
        }
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || 'Download error' });
      }
    })();
    return true; // async
  }
});

async function fetchPinHtml(pinUrl) {
  if (htmlCache.has(pinUrl)) return htmlCache.get(pinUrl);
  const res = await fetch(pinUrl, { credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  htmlCache.set(pinUrl, text);
  return text;
}

async function fetchAsArrayBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.arrayBuffer();
}

function suggestFileName({ title, videoUrl, pinUrl }) {
  // Prefer a stable ID
  const idMatch = (videoUrl && videoUrl.match(/[a-f0-9]{16,32}(?=\.mp4)/i)) || (pinUrl && pinUrl.match(/pin\/(\d+)/));
  const id = idMatch ? (Array.isArray(idMatch) ? idMatch[1] || idMatch[0] : idMatch[0]) : 'video';
  const base = (title || '').trim() ? title.slice(0, 60) : `pin-${id}`;
  return `${base} [${id}].mp4`;
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|\n\r]+/g, '_');
}

// ======= Extraction (HTML → MP4 & Title) =======
function extractMp4AndTitleFromHtml(html) {
  // 1) __PWS_INITIAL_PROPS__
  const scriptMatch = html.match(/<script id="__PWS_INITIAL_PROPS__"[^>]*>([\s\S]*?)<\/script>/);
  if (scriptMatch) {
    const jsonText = decodeHtmlEntities(scriptMatch[1].trim());
    const fromJson = scanJsonForVideo(jsonText);
    if (fromJson?.mp4) return fromJson;
  }
  // 2) ld+json contentUrl
  const ldMatches = [...html.matchAll(/<script[^>]+type=['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script>/g)];
  for (const m of ldMatches) {
    const block = decodeHtmlEntities(m[1]);
    try {
      const data = JSON.parse(block);
      const mp4 = deepFindFirstString(data, s => /https:\/\/[^\s"']+\.mp4(\?[^"']*)?$/.test(s) && /pinimg\.com/.test(s));
      if (mp4) {
        const title = deepFindFirstString(data, s => typeof s === 'string' && s.length < 200 && /\S/.test(s));
        return { mp4, title: title || '', thumb: '' };
      }
    } catch {}
  }
  // 3) Regex hunt
  const mp4Regex = /(https:\/\/[^\s"']+pinimg\.com\/[^\s"']+\.mp4(?:\?[^"']*)?)/g;
  const mp4s = [];
  let m;
  while ((m = mp4Regex.exec(html))) mp4s.push(m[1]);
  const preferred = pickPreferredMp4(mp4s);
  if (preferred) {
    const title = extractTitleLoose(html);
    return { mp4: preferred, title, thumb: '' };
  }
  // 4) Heuristic m3u8 → expMp4
  const hls = html.match(/https:\/\/[^\s"']+pinimg\.com\/[^\s"']+\.m3u8/);
  if (hls) {
    const tryMp4 = hls[0]
      .replace('/hls/', '/expMp4/')
      .replace(/\.m3u8(\?[^"']*)?$/, '_t1.mp4');
    if (/\.mp4$/.test(tryMp4)) return { mp4: tryMp4, title: extractTitleLoose(html), thumb: '' };
  }
  return { mp4: '', title: extractTitleLoose(html) || '', thumb: '' };
}

function decodeHtmlEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function scanJsonForVideo(jsonText) {
  try {
    const data = JSON.parse(jsonText);
    const mp4 = deepFindFirstString(data, s => /pinimg\.com\/videos\/.+\.mp4(\?[^"']*)?$/.test(s));
    const title = deepFindFirstString(data, s => typeof s === 'string' && s.length <= 140 && /\S/.test(s) && !/\.mp4/.test(s));
    const thumb = deepFindFirstString(data, s => /https:\/\/i\.pinimg\.com\/[^\"]+\.(?:jpg|png|webp)/.test(s));
    return { mp4, title: title || '', thumb: thumb || '' };
  } catch {}
  // Fallback regex scan
  const mp4Regex = /(https:\/\/[^\s"']+pinimg\.com\/[^\s"']+\.mp4(?:\?[^"']*)?)/g;
  const mp4s = [];
  let m;
  while ((m = mp4Regex.exec(jsonText))) mp4s.push(m[1]);
  const preferred = pickPreferredMp4(mp4s);
  return preferred ? { mp4: preferred, title: '', thumb: '' } : { mp4: '', title: '', thumb: '' };
}

function deepFindFirstString(obj, predicate) {
  const seen = new Set();
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (cur && typeof cur === 'object') {
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const k in cur) {
        const v = cur[k];
        if (typeof v === 'string' && predicate(v)) return v;
        if (v && typeof v === 'object') stack.push(v);
      }
    }
  }
  return '';
}

function pickPreferredMp4(list) {
  if (!list || !list.length) return '';
  const score = u => (
    (u.includes('/expMp4/') ? 3 : 0) +
    (u.includes('/1080p/') ? 2 : 0) +
    (u.includes('/720p/') ? 1 : 0)
  );
  return [...list].sort((a, b) => score(b) - score(a))[0];
}

function extractTitleLoose(html) {
  const og = html.match(/<meta[^>]+property=['"]og:title['"][^>]+content=['"]([^"']+)/i);
  if (og) return og[1];
  const t = html.match(/<title>([^<]+)<\/title>/i);
  if (t) return t[1].replace(/\s+\|\s+Pinterest.*$/, '').trim();
  return '';
}
