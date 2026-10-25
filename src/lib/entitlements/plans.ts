// The plans a group can be on, in one place. A limit of `null` means unlimited. The numbers are
// not decided yet, so every plan is unlimited; when they are, change them here and nowhere else.
// (Plan keys must match the database: group_plans.plan, migration 0025.)

export type PlanKey = "founding" | "standard" | "complimentary";
export type BillingStatus = "none" | "trial" | "active" | "past_due" | "cancelled";

export type PlanDefinition = {
  name: string;
  maxMembers: number | null;
  maxAircraft: number | null;
};

export const PLAN_DEFINITIONS: Record<PlanKey, PlanDefinition> = {
  founding: { name: "Founding group", maxMembers: null, maxAircraft: null },
  standard: { name: "Standard", maxMembers: null, maxAircraft: null },
  complimentary: { name: "Complimentary", maxMembers: null, maxAircraft: null },
};

export const isPlanKey = (value: unknown): value is PlanKey =>
  typeof value === "string" && Object.hasOwn(PLAN_DEFINITIONS, value);

export const isBillingStatus = (value: unknown): value is BillingStatus =>
  value === "none" || value === "trial" || value === "active" || value === "past_due" || value === "cancelled";
