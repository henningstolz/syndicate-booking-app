"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isDemoRequest } from "@/lib/demo/mode";
import { flushSoon } from "@/lib/notify/flush";
import { assertCanWrite } from "@/lib/entitlements";
import { MAX_DOWNTIME_NOTE, parseDowntimeReason, resolveDowntimeRange } from "@/lib/downtime";

export type ClashingBooking = { id: string; who: string; starts_at: string; ends_at: string; note: string | null };

// What the form shows after a save attempt. `confirm` holds the bookings that would be cancelled: nothing is
// changed until the admin confirms that exact list.
export type DowntimeActionState = {
  error?: string;
  success?: string;
  confirm?: {
    bookings: ClashingBooking[];
    values: Record<string, string>;
  };
};

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

const FIELDS = ["startDate", "endDate", "startTime", "endTime", "reason", "note"] as const;

function revalidateAll(groupSlug: string) {
  revalidatePath(`/${groupSlug}`);
  revalidatePath(`/${groupSlug}/calendar`);
  revalidatePath(`/${groupSlug}/aircraft`);
  revalidatePath(`/${groupSlug}/aircraft/availability`);
  revalidatePath(`/${groupSlug}/reports`);
}

// Mark the aircraft unavailable for a period. The first call only checks: if bookings overlap it, it returns
// them and changes nothing. The admin then confirms, and the same call is made again naming those bookings.
export async function addDowntime(
  _prev: DowntimeActionState,
  formData: FormData,
): Promise<DowntimeActionState> {
  if (await isDemoRequest()) {
    return { error: "This is a demo, so the aircraft's availability can't be changed. Create your own group to try it." };
  }

  const groupId = text(formData, "groupId");
  const groupSlug = text(formData, "groupSlug");
  const values = Object.fromEntries(FIELDS.map((f) => [f, text(formData, f)])) as Record<string, string>;

  const reason = parseDowntimeReason(values.reason);
  if (!reason) return { error: "Please choose a reason." };
  if (values.note.length > MAX_DOWNTIME_NOTE) return { error: `The note can have at most ${MAX_DOWNTIME_NOTE} characters.` };
  const range = resolveDowntimeRange({
    startDate: values.startDate,
    endDate: values.endDate,
    startTime: values.startTime,
    endTime: values.endTime,
  });
  if ("error" in range) return { error: range.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const readOnly = await assertCanWrite(supabase, groupId);
  if (readOnly) return readOnly;

  const confirmed = text(formData, "confirm") === "1";
  const expectedIds = text(formData, "confirmIds")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const { data, error } = await supabase.rpc("create_aircraft_downtime", {
    p_group_id: groupId,
    p_starts_at: range.startsAt,
    p_ends_at: range.endsAt,
    p_reason: reason,
    p_note: values.note || null,
    p_confirm: confirmed,
    p_expected_ids: confirmed ? expectedIds : null,
  });
  const outcome = data as { result?: string; bookings?: ClashingBooking[]; cancelled?: number; emailed?: number } | null;
  if (error || !outcome?.result) return { error: "Could not save the period. Please try again." };

  switch (outcome.result) {
    case "ok": {
      revalidateAll(groupSlug);
      // The database queued the emails; send them after replying.
      await flushSoon();
      const cancelled = outcome.cancelled ?? 0;
      return {
        success:
          cancelled === 0
            ? "The aircraft is marked unavailable. No bookings were affected."
            : `The aircraft is marked unavailable. ${cancelled} booking${cancelled === 1 ? " was" : "s were"} cancelled and the members affected are being emailed.`,
      };
    }
    case "needs_confirmation":
      return { confirm: { bookings: outcome.bookings ?? [], values } };
    case "bookings_changed":
      return {
        error: "The bookings in that period changed in the meantime. Please check the list again before confirming.",
        confirm: { bookings: outcome.bookings ?? [], values },
      };
    case "not_allowed":
      return { error: "Only group admins can mark the aircraft unavailable." };
    case "period_past":
      return { error: "That period is already over." };
    case "period_invalid":
      return { error: "That period is not valid. Check the dates and times." };
    case "note_too_long":
      return { error: `The note can have at most ${MAX_DOWNTIME_NOTE} characters.` };
    default:
      return { error: "Could not save the period. Please try again." };
  }
}

// Make the aircraft available again. Bookings that were cancelled because of the period stay cancelled.
export async function removeDowntime(formData: FormData) {
  if (await isDemoRequest()) return;
  const groupId = text(formData, "groupId");
  const groupSlug = text(formData, "groupSlug");
  const id = text(formData, "id");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await supabase.rpc("remove_aircraft_downtime", { p_group_id: groupId, p_id: id });
  revalidateAll(groupSlug);
}
