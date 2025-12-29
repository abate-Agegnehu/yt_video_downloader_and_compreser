// Preview page script - handles video content analysis and display

const params = new URLSearchParams(window.location.search);
const videoUrl = params.get("videoUrl");
const videoTitle = params.get("title") || "YouTube Video";

// UI Elements
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error");
const errorMessageEl = document.getElementById("errorMessage");
const insightsEl = document.getElementById("insights");
const displayVideoTitleEl = document.getElementById("displayVideoTitle");
const briefSectionEl = document.getElementById("briefSection");
const briefBoxEl = document.getElementById("briefBox");
const downloadBtn = document.getElementById("downloadBtn");
const closeBtn = document.getElementById("closeBtn");

// Video title will be displayed in the insights section

// Close button handler
closeBtn.addEventListener("click", () => {
  window.close();
});

// Download button handler

downloadBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();

  // Visual feedback - darker green when clicked
  downloadBtn.textContent = "Downloading video...";
  downloadBtn.style.backgroundColor = "#15803d";
  downloadBtn.style.pointerEvents = "none";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "DOWNLOAD_YT_VIDEO",
      videoUrl: videoUrl,
    });

    if (response && response.error) {
      console.error("Download error:", response.error);
      // Could show a toast notification here
    }
  } catch (error) {
    console.error("Failed to start download:", error);
  } finally {
    setTimeout(() => {
      downloadBtn.style.backgroundColor = "#22c55e"; // Reset to default green
      downloadBtn.style.pointerEvents = "auto";
    }, 500);
  }
});


// Main analysis function
async function analyzeVideo() {
  if (!videoUrl) {
    showError("No video URL provided");
    return;
  }

  try {
    // Step 1: Extract transcript (via background script to avoid CORS)
    loadingEl.querySelector(".loading-text").textContent =
      "Extracting video transcript...";
    
    const transcriptResponse = await chrome.runtime.sendMessage({
      type: "FETCH_TRANSCRIPT",
      videoUrl: videoUrl,
    });

    if (!transcriptResponse || !transcriptResponse.ok) {
      const errorMsg = transcriptResponse?.error || "Failed to extract transcript";
      const errorDetail = transcriptResponse?.detail || "";
      
      // Show a more helpful error message
      showError(
        `Transcript not available: ${errorMsg}\n\n` +
        `${errorDetail}\n\n` +
        `This video may not have captions/subtitles enabled. You can:\n` +
        `• Try a different video that has captions (look for the CC button on YouTube)\n` +
        `• Proceed with download anyway (click "Download Video" below)\n` +
        `• Check the server console for detailed error information`
      );
      
      // Still allow download even without transcript
      const downloadBtn = document.getElementById("downloadBtn");
      if (downloadBtn) {
        downloadBtn.style.display = "flex";
        downloadBtn.textContent = "Download Video Anyway";
      }
      
      // Proceed with conceptual analysis using minimal context
      await performAnalysisFallback();
      return;
    }

    let transcript = transcriptResponse.transcript;

    // Ensure transcript is a string
    if (typeof transcript !== 'string') {
      transcript = String(transcript || '');
    }

    if (!transcript || transcript.trim().length < 50) {
      showError(
        "Transcript is too short or unavailable. This video may not have captions.\n\n" +
        "You can still download the video by clicking 'Download Video' below."
      );
      
      // Still allow download
      const downloadBtn = document.getElementById("downloadBtn");
      if (downloadBtn) {
        downloadBtn.style.display = "flex";
        downloadBtn.textContent = "Download Video Anyway";
      }
      
      // Proceed with conceptual analysis using minimal context
      await performAnalysisFallback();
      return;
    }

    await performAnalysis(transcript);
  } catch (error) {
    console.error("Analysis error:", error);
    showError(error.message || "Failed to analyze video content");
  }
}

function showError(message) {
  loadingEl.style.display = "none";
  errorEl.style.display = "block";
  errorMessageEl.textContent = message;
  
  // Ensure download button is visible even on error
  const actionsDiv = document.querySelector(".actions");
  if (actionsDiv) {
    actionsDiv.style.display = "flex";
  }
  if (downloadBtn) {
    downloadBtn.style.display = "flex";
    downloadBtn.disabled = false;
  }
}

function displayInsights(analysis) {
  loadingEl.style.display = "none";
  insightsEl.style.display = "block";

  // Prefer AI-provided title, fallback to page title
  if (analysis.title && typeof analysis.title === 'string' && analysis.title.trim()) {
    displayVideoTitleEl.textContent = analysis.title.trim();
    displayVideoTitleEl.style.display = "block";
  } else if (videoTitle) {
    displayVideoTitleEl.textContent = videoTitle;
    displayVideoTitleEl.style.display = "block";
  } else {
    displayVideoTitleEl.style.display = "none";
  }

  const briefText = typeof analysis.briefText === 'string' ? analysis.briefText.trim() : "";
  if (!briefText || !validateBriefFormat(briefText)) {
    showError("Analysis failed validation: output must strictly follow the Video Intelligence Brief format.");
    return;
  }
  briefBoxEl.textContent = briefText;
  briefSectionEl.style.display = "block";
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function looksLikeTranscript(text) {
  if (!text || typeof text !== "string") return false;
  const longQuotes = /“.*?”|".*?"/s.test(text);
  const timestampy = /\b\d{1,2}:\d{2}(:\d{2})?\b/.test(text) && text.length > 220;
  const colonSpeaker = /^[A-Z][a-zA-Z]+:/m.test(text);
  return longQuotes || timestampy || colonSpeaker;
}

function validateBriefFormat(t) {
  const s = t.trim();
  const required = [
    "Video Intelligence Brief",
    "1. Central Theme",
    "2. Core Argument Flow",
    "3. Key Conceptual Sections",
    "4. Primary Insights",
    "5. Intended Viewer Impact",
  ];
  for (const h of required) {
    if (!s.includes(h)) return false;
  }
  if (looksLikeTranscript(s)) return false;
  return true;
}

async function performAnalysis(transcriptText) {
  loadingEl.querySelector(".loading-text").textContent =
    "Analyzing content with AI...";

  const messagePayload = {
    type: "ANALYZE_TRANSCRIPT",
    transcript: transcriptText,
    videoUrl: videoUrl || "",
    videoTitle: videoTitle || "",
  };

  const analysisResponse = await chrome.runtime.sendMessage(messagePayload);
  if (!analysisResponse || !analysisResponse.ok) {
    throw new Error(analysisResponse?.error || "Failed to analyze content");
  }
  const analysis = analysisResponse.analysis;
  displayInsights(analysis);
}

async function performAnalysisFallback() {
  const minimalContext =
    "No captions available. Provide a conceptual intelligence brief based on title and general context.";
  await performAnalysis(minimalContext);
}

// Start analysis when page loads
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", analyzeVideo);
} else {
  analyzeVideo();
}

