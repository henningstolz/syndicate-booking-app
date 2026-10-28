// The plain-English description of a group's plan, for the plan card in Settings (admins only).
// Pure and tested. It promises nothing about prices: it says what is true today.
import { PLAN_DEFINITIONS, type BillingStatus, type PlanKey } from "./plans.ts";

export type PlanSummary = { title: string; lines: string[] };

const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" });

// A date (2026-12-31) or a moment, as "31 Dec 2026"; empty if it cannot be read.
function formatDay(value: string | null): string {
  if (!value) return "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : day.format(date);
}

export function describePlan(input: {
  plan: PlanKey;
  billingStatus: BillingStatus;
  trialEndsAt: string | null;
  paidUntil: string | null;
  priceLockedUntil: string | null;
}): PlanSummary {
  const lines: string[] = [];
  const lock = formatDay(input.priceLockedUntil);
  const trial = formatDay(input.trialEndsAt);
  const paid = formatDay(input.paidUntil);

  if (input.plan === "complimentary") lines.push("There is no charge for this group.");
  if (input.plan === "founding" && input.billingStatus === "none") lines.push("Free during the beta.");
  if (input.plan === "standard" && input.billingStatus === "none") lines.push("No charge is being made at the moment.");

  if (input.billingStatus === "trial") lines.push(trial ? `Trial until ${trial}.` : "Trial.");
  if (input.billingStatus === "active") lines.push(paid ? `Paid until ${paid}.` : "Active.");
  if (input.billingStatus === "past_due") lines.push("A payment is overdue. Please contact support.");
  if (input.billingStatus === "cancelled") lines.push("This plan has been cancelled. Please contact support.");

  if (input.plan === "founding" && lock) lines.push(`Your founding price is locked until ${lock}.`);
  return { title: PLAN_DEFINITIONS[input.plan].name, lines };
}
