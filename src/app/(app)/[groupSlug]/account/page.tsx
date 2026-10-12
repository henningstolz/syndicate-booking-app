import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isDemoRequest } from "@/lib/demo/mode";
import { getGroupBySlug } from "@/lib/groups";
import { NOTIFICATION_EVENTS, NOTIFICATION_NOTE } from "@/lib/notifications";
import { notifyConfigured } from "@/lib/notify/send";
import {
  createCalendarFeed,
  leaveGroup,
  revokeCalendarFeed,
  saveNotificationPreferences,
  sendRemindersNow,
  sendTestEmail,
  updateDisplayName,
} from "../settings/actions";
import { CopyLinkButton } from "../settings/CopyLinkButton";
import { noticeMessage } from "../settings/notices";

// Everything personal: your name and password, which emails you get, your
// calendar link, and putting Blocktime on your phone. (The group's own settings,
// for admins, are on the Settings page.)

const sectionTitle = "text-sm font-medium text-zinc-500";
const inputClass =
  "rounded-md border border-zinc-300 px-3 py-2 text-base text-zinc-900";
const smallButton =
  "rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100";
const primaryButton =
  "rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700";
const dangerButton =
  "rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700";


export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupSlug: string }>;
  searchParams: Promise<{ notice?: string; n?: string; tab?: string }>;
}) {
  const { groupSlug } = await params;
  const { notice: noticeCode, n, tab } = await searchParams;
  const supabase = await createClient();

  const group = await getGroupBySlug(supabase, groupSlug);
  if (!group) {
    // The layout already redirects before we get here.
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: meRow } = await supabase
    .from("group_members")
    .select("display_name, role, removed_at")
    .eq("group_id", group.id)
    .eq("user_id", user?.id ?? "")
    .maybeSingle<{ display_name: string | null; role: string; removed_at: string | null }>();
  const me = meRow ?? undefined;
  const isAdmin = me?.role === "admin" && !me.removed_at;

  const demo = await isDemoRequest();
  const siteUrl = process.env.SITE_URL ?? "";
  const notice = noticeMessage(noticeCode, n);
  const hidden = (
    <>
      <input type="hidden" name="groupId" value={group.id} />
      <input type="hidden" name="groupSlug" value={groupSlug} />
    </>
  );

  const noticeBlock = notice && (
    <p
      role="status"
      className={`rounded-lg border px-3 py-2 text-sm ${
        notice.ok
          ? "border-green-200 bg-green-50 text-green-800"
          : "border-red-200 bg-red-50 text-red-800"
      }`}
    >
      {notice.text}
    </p>
  );

  const onNotifications = tab === "notifications";
  const onCalendar = tab === "calendar";
  const tabClass = (active: boolean) =>
    `rounded-full px-4 py-1.5 text-sm font-medium ${
      active
        ? "bg-zinc-900 text-white"
        : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100"
    }`;
  const tabs = (
    <nav aria-label="Account sections" className="flex gap-2">
      <Link href={`/${groupSlug}/account`} className={tabClass(!onNotifications && !onCalendar)}>
        Profile
      </Link>
      <Link href={`/${groupSlug}/account?tab=notifications`} className={tabClass(onNotifications)}>
        Notifications
      </Link>
      <Link href={`/${groupSlug}/account?tab=calendar`} className={tabClass(onCalendar)}>
        Calendar
      </Link>
    </nav>
  );

  // ----------------------------------------------------------------- calendar
  if (onCalendar) {
    const { data: feeds } = await supabase
      .from("calendar_feeds")
      .select("token")
      .eq("group_id", group.id)
      .is("revoked_at", null)
      .limit(1)
      .returns<{ token: string }[]>();
    const token = feeds?.[0]?.token;
    const feedUrl = token ? `${siteUrl.replace(/\/+$/, "")}/cal/${token}.ics` : "";
    const appUrl = feedUrl.replace(/^https?:\/\//, "webcal://");

    return (
      <div className="flex flex-1 flex-col gap-6 px-4 py-6">
        {noticeBlock}
        {tabs}

        <section className="flex max-w-xl flex-col gap-3">
          <div>
            <h2 className={sectionTitle}>Your calendar link</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Add {group.name}&apos;s bookings to Apple Calendar, Google Calendar or Outlook. Every booking of the
              aircraft appears, with who booked it and the note, and your own are marked &ldquo;You&rdquo;. It
              updates by itself; the bookings are still made and changed here.
            </p>
          </div>

          {token ? (
            <>
              <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3">
                <input
                  readOnly
                  value={feedUrl}
                  aria-label="Your calendar link"
                  className="w-full rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1.5 font-mono text-xs text-zinc-700"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <CopyLinkButton url={feedUrl} />
                  <a href={appUrl} className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100">
                    Open in my calendar app
                  </a>
                </div>
              </div>
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Keep this link private: anyone who has it can see the bookings, names and notes. If it gets out, make a
                new one below and the old one stops working at once.
              </p>
            </>
          ) : (
            <form action={createCalendarFeed}>
              {hidden}
              <button type="submit" className={primaryButton}>
                Create my calendar link
              </button>
            </form>
          )}
        </section>

        {token && (
          <section className="flex max-w-xl flex-col gap-2">
            <h2 className={sectionTitle}>How to add it</h2>
            <ul className="flex flex-col gap-2 text-sm text-zinc-700">
              <li>
                <span className="font-medium text-zinc-900">iPhone or Mac:</span> press &ldquo;Open in my calendar
                app&rdquo; and confirm. Or in Calendar choose File, then New Calendar Subscription, and paste the link.
              </li>
              <li>
                <span className="font-medium text-zinc-900">Google Calendar:</span> on the website, Other calendars, the
                plus sign, From URL, paste the link. Google can take up to a day to show changes.
              </li>
              <li>
                <span className="font-medium text-zinc-900">Outlook:</span> Add calendar, Subscribe from web, paste the
                link.
              </li>
            </ul>
            <p className="text-xs text-zinc-500">
              Your calendar app decides how often it looks for changes (Apple and Outlook about hourly, Google up to a
              day). For anything urgent, check the app or rely on the notification emails.
            </p>
          </section>
        )}

        {token && (
          <section className="flex max-w-xl flex-col gap-2">
            <h2 className={sectionTitle}>Replace or turn off</h2>
            <div className="flex flex-wrap gap-2">
              <form action={createCalendarFeed}>
                {hidden}
                <button type="submit" className={smallButton}>
                  Make a new link
                </button>
              </form>
              <form action={revokeCalendarFeed}>
                {hidden}
                <button type="submit" className={smallButton}>
                  Turn it off
                </button>
              </form>
            </div>
            <p className="text-xs text-zinc-500">
              Either one stops the current link at once. You&apos;ll need to add the new link to your calendar apps
              again. If you leave the group, your link stops working too.
            </p>
          </section>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------ notifications
  if (onNotifications) {
    const { data: saved } = await supabase
      .from("notification_preferences")
      .select("event, enabled")
      .eq("group_id", group.id)
      .eq("user_id", user?.id ?? "")
      .returns<{ event: string; enabled: boolean }[]>();
    const chosen = new Map((saved ?? []).map((row) => [row.event, row.enabled]));
    const sections = ["Calendar", "Chat", "Tech log", "Reminders", "Costs"] as const;

    return (
      <div className="flex flex-1 flex-col gap-6 px-4 py-6">
        {noticeBlock}
        {tabs}

        <section className="flex max-w-xl flex-col gap-4">
          <div>
            <h2 className={sectionTitle}>Email me when…</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Emails about {group.name} go to{" "}
              <span className="font-medium text-zinc-900">{user?.email}</span>.{" "}
              {NOTIFICATION_NOTE}
            </p>
          </div>

          <form action={saveNotificationPreferences} className="flex flex-col gap-4">
            {hidden}
            {sections.map((section) => (
              <fieldset key={section} className="flex flex-col gap-2">
                <legend className="mb-1 text-xs font-medium text-zinc-500 uppercase">
                  {section}
                </legend>
                {NOTIFICATION_EVENTS.filter((event) => event.section === section).map((event) => (
                  <label
                    key={event.key}
                    className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2.5"
                  >
                    <input
                      type="checkbox"
                      name={event.key}
                      defaultChecked={chosen.get(event.key) ?? event.defaultOn}
                      className="mt-1 h-4 w-4 shrink-0"
                    />
                    <span>
                      <span className="block text-sm font-medium text-zinc-900">
                        {event.label}
                      </span>
                      <span className="block text-xs text-zinc-500">{event.description}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
            <button type="submit" className={`${primaryButton} self-start`}>
              Save choices
            </button>
          </form>
        </section>

        <section className="flex max-w-xl flex-col gap-2">
          <h2 className={sectionTitle}>Check it works</h2>
          <form action={sendTestEmail} className="flex flex-col items-start gap-2">
            {hidden}
            <button type="submit" className={smallButton}>
              Send me a test email
            </button>
            <p className="text-xs text-zinc-500">
              Sends a sample message to {user?.email} so you can see what the emails look
              like and that they arrive.
            </p>
          </form>
        </section>

        {isAdmin && !demo && notifyConfigured() && (
          <section className="flex max-w-xl flex-col gap-2">
            <h2 className={sectionTitle}>Admin</h2>
            <form action={sendRemindersNow} className="flex flex-col items-start gap-2">
              {hidden}
              <button type="submit" className={smallButton}>
                Send due reminders now
              </button>
              <p className="text-xs text-zinc-500">
                Reminders go out by themselves every evening. This looks for bookings tomorrow and
                aircraft dates or hours that are due, and emails them now. Each reminder is sent only
                once, so pressing it again does nothing new.
              </p>
            </form>
          </section>
        )}

        {isAdmin && !demo && !notifyConfigured() && (
          <p className="max-w-xl rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Admin note: sending isn&apos;t set up on this server yet, so no emails go out. The
            setup steps are in <span className="font-mono">docs/systems-and-accounts.md</span>{" "}
            (&ldquo;Set up email notifications&rdquo;).
          </p>
        )}
      </div>
    );
  }


  // -------------------------------------------------------------------- profile
  return (
    <div className="flex flex-1 flex-col gap-8 px-4 py-6">
      {noticeBlock}
      {tabs}

      {/* ------------------------------------------------------------ you */}
      <section className="flex flex-col gap-3">
        <h2 className={sectionTitle}>Your profile</h2>
        <form action={updateDisplayName} className="flex flex-col gap-2">
          {hidden}
          <label className="flex flex-col gap-1 text-sm text-zinc-700">
            Your name in {group.name}
            <input
              type="text"
              name="displayName"
              required
              maxLength={60}
              defaultValue={me?.display_name ?? ""}
              className={`${inputClass} max-w-xs`}
            />
          </label>
          <button type="submit" className={`${primaryButton} self-start`}>
            Save name
          </button>
        </form>

        {demo ? (
          <p className="max-w-md rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            This is the demo group, so your account, password and leaving the
            group aren&apos;t available here. The rest of this page is shown as
            it works, but changes aren&apos;t saved.
          </p>
        ) : (
          <>
          <p className="text-sm text-zinc-600">
            Signed in as {user?.email}.{" "}
            <Link
              href="/reset-password"
              className="text-zinc-900 underline underline-offset-4"
            >
              Change password
            </Link>
          </p>
          <p className="text-sm text-zinc-600">
            Run more than one aircraft?{" "}
            <Link
              href="/groups/new"
              className="text-zinc-900 underline underline-offset-4"
            >
              Start another group
            </Link>
            . It appears in the group menu at the top.
          </p>

          <details className="max-w-md text-sm text-zinc-600">
            <summary className="w-fit cursor-pointer text-zinc-500 underline underline-offset-4">
              Leave this group
            </summary>
            <form action={leaveGroup} className="mt-3 flex flex-col gap-3">
              {hidden}
              <p>
                You will lose access to {group.name} straight away, and your
                upcoming bookings will be cancelled. Your past bookings and
                tech log entries stay in the group&apos;s history under your
                name. An admin can invite you back later.
              </p>
              <button type="submit" className={`${dangerButton} self-start`}>
                Yes, leave {group.name}
              </button>
            </form>
          </details>
          </>
        )}
      </section>

      {/* ------------------------------------------------------- install */}
      <section className="flex max-w-xl flex-col gap-2">
        <h2 className={sectionTitle}>Add Blocktime to your phone</h2>
        <p className="text-sm text-zinc-600">
          Put Blocktime on your home screen, so it opens full screen like an app.
        </p>
        <ul className="flex flex-col gap-1.5 text-sm text-zinc-700">
          <li>
            <span className="font-medium text-zinc-900">iPhone:</span> open this site in Safari, tap the Share button,
            then &ldquo;Add to Home Screen&rdquo;.
          </li>
          <li>
            <span className="font-medium text-zinc-900">Android:</span> in Chrome, open the menu (the three dots),
            then &ldquo;Install app&rdquo; or &ldquo;Add to Home screen&rdquo;.
          </li>
        </ul>
        <p className="text-xs text-zinc-500">
          It is the same Blocktime as in the browser, with the same sign-in, and it needs a connection to show current
          bookings.
        </p>
      </section>
    </div>
  );
}
