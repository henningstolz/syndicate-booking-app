// Turns what the database answered (get_group_entitlement_inputs, migration 0026) into an
// Entitlements result. Anything unexpected means "allow": a problem in the plan data or in the
// answer must never lock a group out of its own aircraft.
import { computeMode, DEFAULT_GRACE_DAYS, type Entitlements } from "./compute-mode.ts";
import { PLAN_DEFINITIONS, isBillingStatus, isPlanKey, type PlanDefinition, type PlanKey } from "./plans.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nullableString = (value: unknown): string | null | undefined =>
  value === null ? null : typeof value === "string" ? value : undefined;

export const unavailable = (reason: string): Entitlements => ({
  mode: "full",
  reasons: [reason],
  limits: { maxMembers: null, maxAircraft: null },
});

export function evaluateEntitlements(
  answer: unknown,
  now: Date,
  definitions: Record<PlanKey, PlanDefinition> = PLAN_DEFINITIONS,
): Entitlements {
  if (!isRecord(answer) || answer.result !== "ok") return unavailable("unavailable");
  const plan = answer.plan;
  if (plan === null || plan === undefined) return unavailable("no_plan_row");
  if (!isRecord(plan) || !isPlanKey(plan.plan) || !isBillingStatus(plan.billing_status)) return unavailable("unknown_plan");

  const trialEndsAt = nullableString(plan.trial_ends_at);
  const paidUntil = nullableString(plan.paid_until);
  const priceLockedUntil = nullableString(plan.price_locked_until);
  if (trialEndsAt === undefined || paidUntil === undefined || priceLockedUntil === undefined) return unavailable("unreadable_date");

  const settings = isRecord(answer.settings) ? answer.settings : {};
  const grace = settings.grace_period_days;
  return computeMode(
    { plan: plan.plan, billingStatus: plan.billing_status, trialEndsAt, paidUntil, priceLockedUntil },
    {
      // Only a real `true` switches enforcement on.
      billingEnforcementEnabled: settings.billing_enforcement_enabled === true,
      graceDays: typeof grace === "number" && Number.isInteger(grace) && grace >= 0 ? grace : DEFAULT_GRACE_DAYS,
    },
    now,
    definitions,
  );
}
