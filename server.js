const express = require("express");
const { spawn } = require("child_process");
const app = express();

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