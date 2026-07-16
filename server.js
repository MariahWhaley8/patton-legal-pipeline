/**
 * server.js
 *
 * Two jobs:
 *   1. Run the Drive -> Claude -> dataset pipeline every 6 hours (cron).
 *   2. Serve the merged dataset as JSON at GET /api/data, with CORS enabled
 *      so the dashboard (running as a Claude.ai artifact, a different
 *      origin) can fetch it directly from the browser.
 *
 * Required env vars (see .env.example):
 *   ANTHROPIC_API_KEY
 *   GOOGLE_SERVICE_ACCOUNT_JSON
 *   DRIVE_FOLDER_ID
 *   DATA_DIR              (Railway volume mount path, e.g. /data)
 *   PIPELINE_TOKEN         (shared secret to protect the manual trigger route)
 *   ALLOWED_ORIGIN         (optional; restrict CORS to your Claude.ai origin
 *                           instead of "*" once you know the artifact's URL)
 */

const express = require("express");
const cron = require("node-cron");
const { loadDataset } = require("./lib/dataStore");
const { runPipeline } = require("./lib/runPipeline");

const app = express();
const PORT = process.env.PORT || 3000;

// --- CORS ---------------------------------------------------------------
app.use((req, res, next) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// --- Routes ---------------------------------------------------------------

// The dashboard fetches this on load.
app.get("/api/data", async (req, res) => {
  try {
    const dataset = await loadDataset();
    res.setHeader("Cache-Control", "no-store"); // always serve the freshest copy
    res.json(dataset);
  } catch (err) {
    console.error("[server] Failed to load dataset:", err.message);
    res.status(500).json({ error: "Failed to load dataset" });
  }
});

// Manual trigger for testing, protected by a shared token so it's not a
// public "re-run the pipeline" button for anyone who finds the URL.
app.post("/api/run-now", express.json(), async (req, res) => {
  const token = req.headers["x-pipeline-token"];
  if (!process.env.PIPELINE_TOKEN || token !== process.env.PIPELINE_TOKEN) {
    return res.status(401).json({ error: "Invalid or missing pipeline token" });
  }
  try {
    const summary = await runPipeline();
    res.json(summary);
  } catch (err) {
    console.error("[server] Manual run failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/healthz", (req, res) => res.json({ ok: true }));

// --- Scheduled pipeline run: every 6 hours (00:00, 06:00, 12:00, 18:00) ---
cron.schedule("0 */6 * * *", () => {
  console.log("[cron] Triggering scheduled pipeline run");
  runPipeline().catch((err) => console.error("[cron] Pipeline run failed:", err));
});

app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
  console.log("[server] Pipeline scheduled to run every 6 hours");
});
