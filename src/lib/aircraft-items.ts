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

// What an admin submitted for the equipment list, checked and tidied. Pure, so it can be tested.
// The form sends parallel lists (one entry per row) and the ids of rows that were removed.
export type ItemChange =
  | { kind: "add"; label: string; due: string | null }
  | { kind: "update"; id: string; label: string; due: string | null }
  | { kind: "delete"; id: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function planItemChanges(input: {
  ids: string[];
  labels: string[];
  dues: string[];
  origLabels: string[];
  origDues: string[];
  deletedIds: string[];
  maxItems: number;
  maxLabel: number;
}): { error: string } | { changes: ItemChange[] } {
  const { ids, labels, dues, origLabels, origDues, deletedIds, maxItems, maxLabel } = input;
  if (labels.length !== ids.length || dues.length !== ids.length) {
    return { error: "The equipment list could not be read. Please reload the page and try again." };
  }
  if (ids.length > maxItems) {
    return { error: `A group can have at most ${maxItems} equipment items.` };
  }

  const changes: ItemChange[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i++) {
    const label = (labels[i] ?? "").trim().replace(/\s+/g, " ");
    const due = (dues[i] ?? "").trim();
    if (label === "") return { error: "Every equipment item needs a name." };
    if (label.length > maxLabel) return { error: `An item name can have at most ${maxLabel} characters.` };
    if (due !== "" && (!DATE.test(due) || Number.isNaN(Date.parse(`${due}T00:00:00Z`)))) {
      return { error: `"${label}" has a date that is not valid.` };
    }
    const key = label.toLowerCase();
    if (seen.has(key)) return { error: `Two items are called "${label}". Give them different names.` };
    seen.add(key);

    const dueOrNull = due === "" ? null : due;
    if (ids[i] === "") {
      changes.push({ kind: "add", label, due: dueOrNull });
    } else if (label !== (origLabels[i] ?? "") || (dueOrNull ?? "") !== (origDues[i] ?? "")) {
      changes.push({ kind: "update", id: ids[i], label, due: dueOrNull });
    }
  }
  for (const id of deletedIds) {
    if (id !== "") changes.push({ kind: "delete", id });
  }
  return { changes };
}
