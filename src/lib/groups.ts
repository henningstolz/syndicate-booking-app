import type { createClient } from "@/lib/supabase/server";
import { STATUS_FIELDS, type AircraftStatusFields } from "@/lib/aircraft-status";

export type GroupRow = AircraftStatusFields & {
  id: string;
  // Hours bookkeeping kept by the flight log (see migration 0011).
  airframe_total_hours: number | null;
  airframe_hours_baseline: number | null;
  next_check_at_hours: number | null;
  name: string;
  aircraft_registration: string;
  aircraft_type: string | null;
  home_base: string | null;
};

const COLUMNS = [
  "id",
  "name",
  "aircraft_registration",
  "aircraft_type",
  "home_base",
  "airframe_total_hours",
  "airframe_hours_baseline",
  "next_check_at_hours",
  ...STATUS_FIELDS.map((field) => field.column),
].join(", ");

export async function getGroupBySlug(
  supabase: Awaited<ReturnType<typeof createClient>>,
  slug: string,
) {
  const { data } = await supabase
    .from("groups")
    .select(COLUMNS)
    .eq("slug", slug)
    .maybeSingle();

  // The select list is built from STATUS_FIELDS at runtime, so the
  // client can't infer the row type from it — it's asserted here.
  return data as unknown as GroupRow | null;
}
