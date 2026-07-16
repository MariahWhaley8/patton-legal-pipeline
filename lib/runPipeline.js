/**
 * lib/runPipeline.js
 *
 * The full end-to-end run, triggered on a schedule by server.js (or
 * manually via `npm run run-once`):
 *
 *   1. Ask Drive for files added/modified since the last run.
 *   2. For each file: download it, extract text, send to Claude.
 *   3. Validate Claude's output against the schema.
 *   4. Merge valid entries into the master dataset; log rejections.
 *   5. Persist the dataset and record this run's timestamp.
 *
 * Designed so one bad file (unparseable PDF, malformed extraction, a
 * single API error) logs and moves on rather than aborting the whole run —
 * with unattended full auto-publish, one failure shouldn't block every
 * other legitimate update from going live.
 */

const { listNewFiles, downloadFile } = require("./driveClient");
const { extractText } = require("./extractText");
const { extractFromDocument } = require("./claudeExtract");
const { validateExtraction } = require("./schema");
const {
  loadDataset,
  saveDataset,
  getLastRunIso,
  setLastRunIso,
  logRejections,
  mergeCaseUpdates,
  mergeNotes
} = require("./dataStore");

async function runPipeline() {
  const startedAt = new Date().toISOString();
  console.log(`[pipeline] Run started at ${startedAt}`);

  const sinceIso = await getLastRunIso();
  console.log(`[pipeline] Checking for files modified since: ${sinceIso || "(beginning)"}`);

  let files;
  try {
    files = await listNewFiles(sinceIso);
  } catch (err) {
    console.error("[pipeline] Failed to list Drive files — aborting this run:", err.message);
    return { ok: false, error: err.message };
  }

  console.log(`[pipeline] Found ${files.length} new/modified file(s)`);
  if (files.length === 0) {
    await setLastRunIso(startedAt);
    return { ok: true, filesProcessed: 0, caseUpdates: 0, notes: 0 };
  }

  const dataset = await loadDataset();
  let totalCaseUpdates = 0;
  let totalNotes = 0;
  let totalRejected = 0;
  const failedFiles = [];

  for (const file of files) {
    try {
      console.log(`[pipeline] Processing '${file.name}' (${file.mimeType})`);
      const buffer = await downloadFile(file);
      const text = await extractText(buffer, file.mimeType, file.name);

      if (!text) {
        console.log(`[pipeline]   Skipped '${file.name}' — unsupported file type`);
        continue;
      }

      const extraction = await extractFromDocument(text, file.name);
      if (extraction.parseFailed) {
        failedFiles.push(file.name);
        continue;
      }

      const { caseUpdates, notes, rejected } = validateExtraction(extraction);

      if (rejected.length > 0) {
        console.warn(`[pipeline]   ${rejected.length} item(s) from '${file.name}' failed validation and were skipped`);
        await logRejections(rejected, file.name);
        totalRejected += rejected.length;
      }

      mergeCaseUpdates(dataset, caseUpdates);
      mergeNotes(dataset, notes);
      totalCaseUpdates += caseUpdates.length;
      totalNotes += notes.length;

      console.log(`[pipeline]   -> ${caseUpdates.length} case update(s), ${notes.length} note(s)`);
    } catch (err) {
      console.error(`[pipeline] Error processing '${file.name}':`, err.message);
      failedFiles.push(file.name);
    }
  }

  dataset.generatedAt = new Date().toISOString();
  await saveDataset(dataset);
  await setLastRunIso(startedAt);

  const summary = {
    ok: true,
    filesProcessed: files.length,
    caseUpdates: totalCaseUpdates,
    notes: totalNotes,
    rejected: totalRejected,
    failedFiles
  };
  console.log("[pipeline] Run complete:", JSON.stringify(summary));
  return summary;
}

if (require.main === module) {
  runPipeline()
    .then((summary) => {
      console.log("Done:", summary);
      process.exit(summary.ok ? 0 : 1);
    })
    .catch((err) => {
      console.error("Fatal error:", err);
      process.exit(1);
    });
}

module.exports = { runPipeline };
