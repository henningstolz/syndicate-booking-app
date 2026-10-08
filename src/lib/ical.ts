// Builds an iCalendar (.ics) file, the format calendar apps subscribe to
// (RFC 5545). Pure and import-free, so tests can load it in plain Node.
// Times are written in UTC ("Z"), so no time zone definitions are needed and
// every calendar shows them correctly in the viewer's own time.

export type IcsEvent = {
  uid: string; // stable for the booking, so an updated booking replaces the old event
  start: string; // ISO timestamp
  end: string;
  summary: string;
  description?: string;
  url?: string;
  stamp: string; // ISO timestamp of when the booking was made
};

// "2026-10-10T07:00:00.000Z" -> "20261010T070000Z"
export function icsTime(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// Text values: backslash, semicolon, comma and line breaks are escaped.
export function icsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

// Lines longer than 75 octets are split, each continuation starting with a
// space. Splits fall between characters (never inside a multi-byte one).
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  let limit = 75;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
      limit = 74; // the leading space of a continuation line takes one octet
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function buildIcs(input: { name: string; events: IcsEvent[]; refreshHours?: number }): string {
  const refresh = `PT${input.refreshHours ?? 1}H`;
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Blocktime//Aircraft bookings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(input.name)}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${refresh}`,
    `X-PUBLISHED-TTL:${refresh}`,
  ];
  for (const event of input.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${icsTime(event.stamp)}`,
      `DTSTART:${icsTime(event.start)}`,
      `DTEND:${icsTime(event.end)}`,
      `SUMMARY:${icsText(event.summary)}`,
    );
    if (event.description) lines.push(`DESCRIPTION:${icsText(event.description)}`);
    if (event.url) lines.push(`URL:${event.url}`);
    lines.push("STATUS:CONFIRMED", "TRANSP:OPAQUE", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
