/**
 * lib/claudeExtract.js
 *
 * Sends the raw text of one source document (PDF, email, etc) to Claude
 * and asks for ONLY structured case-update / note JSON matching the
 * dashboard's schema. No prose, no commentary — JSON only, so it can be
 * parsed directly and validated before merging.
 *
 * Required env var:
 *   ANTHROPIC_API_KEY
 */

const Anthropic = require("@anthropic-ai/sdk");
const { CASE_FIELDS } = require("./schema");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a data-extraction engine for a legal case tracking system. You will be given the raw text of one document (a PDF, an email chain, or a plain text file) related to Patton Family legal/collections matters.

Your job: extract any information relevant to existing or new legal cases and return it as JSON matching this exact schema:

{
  "caseUpdates": [
    {
      "key": "ORG-CASENAME",             // REQUIRED. Match existing case keys when possible (format: <ORGCODE>-<SHORTNAME>, e.g. "HTL-ALEXLOGIST"). Only include a NEW key if this is clearly a brand-new matter with no existing match.
      // Include ONLY the fields below that this document actually gives you new/updated information for. Omit fields you have no information about — do not guess or fill in placeholders.
      "org": "string, full organization name, e.g. 'Hello Truck Lease (HTL)'",
      "name": "string, business/defendant legal name",
      "status": "string, current case status",
      "active": true or false,
      "lastAction": "string, most recent action taken",
      "nextAction": "string, next step planned",
      "nextOwner": "string",
      "targetTiming": "string",
      "dateOpened": "YYYY-MM-DD or null",
      "lastUpdated": "YYYY-MM-DD or null",
      "principal": number or null,
      "balance": number or null,
      "judgmentAmount": number or null,
      "judgmentDate": "YYYY-MM-DD or null",
      "court": "string",
      "caseNumber": "string",
      "trialDate": "YYYY-MM-DD or null",
      "outsideCounsel": "string",
      "primaryContact": "string",
      "collectability": "string",
      "judge": "string",
      "guarantors": "string",
      "contactEmail": "string",
      "contactPhone": "string",
      "entityType": "string",
      "complaintFiledDate": "YYYY-MM-DD or null",
      "fileReference": "string"
    }
  ],
  "notes": [
    {
      "key": "ORG-CASENAME",   // REQUIRED, must match a case key above or an existing case
      "note": "string, a concise factual summary of what this document reveals about the case",
      "ts": "YYYY-MM-DD or null, the date this event/note occurred (not today's date, unless that's genuinely the same)",
      "author": "string or null, only if the document clearly attributes this to a specific person"
    }
  ]
}

Rules:
- Dates MUST be in YYYY-MM-DD format or null. Never guess a year — if the year is ambiguous or looks wrong (e.g., pre-2000 or after 2035), use null instead.
- Never invent case keys, dollar amounts, or names that are not explicitly stated in the document.
- If the document has nothing relevant to legal cases, return {"caseUpdates": [], "notes": []}.
- Output ONLY the JSON object. No markdown fences, no preamble, no explanation.`;

/**
 * @param {string} text        extracted document text
 * @param {string} sourceName  original filename, included for citation in
 *                             prompt context (not used elsewhere)
 * @returns {Promise<object>}  parsed { caseUpdates: [], notes: [] } — NOT
 *                             yet validated; caller must run it through
 *                             schema.validateExtraction before merging.
 */
async function extractFromDocument(text, sourceName) {
  // Guard against empty/near-empty documents wasting an API call.
  if (!text || text.trim().length < 20) {
    return { caseUpdates: [], notes: [] };
  }

  // Truncate extremely long documents to stay within reasonable token
  // budget; most case-related PDFs/emails are well under this.
  const MAX_CHARS = 60000;
  const trimmedText = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Source document: ${sourceName}\n\n---\n\n${trimmedText}`
      }
    ]
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) return { caseUpdates: [], notes: [] };

  let raw = textBlock.text.trim();
  // Defensive: strip markdown fences if the model adds them despite instructions.
  raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");

  try {
    const parsed = JSON.parse(raw);
    return {
      caseUpdates: Array.isArray(parsed.caseUpdates) ? parsed.caseUpdates : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : []
    };
  } catch (err) {
    // A parse failure here should surface as a loud log line, not a crash —
    // one bad document shouldn't take down the whole pipeline run.
    console.error(`[claudeExtract] Failed to parse JSON for '${sourceName}':`, err.message);
    console.error(`[claudeExtract] Raw response was:`, raw.slice(0, 500));
    return { caseUpdates: [], notes: [], parseFailed: true };
  }
}

module.exports = { extractFromDocument, CASE_FIELDS };
