// Builds the cost statement PDF: A4 portrait. One statement per member (their
// fixed share, flying with every flight listed, expenses they paid, the total),
// and, for an admin's "everyone" download, a summary page in front.
// Like the flight log PDF it takes ready-formatted text, so it has no
// dependency on the app and can be tested on its own.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { makeSafe, wrap } from "./flight-log-pdf.ts";

export type StatementPdfPerson = {
  name: string;
  notAMember: boolean; // charged for a flight in the month without being a member
  fixedLabel: string; // "Fixed monthly share"
  fixed: string; // "£120.00"
  flyingLabel: string; // "Flying: 8.3 block hours at £65.00 an hour"
  flying: string;
  flights: { date: string; route: string; hours: string; charge: string }[];
  expenses: { date: string; description: string; amount: string }[]; // amount already negative: "-£18.40"
  expensesTotal: string; // "" when there are none
  totalLabel: string; // "Total for October 2026" or "Credit due for October 2026"
  total: string;
  // Payments received (only when there are some): each with its date and note,
  // then what is left. Empty means nothing is printed.
  payments?: { date: string; note: string; amount: string }[]; // amount as a deduction: "-£185.00"
  paymentsTotal?: string;
  balanceLabel?: string; // "Still to pay", "Settled" or "Credit still due"
  balance?: string;
  note: string; // "Your own rates apply: ..." or ""
};

export type StatementPdfSummaryRow = {
  name: string;
  hours: string;
  fixed: string;
  flying: string;
  expenses: string;
  total: string;
};

export type StatementPdfInput = {
  groupName: string;
  registration: string;
  monthLabel: string; // "October 2026"
  printedAt: string; // "8 Oct 2026, 14:05"
  closed: boolean;
  status: string; // "Final. Closed on 2 Sep 2026 by Alex." / "Provisional: ..."
  // The group-wide page for an admin's "everyone" download (omit for a single statement).
  summary?: { rows: StatementPdfSummaryRow[]; totals: StatementPdfSummaryRow };
  people: StatementPdfPerson[];
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const FOOTER_H = 30;
const USABLE_W = PAGE_W - 2 * MARGIN;
const BOTTOM = PAGE_H - MARGIN - FOOTER_H;

const INK = rgb(0.09, 0.125, 0.15);
const MUTED = rgb(0.42, 0.45, 0.43);
const LINE = rgb(0.7, 0.72, 0.7);
const SHADE = rgb(0.94, 0.95, 0.93);
const AMBER = rgb(0.72, 0.5, 0.1);

const NOTE =
  "Block time runs from brakes off to brakes on, as in the tech log. A guest's flight is charged to the member who logged it. Amounts are in pounds sterling.";

export async function buildStatementPdf(input: StatementPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Cost statement ${input.registration} ${input.monthLabel}`);
  doc.setCreator("Blocktime");
  doc.setProducer("Blocktime");

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const safe = makeSafe(regular);

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0; // distance from the top of the page

  type Style = { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> };
  const Y = (fromTop: number) => PAGE_H - fromTop;

  const put = (value: string, x: number, baseline: number, style: Style = {}) =>
    page.drawText(safe(value), { x, y: Y(baseline), font: style.font ?? regular, size: style.size ?? 10, color: style.color ?? INK });
  const putRight = (value: string, rightX: number, baseline: number, style: Style = {}) => {
    const font = style.font ?? regular;
    const size = style.size ?? 10;
    put(value, rightX - font.widthOfTextAtSize(safe(value), size), baseline, style);
  };
  const rule = (at: number, thickness = 0.6) =>
    page.drawLine({ start: { x: MARGIN, y: Y(at) }, end: { x: PAGE_W - MARGIN, y: Y(at) }, thickness, color: LINE });

  // Starts a page with the heading block; `title` is the line in bold.
  function newPage(title: string, subtitle: string) {
    page = doc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    put(input.groupName, MARGIN, MARGIN + 12, { font: bold, size: 15 });
    put(`${input.registration}  -  Cost statement, ${input.monthLabel}`, MARGIN, MARGIN + 28, { size: 9, color: MUTED });
    y = MARGIN + 52;
    put(title, MARGIN, y, { font: bold, size: 12 });
    if (subtitle) put(subtitle, MARGIN, y + 14, { size: 9, color: MUTED });
    y += subtitle ? 30 : 20;
  }

  // Makes sure `height` fits on this page, otherwise carries on at the top of a new one.
  function room(height: number, continuedTitle: string) {
    if (y + height <= BOTTOM) return;
    newPage(continuedTitle, "(continued)");
  }

  // The status box: shaded when the month is closed, outlined in amber when not.
  function statusBox() {
    const lines = wrap(safe(input.status), regular, 9, USABLE_W - 16);
    const h = lines.length * 12 + 12;
    if (input.closed) {
      page.drawRectangle({ x: MARGIN, y: Y(y + h), width: USABLE_W, height: h, color: SHADE });
    } else {
      page.drawRectangle({ x: MARGIN, y: Y(y + h), width: USABLE_W, height: h, borderColor: AMBER, borderWidth: 0.8 });
    }
    lines.forEach((line, i) => put(line, MARGIN + 8, y + 14 + i * 12, { size: 9, font: i === 0 ? bold : regular }));
    y += h + 14;
  }

  // ---------------------------------------------------------------- summary
  if (input.summary) {
    newPage(`Everyone, ${input.monthLabel}`, "");
    statusBox();
    const cols = [
      { label: "MEMBER", x: MARGIN, align: "left" as const },
      { label: "HOURS", x: MARGIN + 215, align: "right" as const },
      { label: "FIXED", x: MARGIN + 285, align: "right" as const },
      { label: "FLYING", x: MARGIN + 355, align: "right" as const },
      { label: "EXPENSES", x: MARGIN + 425, align: "right" as const },
      { label: "TOTAL", x: MARGIN + USABLE_W, align: "right" as const },
    ];
    const header = () => {
      page.drawRectangle({ x: MARGIN, y: Y(y + 18), width: USABLE_W, height: 18, color: SHADE });
      for (const c of cols) {
        if (c.align === "left") put(c.label, c.x + 4, y + 12, { font: bold, size: 7.5 });
        else putRight(c.label, c.x, y + 12, { font: bold, size: 7.5 });
      }
      y += 18;
    };
    const line = (r: StatementPdfSummaryRow, isTotal: boolean) => {
      const font = isTotal ? bold : regular;
      if (isTotal) rule(y, 0.9);
      const nameLines = wrap(safe(r.name), font, 9.5, 205);
      put(nameLines[0] ?? "", MARGIN + 4, y + 14, { font, size: 9.5 });
      putRight(r.hours, cols[1].x, y + 14, { font, size: 9.5 });
      putRight(r.fixed, cols[2].x, y + 14, { font, size: 9.5 });
      putRight(r.flying, cols[3].x, y + 14, { font, size: 9.5 });
      putRight(r.expenses, cols[4].x, y + 14, { font, size: 9.5 });
      putRight(r.total, cols[5].x, y + 14, { font: bold, size: 9.5 });
      y += 20;
      rule(y - 2, isTotal ? 0.9 : 0.4);
    };
    header();
    for (const r of input.summary.rows) {
      if (y + 22 > BOTTOM) {
        newPage(`Everyone, ${input.monthLabel}`, "(continued)");
        header();
      }
      line(r, false);
    }
    if (y + 24 > BOTTOM) {
      newPage(`Everyone, ${input.monthLabel}`, "(continued)");
      header();
    }
    line(input.summary.totals, true);
    y += 8;
    for (const l of wrap(safe(NOTE), regular, 8, USABLE_W)) {
      put(l, MARGIN, y + 8, { size: 8, color: MUTED });
      y += 11;
    }
  }

  // ------------------------------------------------------------- statements
  const amountX = PAGE_W - MARGIN;
  for (const person of input.people) {
    const title = person.notAMember ? `${person.name} (not a member this month)` : person.name;
    newPage(title, "");
    statusBox();

    // A row with a label on the left and an amount on the right.
    const row = (label: string, amount: string, style: Style = {}) => {
      const font = style.font ?? regular;
      const size = style.size ?? 10;
      const lines = wrap(safe(label), font, size, USABLE_W - 90);
      room(lines.length * (size + 3) + 4, title);
      lines.forEach((l, i) => put(l, MARGIN, y + size + i * (size + 3), { ...style, font, size }));
      putRight(amount, amountX, y + size, { ...style, font, size });
      y += lines.length * (size + 3) + 3;
    };
    const subRow = (label: string, amount: string) => {
      const lines = wrap(safe(label), regular, 8.5, USABLE_W - 110);
      room(lines.length * 11 + 2, title);
      page.drawLine({ start: { x: MARGIN + 6, y: Y(y - 1) }, end: { x: MARGIN + 6, y: Y(y + lines.length * 11) }, thickness: 0.6, color: LINE });
      lines.forEach((l, i) => put(l, MARGIN + 14, y + 8.5 + i * 11, { size: 8.5, color: MUTED }));
      putRight(amount, amountX, y + 8.5, { size: 8.5, color: MUTED });
      y += lines.length * 11 + 1;
    };

    row(person.fixedLabel, person.fixed);
    y += 6;
    row(person.flyingLabel, person.flying);
    if (person.flights.length === 0) subRow("No flights this month", "");
    for (const f of person.flights) subRow(`${f.date}  -  ${f.route}  -  ${f.hours} h`, f.charge);
    if (person.expenses.length > 0) {
      y += 6;
      row("Expenses paid for the group", person.expensesTotal);
      for (const e of person.expenses) subRow(`${e.date}  -  ${e.description}`, e.amount);
    }

    room(60, title);
    y += 8;
    rule(y, 0.9);
    y += 6;
    row(person.totalLabel, person.total, { font: bold, size: 12 });
    y += 6;
    if (person.payments && person.payments.length > 0) {
      row("Payments received", person.paymentsTotal ?? "");
      for (const pay of person.payments) subRow(`${pay.date}${pay.note ? `  -  ${pay.note}` : ""}`, pay.amount);
      y += 4;
      row(person.balanceLabel ?? "", person.balance ?? "", { font: bold, size: 11 });
      y += 6;
    }
    if (person.note) {
      for (const l of wrap(safe(person.note), regular, 8.5, USABLE_W)) {
        room(12, title);
        put(l, MARGIN, y + 9, { size: 8.5, color: MUTED });
        y += 12;
      }
    }
    y += 6;
    for (const l of wrap(safe(NOTE), regular, 8, USABLE_W)) {
      room(11, title);
      put(l, MARGIN, y + 8, { size: 8, color: MUTED });
      y += 11;
    }
  }

  // Footers, once the number of pages is known.
  pages.forEach((p, i) => {
    page = p;
    rule(PAGE_H - MARGIN - FOOTER_H + 14, 0.4);
    put(`Printed ${input.printedAt}`, MARGIN, PAGE_H - MARGIN + 2, { size: 7.5, color: MUTED });
    const mid = "Blocktime";
    put(mid, PAGE_W / 2 - bold.widthOfTextAtSize(mid, 7.5) / 2, PAGE_H - MARGIN + 2, { font: bold, size: 7.5, color: MUTED });
    putRight(`Page ${i + 1} of ${pages.length}`, PAGE_W - MARGIN, PAGE_H - MARGIN + 2, { size: 7.5, color: MUTED });
  });

  return doc.save();
}
