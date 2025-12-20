// This page runs inside the extension and can use chrome.* APIs, including
// chrome.downloads. It expects two query parameters:
//   ?videoUrl=<youtube-url>
//   ?title=<optional-title>
//
// It then calls YOUR backend API to resolve a direct video URL and starts
// the download. You must implement that backend yourself.

async function start() {
  const params = new URLSearchParams(location.search);
  const videoUrl = params.get("videoUrl");
  const title = params.get("title") || "youtube-video";

  const infoEl = document.getElementById("info");
  const statusEl = document.getElementById("status");

  if (!videoUrl) {
    statusEl.textContent = "Missing video URL.";
    statusEl.className = "error";
    return;
  }

  infoEl.innerHTML = `Video: <code>${videoUrl}</code>`;
  statusEl.textContent = "Contacting backend to resolve video file…";

  try {
    // TODO: REPLACE THIS with your real backend endpoint.
    // The backend should accept a YouTube URL and respond with JSON:
    //   { downloadUrl: "https://..." }
    //
    // For example, if you host an API at https://your-server.com/api/yt:
    //   POST { url: "<youtube-url>" }
    // and it returns { downloadUrl: "<direct-file-url>" }

    const backendUrl = "http://localhost:3000/api/yt"; // <--- CHANGE ME

    // Ask background.js to call the backend (avoids CORS in the page)
    const response = await chrome.runtime.sendMessage({
      type: "RESOLVE_YT_VIDEO",
      videoUrl,
    });

    if (!response || !response.ok) {
      throw new Error(response?.error || "Backend call failed");
    }

    const data = response.data || {};
    if (!data.downloadUrl) {
      throw new Error("Backend did not return downloadUrl");
    }

    statusEl.textContent = "Starting browser download…";

    chrome.downloads.download(
      {
        url: data.downloadUrl,
        filename: `${title}.mp4`,
        saveAs: true,
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          statusEl.textContent =
            "Failed to start download: " + chrome.runtime.lastError.message;
          statusEl.className = "error";
          return;
        }
        statusEl.textContent =
          "Download started in your browser (ID " + downloadId + ").";
        statusEl.className = "ok";
      }
    );
  } catch (e) {
    console.error(e);
    statusEl.textContent =
      "Error: " + (e && e.message ? e.message : "Unknown error");
    statusEl.className = "error";
  }
}

start();


