/**
 * lib/driveClient.js
 *
 * Wraps the Google Drive API v3 for exactly what this pipeline needs:
 * 1. List files in one folder that were added/modified since the last run.
 * 2. Download a file's raw bytes (PDF, plain text, etc).
 *
 * Auth: uses a Google Cloud service account (JSON key). The service account
 * must be shared as a Viewer on the target Drive folder — service accounts
 * don't inherit access from your personal Google account automatically.
 *
 * Required env vars:
 *   GOOGLE_SERVICE_ACCOUNT_JSON  - the full service account JSON key, as a
 *                                  single-line string (Railway env vars are
 *                                  string-only, so store it stringified).
 *   DRIVE_FOLDER_ID              - the folder ID from the Drive URL:
 *                                  https://drive.google.com/drive/folders/<THIS_PART>
 */

const { google } = require("googleapis");

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON env var is not set");
  }
  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"]
  });
}

async function getDriveClient() {
  const auth = getAuth();
  return google.drive({ version: "v3", auth });
}

/**
 * Returns files in DRIVE_FOLDER_ID with modifiedTime after `sinceIso`.
 * Excludes trashed files and subfolders (files only).
 */
async function listNewFiles(sinceIso) {
  const drive = await getDriveClient();
  const folderId = process.env.DRIVE_FOLDER_ID;
  if (!folderId) throw new Error("DRIVE_FOLDER_ID env var is not set");

  const query = [
    `'${folderId}' in parents`,
    "trashed = false",
    "mimeType != 'application/vnd.google-apps.folder'",
    sinceIso ? `modifiedTime > '${sinceIso}'` : null
  ].filter(Boolean).join(" and ");

  const files = [];
  let pageToken = undefined;
  do {
    const res = await drive.files.list({
      q: query,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime, size)",
      pageSize: 100,
      pageToken
    });
    files.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return files;
}

/**
 * Downloads a file's raw content as a Buffer.
 * Google-native types (Docs, Sheets) get exported as plain text instead of
 * downloaded raw, since they have no direct binary representation.
 */
async function downloadFile(file) {
  const drive = await getDriveClient();

  const GOOGLE_NATIVE_EXPORT = {
    "application/vnd.google-apps.document": "text/plain",
    "application/vnd.google-apps.spreadsheet": "text/csv"
  };

  if (GOOGLE_NATIVE_EXPORT[file.mimeType]) {
    const res = await drive.files.export(
      { fileId: file.id, mimeType: GOOGLE_NATIVE_EXPORT[file.mimeType] },
      { responseType: "arraybuffer" }
    );
    return Buffer.from(res.data);
  }

  const res = await drive.files.get(
    { fileId: file.id, alt: "media" },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data);
}

module.exports = { listNewFiles, downloadFile };
