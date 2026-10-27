import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { adminState } from "@/lib/platform-admin/guard";
import { parseAdminGroups } from "@/lib/platform-admin/groups";
import { currentValue } from "@/lib/platform-admin/plan-form";
import { formatDateTime } from "@/lib/platform-admin/format";
import { History, parseEvents } from "../../History";
import { noticeFor } from "../../notices";
import { saveGroupPlan } from "./actions";

const input = "rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900";
const label = "flex flex-col gap-1 text-sm font-medium";

export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ notice?: string; field?: string }>;
}) {
  const supabase = await createClient();
  const state = await adminState(supabase);
  if (state === "not_admin") notFound();
  if (state !== "ok") return <Back />; // the code screen is on the main page

  const { groupId } = await params;
  const { notice: code, field } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(groupId)) notFound();

  const [{ data: listed }, { data: eventsAnswer }] = await Promise.all([
    supabase.rpc("admin_list_groups"),
    supabase.rpc("admin_list_plan_events", { p_group_id: groupId, p_limit: 50 }),
  ]);
  const group = parseAdminGroups(listed)?.find((g) => g.group_id === groupId);
  if (!group) notFound();
  const notice = noticeFor(code, field);
  const v = (f: Parameters<typeof currentValue>[1]) => currentValue(group, f);

  return (
    <div className="flex flex-col gap-5">
      <Back />
      <div>
        <h1 className="text-xl font-semibold">{group.name}</h1>
        <p className="text-sm text-zinc-500">
          {group.slug} · {group.member_count} members · {group.aircraft_count} aircraft · created {formatDateTime(group.created_at)} · last activity {formatDateTime(group.last_activity)}
        </p>
        <p className="mt-1 text-sm text-zinc-600">
          Group admins: {group.admins.map((a) => [a.name, a.email].filter(Boolean).join(" · ")).join(", ") || "—"}
        </p>
      </div>

      {notice && (
        <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${notice.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>{notice.text}</p>
      )}

      <form action={saveGroupPlan} className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 sm:grid-cols-2">
        <input type="hidden" name="groupId" value={group.group_id} />
        <label className={label}>Plan
          <select name="plan" defaultValue={v("plan")} className={input}>
            <option value="founding">Founding</option>
            <option value="standard">Standard</option>
            <option value="complimentary">Complimentary</option>
          </select>
        </label>
        <label className={label}>Billing status
          <select name="billing_status" defaultValue={v("billing_status")} className={input}>
            <option value="none">None</option>
            <option value="trial">Trial</option>
            <option value="active">Active</option>
            <option value="past_due">Past due</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className={label}>Cohort
          <input name="cohort" defaultValue={v("cohort")} maxLength={40} className={input} />
        </label>
        <label className={label}>Discount %
          <input name="discount_percent" type="number" min={0} max={100} step={1} defaultValue={v("discount_percent")} className={input} />
        </label>
        <label className={label}>Trial ends
          <input name="trial_ends_at" type="date" defaultValue={v("trial_ends_at")} className={input} />
        </label>
        <label className={label}>Paid until
          <input name="paid_until" type="date" defaultValue={v("paid_until")} className={input} />
        </label>
        <label className={label}>Price locked until
          <input name="price_locked_until" type="date" defaultValue={v("price_locked_until")} className={input} />
        </label>
        <label className={label}>Billing reference
          <input name="billing_reference" defaultValue={v("billing_reference")} maxLength={200} className={input} />
        </label>
        <details className="sm:col-span-2">
          <summary className="cursor-pointer text-sm text-zinc-600">Payment provider ids (not used yet)</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className={label}>Stripe customer id
              <input name="stripe_customer_id" defaultValue={v("stripe_customer_id")} maxLength={200} className={input} />
            </label>
            <label className={label}>Stripe subscription id
              <input name="stripe_subscription_id" defaultValue={v("stripe_subscription_id")} maxLength={200} className={input} />
            </label>
          </div>
        </details>
        <label className={`${label} sm:col-span-2`}>Reason for the change (required, goes into the history)
          <input name="reason" required minLength={3} maxLength={500} className={input} />
        </label>
        <div className="sm:col-span-2">
          <button type="submit" className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700">Save changes</button>
        </div>
      </form>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-500">History</h2>
        <History events={parseEvents(eventsAnswer)} />
      </section>
    </div>
  );
}

function Back() {
  return <Link href="/platform-admin" className="text-sm text-zinc-600 underline underline-offset-4">← All groups</Link>;
}
