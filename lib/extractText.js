/**
 * lib/extractText.js
 * Converts PDF / plain text / .eml files into plain text for Claude.
 */

const pdfParse = require("pdf-parse");

function extractEmailText(buffer) {
  const raw = buffer.toString("utf-8");
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

  const metaText = Object.entries(meta).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");
  return `${metaText}\n\n${bodyBlock.trim()}`;
}

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
