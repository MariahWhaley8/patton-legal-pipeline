/**
 * lib/dataStore.js
 *
 * Reads and writes the single master dataset file that the dashboard
 * fetches. Lives on a Railway Volume (a persistent disk mount) so it
 * survives redeploys and restarts — a plain filesystem path inside the
 * container would be wiped every time Railway redeploys the service.
 *
 * Required env var:
 *   DATA_DIR   - mount path of the Railway volume, e.g. "/data"
 *                (set this to match the volume's mount path in Railway's
 *                dashboard; see README.md for setup steps)
 *
 * File layout on the volume:
 *   /data/dataset.json    - the merged { generatedAt, cases: [], notes: [] }
 *   /data/last-run.json   - { lastRunIso } used to ask Drive for "what's new
 *                            since last time" instead of re-scanning
 *                            everything on every run
 *   /data/rejections.log  - append-only log of extraction items that failed
 *                            schema validation, for later review
 */

const fs = require("fs/promises");
const path = require("path");

function dataDir() {
  const dir = process.env.DATA_DIR;
  if (!dir) throw new Error("DATA_DIR env var is not set");
  return dir;
}

async function ensureDataDir() {
  await fs.mkdir(dataDir(), { recursive: true });
}

async function readJsonSafe(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

async function loadDataset() {
  await ensureDataDir();
  const filePath = path.join(dataDir(), "dataset.json");
  return readJsonSafe(filePath, {
    generatedAt: null,
    sourceTitle: "Legal Cases Master",
    cases: [],
    notes: []
  });
}

async function saveDataset(dataset) {
  await ensureDataDir();
  const filePath = path.join(dataDir(), "dataset.json");
  const tmpPath = `${filePath}.tmp`;
  // Write to a temp file then rename, so a crash mid-write never leaves
  // dataset.json truncated or corrupted for the dashboard to fetch.
  await fs.writeFile(tmpPath, JSON.stringify(dataset), "utf-8");
  await fs.rename(tmpPath, filePath);
}

async function getLastRunIso() {
  await ensureDataDir();
  const filePath = path.join(dataDir(), "last-run.json");
  const data = await readJsonSafe(filePath, { lastRunIso: null });
  return data.lastRunIso;
}

async function setLastRunIso(iso) {
  await ensureDataDir();
  const filePath = path.join(dataDir(), "last-run.json");
  await fs.writeFile(filePath, JSON.stringify({ lastRunIso: iso }), "utf-8");
}

async function logRejections(rejections, sourceName) {
  if (!rejections || rejections.length === 0) return;
  await ensureDataDir();
  const filePath = path.join(dataDir(), "rejections.log");
  const lines = rejections.map(
    (r) => JSON.stringify({ ts: new Date().toISOString(), sourceName, ...r })
  );
  await fs.appendFile(filePath, lines.join("\n") + "\n", "utf-8");
}

/**
 * Merges validated case updates into the dataset: upsert by `key`
 * (existing fields are preserved unless the update explicitly overrides
 * them — this is a shallow merge, not a replace).
 */
function mergeCaseUpdates(dataset, caseUpdates) {
  const byKey = new Map(dataset.cases.map((c) => [c.key, c]));
  for (const update of caseUpdates) {
    const existing = byKey.get(update.key);
    if (existing) {
      Object.assign(existing, update);
    } else {
      // New case — fill any fields the schema expects but the update
      // didn't provide, so the dashboard doesn't choke on missing keys.
      byKey.set(update.key, { active: true, ...update });
    }
  }
  dataset.cases = Array.from(byKey.values());
}

/**
 * Appends new notes, skipping exact duplicates (same key + note text +
 * timestamp) so re-processing an already-seen file doesn't double them up.
 */
function mergeNotes(dataset, notes) {
  const existingSignatures = new Set(
    dataset.notes.map((n) => `${n.key}|${n.note}|${n.ts}`)
  );
  for (const note of notes) {
    const sig = `${note.key}|${note.note}|${note.ts}`;
    if (!existingSignatures.has(sig)) {
      dataset.notes.push(note);
      existingSignatures.add(sig);
    }
  }
}

module.exports = {
  loadDataset,
  saveDataset,
  getLastRunIso,
  setLastRunIso,
  logRejections,
  mergeCaseUpdates,
  mergeNotes
};
