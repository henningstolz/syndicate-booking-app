// Shared by the equipment list (src/lib/aircraft-items.ts) and personal reminders (src/lib/personal-reminders.ts).

// What someone submitted for an editable list of named dates (the group's equipment list, a person's own
// reminders), checked and tidied. Pure and import-free, so it can be tested. The form sends parallel lists
// (one entry per row) and the ids of rows that were removed. `texts` words the error messages for the list.
export type ItemChange =
  | { kind: "add"; label: string; due: string | null }
  | { kind: "update"; id: string; label: string; due: string | null }
  | { kind: "delete"; id: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ListTexts = {
  listName: string; // "equipment list"
  noun: string; // "equipment item"
  limit: (max: number) => string; // "A group can have at most 30 equipment items."
};

const EQUIPMENT_TEXTS: ListTexts = {
  listName: "equipment list",
  noun: "equipment item",
  limit: (max) => `A group can have at most ${max} equipment items.`,
};

export function planItemChanges(input: {
  ids: string[];
  labels: string[];
  dues: string[];
  origLabels: string[];
  origDues: string[];
  deletedIds: string[];
  maxItems: number;
  maxLabel: number;
  texts?: ListTexts;
}): { error: string } | { changes: ItemChange[] } {
  const { ids, labels, dues, origLabels, origDues, deletedIds, maxItems, maxLabel } = input;
  const texts = input.texts ?? EQUIPMENT_TEXTS;
  if (labels.length !== ids.length || dues.length !== ids.length) {
    return { error: `The ${texts.listName} could not be read. Please reload the page and try again.` };
  }
  if (ids.length > maxItems) {
    return { error: texts.limit(maxItems) };
  }

  const changes: ItemChange[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i++) {
    const label = (labels[i] ?? "").trim().replace(/\s+/g, " ");
    const due = (dues[i] ?? "").trim();
    if (label === "") return { error: `Every ${texts.noun} needs a name.` };
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
