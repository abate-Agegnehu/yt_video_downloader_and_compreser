// NOTE: Directly downloading YouTube videos may violate YouTube's Terms of Service.
// This code is provided for educational purposes only. You are responsible for
// complying with YouTube's and Chrome Web Store policies.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
   // Handle transcript fetch request
   if (message?.type === "FETCH_TRANSCRIPT" && message.videoUrl) {
    (async () => {
      try {
        const res = await fetch("http://localhost:3000/api/transcript", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url: message.videoUrl }),
        }).catch((fetchError) => {
          // Handle network errors (server not running, CORS, etc.)
          throw new Error(
            "Backend server is not running. Please start the server with 'node server.js'"
          );
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          sendResponse({
            ok: false,
            error: errorData.error || `Failed to extract transcript (${res.status})`,
          });
          return;
        }

        const data = await res.json();
        sendResponse({ ok: true, transcript: data.transcript });
      } catch (e) {
        sendResponse({
          ok: false,
          error: e && e.message ? e.message : "Unknown error",
        });
      }
    })();
    return true; // keep sendResponse async
  }
   // Handle transcript analysis request
   if (message?.type === "ANALYZE_TRANSCRIPT") {
    (async () => {
      console.log("=== ANALYZE_TRANSCRIPT HANDLER STARTED ===");
      console.log("Full message received:", JSON.stringify(message, null, 2).substring(0, 1000));
      console.log("Message keys:", Object.keys(message || {}));
      console.log("Has transcript:", !!message.transcript);
      console.log("Transcript type:", typeof message.transcript);
      console.log("Transcript length:", message.transcript ? message.transcript.length : 0);
      console.log("Video URL:", message.videoUrl);
      console.log("Video Title:", message.videoTitle);
      console.log("==========================================");

      // CRITICAL: Check if message has 'url' field (wrong format)
      if (message.url && !message.transcript) {
        console.error("ERROR: Message has 'url' field but no 'transcript'! This is the wrong format!");
        console.error("This suggests the message is being sent with transcript endpoint format.");
        sendResponse({
          ok: false,
          error: "Invalid message format: received 'url' field instead of 'transcript'. This looks like a transcript request format.",
        });
        return;
      }

      // Validate transcript exists
      if (!message.transcript || (typeof message.transcript === 'string' && message.transcript.trim().length === 0)) {
        console.error("Transcript validation failed:", {
          transcript: message.transcript,
          transcriptType: typeof message.transcript,
          messageKeys: Object.keys(message || {})
        });
        sendResponse({
          ok: false,
          error: "Transcript is missing or empty",
        });
        return;
      }

      try {
        // Ensure transcript is a string
        let transcript = message.transcript;
        if (typeof transcript !== 'string') {
          transcript = String(transcript || '');
        }

        const requestBody = {
          transcript: transcript,
          videoUrl: message.videoUrl || "",
          videoTitle: message.videoTitle || "",
        };

        console.log("Sending analyze request to /api/yt/analyze:", {
          endpoint: "http://localhost:3000/api/yt/analyze",
          transcriptLength: requestBody.transcript ? requestBody.transcript.length : 0,
          transcriptType: typeof requestBody.transcript,
          videoUrl: requestBody.videoUrl,
          videoTitle: requestBody.videoTitle,
          bodyKeys: Object.keys(requestBody),
          bodyStringified: JSON.stringify(requestBody).substring(0, 300)
        });

        // Double-check the request body before sending
        if (!requestBody.transcript) {
          console.error("ERROR: Request body missing transcript!", requestBody);
          sendResponse({
            ok: false,
            error: "Internal error: transcript missing from request body",
          });
          return;
        }

        // Log the exact request being sent
        // Use /api/yt/analyze to match what server is receiving (both endpoints work)
        const requestUrl = "http://localhost:3000/api/yt/analyze";
        const requestBodyString = JSON.stringify(requestBody);
        
        console.log("About to send fetch request:", {
          url: requestUrl,
          method: "POST",
          bodyLength: requestBodyString.length,
          bodyPreview: requestBodyString.substring(0, 200),
          bodyKeys: Object.keys(requestBody),
          fullBody: requestBodyString.substring(0, 500) // Log more of the body for debugging
        });

        // Verify the body has transcript before sending
        const parsedBody = JSON.parse(requestBodyString);
        if (!parsedBody.transcript) {
          console.error("CRITICAL ERROR: Request body does not contain transcript!", {
            bodyKeys: Object.keys(parsedBody),
            body: parsedBody
          });
          sendResponse({
            ok: false,
            error: "Internal error: Request body missing transcript field",
          });
          return;
        }

        // Double-check: ensure we're not accidentally sending the wrong format
        if (parsedBody.url && !parsedBody.transcript) {
          console.error("CRITICAL ERROR: Request body has 'url' field but no 'transcript'!", {
            bodyKeys: Object.keys(parsedBody),
            body: parsedBody
          });
          sendResponse({
            ok: false,
            error: "Internal error: Request body has wrong format (has 'url' instead of 'transcript')",
          });
          return;
        }

        const res = await fetch(requestUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: requestBodyString,
        }).catch((fetchError) => {
          // Handle network errors (server not running, CORS, etc.)
          throw new Error(
            "Backend server is not running. Please start the server with 'node server.js'"
          );
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          sendResponse({
            ok: false,
            error: errorData.error || `Failed to analyze content (${res.status})`,
          });
          return;
        }

        const data = await res.json();
        sendResponse({ ok: true, analysis: data });
      } catch (e) {
        sendResponse({
          ok: false,
          error: e && e.message ? e.message : "Unknown error",
        });
      }
    })();
    return true; // keep sendResponse async
  }
   // Handle preview request - open preview page
   if (message?.type === "SHOW_PREVIEW" && message.videoUrl) {
    (async () => {
      try {
        const videoTitle = encodeURIComponent(message.videoTitle || "YouTube Video");
        const videoUrl = encodeURIComponent(message.videoUrl);
        const previewUrl = chrome.runtime.getURL(
          `preview.html?videoUrl=${videoUrl}&title=${videoTitle}`
        );
        
        // Open preview in a new tab
        const tab = await chrome.tabs.create({
          url: previewUrl,
          active: true,
        });
        
        sendResponse({ ok: true, tabId: tab.id });
      } catch (e) {
        sendResponse({
          ok: false,
          error: e && e.message ? e.message : "Unknown error",
        });
      }
    })();
    return true; // keep sendResponse async
  }
 
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


