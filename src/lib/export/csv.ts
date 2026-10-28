// CSV for the group data export. Written so a spreadsheet opens it correctly (UTF-8 with a byte-order
// mark, Windows line endings) and so nothing typed by a member can run as a formula when the file is
// opened: a text cell that starts with = + - @ (or a tab or carriage return) gets a leading apostrophe.
// Numbers are passed as numbers, so a negative amount stays a number. Pure.

const NEEDS_QUOTES = /[",\r\n]/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}
