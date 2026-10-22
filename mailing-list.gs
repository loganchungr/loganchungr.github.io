/**
 * Mailing list collector for Loggin' Chung.
 * Lives inside a Google Sheet (Extensions > Apps Script). It is not part of the website;
 * keep this copy for reference. Setup steps are in README.md under "Mailing list".
 */

const SHEET_NAME = "Sheet1"; // falls back to the first sheet if this name isn't found

function doPost(e) {
  const p = (e && e.parameter) || {};

  // Honeypot: real visitors never fill this in, bots usually do.
  if (p.website) return reply("ok");

  const email = String(p.email || "").trim().toLowerCase();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
  // Reject leading = + - @ so a cell can never be read as a spreadsheet formula.
  if (!valid || /^[=+\-@]/.test(email)) return reply("invalid");

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
    if (sheet.getLastRow() === 0) sheet.appendRow(["Timestamp", "Email"]);
    const last = sheet.getLastRow();
    const existing = last > 1 ? sheet.getRange(2, 2, last - 1, 1).getValues().flat() : [];
    if (existing.indexOf(email) === -1) sheet.appendRow([new Date(), email]);
  } finally {
    lock.releaseLock();
  }
  return reply("ok");
}

function reply(text) {
  return ContentService.createTextOutput(text);
}
