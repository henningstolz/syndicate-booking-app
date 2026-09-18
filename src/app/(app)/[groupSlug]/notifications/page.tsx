import { createClient } from "@/lib/supabase/server";
import { getGroupBySlug } from "@/lib/groups";
import { LONDON_TZ } from "@/lib/datetime";
import { NotificationsForm } from "./NotificationsForm";

const DUE_SOON_DAYS = 30;
const HOURS_DUE_SOON = 10;

type Status = "overdue" | "soon" | "ok" | "unset";

function dateStatus(dateStr: string | null): Status {
  if (!dateStr) return "unset";
  const daysUntil =
    (new Date(`${dateStr}T00:00:00Z`).getTime() - Date.now()) / 86_400_000;
  if (daysUntil < 0) return "overdue";
  if (daysUntil <= DUE_SOON_DAYS) return "soon";
  return "ok";
}

function hoursStatus(hours: number | null): Status {
  if (hours === null) return "unset";
  if (hours <= 0) return "overdue";
  if (hours <= HOURS_DUE_SOON) return "soon";
  return "ok";
}

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

export default async function NotificationsPage({
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

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 py-6">
      <div className="flex flex-col gap-2">
        <StatusRow
          label="Annual/Permit Renewal Due"
          value={formatDate(group.annual_renewal_due)}
          status={dateStatus(group.annual_renewal_due)}
        />
        <StatusRow
          label="Insurance Renewal Due"
          value={formatDate(group.insurance_renewal_due)}
          status={dateStatus(group.insurance_renewal_due)}
        />
        <StatusRow
          label="Next Check Due"
          value={formatDate(group.next_check_due)}
          status={dateStatus(group.next_check_due)}
        />
        <StatusRow
          label="Hours To Next Check"
          value={
            group.hours_to_next_check === null
              ? "Not stated"
              : `${group.hours_to_next_check}`
          }
          status={hoursStatus(group.hours_to_next_check)}
        />
      </div>

      {isAdmin && (
        <NotificationsForm
          groupId={group.id}
          groupSlug={groupSlug}
          initial={{
            annualRenewalDue: group.annual_renewal_due,
            insuranceRenewalDue: group.insurance_renewal_due,
            nextCheckDue: group.next_check_due,
            hoursToNextCheck: group.hours_to_next_check,
          }}
        />
      )}
    </main>
  );
}
