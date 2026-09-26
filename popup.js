function applyTheme(name) {
  const r = document.documentElement.style;
  if (name === 'pinterest') {
    r.setProperty('--bg', '#ffffff');
    r.setProperty('--card', '#ffffff');
    r.setProperty('--text', '#111111');
    r.setProperty('--muted', '#767676');
    r.setProperty('--accent', '#E60023');
    r.setProperty('--accent-700', '#ad081b');
    r.setProperty('--ok', '#118A38');
    r.setProperty('--fail', '#A11212');
    r.setProperty('--border', '#efefef');
    // keep shadow the same
  } else if (name === 'dark') {
    r.setProperty('--bg', '#0f1115');
    r.setProperty('--card', '#171a21');
    r.setProperty('--text', '#e6e6e6');
    r.setProperty('--muted', '#9aa0a6');
    r.setProperty('--accent', '#5b9cff');
    r.setProperty('--accent-700', '#3d7fe0');
    r.setProperty('--ok', '#12a150');
    r.setProperty('--fail', '#a11212');
    r.setProperty('--border', '#222');
  }
}

// Example: force Pinterest theme on load
applyTheme('pinterest');


// Storage helpers
const store = {
  async get() { return (await chrome.storage.local.get(['items']))?.items || []; },
  async set(items) { await chrome.storage.local.set({ items }); },
  async clear() { await chrome.storage.local.remove(['items']); }
};

// UI elements
const els = {
  close: document.getElementById('btnClose'),
  start: document.getElementById('btnStart'),
  clear: document.getElementById('btnClear'),
  targetCount: document.getElementById('targetCount'),
  grid: document.getElementById('grid'),
  selectAll: document.getElementById('btnSelectAll'),
  deselectAll: document.getElementById('btnDeselectAll'),
  exportCsv: document.getElementById('btnExportCsv'),
  zip: document.getElementById('btnZip'),
  indiv: document.getElementById('btnIndiv'),
  extractProgress: document.getElementById('extractProgress'),
  extractText: document.getElementById('extractText'),
  downloadProgress: document.getElementById('downloadProgress'),
  downloadText: document.getElementById('downloadText'),
};

// Initialize
(async function init() {
  const items = await store.get();
  render(items);
})();

els.close.addEventListener('click', () => window.close());

els.clear.addEventListener('click', async () => {
  await store.clear();
  render([]);
});

els.start.addEventListener('click', async () => {
  const max = Math.max(1, Math.min(500, parseInt(els.targetCount.value || '50', 10)));
  const tab = await getActiveTab();
  if (!tab?.id) return alert('Open a Pinterest page first.');

  // Step 1: collect pin URLs via content script
  const collected = await chrome.tabs.sendMessage(tab.id, { type: 'CS_COLLECT_PINS', payload: { max } })
    .catch(() => ({ ok: false, error: 'Content script not ready. Reload the page.' }));
  if (!collected?.ok) return alert(collected?.error || 'Failed collecting pins.');

  // Reset extract progress
  setExtractProgress(0, collected.urls.length);

  // Listen for progress ticks
  const progressHandler = (msg) => {
    if (msg?.type === 'BG_PROGRESS') {
      setExtractProgress(msg.payload.processed, msg.payload.total);
    }
  };
  chrome.runtime.onMessage.addListener(progressHandler);

  // Step 2: background resolves .mp4 + title per pin URL
  const { results } = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'BG_FETCH_DETAILS', payload: { pinUrls: collected.urls } }, (resp) => resolve(resp || { results: [] }));
  });

  chrome.runtime.onMessage.removeListener(progressHandler);

  // Merge with existing, de-dup by pinUrl
  const existing = await store.get();
  const byPin = new Map(existing.map(x => [x.pinUrl, x]));
  for (const r of results) {
    const selected = r.ok && r.videoUrl.endsWith('.mp4');
    byPin.set(r.pinUrl, { ...r, selected });
  }
  const merged = [...byPin.values()];
  await store.set(merged);
  render(merged);
});

els.selectAll.addEventListener('click', async () => {
  const items = await store.get();
  items.forEach(i => { if (i.ok && i.videoUrl) i.selected = true; });
  await store.set(items); render(items);
});

els.deselectAll.addEventListener('click', async () => {
  const items = await store.get();
  items.forEach(i => { i.selected = false; });
  await store.set(items); render(items);
});

els.exportCsv.addEventListener('click', async () => {
  const items = await store.get();
  const sel = items.filter(i => i.selected);
  const rows = [['pin_url', 'video_url', 'title']]
    .concat(sel.map(i => [i.pinUrl, i.videoUrl, (i.title || '').replace(/\n/g, ' ')]));
  const csv = rows.map(r => r.map(cell => '"' + (cell || '').replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const when = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  await chrome.downloads.download({ url, filename: `pinterest-videos-${when}.csv`, saveAs: true });
  URL.revokeObjectURL(url);
});

els.zip.addEventListener('click', async () => {
  const items = (await store.get()).filter(i => i.selected && i.ok && i.videoUrl);
  if (!items.length) return alert('Select at least one item with a valid MP4.');

  setDownloadProgress(0, items.length);
  const progressHandler = (msg) => {
    if (msg?.type === 'BG_ZIP_PROGRESS') {
      setDownloadProgress(msg.payload.done, msg.payload.total);
    }
  };
  chrome.runtime.onMessage.addListener(progressHandler);

  await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'BG_ZIP_AND_DOWNLOAD', payload: { items } }, () => resolve());
  });

  chrome.runtime.onMessage.removeListener(progressHandler);
});

els.indiv.addEventListener('click', async () => {
  const items = (await store.get()).filter(i => i.selected && i.ok && i.videoUrl);
  if (!items.length) return alert('Select at least one item with a valid MP4.');

  setDownloadProgress(0, items.length);
  const progressHandler = (msg) => {
    if (msg?.type === 'BG_DL_PROGRESS') {
      setDownloadProgress(msg.payload.done, msg.payload.total);
    }
  };
  chrome.runtime.onMessage.addListener(progressHandler);

  await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'BG_DOWNLOAD_INDIVIDUAL', payload: { items } }, () => resolve());
  });

  chrome.runtime.onMessage.removeListener(progressHandler);
});

function setExtractProgress(done, total) {
  els.extractProgress.max = total; els.extractProgress.value = done;
  els.extractText.textContent = `${done}/${total}`;
}
function setDownloadProgress(done, total) {
  els.downloadProgress.max = total; els.downloadProgress.value = done;
  els.downloadText.textContent = `${done}/${total}`;
}

function render(items) {
  els.grid.innerHTML = '';
  const observer = makeLazyObserver();
  for (const it of items) {
    const card = document.createElement('div');
    card.className = 'card';

    // Checkbox overlay
    const cbWrap = document.createElement('div');
    cbWrap.className = 'cb-overlay';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = !!it.selected;
    cb.addEventListener('click', async (e) => {
      e.stopPropagation();
      const all = await store.get();
      const idx = all.findIndex(x => x.pinUrl === it.pinUrl);
      if (idx >= 0) { all[idx].selected = cb.checked; await store.set(all); }
    });
    cbWrap.appendChild(cb);

    // Preview box
    const preview = document.createElement('div');
    preview.className = 'preview';

    // Status badge (MP4/No MP4)
    const badge = document.createElement('div');
    badge.className = `badge ${it.ok && it.videoUrl ? 'ok' : 'fail'}`;
    badge.textContent = it.ok && it.videoUrl ? 'MP4' : 'No MP4';

    // Video or thumb
    if (it.videoUrl) {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.loop = true;
      v.preload = 'metadata';
      if (it.thumb) v.poster = it.thumb;
      v.setAttribute('data-src', it.videoUrl); // lazy src
      v.addEventListener('mouseenter', () => { if (v.readyState >= 2) v.play().catch(() => { }); });
      v.addEventListener('mouseleave', () => { v.pause(); v.currentTime = 0; });
      preview.appendChild(v);
      observer.observe(v);
    } else if (it.thumb) {
      const img = document.createElement('img');
      img.src = it.thumb;
      preview.appendChild(img);
    } else {
      const span = document.createElement('span');
      span.className = 'small';
      span.textContent = 'No preview';
      preview.appendChild(span);
    }

    // Overlay labels with links
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const pinLink = document.createElement('a');
    pinLink.href = it.pinUrl; pinLink.target = '_blank'; pinLink.textContent = 'Pin: open';
    const mp4Link = document.createElement('a');
    if (it.videoUrl) { mp4Link.href = it.videoUrl; mp4Link.target = '_blank'; mp4Link.textContent = 'MP4: link'; }
    else { mp4Link.textContent = 'MP4: —'; mp4Link.style.opacity = '0.6'; mp4Link.style.pointerEvents = 'none'; }

    overlay.appendChild(pinLink);
    overlay.appendChild(mp4Link);

    preview.appendChild(badge);
    preview.appendChild(cbWrap);
    preview.appendChild(overlay);

    // Title (below)
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = it.title || '(No title)';

    card.appendChild(preview);
    card.appendChild(title);

    els.grid.appendChild(card);
  }
}

function makeLazyObserver() {
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) {
        const v = e.target;
        const src = v.getAttribute('data-src');
        if (src && !v.src) {
          v.src = src;
        }
      }
    }
  }, { root: document, rootMargin: '50px', threshold: 0.01 });
  return io;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
