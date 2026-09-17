"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { londonWallTimeToUtc } from "@/lib/datetime";
import {
  FULL_DAY_START,
  FULL_DAY_END,
  HALF_DAY_SPLIT,
} from "@/lib/booking-durations";

export type BookingActionState = { error?: string; success?: boolean };

function resolveRange(
  mode: string,
  formData: FormData,
): { starts: Date; ends: Date } | null {
  switch (mode) {
    case "half-am": {
      const date = formData.get("date") as string;
      if (!date) return null;
      return {
        starts: londonWallTimeToUtc(date, FULL_DAY_START),
        ends: londonWallTimeToUtc(date, HALF_DAY_SPLIT),
      };
    }
    case "half-pm": {
      const date = formData.get("date") as string;
      if (!date) return null;
      return {
        starts: londonWallTimeToUtc(date, HALF_DAY_SPLIT),
        ends: londonWallTimeToUtc(date, FULL_DAY_END),
      };
    }
    case "full-day": {
      const date = formData.get("date") as string;
      if (!date) return null;
      return {
        starts: londonWallTimeToUtc(date, FULL_DAY_START),
        ends: londonWallTimeToUtc(date, FULL_DAY_END),
      };
    }
    case "multi-day": {
      const startDate = formData.get("startDate") as string;
      const endDate = formData.get("endDate") as string;
      if (!startDate || !endDate) return null;
      return {
        starts: londonWallTimeToUtc(startDate, FULL_DAY_START),
        ends: londonWallTimeToUtc(endDate, FULL_DAY_END),
      };
    }
    case "custom":
    default: {
      const startsAt = formData.get("startsAt") as string;
      const endsAt = formData.get("endsAt") as string;
      if (!startsAt || !endsAt) return null;
      const [startDate, startTime] = startsAt.split("T");
      const [endDate, endTime] = endsAt.split("T");
      return {
        starts: londonWallTimeToUtc(startDate, startTime),
        ends: londonWallTimeToUtc(endDate, endTime),
      };
    }
  }
}

function revalidateGroupPaths(groupSlug: string) {
  revalidatePath(`/${groupSlug}`);
  revalidatePath(`/${groupSlug}/calendar`);
  revalidatePath(`/${groupSlug}/reports`);
}

export async function createBooking(
  _prevState: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  const groupId = formData.get("groupId") as string;
  const groupSlug = formData.get("groupSlug") as string;
  const mode = (formData.get("mode") as string) ?? "custom";
  const note = (formData.get("note") as string) || null;

  const range = resolveRange(mode, formData);
  if (!range) {
    return { error: "Please fill in the required dates/times." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase.from("bookings").insert({
    group_id: groupId,
    member_id: user.id,
    starts_at: range.starts.toISOString(),
    ends_at: range.ends.toISOString(),
    note,
  });

  if (error) {
    // exclusion_violation: overlaps a confirmed booking (23P01),
    // check_violation: end time before/at start time (23514).
    if (error.code === "23P01") {
      return { error: "That overlaps an existing booking." };
    }
    if (error.code === "23514") {
      return { error: "End time must be after the start time." };
    }
    return { error: error.message };
  }

  revalidateGroupPaths(groupSlug);
  return { success: true };
}

export async function cancelBooking(formData: FormData) {
  const bookingId = formData.get("bookingId") as string;
  const groupSlug = formData.get("groupSlug") as string;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // RLS restricts this to the booking's own member or a group admin;
  // anyone else's update simply matches zero rows.
  await supabase
    .from("bookings")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: user.id,
    })
    .eq("id", bookingId);

  revalidateGroupPaths(groupSlug);
}
