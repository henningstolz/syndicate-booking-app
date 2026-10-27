import Link from "next/link";
import { disableEnforcement, saveSetting } from "./settings-actions";

const input = "rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900";
const save = "rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700";

export type Settings = {
  billing_enforcement_enabled?: unknown;
  default_plan_new_groups?: unknown;
  default_cohort_new_groups?: unknown;
  paid_beta_cutoff?: unknown;
  grace_period_days?: unknown;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

function Row({ settingKey, label, help, children }: { settingKey: string; label: string; help: string; children: React.ReactNode }) {
  return (
    <form action={saveSetting} className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3">
      <input type="hidden" name="key" value={settingKey} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        {label}
        {children}
      </label>
      <p className="text-xs text-zinc-500">{help}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input name="reason" required minLength={3} maxLength={500} placeholder="Reason (goes into the history)" aria-label={`Reason for changing ${label}`} className={`${input} min-w-48 flex-1`} />
        <button type="submit" className={save}>Save</button>
      </div>
    </form>
  );
}

export function SettingsPanel({ settings }: { settings: Settings }) {
  const enforcementOn = settings.billing_enforcement_enabled === true;
  return (
    <div className="flex flex-col gap-3">
      <div className={`rounded-lg border p-3 ${enforcementOn ? "border-red-300 bg-red-50" : "border-zinc-200 bg-white"}`}>
        <p className="text-sm font-medium">Billing enforcement: {enforcementOn ? "ON" : "off"}</p>
        <p className="mt-1 text-xs text-zinc-600">
          {enforcementOn
            ? "Groups whose trial or payment has lapsed are read-only for the main actions."
            : "No group is limited. Every group can always write."}
        </p>
        {enforcementOn ? (
          <form action={disableEnforcement} className="mt-2 flex flex-wrap items-center gap-2">
            <input name="reason" required minLength={3} maxLength={500} placeholder="Reason for switching off" aria-label="Reason for switching enforcement off" className={`${input} min-w-48 flex-1`} />
            <button type="submit" className={save}>Switch off</button>
          </form>
        ) : (
          <Link href="/platform-admin/settings/enforcement" className="mt-2 inline-block text-sm underline underline-offset-4">
            Switch on…
          </Link>
        )}
      </div>

      <Row settingKey="default_plan_new_groups" label="Plan for new groups" help="What a group created today starts on (before the cut-off date).">
        <select name="value" defaultValue={str(settings.default_plan_new_groups)} className={input}>
          <option value="founding">Founding</option>
          <option value="standard">Standard</option>
          <option value="complimentary">Complimentary</option>
        </select>
      </Row>
      <Row settingKey="default_cohort_new_groups" label="Cohort for new groups" help="A label such as founding-2026, to tell groups apart later.">
        <input name="value" defaultValue={str(settings.default_cohort_new_groups)} maxLength={40} required className={input} />
      </Row>
      <Row settingKey="paid_beta_cutoff" label="Paid-beta cut-off date" help="From this date on, new groups start on the Standard plan. Empty means no cut-off.">
        <input type="date" name="value" defaultValue={str(settings.paid_beta_cutoff)} className={input} />
      </Row>
      <Row settingKey="grace_period_days" label="Grace period (days)" help="How long after a trial or paid-until date a group can still write (when enforcement is on).">
        <input type="number" name="value" min={0} max={365} step={1} defaultValue={typeof settings.grace_period_days === "number" ? settings.grace_period_days : 14} required className={`${input} w-28`} />
      </Row>
    </div>
  );
}
