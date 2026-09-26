// Optional: separate extractor (not imported by default)
export function extractMp4AndTitleFromHtml(html) {
  // Keep this file if you want to ESM-import into a module worker instead of using inline functions.
  return { mp4: '', title: '', thumb: '' };
}
