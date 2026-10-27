// Small display helpers for the platform admin page (UK time, plain wording).
const dateTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" });

export const formatDateTime = (iso: string | null): string => (iso && !Number.isNaN(Date.parse(iso)) ? dateTime.format(new Date(iso)) : "—");
export const formatMoment = (iso: string | null): string => (iso && !Number.isNaN(Date.parse(iso)) ? day.format(new Date(iso)) : "—");
// A date as the database writes it (2026-12-31).
export const formatDate = (value: string | null): string => (value && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? day.format(new Date(`${value}T12:00:00Z`)) : "—");

export const FIELD_LABELS: Record<string, string> = {
  plan: "Plan",
  billing_status: "Billing status",
  cohort: "Cohort",
  trial_ends_at: "Trial ends",
  paid_until: "Paid until",
  price_locked_until: "Price locked until",
  discount_percent: "Discount %",
  billing_reference: "Billing reference",
  stripe_customer_id: "Stripe customer id",
  stripe_subscription_id: "Stripe subscription id",
  billing_enforcement_enabled: "Billing enforcement",
  default_plan_new_groups: "Default plan for new groups",
  default_cohort_new_groups: "Default cohort for new groups",
  paid_beta_cutoff: "Paid-beta cut-off date",
  grace_period_days: "Grace period (days)",
};
