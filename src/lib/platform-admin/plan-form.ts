// Turns what the platform admin typed into the changes to send to admin_update_group_plan() and
// admin_update_setting() (migration 0025). Only fields that really changed are sent. Pure, tested.
import { ukDate } from "../entitlements/compute-mode.ts";
import { isBillingStatus, isPlanKey } from "../entitlements/plans.ts";
import type { AdminGroup } from "./groups.ts";

export const PLAN_FIELDS = [
  "plan", "billing_status", "cohort", "trial_ends_at", "paid_until", "price_locked_until",
  "discount_percent", "billing_reference", "stripe_customer_id", "stripe_subscription_id",
] as const;
export type PlanField = (typeof PLAN_FIELDS)[number];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (value: string) => DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

// What a field currently shows in its input: dates as 2026-12-31 (the trial end as its UK day).
export function currentValue(group: AdminGroup, field: PlanField): string {
  switch (field) {
    case "trial_ends_at": return group.trial_ends_at ? ukDate(new Date(group.trial_ends_at)) : "";
    case "discount_percent": return group.discount_percent === null ? "" : String(group.discount_percent);
    default: return group[field] ?? "";
  }
}

export type ParsedChanges =
  | { ok: true; changes: Record<string, string | number | null> }
  | { ok: false; field: string };

// `form` holds the raw text of every field (missing = empty).
export function buildPlanChanges(form: Record<string, string>, group: AdminGroup): ParsedChanges {
  const changes: Record<string, string | number | null> = {};
  for (const field of PLAN_FIELDS) {
    const raw = (form[field] ?? "").trim();
    if (raw === currentValue(group, field)) continue; // untouched
    switch (field) {
      case "plan":
        if (!isPlanKey(raw)) return { ok: false, field };
        changes[field] = raw;
        break;
      case "billing_status":
        if (!isBillingStatus(raw)) return { ok: false, field };
        changes[field] = raw;
        break;
      case "trial_ends_at":
      case "paid_until":
      case "price_locked_until":
        if (raw !== "" && !isRealDate(raw)) return { ok: false, field };
        changes[field] = raw === "" ? null : raw;
        break;
      case "discount_percent": {
        if (raw === "") { changes[field] = null; break; }
        if (!/^\d{1,3}$/.test(raw) || Number(raw) > 100) return { ok: false, field };
        changes[field] = Number(raw);
        break;
      }
      case "cohort":
        if (raw.length > 40) return { ok: false, field };
        changes[field] = raw === "" ? null : raw;
        break;
      default:
        if (raw.length > 200) return { ok: false, field };
        changes[field] = raw === "" ? null : raw;
    }
  }
  return { ok: true, changes };
}

// ---------------------------------------------------------------- platform settings

export const SETTING_KEYS = [
  "billing_enforcement_enabled", "default_plan_new_groups", "default_cohort_new_groups", "paid_beta_cutoff", "grace_period_days",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

// The value to send for one setting (billing enforcement is handled by the confirmation step).
export function parseSettingValue(key: string, raw: string): { ok: true; value: string | number | null } | { ok: false } {
  const text = raw.trim();
  switch (key) {
    case "default_plan_new_groups":
      return isPlanKey(text) ? { ok: true, value: text } : { ok: false };
    case "default_cohort_new_groups":
      return text.length >= 1 && text.length <= 40 ? { ok: true, value: text } : { ok: false };
    case "paid_beta_cutoff":
      if (text === "") return { ok: true, value: null };
      return isRealDate(text) ? { ok: true, value: text } : { ok: false };
    case "grace_period_days":
      return /^\d{1,3}$/.test(text) && Number(text) <= 365 ? { ok: true, value: Number(text) } : { ok: false };
    default:
      return { ok: false };
  }
}
