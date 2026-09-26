# Pinterest Video Extractor (MV3)

**Features**
- Collect Pinterest **video pins only** from the current page (search results, boards, profiles).
- Infinite scroll collector with a target count (e.g., 50 videos).
- Grid view with thumbnail/title/links and selection (Select All / Deselect All).
- Export CSV (pin_url, video_url, title).
- Bulk ZIP download of selected items with a progress bar.
- Persistent data (chrome.storage.local), Clear Data to start fresh.
- Guaranteed **.mp4** capture: parse pin pages for expMp4/1080p/720p sources; pins without MP4 are skipped.

**Install (Developer Mode)**
1. Ensure `lib/jszip.min.js` exists (JSZip v3.x). You can download from JSZip releases and place it here.
2. Open `chrome://extensions` → toggle **Developer mode** → **Load unpacked** → select this folder.
3. Open a Pinterest page with videos. Click the extension icon.

**Flow**
1. Enter **Target count** → **Start Extract** (auto-scrolls & resolves .mp4s).
2. Review/Select → **Export CSV** or **Download ZIP** (or **Download Individually**).
3. **Clear Data** to start again.

**Notes**
- Pins that expose only `.m3u8` (HLS) are shown as **No MP4** and are excluded from downloads.
- Zipping many large files uses memory; for big batches use individual downloads.
