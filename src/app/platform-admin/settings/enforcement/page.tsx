import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { adminState } from "@/lib/platform-admin/guard";
import { parseAdminGroups, wouldBeReadOnly } from "@/lib/platform-admin/groups";
import { enableEnforcement } from "../../settings-actions";
import { noticeFor } from "../../notices";

// The confirmation step before billing enforcement is switched on.
export default async function EnforcementPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const supabase = await createClient();
  if ((await adminState(supabase)) !== "ok") notFound();
  const { notice: code } = await searchParams;
  const notice = noticeFor(code, undefined);

  const [{ data: groupsAnswer }, { data: settingsAnswer }] = await Promise.all([
    supabase.rpc("admin_list_groups"),
    supabase.rpc("get_platform_settings"),
  ]);
  const groups = parseAdminGroups(groupsAnswer) ?? [];
  const grace = (settingsAnswer as { settings?: { grace_period_days?: unknown } } | null)?.settings?.grace_period_days;
  const graceDays = typeof grace === "number" ? grace : 14;
  const affected = wouldBeReadOnly(groups, graceDays, new Date());

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <Link href="/platform-admin#settings" className="text-sm text-zinc-600 underline underline-offset-4">← Back</Link>
      <h1 className="text-xl font-semibold">Switch billing enforcement on?</h1>
      {notice && <p role="status" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{notice.text}</p>}

      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <h2 className="font-medium">What will happen</h2>
        <ul className="mt-2 list-disc pl-5 text-zinc-700">
          <li>
            Right now, <strong>{affected.length}</strong> of {groups.length} groups would become read-only
            {affected.length > 0 ? ": " : "."}
            {affected.map((g) => g.name).join(", ")}
          </li>
          <li>Read-only means: they can still look at everything, sign in, cancel their own bookings and settle costs, but cannot create bookings, post in the chat, log flights, add expenses or invite people.</li>
          <li>Complimentary groups, founding groups with a price lock that has not ended, and groups with status “none” are never limited.</li>
          <li>A grace period of {graceDays} days applies after a trial or paid-until date.</li>
        </ul>
      </section>

      <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <h2 className="font-medium">Not yet fully protected</h2>
        <p className="mt-1">
          The block is applied by the app&apos;s server for five actions. It is <strong>not yet enforced inside the database</strong>, so a
          technical member could still write by other routes. See docs/entitlements.md. There is also no read-only notice in the app
          yet, so affected members would only see the message when they try to write. Switch this on only if that is acceptable.
        </p>
      </section>

      <form action={enableEnforcement} className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
        <label className="flex flex-col gap-1 text-sm">
          Reason (goes into the history)
          <input name="reason" required minLength={3} maxLength={500} className="rounded-md border border-zinc-300 px-2 py-1.5" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Type ENABLE to confirm
          <input name="confirm" required autoComplete="off" className="rounded-md border border-zinc-300 px-2 py-1.5 font-mono" />
        </label>
        <button type="submit" className="self-start rounded-full bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700">Switch enforcement on</button>
      </form>
    </div>
  );
}
