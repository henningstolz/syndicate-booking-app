// Builds the monthly flight log PDF: A4 landscape, laid out like the club's
// paper Technical Log (simplified): the fields a pilot enters, the calculated
// decimal hours, the airframe total and hours to the next check, and a
// signature line on every page.
// Self-contained on purpose: it takes ready-formatted text, so it has no
// dependency on the app and can be tested on its own.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type PdfRow = {
  date: string;
  from: string;
  to: string;
  category: string;
  captain: string;
  fuelLeft: string;
  fuelRight: string;
  fuelTotal: string;
  oil: string;
  brakesOff: string;
  airborne: string;
  landed: string;
  brakesOn: string;
  // Calculated: decimal hours (paper conversion table) for block and flight
  // time, the airframe total after this flight and the hours left to the next
  // check. Empty strings when not known (totals not set up, entry voided).
  blockDeci: string;
  flightDeci: string;
  totalHours: string;
  hoursToCheck: string;
  defects: string;
  // A voided entry stays on the printout, struck through, like a correction
  // on paper. Its `defects` text then holds the reason.
  voided: boolean;
};

export type PdfInput = {
  groupName: string;
  registration: string;
  aircraftType: string;
  monthLabel: string; // "October 2026"
  printedAt: string; // "6 Oct 2026, 14:05"
  rows: PdfRow[];
};

// A4 landscape in points (1 pt = 1/72 inch).
const PAGE_W = 841.89;
const PAGE_H = 595.28;
const MARGIN = 28;
const FOOTER_H = 22;
// Room kept at the bottom of every page for the signature line.
const SIGN_H = 34;

const INK = rgb(0.09, 0.125, 0.15);
const MUTED = rgb(0.42, 0.45, 0.43);
const LINE = rgb(0.55, 0.57, 0.55);
const SHADE = rgb(0.93, 0.94, 0.92);
// One row never prints more than this many lines of a note, so a very long
// note cannot run off the bottom of the page. The full text stays in the app.
const MAX_CELL_LINES = 26;
const FONT_SIZE = 8;
const LEADING = 10;
const PAD = 3;

type Column = { key: keyof PdfRow | null; label: string; width: number; align: "left" | "center" };

// Widths add up to the usable width (841.89 - 2 * 28 = 785.89); defects take
// whatever is left.
const FIXED: Column[] = [
  { key: "date", label: "DATE", width: 40, align: "left" },
  { key: "from", label: "FROM", width: 34, align: "left" },
  { key: "to", label: "TO", width: 34, align: "left" },
  { key: "category", label: "CAT", width: 24, align: "center" },
  { key: "captain", label: "CAPTAIN", width: 74, align: "left" },
  { key: "fuelLeft", label: "L", width: 28, align: "center" },
  { key: "fuelRight", label: "R", width: 28, align: "center" },
  { key: "fuelTotal", label: "TOTAL", width: 32, align: "center" },
  { key: "oil", label: "OIL (qt)", width: 26, align: "center" },
  { key: "brakesOff", label: "BRAKES OFF", width: 38, align: "center" },
  { key: "airborne", label: "AIRBORNE", width: 42, align: "center" },
  { key: "landed", label: "LANDED", width: 38, align: "center" },
  { key: "brakesOn", label: "BRAKES ON", width: 38, align: "center" },
  { key: "blockDeci", label: "BLOCK", width: 32, align: "center" },
  { key: "flightDeci", label: "FLIGHT", width: 32, align: "center" },
  { key: "totalHours", label: "TOTAL HOURS", width: 44, align: "center" },
  { key: "hoursToCheck", label: "HOURS TO CHK", width: 40, align: "center" },
];
const USABLE_W = PAGE_W - 2 * MARGIN;

// Column groups with a label above them: [first column, how many, label].
const GROUPS: [number, number, string][] = [
  [5, 3, "FUEL AT DEP. (US gal)"],
  [9, 4, "LOCAL TIMES"],
  [13, 2, "DECI HOURS"],
];
const GROUP_ROW_H = 12;
const COLUMNS: Column[] = [
  ...FIXED,
  {
    key: "defects",
    label: "DEFECTS",
    width: USABLE_W - FIXED.reduce((sum, c) => sum + c.width, 0),
    align: "left",
  },
];

// The standard PDF fonts only know Western European characters; anything else
// (an emoji in a defect note, a non-Latin name) becomes "?" instead of making
// the whole PDF fail.
function makeSafe(font: PDFFont) {
  const supported = new Set(font.getCharacterSet());
  return (text: string) =>
    Array.from(text.replace(/\r\n?/g, "\n"))
      .map((ch) => (ch === "\n" || supported.has(ch.codePointAt(0) as number) ? ch : "?"))
      .join("");
}

// Splits text into lines no wider than maxWidth, honouring line breaks and
// breaking words that are longer than a line.
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      let rest = word;
      const attempt = line === "" ? rest : `${line} ${rest}`;
      if (font.widthOfTextAtSize(attempt, size) <= maxWidth) {
        line = attempt;
        continue;
      }
      if (line !== "") {
        lines.push(line);
        line = "";
      }
      // The word alone may still be too wide: cut it.
      while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

function clipToLines(value: string, font: PDFFont, width: number): string {
  const lines = wrap(value, font, FONT_SIZE, width);
  if (lines.length <= MAX_CELL_LINES) return value;
  return [...lines.slice(0, MAX_CELL_LINES - 1), "... (continues in the app)"].join("\n");
}

export async function buildFlightLogPdf(input: PdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Technical Log ${input.registration} ${input.monthLabel}`);
  doc.setCreator("Blocktime");
  doc.setProducer("Blocktime");

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const safe = makeSafe(regular);

  const pages: PDFPage[] = [];

  // y values below are measured from the TOP of the page (easier to think
  // about); pdf-lib wants them from the bottom.
  const Y = (fromTop: number) => PAGE_H - fromTop;

  const text = (
    page: PDFPage,
    value: string,
    x: number,
    baselineFromTop: number,
    opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {},
  ) =>
    page.drawText(safe(value), {
      x,
      y: Y(baselineFromTop),
      font: opts.font ?? regular,
      size: opts.size ?? FONT_SIZE,
      color: opts.color ?? INK,
    });

  const hline = (page: PDFPage, x1: number, x2: number, fromTop: number, thickness = 0.6) =>
    page.drawLine({
      start: { x: x1, y: Y(fromTop) },
      end: { x: x2, y: Y(fromTop) },
      thickness,
      color: LINE,
    });

  const vline = (page: PDFPage, x: number, top: number, bottom: number) =>
    page.drawLine({
      start: { x, y: Y(top) },
      end: { x, y: Y(bottom) },
      thickness: 0.6,
      color: LINE,
    });

  // Centred (or left-aligned) text inside a cell, wrapping as needed.
  const cellText = (
    page: PDFPage,
    value: string,
    col: Column,
    x: number,
    topOfCell: number,
    opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {},
  ) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? FONT_SIZE;
    const lines = wrap(safe(value), font, size, col.width - 2 * PAD);
    lines.forEach((line, i) => {
      const w = font.widthOfTextAtSize(line, size);
      const tx = col.align === "center" ? x + (col.width - w) / 2 : x + PAD;
      text(page, line, tx, topOfCell + size + 1.5 + i * LEADING, { ...opts, font, size });
    });
    return lines.length;
  };

  // ------------------------------------------------------------ page chrome
  let page!: PDFPage;
  let cursor = 0; // current y, from the top
  const BOTTOM = PAGE_H - MARGIN - FOOTER_H - SIGN_H; // lowest y a row may reach

  const tableLeft = MARGIN;
  const colX: number[] = [];
  COLUMNS.reduce((x, c) => (colX.push(x), x + c.width), tableLeft);

  function drawHeader(first: boolean) {
    let y = MARGIN;
    text(page, "TECHNICAL LOG", MARGIN, y + 14, { font: bold, size: 16 });
    text(page, input.groupName, MARGIN, y + 28, { size: 9, color: MUTED });

    // Three boxed fields, like the DATE / REG / TYPE box on the paper sheet.
    const boxW = 190;
    const boxX = PAGE_W - MARGIN - boxW;
    const fields: [string, string][] = [
      ["MONTH", input.monthLabel],
      ["REG", input.registration],
      ["TYPE", input.aircraftType],
    ];
    const boxH = first ? 52 : 52;
    page.drawRectangle({
      x: boxX,
      y: Y(y + boxH),
      width: boxW,
      height: boxH,
      borderColor: INK,
      borderWidth: 0.9,
    });
    fields.forEach(([label, value], i) => {
      const fy = y + 15 + i * 15.5;
      text(page, label, boxX + 7, fy, { font: bold, size: 7.5 });
      text(page, value, boxX + 48, fy, { size: 9 });
      if (i < fields.length - 1) hline(page, boxX + 46, boxX + boxW - 7, fy + 3, 0.4);
    });
    y += boxH + 14;

    // Two-row table header: group labels over the fuel and time columns.
    const groupRowH = GROUP_ROW_H;
    const labelRowH = 22;
    page.drawRectangle({
      x: tableLeft,
      y: Y(y + groupRowH + labelRowH),
      width: USABLE_W,
      height: groupRowH + labelRowH,
      color: SHADE,
    });
    for (const [start, count, label] of GROUPS) {
      const gx = colX[start];
      const gw = COLUMNS.slice(start, start + count).reduce((s, c) => s + c.width, 0);
      const w = bold.widthOfTextAtSize(label, 6.5);
      text(page, label, gx + (gw - w) / 2, y + 8.5, { font: bold, size: 6.5 });
      hline(page, gx + 2, gx + gw - 2, y + groupRowH, 0.4);
    }
    COLUMNS.forEach((col, i) => {
      const lines = wrap(col.label, bold, 6.5, col.width - 2 * PAD);
      const startY = y + groupRowH + (labelRowH - lines.length * 8) / 2;
      lines.forEach((line, li) => {
        const w = bold.widthOfTextAtSize(line, 6.5);
        const tx = col.align === "center" ? colX[i] + (col.width - w) / 2 : colX[i] + PAD;
        text(page, line, tx, startY + 6.5 + li * 8, { font: bold, size: 6.5 });
      });
    });

    const tableTop = y;
    y += groupRowH + labelRowH;
    hline(page, tableLeft, tableLeft + USABLE_W, tableTop, 0.9);
    hline(page, tableLeft, tableLeft + USABLE_W, y, 0.9);
    return { tableTop, headerBottom: y };
  }

  let currentTableTop = 0;
  let currentHeaderBottom = 0;

  function newPage(first: boolean) {
    page = doc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    const { tableTop, headerBottom } = drawHeader(first);
    currentTableTop = tableTop;
    currentHeaderBottom = headerBottom;
    cursor = headerBottom;
  }

  // Close the table on the current page: outer frame and column dividers.
  function closeTable(empty = false) {
    const left = tableLeft;
    const right = tableLeft + USABLE_W;
    vline(page, left, currentTableTop, cursor);
    vline(page, right, currentTableTop, cursor);
    // With no rows the dividers stop at the end of the header, so they do
    // not cut through the "no flights" message.
    const dividersTo = empty ? currentHeaderBottom : cursor;
    // Dividers between columns of a labelled group start below the label, so
    // they do not cut through it.
    colX.slice(1).forEach((x, k) => {
      const index = k + 1;
      const insideGroup = GROUPS.some(([start, count]) => index > start && index < start + count);
      vline(page, x, insideGroup ? currentTableTop + GROUP_ROW_H : currentTableTop, dividersTo);
    });
    hline(page, left, right, cursor, 0.9);
  }

  newPage(true);

  // ------------------------------------------------------------------ rows
  if (input.rows.length === 0) {
    const h = 26;
    text(page, "No flights logged this month.", tableLeft + 8, cursor + 16, {
      color: MUTED,
      size: 9,
    });
    cursor += h;
  }

  for (const row of input.rows) {
    const color = row.voided ? MUTED : INK;
    // Row height from the tallest wrapped cell (captain, defects).
    const cells = COLUMNS.map((col) =>
      clipToLines(safe(String(row[col.key as keyof PdfRow] ?? "")), regular, col.width - 2 * PAD),
    );
    const needed = cells.map((value, i) =>
      wrap(value, regular, FONT_SIZE, COLUMNS[i].width - 2 * PAD).length,
    );
    const lines = Math.max(...needed, 1);
    const rowH = Math.max(18, lines * LEADING + 8);

    if (cursor + rowH > BOTTOM) {
      closeTable();
      newPage(false);
    }

    COLUMNS.forEach((col, i) => {
      cellText(page, cells[i], col, colX[i], cursor + 3, { color });
    });

    // Struck through: a thin line across the row's data, never removed.
    if (row.voided) {
      const midY = cursor + rowH / 2;
      hline(page, tableLeft + 2, colX[COLUMNS.length - 1] - 2, midY, 0.7);
    }

    cursor += rowH;
    hline(page, tableLeft, tableLeft + USABLE_W, cursor, 0.4);
  }
  closeTable(input.rows.length === 0);

  // ---------------------------------------------------------------- footers
  const total = pages.length;
  pages.forEach((p, i) => {
    // Signature line: each printed sheet in the folder gets signed.
    const signY = PAGE_H - MARGIN - FOOTER_H - 10; // from the top
    const fields: [string, number, number][] = [
      ["SIGNED", MARGIN, 230],
      ["NAME", MARGIN + 270, 190],
      ["DATE", MARGIN + 500, 120],
    ];
    for (const [label, x, width] of fields) {
      text(p, label, x, signY, { font: bold, size: 7.5 });
      const labelW = bold.widthOfTextAtSize(label, 7.5);
      hline(p, x + labelW + 6, x + labelW + 6 + width, signY + 2, 0.6);
    }
    const left = `Blocktime flight log · ${input.registration} · ${input.monthLabel} · printed ${input.printedAt}`;
    text(p, left, MARGIN, PAGE_H - MARGIN + 6, { size: 7, color: MUTED });
    const right = `Page ${i + 1} of ${total}`;
    const w = regular.widthOfTextAtSize(right, 7);
    text(p, right, PAGE_W - MARGIN - w, PAGE_H - MARGIN + 6, { size: 7, color: MUTED });
    text(
      p,
      "Voided entries are shown struck through with their reason.",
      MARGIN,
      PAGE_H - MARGIN + 15,
      { size: 6.5, color: MUTED },
    );
  });

  return doc.save();
}
