// What each ?notice= code from the Account and Settings actions means, and whether
// it is good news. Shared by both pages.

// What each ?notice= code from the actions means, and whether it is good news.
export const NOTICES: Record<string, { ok: boolean; text: string }> = {
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

export function noticeMessage(code: string | undefined, count: string | undefined) {
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

