// The platform admin's view of the groups: the shape admin_list_groups() returns (migration 0025),
// and the pure helpers behind the summary strip and the table (counts, search, sort, filter).
// Relative imports only, so the plain-Node unit tests can run it.
import { addDays, computeMode, ukDate } from "../entitlements/compute-mode.ts";
import { isBillingStatus, isPlanKey, type BillingStatus, type PlanKey } from "../entitlements/plans.ts";

export type AdminGroup = {
  group_id: string;
  slug: string;
  name: string;
  created_at: string;
  aircraft_count: number;
  member_count: number;
  admins: { name: string | null; email: string | null }[];
  last_activity: string | null;
  plan: PlanKey | null; // null: the group has no plan row (should not happen)
  billing_status: BillingStatus | null;
  cohort: string | null;
  trial_ends_at: string | null;
  paid_until: string | null;
  price_locked_until: string | null;
  discount_percent: number | null;
  billing_reference: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan_updated_at: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

// The database's answer to admin_list_groups(), or null if it is not the answer we expect.
export function parseAdminGroups(answer: unknown): AdminGroup[] | null {
  if (!isRecord(answer) || answer.result !== "ok" || !Array.isArray(answer.groups)) return null;
  const groups: AdminGroup[] = [];
  for (const raw of answer.groups) {
    if (!isRecord(raw) || typeof raw.group_id !== "string") return null;
    groups.push({
      group_id: raw.group_id,
      slug: text(raw.slug) ?? "",
      name: text(raw.name) ?? "",
      created_at: text(raw.created_at) ?? "",
      aircraft_count: typeof raw.aircraft_count === "number" ? raw.aircraft_count : 1,
      member_count: typeof raw.member_count === "number" ? raw.member_count : 0,
      admins: Array.isArray(raw.admins)
        ? raw.admins.filter(isRecord).map((a) => ({ name: text(a.name), email: text(a.email) }))
        : [],
      last_activity: text(raw.last_activity),
      plan: isPlanKey(raw.plan) ? raw.plan : null,
      billing_status: isBillingStatus(raw.billing_status) ? raw.billing_status : null,
      cohort: text(raw.cohort),
      trial_ends_at: text(raw.trial_ends_at),
      paid_until: text(raw.paid_until),
      price_locked_until: text(raw.price_locked_until),
      discount_percent: typeof raw.discount_percent === "number" ? raw.discount_percent : null,
      billing_reference: text(raw.billing_reference),
      stripe_customer_id: text(raw.stripe_customer_id),
      stripe_subscription_id: text(raw.stripe_subscription_id),
      plan_updated_at: text(raw.plan_updated_at),
    });
  }
  return groups;
}

// ------------------------------------------------------------------ summary strip

export type Summary = {
  total: number;
  byPlan: Record<PlanKey, number> & { none: number };
  trialsEnding: number; // billing status "trial" and the trial ends within the window
  paidUntilExpiring: number; // a paid-until date within the window
};

export const WINDOW_DAYS = 30;

const dayOfMoment = (value: string): string => ukDate(new Date(value));

// "Within the next 30 days": today up to and including the 30th day from now (UK days).
const withinWindow = (day: string, today: string): boolean => day >= today && day <= addDays(today, WINDOW_DAYS);

export function summarise(groups: AdminGroup[], now: Date): Summary {
  const today = ukDate(now);
  const byPlan = { founding: 0, standard: 0, complimentary: 0, none: 0 };
  let trialsEnding = 0;
  let paidUntilExpiring = 0;
  for (const g of groups) {
    byPlan[g.plan ?? "none"]++;
    if (g.billing_status === "trial" && g.trial_ends_at && withinWindow(dayOfMoment(g.trial_ends_at), today)) trialsEnding++;
    if (g.paid_until && withinWindow(g.paid_until, today)) paidUntilExpiring++;
  }
  return { total: groups.length, byPlan, trialsEnding, paidUntilExpiring };
}

// Which groups would be read-only right now if billing enforcement were switched on.
export function wouldBeReadOnly(groups: AdminGroup[], graceDays: number, now: Date): AdminGroup[] {
  return groups.filter((g) => {
    if (!g.plan || !g.billing_status) return false;
    const { mode } = computeMode(
      { plan: g.plan, billingStatus: g.billing_status, trialEndsAt: g.trial_ends_at, paidUntil: g.paid_until, priceLockedUntil: g.price_locked_until },
      { billingEnforcementEnabled: true, graceDays },
      now,
    );
    return mode === "read_only";
  });
}

// ------------------------------------------------------------ search, filter, sort

export type Filters = { search: string; plan: string; status: string };

export function filterGroups(groups: AdminGroup[], filters: Filters): AdminGroup[] {
  const needle = filters.search.trim().toLowerCase();
  return groups.filter((g) => {
    if (filters.plan && (g.plan ?? "none") !== filters.plan) return false;
    if (filters.status && (g.billing_status ?? "none") !== filters.status) return false;
    if (!needle) return true;
    const haystack = [g.name, g.slug, g.cohort, g.billing_reference, ...g.admins.flatMap((a) => [a.name, a.email])]
      .filter((v): v is string => typeof v === "string")
      .join("\n")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export type SortKey = "name" | "members" | "plan" | "status" | "created" | "activity" | "trial" | "paid";

const sortValue = (g: AdminGroup, key: SortKey): string | number | null => {
  switch (key) {
    case "name": return g.name.toLowerCase();
    case "members": return g.member_count;
    case "plan": return g.plan;
    case "status": return g.billing_status;
    case "created": return g.created_at ? Date.parse(g.created_at) : null;
    case "activity": return g.last_activity ? Date.parse(g.last_activity) : null;
    case "trial": return g.trial_ends_at ? Date.parse(g.trial_ends_at) : null;
    case "paid": return g.paid_until;
  }
};

// Missing values always go last, whichever way it is sorted.
export function sortGroups(groups: AdminGroup[], key: SortKey, direction: "asc" | "desc"): AdminGroup[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...groups].sort((a, b) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    if (x === null && y === null) return a.name.localeCompare(b.name);
    if (x === null) return 1;
    if (y === null) return -1;
    if (x < y) return -sign;
    if (x > y) return sign;
    return a.name.localeCompare(b.name);
  });
}
