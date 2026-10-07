// Turns a queued notification into an email (subject, plain text and HTML).
// Pure (no server code), and relative imports with .ts extensions so the tests
// can run it in plain Node. Everything a member typed (chat text, notes,
// names, defects) is escaped before it goes into the HTML.
import { LONDON_TZ, formatDayHeading, formatTime, londonDateKey } from "../datetime.ts";

export type QueuedNotification = {
  id: string;
  recipient_email: string;
  event: string;
  payload: Record<string, unknown>;
  group_name: string;
  group_slug: string;
};

export type RenderedEmail = { subject: string; text: string; html: string };

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" && value.trim() !== "" ? value : fallback;

// "Sat 10 Oct, 09:00–13:00", or across days "Sat 10 Oct 09:00 – Mon 12 Oct 19:00".
export function describeWhen(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  const startDay = formatDayHeading(start);
  if (londonDateKey(start) === londonDateKey(end)) {
    return `${startDay}, ${formatTime(startsAt)}–${formatTime(endsAt)}`;
  }
  return `${startDay} ${formatTime(startsAt)} – ${formatDayHeading(end)} ${formatTime(endsAt)}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const dateOnly = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", // a plain calendar date with no time of day
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

// "Sat 17 Oct 2026", in the same style as the rest of the app (no comma).
function formatDateOnly(iso: string): string {
  const parts = Object.fromEntries(
    dateOnly.formatToParts(new Date(`${iso}T00:00:00Z`)).map((part) => [part.type, part.value]),
  );
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}`;
}

// One line of an aircraft reminder. `short` is for the subject line when it
// is the only item.
function describeReminderItem(raw: unknown): { line: string; short: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as Record<string, unknown>;
  const name = str(item.item);
  if (!name) return null;

  if (item.kind === "date" && typeof item.days === "number" && typeof item.due === "string") {
    const days = item.days;
    const date = formatDateOnly(item.due);
    const phrase =
      days < 0 ? `overdue by ${plural(-days, "day")}` : days === 0 ? "due today" : `due in ${plural(days, "day")}`;
    return { line: `${name}: ${phrase} (${date})`, short: `${name} ${phrase}` };
  }
  if (item.kind === "hours" && typeof item.hours === "number") {
    const limit = typeof item.limit === "number" ? item.limit.toFixed(1) : null;
    if (item.hours <= 0) {
      return {
        line: `${name}: limit reached${limit ? ` (the check was due at ${limit} h)` : ""}`,
        short: "Next check: hours limit reached",
      };
    }
    return {
      line: `${name}: ${item.hours.toFixed(1)} hours left${limit ? ` (check at ${limit} h)` : ""}`,
      short: `${item.hours.toFixed(1)} hours to the next check`,
    };
  }
  return null;
}

type Content = {
  subject: string;
  headline: string;
  lines: string[];
  // A quoted block: a chat message, a note, a defect.
  quote?: { label?: string; text: string; tone?: "plain" | "warning" };
  link: { label: string; path: string };
};

function content(n: QueuedNotification): Content {
  const p = n.payload;
  const slug = encodeURIComponent(n.group_slug);
  const startsAt = str(p.starts_at);
  const endsAt = str(p.ends_at);
  const when = startsAt && endsAt ? describeWhen(startsAt, endsAt) : "";
  const date = startsAt ? londonDateKey(new Date(startsAt)) : "";
  const calendar = `/${slug}/calendar?view=list${date ? `&start=${date}` : ""}`;
  const note = str(p.note);

  switch (n.event) {
    case "booking_created": {
      const who = str(p.who, "A member");
      return {
        subject: `New booking: ${who}, ${when}`,
        headline: `${who} booked the aircraft`,
        lines: [when],
        quote: note ? { label: "Note", text: note } : undefined,
        link: { label: "Open the calendar", path: calendar },
      };
    }
    case "booking_cancelled": {
      const who = str(p.who, "A member");
      const by = str(p.cancelled_by);
      return {
        subject: `Booking cancelled: ${who}, ${when}`,
        headline: by
          ? `${who}'s booking was cancelled by ${by}`
          : `${who} cancelled a booking`,
        lines: [when],
        quote: note ? { label: "Note", text: note } : undefined,
        link: { label: "Open the calendar", path: calendar },
      };
    }
    case "chat_message": {
      const who = str(p.who, "A member");
      return {
        subject: `${who} posted in ${n.group_name}`,
        headline: `${who} posted in the chat`,
        lines: [],
        quote: { text: str(p.message) },
        link: { label: "Open the chat", path: `/${slug}/chat` },
      };
    }
    case "flight_logged":
    case "defect_reported": {
      const captain = str(p.captain, "A member");
      const loggedBy = str(p.logged_by);
      const route = `${str(p.from, "?")} → ${str(p.to, "?")}`;
      const day = str(p.brakes_off) ? formatDayHeading(new Date(str(p.brakes_off))) : "";
      const hours = typeof p.flight_deci === "number" ? `${p.flight_deci.toFixed(1)} h flight time` : "";
      const details = [route, captain, day, hours].filter(Boolean).join(" · ");
      const entered = loggedBy ? `Entered by ${loggedBy}.` : "";
      if (n.event === "defect_reported") {
        return {
          subject: `Defect reported: ${route}`,
          headline: "A defect was reported",
          lines: [details, entered].filter(Boolean),
          quote: { label: "Defect", text: str(p.defects), tone: "warning" },
          link: { label: "Open the tech log", path: `/${slug}/tech-log` },
        };
      }
      return {
        subject: `Flight logged: ${route}, ${captain}`,
        headline: `${captain} flew ${route}`,
        lines: [[day, hours].filter(Boolean).join(" · "), entered].filter(Boolean),
        link: { label: "Open the tech log", path: `/${slug}/tech-log` },
      };
    }
    case "booking_reminder": {
      return {
        subject: `Reminder: you're booked tomorrow, ${when}`,
        headline: "You're booked tomorrow",
        lines: [when],
        quote: note ? { label: "Note", text: note } : undefined,
        link: { label: "Open the calendar", path: calendar },
      };
    }
    case "aircraft_reminder": {
      const described = (Array.isArray(p.items) ? p.items : [])
        .map(describeReminderItem)
        .filter((x): x is { line: string; short: string } => x !== null);
      if (described.length > 0) {
        const registration = str(p.registration, n.group_name);
        const count = described.length;
        return {
          subject:
            count === 1
              ? `Aircraft reminder: ${described[0].short}`
              : `Aircraft reminder: ${count} items need attention`,
          headline: `${registration}: ${count === 1 ? "1 item needs" : `${count} items need`} attention`,
          lines: described.map((x) => x.line),
          link: { label: "Open the aircraft page", path: `/${slug}/aircraft` },
        };
      }
      break;
    }
    default:
      break;
  }
  // An unknown event, or one with nothing usable in it.
  return {
    subject: `Update from ${n.group_name}`,
    headline: `Something happened in ${n.group_name}`,
    lines: [],
    link: { label: "Open Blocktime", path: `/${slug}` },
  };
}

export function renderNotification(n: QueuedNotification, siteUrl: string): RenderedEmail {
  const base = siteUrl.replace(/\/+$/, "");
  const c = content(n);
  const url = `${base}${c.link.path}`;
  const settingsUrl = `${base}/${encodeURIComponent(n.group_slug)}/settings?tab=notifications`;
  const reason = `You are getting this because you are a member of ${n.group_name} on Blocktime.`;

  const text = [
    c.headline,
    ...c.lines,
    c.quote ? `${c.quote.label ? `${c.quote.label}: ` : ""}${c.quote.text}` : "",
    "",
    `${c.link.label}: ${url}`,
    "",
    "--",
    reason,
    `Choose which emails you get: ${settingsUrl}`,
  ]
    .filter((line, i, all) => !(line === "" && (all[i - 1] === "" || i === 0)))
    .join("\n");

  const quoteBg = c.quote?.tone === "warning" ? "#fbf1e1" : "#f1f2ee";
  const quoteBorder = c.quote?.tone === "warning" ? "#b97327" : "#b9bcb1";
  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#f4f5f0;">
<div style="max-width:520px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#172026;">
  <p style="margin:0 0 20px;font-family:Menlo,Consolas,monospace;font-size:13px;color:#4f5a54;">blocktime &middot; ${escapeHtml(n.group_name)}</p>
  <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;font-weight:700;">${escapeHtml(c.headline)}</h1>
  ${c.lines.map((line) => `<p style="margin:0 0 8px;font-size:16px;line-height:1.5;">${escapeHtml(line)}</p>`).join("\n  ")}
  ${
    c.quote
      ? `<div style="margin:16px 0;padding:12px 14px;background:${quoteBg};border-left:4px solid ${quoteBorder};font-size:16px;line-height:1.5;white-space:pre-wrap;">${
          c.quote.label ? `<strong>${escapeHtml(c.quote.label)}:</strong> ` : ""
        }${escapeHtml(c.quote.text)}</div>`
      : ""
  }
  <p style="margin:24px 0;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 22px;background:#172026;color:#f4f5f0;text-decoration:none;border-radius:999px;font-weight:600;font-size:15px;">${escapeHtml(c.link.label)}</a></p>
  <hr style="border:none;border-top:1px solid #d9dbd2;margin:28px 0 16px;">
  <p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:#4f5a54;">${escapeHtml(reason)}</p>
  <p style="margin:0;font-size:13px;line-height:1.5;color:#4f5a54;"><a href="${escapeHtml(settingsUrl)}" style="color:#1f5673;">Choose which emails you get</a></p>
</div>
</body>
</html>`;

  return { subject: c.subject.replace(/\s+/g, " ").trim(), text, html };
}

// Used by "Send me a test email" in Settings.
export function renderTestEmail(groupName: string, siteUrl: string): RenderedEmail {
  const base = siteUrl.replace(/\/+$/, "");
  return renderNotification(
    {
      id: "test",
      recipient_email: "",
      event: "chat_message",
      payload: {
        who: "Blocktime",
        message: "This is a test email. If you can read this, notifications reach you.",
      },
      group_name: groupName,
      group_slug: "",
    },
    base,
  );
}

// Exported for tests.
export { LONDON_TZ };
