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
    statusEl.textContent = "Preparing download…";
    statusEl.className = "status";

    try {
      await chrome.runtime.sendMessage({
        type: "DOWNLOAD_YT_VIDEO",
        videoUrl: tab.url,
      });
      statusEl.textContent = "Download started in your browser.";
      statusEl.className = "status ok";
      window.close();
    } catch (err) {
      console.error(err);
      statusEl.textContent =
        "Could not start download. This may be restricted by YouTube/Chrome.";
      statusEl.className = "status error";
      btn.disabled = false;
    }
  });
}

document.addEventListener("DOMContentLoaded", init);


