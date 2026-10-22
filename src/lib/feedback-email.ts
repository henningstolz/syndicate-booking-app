// The email a member's feedback becomes. Pure (no server code), relative imports with
// .ts extensions, so the tests can run it in plain Node. Everything the member typed is
// escaped before it goes into the HTML.
export type FeedbackCategory = "bug" | "idea" | "other";

export const FEEDBACK_CATEGORIES: { key: FeedbackCategory; label: string; short: string }[] = [
  { key: "bug", label: "Something's wrong", short: "Bug" },
  { key: "idea", label: "I have an idea", short: "Idea" },
  { key: "other", label: "Something else", short: "Feedback" },
];

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// A readable device from the browser's own description: "iPhone, Safari, home-screen app".
export function describeDevice(userAgent: string): string {
  const ua = userAgent || "";
  const system = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh|Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "unknown browser";
  return `${system}, ${browser}${/home-screen app/.test(ua) ? ", home-screen app" : ""}`;
}

export type FeedbackInput = {
  category: FeedbackCategory;
  message: string;
  name: string;
  email: string;
  groupName: string;
  groupSlug: string;
  page: string;
  userAgent: string;
  sentAt: Date;
};

export function buildFeedbackEmail(input: FeedbackInput, siteUrl: string): { subject: string; text: string; html: string } {
  const category = FEEDBACK_CATEGORIES.find((c) => c.key === input.category) ?? FEEDBACK_CATEGORIES[2];
  const flat = input.message.replace(/\s+/g, " ").trim();
  const subject = `[Blocktime] ${category.short}: ${flat.length > 60 ? `${flat.slice(0, 57)}...` : flat}`;
  const base = siteUrl.replace(/\/+$/, "");
  const pageUrl = input.page.startsWith("/") ? `${base}${input.page}` : input.page;
  const when = input.sentAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const device = describeDevice(input.userAgent);

  const details: [string, string][] = [
    ["Type", category.short],
    ["From", `${input.name} <${input.email}>`],
    ["Group", `${input.groupName} (${input.groupSlug})`],
    ["Page", pageUrl || "unknown"],
    ["Device", device],
    ["Sent", when],
  ];
  const text = [input.message.trim(), "", "--", ...details.map(([k, v]) => `${k}: ${v}`), "", "Reply to this email to answer the member."].join("\n");

  const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:#f4f5f0;">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#172026;">
  <p style="margin:0 0 16px;font-family:Menlo,Consolas,monospace;font-size:13px;color:#4f5a54;">blocktime &middot; feedback &middot; ${escapeHtml(category.short)}</p>
  <div style="margin:0 0 20px;padding:14px 16px;background:#ffffff;border-left:4px solid #b97327;font-size:16px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(input.message.trim())}</div>
  <table style="font-size:13px;line-height:1.6;color:#4f5a54;border-collapse:collapse;">
    ${details.map(([k, v]) => `<tr><td style="padding:0 14px 0 0;vertical-align:top;">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join("\n    ")}
  </table>
  <p style="margin:20px 0 0;font-size:13px;color:#4f5a54;">Reply to this email to answer the member.</p>
</div>
</body></html>`;
  return { subject: subject.replace(/\s+/g, " ").trim(), text, html };
}
