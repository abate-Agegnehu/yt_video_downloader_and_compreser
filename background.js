// NOTE: Directly downloading YouTube videos may violate YouTube's Terms of Service.
// This code is provided for educational purposes only. You are responsible for
// complying with YouTube's and Chrome Web Store policies.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "DOWNLOAD_YT_VIDEO" && message.videoUrl) {
    // Handle direct download without opening a new tab
    (async () => {
      try {
        // First, resolve the video URL to get the direct download URL
        const backendUrl = "http://localhost:3000/api/yt";
        const res = await fetch(backendUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url: message.videoUrl }),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          sendResponse({
            ok: false,
            error:
              "Backend status " + res.status + (body ? " body: " + body : ""),
          });
          return;
        }

        const data = await res.json();
        if (!data.downloadUrl) {
          sendResponse({
            ok: false,
            error: "Backend did not return downloadUrl",
          });
          return;
        }

        // Extract video ID for filename
        const videoIdMatch = message.videoUrl.match(/[?&]v=([^&]+)/);
        const videoId = videoIdMatch ? videoIdMatch[1] : "youtube-video";
        
        // Start the download directly using chrome.downloads API
        chrome.downloads.download(
          {
            url: data.downloadUrl,
            filename: `YouTube_${videoId}.mp4`,
            saveAs: false, // Download to default location for seamless experience
          },
          (downloadId) => {
            if (chrome.runtime.lastError) {
              sendResponse({
                ok: false,
                error: chrome.runtime.lastError.message,
              });
              return;
            }
            sendResponse({
              ok: true,
              downloadId: downloadId,
            });
          }
        );
      } catch (e) {
        sendResponse({
          ok: false,
          error: e && e.message ? e.message : "Unknown error",
        });
      }
    })();

    return true; // keep sendResponse async
  }

  if (message?.type === "RESOLVE_YT_VIDEO" && message.videoUrl) {
    // Called from download.html (for backward compatibility with popup)
    (async () => {
      try {
        const backendUrl = "http://localhost:3000/api/yt";
        const res = await fetch(backendUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url: message.videoUrl }),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          sendResponse({
            ok: false,
            error:
              "Backend status " + res.status + (body ? " body: " + body : ""),
          });
          return;
        }

        const data = await res.json();
        sendResponse({ ok: true, data });
      } catch (e) {
        sendResponse({
          ok: false,
          error: e && e.message ? e.message : "Unknown error",
        });
      }
    })();

    return true; // keep sendResponse async
  }
});


