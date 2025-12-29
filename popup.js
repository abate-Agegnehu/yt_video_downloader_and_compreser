async function getActiveYoutubeTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab || !tab.url || !tab.url.includes("youtube.com/watch")) {
    return null;
  }
  return tab;
}

async function init() {
  const descEl = document.getElementById("desc");
  const urlEl = document.getElementById("url");
  const btn = document.getElementById("downloadBtn");
  const statusEl = document.getElementById("status");

  const tab = await getActiveYoutubeTab();
  if (!tab) {
    descEl.textContent = "Open a YouTube video page and try again.";
    urlEl.textContent = "No valid YouTube video detected.";
    btn.disabled = true;
    return;
  }

  descEl.textContent = "Ready to download this video:";
  urlEl.textContent = tab.url;
  btn.disabled = false;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    statusEl.textContent = "Opening preview…";
    statusEl.className = "status";

    try {
      // Extract video title from the page if possible
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: () => {
          const titleEl = document.querySelector(
            "h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string, h1.ytd-video-primary-info-renderer"
          );
          return titleEl ? titleEl.textContent.trim() : "YouTube Video";
        },
      });

      const videoTitle = result?.result || "YouTube Video";

      const response = await chrome.runtime.sendMessage({
        type: "SHOW_PREVIEW",
        videoUrl: tab.url,
        videoTitle: videoTitle,
      });

      if (response && response.ok) {
        statusEl.textContent = "Preview opened in new tab.";
        statusEl.className = "status ok";
        window.close();
      } else {
        throw new Error(response?.error || "Failed to open preview");
      }
    } catch (err) {
      console.error(err);
      statusEl.textContent =
        "Could not open preview. This may be restricted by YouTube/Chrome.";
      statusEl.className = "status error";
      btn.disabled = false;
    }
  });
}

document.addEventListener("DOMContentLoaded", init);


