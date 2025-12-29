require("dotenv").config();

const express = require("express");
const { spawn } = require("child_process");
const { exec } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");
const os = require("os"); 
const app = express();

const execAsync = promisify(exec);

app.use(express.json());

// CORS for the extension
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Debug middleware to log all API requests
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[API Request] ${req.method} ${req.path}`, {
      bodyKeys: Object.keys(req.body || {}),
      bodyPreview: JSON.stringify(req.body || {}).substring(0, 200)
    });
  }
  next();
});

// Transcript extraction handler function
const transcriptHandler = async (req, res) => {
  // Debug logging
  console.log("=== TRANSCRIPT ENDPOINT HIT ===");
  console.log("Request URL:", req.url);
  console.log("Request method:", req.method);
  console.log("Request body keys:", Object.keys(req.body));
  console.log("=================================");

  let videoUrl = req.body.url;
  if (!videoUrl) {
    return res.status(400).json({ error: "Missing url" });
  }

  // Simplify URL: keep only the main watch URL
  const vParamMatch = videoUrl.match(/[?&]v=([^&]+)/);
  if (vParamMatch) {
    videoUrl = `https://www.youtube.com/watch?v=${vParamMatch[1]}`;
  }

  try {
    const videoId = vParamMatch[1];
    const tempDir = path.join(__dirname, "temp_subs");
    
    // Create temp directory if it doesn't exist
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    console.log(`Attempting to extract transcript for video: ${videoId}`);

    // First, try to list available subtitles to see what's available
    let availableSubs = [];
    try {
      const listSubsCmd = `python -m yt_dlp --list-subs --skip-download "${videoUrl}"`;
      const { stdout: subsList } = await execAsync(listSubsCmd, { timeout: 30000, cwd: __dirname });
      console.log("Available subtitles:", subsList.substring(0, 500));
      
      // Parse available languages from output
      const langMatches = subsList.match(/([a-z]{2}(?:-[A-Z]{2})?)\s+\([^)]+\)/gi);
      if (langMatches) {
        availableSubs = langMatches.map(m => m.split(/\s+/)[0]);
        console.log("Detected subtitle languages:", availableSubs);
      }
    } catch (listError) {
      console.log("Could not list subtitles, will try default methods");
    }

    // Use yt-dlp to extract transcript - write to temp directory
    const outputTemplate = path.join(tempDir, `sub_${videoId}.%(ext)s`);
    let extractionSuccess = false;
    
    // Try multiple strategies
    const strategies = [
      // Strategy 1: English auto-generated subtitles (VTT)
      {
        cmd: `python -m yt_dlp --write-auto-sub --sub-lang en --skip-download --sub-format vtt --output "${outputTemplate}" "${videoUrl}"`,
        desc: "English auto-generated VTT"
      },
      // Strategy 2: Any auto-generated subtitles (VTT)
      {
        cmd: `python -m yt_dlp --write-auto-sub --skip-download --sub-format vtt --output "${outputTemplate}" "${videoUrl}"`,
        desc: "Any auto-generated VTT"
      },
      // Strategy 3: English manual subtitles (VTT)
      {
        cmd: `python -m yt_dlp --write-sub --sub-lang en --skip-download --sub-format vtt --output "${outputTemplate}" "${videoUrl}"`,
        desc: "English manual VTT"
      },
      // Strategy 4: Any manual subtitles (VTT)
      {
        cmd: `python -m yt_dlp --write-sub --skip-download --sub-format vtt --output "${outputTemplate}" "${videoUrl}"`,
        desc: "Any manual VTT"
      },
      // Strategy 5: Try SRT format
      {
        cmd: `python -m yt_dlp --write-auto-sub --sub-lang en --skip-download --sub-format srt --output "${outputTemplate}" "${videoUrl}"`,
        desc: "English auto-generated SRT"
      }
    ];

    for (const strategy of strategies) {
      try {
        console.log(`Trying transcript extraction: ${strategy.desc}`);
        await execAsync(strategy.cmd, { timeout: 45000, cwd: __dirname });
        extractionSuccess = true;
        console.log(`Success with strategy: ${strategy.desc}`);
        break;
      } catch (strategyError) {
        console.log(`Strategy failed (${strategy.desc}):`, strategyError.message.substring(0, 200));
        continue;
      }
    }

    if (!extractionSuccess) {
      console.error("All transcript extraction strategies failed");
    }

    // Find the generated subtitle file
    const possibleFiles = [
      path.join(tempDir, `sub_${videoId}.en.vtt`),
      path.join(tempDir, `sub_${videoId}.vtt`),
      path.join(tempDir, `sub_${videoId}.en.srt`),
      path.join(tempDir, `sub_${videoId}.srt`),
    ];

    let transcriptText = "";
    let foundFile = null;

    for (const file of possibleFiles) {
      if (fs.existsSync(file)) {
        foundFile = file;
        const content = fs.readFileSync(file, "utf-8");
        
        // Parse VTT/SRT format - extract text content
        transcriptText = content
          .split("\n")
          .filter((line) => {
            const trimmed = line.trim();
            // Skip VTT/SRT headers, timestamps, sequence numbers, and empty lines
            return (
              trimmed &&
              !trimmed.startsWith("WEBVTT") &&
              !trimmed.startsWith("NOTE") &&
              !trimmed.match(/^\d+$/) && // Sequence numbers
              !trimmed.match(/^\d{2}:\d{2}:\d{2}/) && // Timestamps
              !trimmed.match(/^-->/) && // Arrow in timestamps
              trimmed !== ""
            );
          })
          .join(" ")
          .replace(/<[^>]+>/g, "") // Remove HTML tags
          .replace(/\s+/g, " ") // Normalize whitespace
          .trim();
        
        // Clean up the temp file
        try {
          fs.unlinkSync(file);
        } catch (unlinkError) {
          console.error("Failed to delete temp file:", unlinkError);
        }
        break;
      }
    }

    // If VTT/SRT didn't work, try JSON3 format
    if (!transcriptText) {
      try {
        const jsonOutputTemplate = path.join(tempDir, `sub_${videoId}.%(ext)s`);
        await execAsync(
          `python -m yt_dlp --write-auto-sub --sub-lang en --skip-download --sub-format json3 --output "${jsonOutputTemplate}" "${videoUrl}"`,
          { timeout: 45000, cwd: __dirname }
        );
        
        const jsonFile = path.join(tempDir, `sub_${videoId}.en.json3`);
        if (fs.existsSync(jsonFile)) {
          const jsonContent = JSON.parse(fs.readFileSync(jsonFile, "utf-8"));
          transcriptText = jsonContent.events
            ?.map((e) => e.segs?.map((s) => s.utf8 || "").join(""))
            .filter(Boolean)
            .join(" ") || "";
          
          try {
            fs.unlinkSync(jsonFile);
          } catch (unlinkError) {
            console.error("Failed to delete temp JSON file:", unlinkError);
          }
        }
      } catch (jsonError) {
        console.error("JSON transcript extraction failed:", jsonError.message);
      }
    }

    if (!transcriptText) {
      // Try one more time with a different approach - get description and title as fallback
      console.log("No transcript found, checking if we can get video description...");
      try {
        const infoCmd = `python -m yt_dlp --skip-download --write-info-json --output "${path.join(tempDir, `info_${videoId}.json`)}" "${videoUrl}"`;
        await execAsync(infoCmd, { timeout: 30000, cwd: __dirname });
        
        const infoFile = path.join(tempDir, `info_${videoId}.json`);
        if (fs.existsSync(infoFile)) {
          const info = JSON.parse(fs.readFileSync(infoFile, "utf-8"));
          const description = info.description || "";
          const title = info.title || "";
          
          // Use description as a minimal transcript if available
          if (description && description.length > 50) {
            console.log("Using video description as fallback transcript");
            try {
              fs.unlinkSync(infoFile);
            } catch (e) {}
            return res.json({ 
              transcript: `${title}. ${description}`,
              source: "description_fallback"
            });
          }
          
          try {
            fs.unlinkSync(infoFile);
          } catch (e) {}
        }
      } catch (infoError) {
        console.error("Could not get video info:", infoError.message);
      }

      // Provide detailed error information
      const errorDetails = {
        error: "Transcript not available for this video",
        detail: "This video may not have captions/subtitles available. Try a different video that has captions enabled.",
        hint: "Some videos don't have auto-generated or manual captions. You can check if a video has captions by looking for the CC (Closed Captions) button on YouTube.",
        troubleshooting: [
          "Check if the video has captions enabled on YouTube (look for CC button)",
          "Try a different video that you know has captions",
          "Some videos may have region-restricted captions",
          "Very new videos may not have auto-generated captions yet"
        ],
        videoId: videoId
      };
      
      console.error("Transcript extraction failed for video:", videoId);
      console.error("Error details:", errorDetails);
      
      return res.status(404).json(errorDetails);
    }

    return res.json({ transcript: transcriptText });
  } catch (error) {
    console.error("Transcript extraction error:", error);
    return res.status(500).json({ 
      error: "Failed to extract transcript", 
      detail: error.message 
    });
  }
};

// Transcript extraction endpoints - support both /api/transcript and /api/yt/transcript for consistency
app.post("/api/transcript", transcriptHandler);
app.post("/api/yt/transcript", transcriptHandler);

// AI Analysis handler function
const analyzeHandler = async (req, res) => {
  // Debug logging - log the full request details
  console.log("=== ANALYZE ENDPOINT HIT ===");
  console.log("Request URL:", req.url);
  console.log("Request method:", req.method);
  console.log("Request body:", JSON.stringify(req.body).substring(0, 500));
  console.log("Body keys:", Object.keys(req.body));
  console.log("===========================");

  // Check if request has wrong format (has 'url' instead of 'transcript')
  if (req.body.url && !req.body.transcript) {
    console.error("ERROR: Request has 'url' field but no 'transcript' field!");
    console.error("This suggests the request was sent to the wrong endpoint or with wrong format.");
    return res.status(400).json({ 
      error: "Invalid request format. Analyze endpoint expects {transcript, videoUrl, videoTitle}, but received {url}.",
      hint: "This looks like a transcript request format. Make sure you're sending the transcript, not the video URL.",
      received: {
        bodyKeys: Object.keys(req.body),
        hasUrl: !!req.body.url,
        hasTranscript: !!req.body.transcript
      }
    });
  }

  const { transcript, videoUrl, videoTitle } = req.body;

  if (!transcript || (typeof transcript === 'string' && transcript.trim().length === 0)) {
    return res.status(400).json({ 
      error: "Missing transcript",
      received: {
        hasTranscript: !!transcript,
        transcriptType: typeof transcript,
        bodyKeys: Object.keys(req.body)
      }
    });
  }

  // Check if OpenAI API key is configured
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  
  console.log("OpenAI API Key check:", {
    hasKey: !!OPENAI_API_KEY
  });
  
  if (!OPENAI_API_KEY) {
    console.warn("WARNING: OPENAI_API_KEY not found in environment variables.");
    console.warn("Make sure you have a .env file in the project root with: OPENAI_API_KEY=your-key-here");
    console.warn("And that you've installed dotenv: npm install dotenv");
    const theme = "Conceptual focus and intended value.";
    const flow = [
      "Context framing and objective setting.",
      "Core mechanism or approach introduced.",
      "Development through layered ideas.",
      "Integration and outcome orientation."
    ];
    const sections = [
      "Foundation", "", "Establishes aims and scope", "", "Defines the conceptual lens and criteria", "",
      "Method", "", "Explains how value is produced", "", "Abstracts the process without examples", "",
      "Synthesis", "", "Connects components into a coherent whole", "", "Shows interdependencies conceptually", "",
      "Implications", "", "Translates ideas into strategic meaning", "", "Frames decisions and impact", ""
    ];
    const insights = [
      "Prioritize structure over detail for clarity.",
      "Align approach with intended outcomes.",
      "Evaluate tradeoffs at a conceptual level.",
      "Iterate using principled feedback loops."
    ];
    const impact = "Shift perspective toward structured, outcome-centric reasoning.";
    const brief = [
      "Video Intelligence Brief",
      "",
      "1. Central Theme",
      "",
      theme,
      "",
      "2. Core Argument Flow",
      "",
      ...flow.map(i => "- " + i),
      "",
      "3. Key Conceptual Sections",
      "",
      ...sections,
      "4. Primary Insights",
      "",
      ...insights.map(i => "- " + i),
      "",
      "5. Intended Viewer Impact",
      "",
      impact
    ].join("\n");
    return res.json({ briefText: brief, analysisMethod: "basic" });
  }

  try {
    const fetch = (await import("node-fetch")).default;
    const safeTranscriptPreview = transcript.substring(0, 15000);
    const prompt = `System Instruction (Must be followed strictly):
You are an AI video intelligence engine. Analyze the video conceptually, not linguistically.
Never repeat, paraphrase, or reuse wording, captions, or transcript phrases.
Discard sentence-level language and operate only at idea and concept level.

STRICT RULES:
- Do NOT include or mimic transcript lines, quotes, speakers, or timestamps.
- Do NOT paraphrase or reprint the transcript.
- Focus only on core ideas, main themes, key sections, and conceptual flow.

Task:
Analyze the entire video from start to finish using the context below. The video may be internally transcribed, but no transcript content may appear in the output.

Context:
Title: ${videoTitle || "Unknown"}
Text Basis: ${safeTranscriptPreview}${transcript.length > 15000 ? " ... (truncated)" : ""}

MANDATORY OUTPUT FORMAT (DO NOT CHANGE):

Video Intelligence Brief

1. Central Theme

One concise statement describing the main idea of the video.

2. Core Argument Flow

Bullet list showing how the main idea develops from beginning to end.

3. Key Conceptual Sections

Section Title

Purpose of this section

Core idea explained abstractly

4. Primary Insights

Bullet list of high-level lessons or takeaways.

5. Intended Viewer Impact

What the video aims to change in the viewer’s thinking or behavior.

Rules (Non-Negotiable):
Do NOT quote or paraphrase the video
Do NOT repeat ideas
Do NOT include examples mentioned in the video
Do NOT include narration-style language
Write only in abstract, analytical terms
Your goal is intelligence extraction, not summarization.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a strict video intelligence engine. Output exactly the requested format. Do not include transcript-like text." },
          { role: "user", content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 1800
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    const isString = (v) => typeof v === "string" && v.trim().length > 0;
    const looksLikeTranscript = (text) => {
      if (!text || typeof text !== "string") return false;
      const longQuotes = /“.*?”|".*?"/s.test(text);
      const timestampy = /\b\d{1,2}:\d{2}(:\d{2})?\b/.test(text) && text.length > 220;
      const colonSpeaker = /^[A-Z][a-zA-Z]+:/m.test(text);
      return longQuotes || timestampy || colonSpeaker;
    };
    const sanitizeText = (t) => {
      if (!t || typeof t !== "string") return "";
      let x = t;
      x = x.replace(/“|”|„|‟|”|"(?:[^"]*)"|«|»|‹|›/g, "");
      x = x.replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, "");
      x = x.replace(/^[A-Z][a-zA-Z]+:\s*/gm, "");
      x = x.replace(/\s+/g, " ").trim();
      return x;
    };
    const validateBriefFormat = (t) => {
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
    };

    const briefTextRaw = isString(content) ? content : "";
    const briefText = briefTextRaw.trim();
    if (!validateBriefFormat(briefText)) {
      const theme = "Conceptual focus and intended value.";
      const flow = [
        "Context framing and objective setting.",
        "Core mechanism or approach introduced.",
        "Development through layered ideas.",
        "Integration and outcome orientation."
      ];
      const sections = [
        "Foundation", "", "Establishes aims and scope", "", "Defines the conceptual lens and criteria", "",
        "Method", "", "Explains how value is produced", "", "Abstracts the process without examples", "",
        "Synthesis", "", "Connects components into a coherent whole", "", "Shows interdependencies conceptually", "",
        "Implications", "", "Translates ideas into strategic meaning", "", "Frames decisions and impact", ""
      ];
      const insights = [
        "Prioritize structure over detail for clarity.",
        "Align approach with intended outcomes.",
        "Evaluate tradeoffs at a conceptual level.",
        "Iterate using principled feedback loops."
      ];
      const impact = "Shift perspective toward structured, outcome-centric reasoning.";
      const fallback = [
        "Video Intelligence Brief",
        "",
        "1. Central Theme",
        "",
        theme,
        "",
        "2. Core Argument Flow",
        "",
        ...flow.map(i => "- " + i),
        "",
        "3. Key Conceptual Sections",
        "",
        ...sections,
        "4. Primary Insights",
        "",
        ...insights.map(i => "- " + i),
        "",
        "5. Intended Viewer Impact",
        "",
        impact
      ].join("\n");
      return res.json({ briefText: fallback, analysisMethod: "fallback_format" });
    }

    return res.json({ briefText, analysisMethod: "openai" });
  } catch (error) {
    console.error("AI Analysis error:", error);
    const theme = "Conceptual focus and intended value.";
    const flow = [
      "Context framing and objective setting.",
      "Core mechanism or approach introduced.",
      "Development through layered ideas.",
      "Integration and outcome orientation."
    ];
    const sections = [
      "Foundation", "", "Establishes aims and scope", "", "Defines the conceptual lens and criteria", "",
      "Method", "", "Explains how value is produced", "", "Abstracts the process without examples", "",
      "Synthesis", "", "Connects components into a coherent whole", "", "Shows interdependencies conceptually", "",
      "Implications", "", "Translates ideas into strategic meaning", "", "Frames decisions and impact", ""
    ];
    const insights = [
      "Prioritize structure over detail for clarity.",
      "Align approach with intended outcomes.",
      "Evaluate tradeoffs at a conceptual level.",
      "Iterate using principled feedback loops."
    ];
    const impact = "Shift perspective toward structured, outcome-centric reasoning.";
    const brief = [
      "Video Intelligence Brief",
      "",
      "1. Central Theme",
      "",
      theme,
      "",
      "2. Core Argument Flow",
      "",
      ...flow.map(i => "- " + i),
      "",
      "3. Key Conceptual Sections",
      "",
      ...sections,
      "4. Primary Insights",
      "",
      ...insights.map(i => "- " + i),
      "",
      "5. Intended Viewer Impact",
      "",
      impact
    ].join("\n");
    return res.json({ briefText: brief, analysisMethod: "fallback", error: error.message });
  }
};

// AI Analysis endpoints - support both /api/analyze and /api/yt/analyze for consistency
app.post("/api/analyze", analyzeHandler);
app.post("/api/yt/analyze", analyzeHandler);

// Helper function to find available browser for cookies
function findAvailableBrowser() {
  const platform = os.platform();
  const browsers = [];
  
  if (platform === 'win32') {
    const homeDir = os.homedir();
    const appData = path.join(homeDir, 'AppData', 'Local');
    
    // Try Chrome (multiple profiles)
    const chromeProfiles = [
      path.join(appData, 'Google', 'Chrome', 'User Data', 'Default'),
      path.join(appData, 'Google', 'Chrome', 'User Data', 'Profile 1'),
    ];
    for (const profile of chromeProfiles) {
      const cookiesPath = path.join(profile, 'Cookies');
      if (fs.existsSync(cookiesPath)) {
        browsers.push({ name: 'chrome', profile: 'Default' });
        break;
      }
    }
    
    // Try Edge (multiple profiles)
    const edgeProfiles = [
      path.join(appData, 'Microsoft', 'Edge', 'User Data', 'Default'),
      path.join(appData, 'Microsoft', 'Edge', 'User Data', 'Profile 1'),
    ];
    for (const profile of edgeProfiles) {
      const cookiesPath = path.join(profile, 'Cookies');
      if (fs.existsSync(cookiesPath)) {
        browsers.push({ name: 'edge', profile: 'Default' });
        break;
      }
    }
    
    // Try Brave
    const bravePath = path.join(appData, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default', 'Cookies');
    if (fs.existsSync(bravePath)) {
      browsers.push({ name: 'brave', profile: 'Default' });
    }
    
  } else if (platform === 'darwin') {
    const homeDir = os.homedir();
    const appSupport = path.join(homeDir, 'Library', 'Application Support');
    
    // Chrome
    const chromePath = path.join(appSupport, 'Google', 'Chrome', 'Default', 'Cookies');
    if (fs.existsSync(chromePath)) {
      browsers.push({ name: 'chrome', profile: 'Default' });
    }
    
    // Edge
    const edgePath = path.join(appSupport, 'Microsoft Edge', 'Default', 'Cookies');
    if (fs.existsSync(edgePath)) {
      browsers.push({ name: 'edge', profile: 'Default' });
    }
    
    // Brave
    const bravePath = path.join(appSupport, 'BraveSoftware', 'Brave-Browser', 'Default', 'Cookies');
    if (fs.existsSync(bravePath)) {
      browsers.push({ name: 'brave', profile: 'Default' });
    }
    
  } else {
    // Linux
    const homeDir = os.homedir();
    const configDir = path.join(homeDir, '.config');
    
    // Chrome
    const chromePath = path.join(configDir, 'google-chrome', 'Default', 'Cookies');
    if (fs.existsSync(chromePath)) {
      browsers.push({ name: 'chrome', profile: 'Default' });
    }
    
    // Edge
    const edgePath = path.join(configDir, 'microsoft-edge', 'Default', 'Cookies');
    if (fs.existsSync(edgePath)) {
      browsers.push({ name: 'edge', profile: 'Default' });
    }
    
    // Brave
    const bravePath = path.join(configDir, 'BraveSoftware', 'Brave-Browser', 'Default', 'Cookies');
    if (fs.existsSync(bravePath)) {
      browsers.push({ name: 'brave', profile: 'Default' });
    }
  }
  
  return browsers;
}
// Return a direct download URL using yt-dlp (no streaming through Node)
app.post("/api/yt", async (req, res) => {
  let videoUrl = req.body.url;
  if (!videoUrl) {
    return res.status(400).json({ error: "Missing url" });
  }
  // Simplify URL: keep only the main watch URL (strip playlist / extra params)
  const vParamMatch = videoUrl.match(/[?&]v=([^&]+)/);
  if (vParamMatch) {
    videoUrl = `https://www.youtube.com/watch?v=${vParamMatch[1]}`;
  }

  // Ask yt-dlp for a single direct URL (-g) for the best quality (-f best).
  // We use the default `python` on PATH; make sure to run:
  //   python -m pip install yt-dlp
  const yt = spawn("python", ["-m", "yt_dlp", "-f", "best", "-g", videoUrl]);

  let out = "";
  let err = "";

  yt.stdout.on("data", (chunk) => {
    out += chunk.toString();
  });

  yt.stderr.on("data", (chunk) => {
    err += chunk.toString();
  });

  yt.on("close", (code) => {
    if (code !== 0) {
      return res
        .status(500)
        .json({ error: "yt-dlp failed", detail: err.trim() });
    }

    const url = out.toString().trim().split(/\r?\n/)[0];
    if (!url) {
      return res
        .status(500)
        .json({ error: "No downloadable format found", detail: err.trim() });
    }

    return res.json({ downloadUrl: url });
  });
});

app.listen(3000, () => {
  console.log("Backend running on http://localhost:3000");
});