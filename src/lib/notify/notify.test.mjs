// Tests for the notification emails: wording and times, escaping of anything a
// member typed, the send loop (including failures), and the Resend request.
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { renderNotification, renderTestEmail, escapeHtml, describeWhen } from "./email.ts";
import { flushQueue } from "./send-core.ts";
import { sendEmail } from "./send.ts";

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

console.log(`${count} notification email checks passed`);
