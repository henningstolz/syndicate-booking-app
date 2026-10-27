import { FIELD_LABELS } from "@/lib/platform-admin/format";

// What each ?notice= code means on the platform admin pages, and whether it is good news.
const NOTICES: Record<string, { ok: boolean; text: string }> = {
  saved: { ok: true, text: "Saved. The change is in the history." },
  no_change: { ok: false, text: "Nothing was changed." },
  reason_required: { ok: false, text: "Please give a reason (at least 3 characters). It is written into the history." },
  reason_too_long: { ok: false, text: "That reason is too long (500 characters at most)." },
  invalid: { ok: false, text: "That value was not accepted. Nothing was saved." },
  changes_invalid: { ok: false, text: "Nothing to save." },
  not_found: { ok: false, text: "That group was not found." },
  not_allowed: { ok: false, text: "Not allowed. Sign in with your code again." },
  confirm_needed: { ok: false, text: "Type ENABLE exactly to switch it on. Nothing was changed." },
  enforcement_on: { ok: true, text: "Billing enforcement is ON." },
  enforcement_off: { ok: true, text: "Billing enforcement is OFF." },
  error: { ok: false, text: "Something went wrong. Please try again." },
};

export function noticeFor(code: string | undefined, field: string | undefined) {
  if (!code) return null;
  const known = NOTICES[code];
  if (!known) return null;
  if (code === "invalid" && field && FIELD_LABELS[field]) {
    return { ok: false, text: `“${FIELD_LABELS[field]}” was not accepted. Nothing was saved.` };
  }
  return known;
}
