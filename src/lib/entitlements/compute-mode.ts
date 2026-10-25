// May this group write right now? A pure function: the same inputs always give the same answer, so
// it is tested without a database. The rules are in docs/entitlements.md. Nothing here runs unless
// billing enforcement is switched on in the platform settings.
import { PLAN_DEFINITIONS, type BillingStatus, type PlanDefinition, type PlanKey } from "./plans.ts";

export type Mode = "full" | "read_only";

export type PlanInput = {
  plan: PlanKey;
  billingStatus: BillingStatus;
  trialEndsAt: string | null; // a moment, as the database writes it
  paidUntil: string | null; // a date, 2026-12-31
  priceLockedUntil: string | null; // a date
};

export type SettingsInput = {
  billingEnforcementEnabled: boolean;
  graceDays: number;
};

export type Entitlements = {
  mode: Mode;
  // Short codes saying why, for logs and tests (never shown to people as they are).
  reasons: string[];
  limits: { maxMembers: number | null; maxAircraft: number | null };
};

export const DEFAULT_GRACE_DAYS = 14;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Today's date in the UK, as 2026-12-31. Bills and trials run in UK days.
export function ukDate(moment: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(moment);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// A date as 2026-12-31 (or a moment starting with one), checked to be a real day; otherwise null.
function dayOf(value: string | null, isMoment = false): string | null | "bad" {
  if (value === null) return null;
  if (typeof value !== "string") return "bad";
  if (isMoment) {
    const t = new Date(value);
    return Number.isNaN(t.getTime()) ? "bad" : ukDate(t);
  }
  if (!DATE.test(value)) return "bad";
  const t = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== value ? "bad" : value;
}

const limitsOf = (def: PlanDefinition) => ({ maxMembers: def.maxMembers, maxAircraft: def.maxAircraft });

export function computeMode(
  input: PlanInput,
  settings: SettingsInput,
  now: Date,
  definitions: Record<PlanKey, PlanDefinition> = PLAN_DEFINITIONS,
): Entitlements {
  const limits = limitsOf(definitions[input.plan]);
  const result = (mode: Mode, ...reasons: string[]): Entitlements => ({ mode, reasons, limits });

  if (!settings.billingEnforcementEnabled) return result("full", "enforcement_off");
  if (input.plan === "complimentary") return result("full", "complimentary");

  const today = ukDate(now);
  const priceLock = dayOf(input.priceLockedUntil);
  const paidUntil = dayOf(input.paidUntil);
  const trialEnd = dayOf(input.trialEndsAt, true);
  // A date we cannot read must never lock a group out.
  if (priceLock === "bad" || paidUntil === "bad" || trialEnd === "bad") return result("full", "unreadable_date");
  const grace = Number.isInteger(settings.graceDays) && settings.graceDays >= 0 ? settings.graceDays : DEFAULT_GRACE_DAYS;

  if (input.plan === "founding" && priceLock !== null && today <= priceLock) return result("full", "price_locked");
  if (input.billingStatus === "none") return result("full", "not_billed");
  if (input.billingStatus === "cancelled") return result("read_only", "cancelled");

  if (paidUntil !== null && today <= addDays(paidUntil, grace)) {
    return result("full", today <= paidUntil ? "paid" : "paid_grace_period");
  }
  if (input.billingStatus === "trial") {
    if (trialEnd === null) return result("full", "trial_without_end_date");
    if (today <= addDays(trialEnd, grace)) return result("full", today <= trialEnd ? "trial" : "trial_grace_period");
    return result("read_only", "trial_ended");
  }
  if (input.billingStatus === "active" && paidUntil === null) return result("full", "active_without_end_date");
  return result("read_only", "payment_overdue");
}

// Can one more member / aircraft be added? `null` = unlimited.
export const memberLimitReached = (limits: Entitlements["limits"], currentMembers: number): boolean =>
  limits.maxMembers !== null && currentMembers >= limits.maxMembers;

export const aircraftLimitReached = (limits: Entitlements["limits"], currentAircraft: number): boolean =>
  limits.maxAircraft !== null && currentAircraft >= limits.maxAircraft;
