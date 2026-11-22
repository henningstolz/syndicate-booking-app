import type { createClient } from "@/lib/supabase/server";
import type { AircraftItem } from "@/lib/aircraft-status";

// The group's equipment list (life raft, first aid kit, ...) in the order the admin keeps it.
export async function getAircraftItems(
  supabase: Awaited<ReturnType<typeof createClient>>,
  groupId: string,
): Promise<AircraftItem[]> {
  const { data } = await supabase
    .from("aircraft_items")
    .select("id, label, due_date")
    .eq("group_id", groupId)
    .order("position")
    .order("created_at")
    .returns<AircraftItem[]>();
  return data ?? [];
}

export { planItemChanges, type ItemChange, type ListTexts } from "./list-changes.ts";
