## YT Video Downloader – Browser Extension

This is a simple Chrome/Chromium browser extension that helps you quickly send the current YouTube video URL to an external download service.

> **Important:** Downloading YouTube videos may violate YouTube's Terms of Service and/or local laws. This code is provided for educational purposes only. You are responsible for how you use it and for complying with all applicable terms and laws.

### Features

- **Popup action**: Click the toolbar icon on a YouTube watch page to send the video to a 3rd‑party downloader in a new tab.
- **Inline button**: A small "Download video" button is injected under the video title on YouTube watch pages.

### How it works

- The popup (`popup.html` / `popup.js`) reads the active tab URL; if it's a YouTube video (`https://www.youtube.com/watch...`), it sends a message to the background service worker.
- The content script (`content-script.js`) injects a "Download video" button into the YouTube watch page, which sends the same message on click.
- The background script (`background.js`) receives the message and opens a new tab pointing to a 3rd‑party download/converter service (currently `y2mate`).

You can change the service URL in `background.js`.

### Load the extension in Chrome

1. Open Chrome and go to `chrome://extensions/`.
2. Turn on **Developer mode** (top‑right).
3. Click **Load unpacked**.
4. Select the `yt_video_downloader` folder (this folder containing `manifest.json`).
5. Open any YouTube video.  
   - Click the extension icon → **Download Video**, or  
   - Use the inline **Download video** button under the title.


