/* Content script: collect /pin/{id} URLs with auto-scrolling */
(() => {
  let collecting = false;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'CS_COLLECT_PINS') {
      const { max } = msg.payload;
      if (collecting) return sendResponse({ ok: false, error: 'Already collecting' });
      collecting = true;
      collectPinUrls(max).then(urls => {
        collecting = false;
        sendResponse({ ok: true, urls: [...urls] });
      }).catch(err => {
        collecting = false;
        sendResponse({ ok: false, error: err?.message || 'Collect error' });
      });
      return true; // async
    }
  });

  async function collectPinUrls(max = 50) {
    const seen = new Set();
    let stableTries = 0;
    const MAX_STABLE = 10;

    while (seen.size < max && stableTries < MAX_STABLE) {
      const anchors = [...document.querySelectorAll('a[href*="/pin/"]')]
        .map(a => a.href.split('?')[0])
        .filter(h => /\/pin\/\d+\/?$/.test(h));

      const before = seen.size;
      for (const href of anchors) seen.add(href);
      const after = seen.size;
      if (after === before) stableTries++;
      else stableTries = 0;

      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      await delay(900);
    }
    return new Set([...seen].slice(0, max));
  }

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
})();
