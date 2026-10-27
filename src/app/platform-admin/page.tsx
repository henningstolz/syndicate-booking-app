import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { adminState } from "@/lib/platform-admin/guard";
import { parseAdminGroups, summarise, wouldBeReadOnly } from "@/lib/platform-admin/groups";
import { GroupsTable } from "./GroupsTable";
import { CodePanel, EnrolPanel } from "./MfaPanel";
import { History, parseEvents } from "./History";
import { SettingsPanel, type Settings } from "./SettingsPanel";
import { noticeFor } from "./notices";

const stat = "rounded-lg border border-zinc-200 bg-white p-3";

export default async function PlatformAdminPage({ searchParams }: { searchParams: Promise<{ notice?: string; field?: string }> }) {
  const supabase = await createClient();
  const state = await adminState(supabase);
  if (state === "not_admin") notFound();
  if (state === "needs_enrolment") return <EnrolPanel />;
  if (state === "needs_code") return <CodePanel />;

  const { notice: code, field } = await searchParams;
  const notice = noticeFor(code, field);
  const [{ data: groupsAnswer }, { data: settingsAnswer }, { data: eventsAnswer }] = await Promise.all([
    supabase.rpc("admin_list_groups"),
    supabase.rpc("get_platform_settings"),
    supabase.rpc("admin_list_plan_events", { p_group_id: null, p_limit: 20 }),
  ]);
  const groups = parseAdminGroups(groupsAnswer);
  if (!groups) return <p role="alert" className="text-sm text-red-700">The groups could not be loaded. Reload the page, or sign in again.</p>;

  const settings = ((settingsAnswer as { settings?: Settings } | null)?.settings ?? {}) as Settings;
  const now = new Date();
  const summary = summarise(groups, now);
  const grace = typeof settings.grace_period_days === "number" ? settings.grace_period_days : 14;
  const atRisk = wouldBeReadOnly(groups, grace, now).length;

  return (
    <div className="flex flex-col gap-6">
      {notice && (
        <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${notice.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>{notice.text}</p>
      )}

      <section aria-label="Summary" className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className={stat}><p className="text-2xl font-semibold">{summary.total}</p><p className="text-xs text-zinc-500">groups</p></div>
        <div className={stat}>
          <p className="text-sm">{summary.byPlan.founding} founding · {summary.byPlan.standard} standard · {summary.byPlan.complimentary} complimentary{summary.byPlan.none ? ` · ${summary.byPlan.none} without plan` : ""}</p>
          <p className="mt-1 text-xs text-zinc-500">by plan</p>
        </div>
        <div className={stat}><p className="text-2xl font-semibold">{summary.trialsEnding}</p><p className="text-xs text-zinc-500">trials ending in 30 days</p></div>
        <div className={stat}><p className="text-2xl font-semibold">{summary.paidUntilExpiring}</p><p className="text-xs text-zinc-500">paid-until dates in 30 days</p></div>
        <div className={`${stat} col-span-2 md:col-span-4`}>
          <p className="text-sm"><strong>{atRisk}</strong> group{atRisk === 1 ? "" : "s"} would be read-only if billing enforcement were on today.</p>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-500">Groups</h2>
        <GroupsTable groups={groups} />
      </section>

      <section id="settings">
        <h2 className="mb-2 text-sm font-medium text-zinc-500">Platform settings</h2>
        <SettingsPanel settings={settings} />
        <h3 className="mb-2 mt-5 text-sm font-medium text-zinc-500">Settings history</h3>
        <History events={parseEvents(eventsAnswer)} />
      </section>
    </div>
  );
}
