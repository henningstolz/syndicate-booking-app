import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isDemoRequest } from "@/lib/demo/mode";
import { getGroupBySlug } from "@/lib/groups";
import { LONDON_TZ } from "@/lib/datetime";
import { NOTIFICATION_EVENTS, NOTIFICATION_NOTE } from "@/lib/notifications";
import { notifyConfigured } from "@/lib/notify/send";
import { memberColor } from "@/lib/member-colors";
import {
  createCalendarFeed,
  createInvite,
  leaveGroup,
  removeMember,
  revokeCalendarFeed,
  revokeInvite,
  saveNotificationPreferences,
  sendRemindersNow,
  sendTestEmail,
  setMemberRole,
  updateDisplayName,
  updateGroupDetails,
} from "./actions";
import { CopyLinkButton } from "./CopyLinkButton";

type MemberRow = {
  user_id: string;
  display_name: string | null;
  role: string;
  removed_at: string | null;
};

type InviteRow = {
  id: string;
  role: string;
  label: string | null;
  expires_at: string;
};

// What each ?notice= code from the actions means, and whether it is good news.
const NOTICES: Record<string, { ok: boolean; text: string }> = {
  demo: {
    ok: false,
    text: "This is a demo, so changes in Settings aren't saved. Create your own group to use them.",
  },
  name_saved: { ok: true, text: "Your name was updated." },
  calendar_created: { ok: true, text: "Your calendar link is ready. Copy it into your calendar app." },
  calendar_off: { ok: true, text: "Your calendar link is turned off. The old link no longer works." },
  notifications_saved: { ok: true, text: "Your email choices were saved." },
  test_sent: {
    ok: true,
    text: "Test email sent. It should arrive within a minute; check your spam folder if not.",
  },
  test_failed: {
    ok: false,
    text: "The test email could not be sent. Ask an admin to check the email settings.",
  },
  not_configured: { ok: false, text: "Email sending isn't switched on for this site yet." },
  test_wait: { ok: false, text: "Please wait half a minute before sending another test email." },
  role_changed: { ok: true, text: "Role updated." },
  invite_created: {
    ok: true,
    text: "Invite created. Copy its link below and send it to the person.",
  },
  invite_revoked: { ok: true, text: "Invite cancelled." },
  details_saved: { ok: true, text: "Group details saved." },
  name_required: { ok: false, text: "Please enter a name." },
  name_too_long: { ok: false, text: "That name is too long (60 characters at most)." },
  label_too_long: { ok: false, text: "That label is too long (60 characters at most)." },
  details_required: { ok: false, text: "The group name and the registration are required." },
  last_admin: {
    ok: false,
    text: "A group needs at least one admin. Make someone else an admin first.",
  },
  not_allowed: { ok: false, text: "You don't have permission to do that." },
  not_found: { ok: false, text: "That person is no longer in the group." },
  already_used: { ok: false, text: "That invite has already been used." },
  error: { ok: false, text: "Something went wrong. Please try again." },
};

const sectionTitle = "text-sm font-medium text-zinc-500";
const card = "rounded-lg border border-zinc-200 bg-white";
const inputClass =
  "rounded-md border border-zinc-300 px-3 py-2 text-base text-zinc-900";
const smallButton =
  "rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100";
const primaryButton =
  "rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700";
const dangerButton =
  "rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700";

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: LONDON_TZ,
});

function noticeMessage(code: string | undefined, count: string | undefined) {
  if (!code) return null;
  if (code === "reminders_queued") {
    const queued = Number(count) || 0;
    return {
      ok: true,
      text:
        queued > 0
          ? `${queued} reminder email${queued === 1 ? "" : "s"} queued and being sent.`
          : "Nothing is due right now, so no reminders were queued.",
    };
  }
  if (code === "removed") {
    const cancelled = Number(count) || 0;
    return {
      ok: true,
      text:
        cancelled > 0
          ? `Member removed. Their ${cancelled} upcoming booking${cancelled === 1 ? " was" : "s were"} cancelled.`
          : "Member removed.",
    };
  }
  return NOTICES[code] ?? null;
}

export default async function SettingsPage({
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

  // Everyone, removed or not, in the order the app uses for member colours,
  // so the dots here match the calendar.
  const { data: allMembers } = await supabase
    .from("group_members")
    .select("user_id, display_name, role, removed_at")
    .eq("group_id", group.id)
    .order("created_at")
    .returns<MemberRow[]>();

  const everyone = allMembers ?? [];
  const active = everyone
    .map((member, index) => ({ member, index }))
    .filter(({ member }) => !member.removed_at);
  const former = everyone.filter((member) => member.removed_at);

  const me = everyone.find((m) => m.user_id === user?.id);
  const isAdmin = me?.role === "admin" && !me.removed_at;
  const adminCount = active.filter(({ member }) => member.role === "admin").length;

  let invites: InviteRow[] = [];
  if (isAdmin) {
    const { data } = await supabase
      .from("invites")
      .select("id, role, label, expires_at")
      .eq("group_id", group.id)
      .is("used_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .returns<InviteRow[]>();
    invites = data ?? [];
  }

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
    <nav aria-label="Settings sections" className="flex gap-2">
      <Link href={`/${groupSlug}/settings`} className={tabClass(!onNotifications && !onCalendar)}>
        General
      </Link>
      <Link
        href={`/${groupSlug}/settings?tab=notifications`}
        className={tabClass(onNotifications)}
      >
        Notifications
      </Link>
      <Link href={`/${groupSlug}/settings?tab=calendar`} className={tabClass(onCalendar)}>
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

  // -------------------------------------------------------------------- general
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
            group aren&apos;t available here. The rest of Settings is shown as
            an admin sees it, but changes aren&apos;t saved.
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

      {isAdmin && (
        <>
          {/* -------------------------------------------------- members */}
          <section className="flex flex-col gap-3">
            <h2 className={sectionTitle}>Members</h2>
            <div className="flex flex-col gap-2">
              {active.map(({ member, index }) => {
                const isMe = member.user_id === user?.id;
                const onlyAdmin = member.role === "admin" && adminCount === 1;
                return (
                  <div
                    key={member.user_id}
                    className={`${card} flex flex-col gap-3 px-3 py-3`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${memberColor(index).dot}`}
                        />
                        <span className="truncate text-sm text-zinc-900">
                          {member.display_name ?? "Member"}
                          {isMe && <span className="text-zinc-400"> (you)</span>}
                        </span>
                      </div>
                      <span className="text-xs font-medium text-zinc-500 uppercase">
                        {member.role}
                      </span>
                    </div>

                    {isMe ? (
                      <p className="text-xs text-zinc-500">
                        {demo
                          ? "This is you, the admin of the demo group."
                          : "Use \u201cLeave this group\u201d above to step away."}
                        {onlyAdmin &&
                          !demo &&
                          " You are the only admin, so make someone else an admin first."}
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-start gap-2">
                        <form action={setMemberRole}>
                          {hidden}
                          <input type="hidden" name="userId" value={member.user_id} />
                          <input
                            type="hidden"
                            name="role"
                            value={member.role === "admin" ? "member" : "admin"}
                          />
                          <button type="submit" className={smallButton}>
                            {member.role === "admin" ? "Make member" : "Make admin"}
                          </button>
                        </form>

                        <details className="text-xs text-zinc-600">
                          <summary className="cursor-pointer rounded-full border border-zinc-300 px-3 py-1 text-zinc-700 hover:bg-zinc-100">
                            Remove
                          </summary>
                          <form
                            action={removeMember}
                            className="mt-2 flex max-w-xs flex-col gap-2"
                          >
                            {hidden}
                            <input type="hidden" name="userId" value={member.user_id} />
                            <p>
                              {member.display_name ?? "This member"} will lose
                              access immediately and their upcoming bookings
                              will be cancelled. Their past bookings and tech
                              log entries stay. You can invite them again
                              later.
                            </p>
                            <button type="submit" className={`${dangerButton} self-start`}>
                              Remove {member.display_name ?? "member"}
                            </button>
                          </form>
                        </details>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {former.length > 0 && (
              <p className="text-xs text-zinc-500">
                Former members, still shown on past bookings:{" "}
                {former.map((m) => m.display_name ?? "Member").join(", ")}.
              </p>
            )}
          </section>

          {/* -------------------------------------------------- invites */}
          <section className="flex flex-col gap-3">
            <h2 className={sectionTitle}>Invite someone</h2>
            <form action={createInvite} className="flex max-w-md flex-col gap-2">
              {hidden}
              <label className="flex flex-col gap-1 text-sm text-zinc-700">
                Who is it for?
                <input
                  type="text"
                  name="label"
                  maxLength={60}
                  placeholder="e.g. Julian (so you can tell the links apart)"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-zinc-700">
                Role
                <select name="role" defaultValue="member" className={inputClass}>
                  <option value="member">Member</option>
                  <option value="admin">Admin (can manage members and invites)</option>
                </select>
              </label>
              <button type="submit" className={`${primaryButton} self-start`}>
                Create invite link
              </button>
              <p className="text-xs text-zinc-500">
                The link works once and expires after 14 days. Send it to
                the person yourself; they choose their own password.
              </p>
            </form>

            {invites.length > 0 && (
              <div className="flex flex-col gap-2">
                {invites.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex flex-col gap-2 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-zinc-800">
                        {invite.label ?? "Unnamed invite"}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {invite.role === "admin" ? "Admin" : "Member"} · expires{" "}
                        {dateFormat.format(new Date(invite.expires_at))}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CopyLinkButton url={`${siteUrl}/join/${invite.id}`} />
                      <form action={revokeInvite}>
                        <input type="hidden" name="groupSlug" value={groupSlug} />
                        <input type="hidden" name="inviteId" value={invite.id} />
                        <button type="submit" className={smallButton}>
                          Cancel invite
                        </button>
                      </form>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ------------------------------------------------- group */}
          <section className="flex flex-col gap-3">
            <h2 className={sectionTitle}>Group details</h2>
            <form action={updateGroupDetails} className="flex max-w-md flex-col gap-2">
              {hidden}
              <label className="flex flex-col gap-1 text-sm text-zinc-700">
                Group name
                <input
                  type="text"
                  name="name"
                  required
                  defaultValue={group.name}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-zinc-700">
                Aircraft registration
                <input
                  type="text"
                  name="aircraftRegistration"
                  required
                  defaultValue={group.aircraft_registration}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-zinc-700">
                Aircraft type
                <input
                  type="text"
                  name="aircraftType"
                  defaultValue={group.aircraft_type ?? ""}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-zinc-700">
                Home base
                <input
                  type="text"
                  name="homeBase"
                  defaultValue={group.home_base ?? ""}
                  className={inputClass}
                />
              </label>
              <button type="submit" className={`${primaryButton} self-start`}>
                Save details
              </button>
              <p className="text-xs text-zinc-500">
                The web address of the group does not change when you rename it.
              </p>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
