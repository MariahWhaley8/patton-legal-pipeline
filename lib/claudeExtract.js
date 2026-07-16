/**
 * lib/extractText.js
 *
 * Converts a downloaded file (Buffer + mimeType/name) into plain text that
 * can be handed to Claude for structured extraction.
 *
 * Supported inputs:
 *   - application/pdf                  -> pdf-parse
 *   - text/plain, text/csv             -> decoded directly
 *   - message/rfc822, .eml files       -> naive header/body split
 *     (good enough for forwarded email chains saved as .eml; for anything
 *     fancier, e.g. HTML-only emails, consider adding `mailparser` later)
 *
 * Anything unrecognized is skipped (returns null) rather than guessed at —
 * silently mis-parsing a file is worse than skipping it and logging why.
 */

const pdfParse = require("pdf-parse");

function extractEmailText(buffer) {
  const raw = buffer.toString("utf-8");
  // Split headers from body on the first blank line, per RFC 822.
  const splitIndex = raw.indexOf("\r\n\r\n") !== -1 ? raw.indexOf("\r\n\r\n") : raw.indexOf("\n\n");
  const headerBlock = splitIndex !== -1 ? raw.slice(0, splitIndex) : "";
  const bodyBlock = splitIndex !== -1 ? raw.slice(splitIndex) : raw;

  const getHeader = (name) => {
    const match = headerBlock.match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
    return match ? match[1].trim() : null;
  };

  const meta = {
    from: getHeader("From"),
    to: getHeader("To"),
    subject: getHeader("Subject"),
    date: getHeader("Date")
  };

  const metaText = Object.entries(meta)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  return `${metaText}\n\n${bodyBlock.trim()}`;
}

/**
 * @param {Buffer} buffer   raw file bytes
 * @param {string} mimeType from Drive metadata
 * @param {string} name     original filename, used as a fallback signal
 *                          when mimeType is generic (e.g. octet-stream)
 * @returns {Promise<string|null>} extracted text, or null if unsupported
 */
async function extractText(buffer, mimeType, name) {
  const lowerName = (name || "").toLowerCase();

  if (mimeType === "application/pdf" || lowerName.endsWith(".pdf")) {
    const parsed = await pdfParse(buffer);
    return parsed.text;
  }

  if (mimeType === "text/plain" || lowerName.endsWith(".txt")) {
    return buffer.toString("utf-8");
  }

  if (mimeType === "text/csv" || lowerName.endsWith(".csv")) {
    return buffer.toString("utf-8");
  }

  if (mimeType === "message/rfc822" || lowerName.endsWith(".eml")) {
    return extractEmailText(buffer);
  }

  return null;
}

module.exports = { extractText };
