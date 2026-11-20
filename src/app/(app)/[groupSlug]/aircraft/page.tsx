import { createClient } from "@/lib/supabase/server";
import { getGroupBySlug } from "@/lib/groups";
import { LONDON_TZ } from "@/lib/datetime";
import { STATUS_FIELDS, dateStatus, fieldStatus, type Status } from "@/lib/aircraft-status";
import { getAircraftItems } from "@/lib/aircraft-items";
import { AircraftForm } from "./AircraftForm";

const STATUS_STYLES: Record<Status, string> = {
  overdue: "border-red-300 bg-red-50 text-red-700",
  soon: "border-amber-300 bg-amber-50 text-amber-700",
  ok: "border-emerald-300 bg-emerald-50 text-emerald-700",
  unset: "border-zinc-200 bg-zinc-50 text-zinc-500",
};

const STATUS_LABELS: Record<Status, string> = {
  overdue: "Overdue",
  soon: "Due soon",
  ok: "OK",
  unset: "",
};

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatDate(dateStr: string | null) {
  if (!dateStr) return "Not stated";
  return dateFormat.format(new Date(`${dateStr}T00:00:00Z`));
}

function StatusRow({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status: Status;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${STATUS_STYLES[status]}`}
    >
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm">{value}</span>
        {STATUS_LABELS[status] && (
          <span className="text-xs font-semibold uppercase">
            {STATUS_LABELS[status]}
          </span>
        )}
      </div>
    </div>
  );
}

export default async function AircraftPage({
  params,
}: {
  params: Promise<{ groupSlug: string }>;
}) {
  const { groupSlug } = await params;
  const supabase = await createClient();

  const group = await getGroupBySlug(supabase, groupSlug);
  if (!group) {
    // The layout already redirects before we get here.
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from("group_members")
    .select("role")
    .eq("group_id", group.id)
    .eq("user_id", user?.id ?? "")
    .maybeSingle();

  const isAdmin = membership?.role === "admin";
  const items = await getAircraftItems(supabase, group.id);

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 py-6">
      <div className="flex flex-col gap-2">
        {STATUS_FIELDS.filter((field) => field.kind === "date").map((field) => (
          <StatusRow
            key={field.column}
            label={field.label}
            value={formatDate(group[field.column] as string | null)}
            status={fieldStatus(field.kind, group[field.column])}
          />
        ))}
        {/* The hours figures sit together: the hours left to the next check are worked out from the other two. */}
        <StatusRow
          label="Airframe Total Hours"
          value={
            group.airframe_total_hours === null
              ? "Not stated"
              : group.airframe_total_hours.toFixed(1)
          }
          status="unset"
        />
        <StatusRow
          label="Next Check At (hours)"
          value={
            group.next_check_at_hours === null
              ? "Not stated"
              : group.next_check_at_hours.toFixed(1)
          }
          status="unset"
        />
        {STATUS_FIELDS.filter((field) => field.kind === "hours").map((field) => (
          <StatusRow
            key={field.column}
            label={field.label}
            value={group[field.column] === null ? "Not stated" : `${group[field.column]}`}
            status={fieldStatus(field.kind, group[field.column])}
          />
        ))}
        {items.map((item) => (
          <StatusRow
            key={item.id}
            label={`${item.label} due`}
            value={formatDate(item.due_date)}
            status={dateStatus(item.due_date)}
          />
        ))}
      </div>

      {isAdmin && (
        <AircraftForm
          groupId={group.id}
          groupSlug={groupSlug}
          initial={group}
          items={items}
          hours={{
            total: group.airframe_total_hours,
            checkAt: group.next_check_at_hours,
          }}
        />
      )}
    </main>
  );
}
