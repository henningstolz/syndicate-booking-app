"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { wallTimesToUtcIso } from "@/lib/datetime";
import { dayOffsets } from "@/lib/flight-times";

export type FlightActionState = { error?: string; success?: boolean };

const ADD_ERRORS: Record<string, string> = {
  not_allowed: "You can't add entries to this group's log.",
  place_required: "Please fill in where the flight was from and to.",
  place_too_long: "Place names are limited to 40 characters.",
  category_invalid: "Please choose a flight category.",
  captain_invalid: "That captain isn't a current member of the group.",
  captain_required: "Please enter the captain's name.",
  fuel_invalid: "Fuel must be between 0 and 100 US gallons in each tank.",
  oil_invalid: "Oil must be between 0 and 20 quarts.",
  times_order:
    "The four times must run in order: brakes off, airborne, landed, brakes on.",
  too_long:
    "That is more than 16 hours from brakes off to brakes on. Please check the times.",
  in_future: "That flight starts in the future. Please check the date and times.",
  defects_too_long: "Defects are limited to 2000 characters.",
  overlap:
    "This overlaps another flight in the log. If it is the same flight, it is already there.",
};

const text = (formData: FormData, key: string) =>
  ((formData.get(key) as string | null) ?? "").trim();

// "24.5" -> 24.5; blank or not a number -> null (the database then says which
// field is wrong).
function numberOrNull(raw: string): number | null {
  if (raw === "") return null;
  const value = Number(raw);
  return Number.isNaN(value) ? null : value;
}

export async function addFlightEntry(
  _prevState: FlightActionState,
  formData: FormData,
): Promise<FlightActionState> {
  const groupId = text(formData, "groupId");
  const groupSlug = text(formData, "groupSlug");
  const date = text(formData, "date");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "Please choose the date of the flight." };
  }

  // The four times are typed as plain UK clock times on the flight's date; a
  // time earlier than the one before it falls on the next day.
  const times = ["brakesOff", "airborne", "landed", "brakesOn"].map((key) =>
    text(formData, key),
  );
  const offsets = dayOffsets(times);
  if (!offsets) {
    return { error: "Please enter all four times: brakes off, airborne, landed, brakes on." };
  }
  const [brakesOff, airborne, landed, brakesOn] = wallTimesToUtcIso(
    date,
    times,
    offsets,
  );

  // "member:<user id>" for a group member, "guest" for anyone else.
  const captain = text(formData, "captain");
  const captainId = captain.startsWith("member:") ? captain.slice(7) : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data, error } = await supabase.rpc("add_flight_entry", {
    p_group_id: groupId,
    p_from: text(formData, "from"),
    p_to: text(formData, "to"),
    p_category: text(formData, "category"),
    p_captain_id: captainId,
    p_captain_name: captainId ? null : text(formData, "guestName"),
    p_fuel_left: numberOrNull(text(formData, "fuelLeft")),
    p_fuel_right: numberOrNull(text(formData, "fuelRight")),
    p_oil: numberOrNull(text(formData, "oil")),
    p_brakes_off: brakesOff,
    p_airborne: airborne,
    p_landed: landed,
    p_brakes_on: brakesOn,
    p_defects: text(formData, "defects"),
  });

  const result = (data as { result?: string } | null)?.result;
  if (error || !result) {
    return { error: "Could not save the entry. Please try again." };
  }
  if (result !== "ok") {
    return { error: ADD_ERRORS[result] ?? "Could not save the entry." };
  }

  revalidatePath(`/${groupSlug}/tech-log`);
  revalidatePath(`/${groupSlug}/aircraft`);
  revalidatePath(`/${groupSlug}`);
  return { success: true };
}

// Admin: take an entry out of the totals, with a reason. It stays in the log,
// marked void. Ends by redirecting back with a short notice code.
export async function voidFlightEntry(formData: FormData) {
  const groupSlug = text(formData, "groupSlug");
  const back = (notice: string) =>
    redirect(`/${groupSlug}/tech-log?notice=${notice}`);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data, error } = await supabase.rpc("void_flight_entry", {
    p_entry_id: text(formData, "entryId"),
    p_reason: text(formData, "reason"),
  });
  const result = (data as { result?: string } | null)?.result;

  if (error || !result) back("error");
  if (result === "ok") {
    revalidatePath(`/${groupSlug}/aircraft`);
    revalidatePath(`/${groupSlug}`);
    back("voided");
  }
  back(result as string);
}
