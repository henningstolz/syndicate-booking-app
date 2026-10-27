import { FIELD_LABELS, formatDateTime } from "@/lib/platform-admin/format";

export type PlanEvent = {
  id: string;
  created_at: string;
  event_type: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  reason: string | null;
  actor_email: string | null;
};

const TITLES: Record<string, string> = { group_created: "Group created", plan_changed: "Plan changed", setting_changed: "Setting changed" };

const show = (value: unknown) => (value === null || value === undefined || value === "" ? "none" : String(value));

export function parseEvents(answer: unknown): PlanEvent[] {
  const a = answer as { result?: string; events?: PlanEvent[] } | null;
  return a?.result === "ok" && Array.isArray(a.events) ? a.events : [];
}

// The append-only history of changes, newest first.
export function History({ events }: { events: PlanEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-zinc-500">No changes yet.</p>;
  return (
    <ol className="flex flex-col gap-3">
      {events.map((e) => {
        const keys = Object.keys(e.new_values ?? {});
        return (
          <li key={e.id} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm">
            <p className="flex flex-wrap justify-between gap-2">
              <span className="font-medium">{TITLES[e.event_type] ?? e.event_type}</span>
              <span className="text-zinc-500">{formatDateTime(e.created_at)}{e.actor_email ? ` · ${e.actor_email}` : ""}</span>
            </p>
            {keys.length > 0 && (
              <ul className="mt-1 text-zinc-700">
                {keys.map((k) => (
                  <li key={k}>
                    {FIELD_LABELS[k] ?? k}: {e.old_values && k in e.old_values ? `${show(e.old_values[k])} → ` : ""}
                    <span className="font-medium">{show(e.new_values?.[k])}</span>
                  </li>
                ))}
              </ul>
            )}
            {e.reason && <p className="mt-1 text-zinc-500">Reason: {e.reason}</p>}
          </li>
        );
      })}
    </ol>
  );
}
