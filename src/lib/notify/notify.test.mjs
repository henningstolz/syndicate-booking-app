// Tests for the notification emails: wording and times, escaping of anything a
// member typed, the send loop (including failures), and the Resend request.
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { renderNotification, renderTestEmail, escapeHtml, describeWhen } from "./email.ts";
import { flushQueue } from "./send-core.ts";
import { sendEmail } from "./send.ts";
import { PDFDocument } from "pdf-lib";

let count = 0;
const eq = (got, want, label) => { assert.deepEqual(got, want, label); count++; };
const yes = (cond, label) => { assert.ok(cond, label); count++; };

const SITE = "https://blocktime.group/";
const item = (event, payload, extra = {}) => ({
  id: "n1", recipient_email: "cara@example.test", event, payload,
  group_name: "Demo Flying Group", group_slug: "demo", ...extra,
});

// ------------------------------------------------------------------ times
eq(describeWhen("2026-10-10T07:00:00+00:00", "2026-10-10T11:00:00+00:00"), "Sat 10 Oct, 08:00–12:00", "same day, UK summer time (BST)");
eq(describeWhen("2026-12-05T07:00:00Z", "2026-12-05T11:00:00Z"), "Sat 5 Dec, 07:00–11:00", "same day, UK winter time (GMT)");
eq(describeWhen("2026-10-10T07:00:00Z", "2026-10-12T17:00:00Z"), "Sat 10 Oct 08:00 – Mon 12 Oct 18:00", "across days");
eq(describeWhen("2026-10-25T23:30:00Z", "2026-10-26T01:00:00Z"), "Sun 25 Oct 23:30 – Mon 26 Oct 01:00", "across the night the clocks go back (GMT afterwards)");
eq(describeWhen("nonsense", "x"), "", "bad dates give nothing rather than a crash");

// --------------------------------------------------------------- the events
const booking = renderNotification(item("booking_created", { who: "Sam", starts_at: "2026-10-10T07:00:00Z", ends_at: "2026-10-10T11:00:00Z", note: "Fly-out lunch" }), SITE);
eq(booking.subject, "New booking: Sam, Sat 10 Oct, 08:00–12:00", "booking subject");
yes(booking.text.includes("Sam booked the aircraft") && booking.text.includes("Note: Fly-out lunch"), "booking text says who and the note");
yes(booking.text.includes("https://blocktime.group/demo/calendar?view=list&start=2026-10-10"), "booking links to the calendar on that day (single slash, no doubled)");
yes(booking.text.includes("https://blocktime.group/demo/settings?tab=notifications"), "every email links to the notification settings");
yes(booking.html.includes("Demo Flying Group") && booking.html.includes("Choose which emails you get"), "html has the group and the settings link");

const cancelledByAdmin = renderNotification(item("booking_cancelled", { who: "Bob", cancelled_by: "Alice", starts_at: "2026-10-10T07:00:00Z", ends_at: "2026-10-10T11:00:00Z" }), SITE);
yes(cancelledByAdmin.text.includes("Bob's booking was cancelled by Alice"), "an admin's cancellation names the admin");
eq(cancelledByAdmin.subject, "Booking cancelled: Bob, Sat 10 Oct, 08:00–12:00", "cancellation subject");
const cancelledSelf = renderNotification(item("booking_cancelled", { who: "Bob", cancelled_by: null, starts_at: "2026-10-10T07:00:00Z", ends_at: "2026-10-10T11:00:00Z" }), SITE);
yes(cancelledSelf.text.includes("Bob cancelled a booking"), "a self-cancellation does not name anyone else");

const chat = renderNotification(item("chat_message", { who: "Alex", message: "Fuel bowser is out of order" }), SITE);
eq(chat.subject, "Alex posted in Demo Flying Group", "chat subject");
yes(chat.text.includes("Fuel bowser is out of order") && chat.text.includes("/demo/chat"), "chat text and link");

const flight = renderNotification(item("flight_logged", { captain: "Sam", logged_by: "Alex", from: "EGLM", to: "EGTK", brakes_off: "2026-10-10T07:00:00Z", flight_deci: 1.2 }), SITE);
eq(flight.subject, "Flight logged: EGLM → EGTK, Sam", "flight subject");
yes(flight.text.includes("1.2 h flight time") && flight.text.includes("Entered by Alex.") && flight.text.includes("/demo/tech-log"), "flight text: time, who entered it, link");
const defect = renderNotification(item("defect_reported", { captain: "Sam", from: "EGLM", to: "EGTK", brakes_off: "2026-10-10T07:00:00Z", flight_deci: 1.2, defects: "Transponder intermittent" }), SITE);
eq(defect.subject, "Defect reported: EGLM → EGTK", "defect subject");
yes(defect.text.includes("Defect: Transponder intermittent"), "defect text is quoted");
yes(defect.html.includes("#b97327"), "the defect is highlighted");
const unknown = renderNotification(item("something_new", {}), SITE);
yes(unknown.subject.includes("Demo Flying Group"), "an unknown event still produces a sensible email");
eq(renderNotification(item("chat_message", { message: "hi" }), SITE).subject, "A member posted in Demo Flying Group", "a missing name falls back");
yes(!renderNotification(item("chat_message", { who: "A", message: "m" }), "https://blocktime.group///").text.includes("///"), "trailing slashes on the site address are tidied");

const test = renderTestEmail("Demo Flying Group", SITE);
yes(test.text.includes("This is a test email"), "the test email says so");

// ---------------------------------------------------------------- reminders
const reminder = renderNotification(item("booking_reminder", { starts_at: "2026-10-10T07:00:00Z", ends_at: "2026-10-10T11:00:00Z", note: "Fly-out lunch" }), SITE);
eq(reminder.subject, "Reminder: you're booked tomorrow, Sat 10 Oct, 08:00–12:00", "booking reminder subject");
yes(reminder.text.includes("You're booked tomorrow") && reminder.text.includes("Note: Fly-out lunch") && reminder.text.includes("/demo/calendar?view=list&start=2026-10-10"), "booking reminder text, note and link");

const aircraft = (items, extra = {}) => renderNotification(item("aircraft_reminder", { registration: "G-DEMO", items, ...extra }), SITE);
const dateItem = (days, name = "Insurance renewal", due = "2026-10-17") => ({ item: name, kind: "date", due, days, stage: "7" });
const one = aircraft([dateItem(7)]);
eq(one.subject, "Aircraft reminder: Insurance renewal due in 7 days", "one date item: subject");
yes(one.text.includes("G-DEMO: 1 item needs attention") && one.text.includes("Insurance renewal: due in 7 days (Sat 17 Oct 2026)") && one.text.includes("/demo/aircraft"), "one date item: headline, line and link");
eq(aircraft([dateItem(1)]).subject, "Aircraft reminder: Insurance renewal due in 1 day", "singular day");
eq(aircraft([dateItem(0)]).subject, "Aircraft reminder: Insurance renewal due today", "due today");
yes(aircraft([dateItem(-3)]).text.includes("overdue by 3 days (Sat 17 Oct 2026)"), "overdue by days");
eq(aircraft([dateItem(-1)]).subject, "Aircraft reminder: Insurance renewal overdue by 1 day", "overdue by one day");
const hours = aircraft([{ item: "Hours to next check", kind: "hours", hours: 8.6, limit: 2429.7, stage: "10" }]);
eq(hours.subject, "Aircraft reminder: 8.6 hours to the next check", "hours: subject");
yes(hours.text.includes("Hours to next check: 8.6 hours left (check at 2429.7 h)"), "hours: line");
yes(aircraft([{ item: "Hours to next check", kind: "hours", hours: -0.4, limit: 2429.7, stage: "overdue" }]).text.includes("limit reached (the check was due at 2429.7 h)"), "hours: limit reached");
yes(aircraft([{ item: "Hours to next check", kind: "hours", hours: 4, limit: null, stage: "5" }]).text.includes("4.0 hours left") && !aircraft([{ item: "Hours to next check", kind: "hours", hours: 4, limit: null, stage: "5" }]).text.includes("check at"), "hours without a known limit");
const many = aircraft([dateItem(7), dateItem(20, "Life raft", "2026-10-30"), { item: "Hours to next check", kind: "hours", hours: 4, limit: 100, stage: "5" }]);
eq(many.subject, "Aircraft reminder: 3 items need attention", "several items: subject");
yes(many.text.includes("G-DEMO: 3 items need attention") && many.text.includes("Insurance renewal: due in 7 days") && many.text.includes("Life raft: due in 20 days") && many.text.includes("4.0 hours left"), "several items: all listed");
yes(aircraft([dateItem(7)]).html.includes("Open the aircraft page"), "the html has the button");
eq(aircraft([]).subject, "Update from Demo Flying Group", "no usable items: a sensible fallback email");
eq(aircraft([{ nonsense: true }, null, "text"]).subject, "Update from Demo Flying Group", "garbage items are ignored, not crashed on");
eq(aircraft([{ item: "x", kind: "date", due: "2026-10-17", days: 3, stage: "7" }, { nonsense: true }]).subject, "Aircraft reminder: x due in 3 days", "bad items are dropped, good ones kept");
const hostileReminder = aircraft([dateItem(7, "<img src=x onerror=1>")], { registration: "<b>G</b>" });
yes(!hostileReminder.html.includes("<img src=x") && !hostileReminder.html.includes("<b>G</b>") && hostileReminder.html.includes("&lt;img"), "item names and registration are escaped in reminders too");

// ---------------------------------------------------------------- escaping
const hostile = renderNotification(item("chat_message", {
  who: "<img src=x onerror=alert(1)>",
  message: "<script>alert(\"hi\")</script> & 'quotes'",
}, { group_name: "<b>Bad group</b>" }), SITE);
yes(!hostile.html.includes("<script>") && !hostile.html.includes("<img src=x") && !hostile.html.includes("<b>Bad group</b>"), "no typed HTML survives into the email's HTML");
yes(hostile.html.includes("&lt;script&gt;") && hostile.html.includes("&amp;") && hostile.html.includes("&#39;quotes&#39;"), "it is shown as text instead");
yes(hostile.text.includes("<script>alert(\"hi\")</script>"), "the plain-text version keeps the characters as typed");
const sneaky = renderNotification(item("chat_message", { who: "x", message: "m" }, { group_slug: "a\"><script>x</script>" }), SITE);
yes(!sneaky.html.includes("<script>") && !sneaky.text.includes("\"><script>"), "even a strange group address cannot break out of a link");
eq(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;", "escapeHtml");
eq(renderNotification(item("chat_message", { who: "A", message: "line one\nline two" }), SITE).subject.includes("\n"), false, "subjects are one line");
yes(renderNotification(item("chat_message", { who: "A\nBcc: x@y.z", message: "m" }), SITE).subject.indexOf("\n") === -1, "a newline in a name cannot add email headers via the subject");

// -------------------------------------------------------------- the send loop
function deps(overrides = {}) {
  const log = { sent: [], failed: [], posted: [], slept: [] };
  const queue = overrides.queue ?? [item("chat_message", { who: "A", message: "1" }, { id: "a", recipient_email: "a@x.test" }), item("chat_message", { who: "B", message: "2" }, { id: "b", recipient_email: "b@x.test" }), item("chat_message", { who: "C", message: "3" }, { id: "c", recipient_email: "c@x.test" })];
  return {
    log,
    deps: {
      claim: async (limit) => { log.limit = limit; return queue; },
      markSent: async (id) => { log.sent.push(id); },
      markFailed: async (id, error) => { log.failed.push([id, error]); },
      post: overrides.post ?? (async (email) => { log.posted.push(email); return { ok: true }; }),
      sleep: async (ms) => { log.slept.push(ms); },
      siteUrl: SITE,
    },
  };
}

{
  const { deps: d, log } = deps();
  eq(await flushQueue(d), { sent: 3, failed: 0 }, "all three sent");
  eq(log.sent, ["a", "b", "c"], "each reported sent");
  eq(log.posted.map((m) => m.to), ["a@x.test", "b@x.test", "c@x.test"], "each to its own recipient");
  eq(log.slept.length, 2, "a pause between sends (not before the first)");
  eq(log.limit, 15, "asks for at most 15 at a time");
  yes(log.posted[0].unsubscribeUrl.endsWith("/demo/settings?tab=notifications"), "the unsubscribe link goes to the settings tab");
}
{
  let call = 0;
  const { deps: d, log } = deps({ post: async () => (++call === 2 ? { ok: false, error: "Resend answered 429" } : { ok: true }) });
  eq(await flushQueue(d), { sent: 2, failed: 1 }, "one failure does not stop the others");
  eq(log.failed, [["b", "Resend answered 429"]], "the failure and its reason are reported");
  eq(log.sent, ["a", "c"], "the others are marked sent");
}
{
  const broken = { id: "x", recipient_email: "x@x.test", event: "chat_message", payload: null, group_name: "G", group_slug: "g" };
  const { deps: d, log } = deps({ queue: [broken, item("chat_message", { who: "A", message: "ok" }, { id: "ok" })] });
  eq(await flushQueue(d), { sent: 1, failed: 1 }, "an email that cannot even be written is reported, the rest still go");
  eq(log.failed.map(([id]) => id), ["x"], "and stays queued for a retry");
}
{
  const { deps: d, log } = deps({ post: async () => { throw new Error("network down"); } });
  eq(await flushQueue(d), { sent: 0, failed: 3 }, "a network error is a failure, not a crash");
  eq(log.failed.map(([, e]) => e), ["network down", "network down", "network down"], "with the reason");
}
{
  const { deps: d, log } = deps({ queue: [] });
  eq(await flushQueue(d), { sent: 0, failed: 0 }, "nothing waiting, nothing sent");
  eq(log.slept.length + log.posted.length, 0, "and no calls made");
}

// ------------------------------------------------------- the Resend request
{
  process.env.RESEND_API_KEY = "re_test_key";
  delete process.env.NOTIFY_FROM;
  let seen;
  const fake = async (url, init) => { seen = { url, init }; return { ok: true, status: 200, text: async () => "" }; };
  const email = { to: "cara@example.test", subject: "Hello", text: "plain", html: "<p>html</p>", unsubscribeUrl: "https://blocktime.group/demo/settings?tab=notifications" };
  eq(await sendEmail(email, fake), { ok: true }, "a successful send");
  eq(seen.url, "https://api.resend.com/emails", "sent to Resend");
  eq(seen.init.headers.Authorization, "Bearer re_test_key", "with the key");
  const body = JSON.parse(seen.init.body);
  eq([body.from, body.to, body.reply_to, body.subject], ["Blocktime <notifications@mail.blocktime.group>", ["cara@example.test"], "hello@blocktime.group", "Hello"], "from, to, reply-to and subject");
  eq(body.headers["List-Unsubscribe"], "<https://blocktime.group/demo/settings?tab=notifications>", "a List-Unsubscribe header");
  process.env.NOTIFY_FROM = "Club <club@mail.blocktime.group>";
  await sendEmail(email, fake);
  eq(JSON.parse(seen.init.body).from, "Club <club@mail.blocktime.group>", "the sender can be set");

  const rejected = await sendEmail(email, async () => ({ ok: false, status: 422, text: async () => "invalid to address" }));
  eq(rejected.ok === false && rejected.error.includes("422") && rejected.error.includes("invalid to address"), true, "a refusal comes back with its status and reason");
  const down = await sendEmail(email, async () => { throw new Error("socket hang up"); });
  eq(down, { ok: false, error: "socket hang up" }, "a network error comes back as a failure");
  delete process.env.RESEND_API_KEY;
  eq(await sendEmail(email, fake), { ok: false, error: "RESEND_API_KEY is not set" }, "without a key it says so and sends nothing");
}

// ------------------------------------------------------- emailed statements
{
  const statementPayload = (o = {}) => ({
    result: "ok", month: "2026-10-01", is_admin: false, registration: "G-BBFD", updated: false,
    rates: { fee_pence: 12000, hourly_pence: 6500, missing: false }, hours_tenths: 67, credits_pence: 18400,
    members: [{ user_id: "u-alex", name: "Alex", is_member: true, flights: 2, hours_tenths: 33, fee_pence: 12000, hourly_rate_pence: 6500, custom_rates: false, fixed_pence: 12000, hourly_pence: 21450, credit_pence: 18400, total_pence: 15050 }],
    flights: [{ id: "f1", date: "2026-10-01", from: "EGXX", to: "EGKA", user_id: "u-alex", hours_tenths: 20, pence: 13000 }, { id: "f2", date: "2026-10-03", from: "EGKA", to: "EGXX", user_id: "u-alex", hours_tenths: 13, pence: 8450 }],
    expenses: [{ id: "e1", date: "2026-10-04", description: "Fuel at Sywell", user_id: "u-alex", pence: 18400 }],
    closed: { id: "c1", closed_at: "2026-11-02T10:00:00Z", closed_by_name: "Alice", note: "Checked with the group" }, can_close: false, drift: [],
    ...o,
  });
  const stmt = (payload) => item("statement_ready", payload, { id: "s1", group_name: "G-BBFD Syndicate", group_slug: "g-bbfd", recipient_email: "alex@x.test" });

  const mail = renderNotification(stmt(statementPayload()), SITE);
  eq(mail.subject, "Your October 2026 statement: £150.50", "the subject says the month and the total");
  yes(mail.text.includes("Your October 2026 statement is ready") && mail.text.includes("Total: £150.50"), "the text says it is ready, with the total");
  yes(mail.text.includes("Fixed share £120.00, flying £214.50 (3.3 h), expenses you paid -£184.00"), "the breakdown is in the text");
  yes(mail.text.includes("Closed by Alice. The PDF is attached.") && mail.text.includes("Note: Checked with the group"), "who closed it, and the note");
  yes(mail.text.includes("https://blocktime.group/g-bbfd/costs?month=2026-10"), "links to that month's page");
  const credit = renderNotification(stmt(statementPayload({ members: [{ ...statementPayload().members[0], total_pence: -5000 }] })), SITE);
  yes(credit.subject.includes("credit due £50.00") && credit.text.includes("Credit due: £50.00"), "a negative total reads as a credit due");
  const again = renderNotification(stmt(statementPayload({ updated: true })), SITE);
  yes(again.subject.includes("(updated)") && again.text.includes("was updated"), "a re-closed month says updated");
  const pre = renderNotification(stmt(statementPayload({ preview: true, closed: null })), SITE);
  yes(pre.subject.startsWith("Preview: Your October 2026 statement") && pre.text.includes("Preview of your October 2026 statement") && pre.text.includes("sent only to you"), "a preview says so, and that members get nothing");
  yes(!pre.text.includes("Closed by") && pre.text.includes("The PDF is attached."), "a preview of an open month has no closing line");
  const broken = renderNotification(stmt({ month: "2026-10-01", members: [] }), SITE);
  yes(broken.subject.startsWith("Update from"), "a statement email with nothing usable still renders something sensible");

  // The PDF is made from the same payload and attached; a failure to make it must not stop the email.
  const attached = [];
  const q = { queue: [stmt(statementPayload()), item("chat_message", { who: "A", message: "1" }, { id: "plain", recipient_email: "a@x.test" })] };
  const { deps: d1 } = deps({ ...q, post: async (email) => { attached.push(email); return { ok: true }; } });
  eq(await flushQueue(d1), { sent: 2, failed: 0 }, "a statement email and an ordinary one both go");
  const first = attached[0];
  eq(first.attachments?.length, 1, "the statement email has one attachment");
  eq(first.attachments[0].filename, "G-BBFD-statement-2026-10.pdf", "named after the aircraft and month");
  yes(Buffer.from(first.attachments[0].content, "base64").subarray(0, 5).toString() === "%PDF-", "and it is a real PDF");
  eq(attached[1].attachments, undefined, "an ordinary email has none");
  const pdfDoc = await PDFDocument.load(Buffer.from(first.attachments[0].content, "base64"));
  eq(pdfDoc.getPageCount(), 1, "a one-page statement");
  const sent = [];
  const { deps: d2 } = deps({ queue: [stmt({ month: "2026-10-01", members: [] })], post: async (email) => { sent.push(email); return { ok: true }; } });
  eq(await flushQueue(d2), { sent: 1, failed: 0 }, "an email whose PDF cannot be made still goes");
  eq(sent[0].attachments, undefined, "...without the attachment");

  // The request to Resend carries the attachment.
  process.env.RESEND_API_KEY = "re_test_key";
  let body;
  await sendEmail({ ...first }, async (url, init) => { body = JSON.parse(init.body); return { ok: true }; });
  eq(body.attachments?.[0]?.filename, "G-BBFD-statement-2026-10.pdf", "the Resend request includes the attachment");
  await sendEmail({ to: "a@x.test", subject: "s", text: "t", html: "h", unsubscribeUrl: "u" }, async (url, init) => { body = JSON.parse(init.body); return { ok: true }; });
  eq("attachments" in body, false, "and leaves the field out for ordinary emails");
  delete process.env.RESEND_API_KEY;
}

console.log(`${count} notification email checks passed`);
