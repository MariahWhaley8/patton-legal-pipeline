/**
 * lib/schema.js
 *
 * Defines the exact shape of a "case" and a "note" record, matching what
 * dashboard.html expects in its embedded/fetched DATA object. Also provides
 * a validator so a bad extraction from Claude gets rejected before it ever
 * touches the live dataset, rather than silently corrupting it.
 */

const CASE_FIELDS = [
  "key", "org", "name", "caseType", "subtype", "status", "active",
  "lastAction", "nextAction", "nextOwner", "targetTiming",
  "dateOpened", "lastUpdated", "principal", "balance",
  "judgmentAmount", "judgmentDate", "court", "caseNumber", "trialDate",
  "outsideCounsel", "primaryContact", "collectability",
  "judge", "guarantors", "contactEmail", "contactPhone",
  "entityType", "complaintFiledDate", "fileReference"
];

const NOTE_FIELDS = ["key", "note", "ts", "author"];

const STRING_FIELDS = new Set([
  "key", "org", "name", "caseType", "subtype", "status", "lastAction",
  "nextAction", "nextOwner", "targetTiming", "court", "caseNumber",
  "outsideCounsel", "primaryContact", "collectability", "judge",
  "guarantors", "contactEmail", "contactPhone", "entityType", "fileReference"
]);

const NUMBER_FIELDS = new Set(["principal", "balance", "judgmentAmount"]);

const DATE_FIELDS = new Set([
  "dateOpened", "lastUpdated", "judgmentDate", "trialDate", "complaintFiledDate"
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MIN_YEAR = 2000;
const MAX_YEAR = 2035;

function isPlausibleDate(value) {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

/**
 * Validates a single case-update object. Returns { valid, errors }.
 * A case update doesn't need every field — only "key" is required, since
 * updates should be partial (merge into the existing case, not replace it).
 */
function validateCaseUpdate(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") {
    return { valid: false, errors: ["not an object"] };
  }
  if (!obj.key || typeof obj.key !== "string") {
    errors.push("missing or invalid 'key'");
  }
  for (const field of Object.keys(obj)) {
    if (!CASE_FIELDS.includes(field)) {
      errors.push(`unknown field '${field}'`);
      continue;
    }
    const value = obj[field];
    if (value === null) continue;
    if (STRING_FIELDS.has(field) && typeof value !== "string") {
      errors.push(`field '${field}' should be string, got ${typeof value}`);
    }
    if (NUMBER_FIELDS.has(field) && typeof value !== "number") {
      errors.push(`field '${field}' should be number, got ${typeof value}`);
    }
    if (DATE_FIELDS.has(field) && !isPlausibleDate(value)) {
      errors.push(`field '${field}' has an implausible or malformed date: ${value}`);
    }
    if (field === "active" && typeof value !== "boolean") {
      errors.push(`field 'active' should be boolean, got ${typeof value}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function validateNote(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") {
    return { valid: false, errors: ["not an object"] };
  }
  if (!obj.key || typeof obj.key !== "string") errors.push("missing or invalid 'key'");
  if (!obj.note || typeof obj.note !== "string") errors.push("missing or invalid 'note'");
  if (obj.ts !== null && obj.ts !== undefined && !isPlausibleDate(obj.ts)) {
    errors.push(`'ts' is implausible or malformed: ${obj.ts}`);
  }
  for (const field of Object.keys(obj)) {
    if (!NOTE_FIELDS.includes(field)) errors.push(`unknown field '${field}'`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validates a full extraction payload from Claude:
 * { caseUpdates: [...], notes: [...] }
 * Returns only the entries that pass validation, plus a list of rejections
 * (with reasons) so failures are visible in logs instead of silently dropped.
 */
function validateExtraction(payload) {
  const result = { caseUpdates: [], notes: [], rejected: [] };
  if (!payload || typeof payload !== "object") {
    result.rejected.push({ item: payload, errors: ["payload is not an object"] });
    return result;
  }

  const caseUpdates = Array.isArray(payload.caseUpdates) ? payload.caseUpdates : [];
  for (const c of caseUpdates) {
    const { valid, errors } = validateCaseUpdate(c);
    if (valid) result.caseUpdates.push(c);
    else result.rejected.push({ item: c, errors });
  }

  const notes = Array.isArray(payload.notes) ? payload.notes : [];
  for (const n of notes) {
    const { valid, errors } = validateNote(n);
    if (valid) result.notes.push(n);
    else result.rejected.push({ item: n, errors });
  }

  return result;
}

module.exports = {
  CASE_FIELDS,
  NOTE_FIELDS,
  validateCaseUpdate,
  validateNote,
  validateExtraction,
  isPlausibleDate
};
