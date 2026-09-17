"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type BookingActionState = { error?: string; success?: boolean };

export async function createBooking(
  _prevState: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  const groupId = formData.get("groupId") as string;
  const groupSlug = formData.get("groupSlug") as string;
  const startsAt = formData.get("startsAt") as string;
  const endsAt = formData.get("endsAt") as string;
  const note = (formData.get("note") as string) || null;

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
    starts_at: new Date(startsAt).toISOString(),
    ends_at: new Date(endsAt).toISOString(),
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

  revalidatePath(`/${groupSlug}`);
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

  revalidatePath(`/${groupSlug}`);
}
