import { createClient } from "@/lib/supabase/server";
import { describePlan } from "@/lib/entitlements/describe";
import { isBillingStatus, isPlanKey } from "@/lib/entitlements/plans";

// What plan this group is on, in a sentence or two. Read-only: no buttons, no payment. Shown to group
// admins. Uses the same database function as the write check (get_group_entitlement_inputs).
export async function PlanCard({ groupId }: { groupId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_group_entitlement_inputs", { p_group_id: groupId });
  const answer = data as { result?: string; plan?: Record<string, unknown> | null } | null;
  const plan = answer?.result === "ok" ? answer.plan : null;
  if (!plan || !isPlanKey(plan.plan) || !isBillingStatus(plan.billing_status)) return null;

  const text = (v: unknown) => (typeof v === "string" ? v : null);
  const summary = describePlan({
    plan: plan.plan,
    billingStatus: plan.billing_status,
    trialEndsAt: text(plan.trial_ends_at),
    paidUntil: text(plan.paid_until),
    priceLockedUntil: text(plan.price_locked_until),
  });

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-zinc-500">Your plan</h2>
      <div className="max-w-md rounded-lg border border-zinc-200 bg-white p-4">
        <p className="font-medium text-zinc-900">{summary.title}</p>
        {summary.lines.map((line) => (
          <p key={line} className="mt-1 text-sm text-zinc-600">{line}</p>
        ))}
      </div>
    </section>
  );
}
