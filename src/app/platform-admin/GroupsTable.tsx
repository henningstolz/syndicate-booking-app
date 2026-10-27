"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { filterGroups, sortGroups, type AdminGroup, type SortKey } from "@/lib/platform-admin/groups";
import { formatDate, formatMoment } from "@/lib/platform-admin/format";

const control = "rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Group" },
  { key: "members", label: "Members" },
  { key: "plan", label: "Plan" },
  { key: "status", label: "Status" },
  { key: "created", label: "Created" },
  { key: "activity", label: "Last activity" },
  { key: "trial", label: "Trial ends" },
  { key: "paid", label: "Paid until" },
];

const adminLine = (g: AdminGroup) => g.admins.map((a) => [a.name, a.email].filter(Boolean).join(" · ")).join(", ") || "—";

export function GroupsTable({ groups }: { groups: AdminGroup[] }) {
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");

  const rows = useMemo(
    () => sortGroups(filterGroups(groups, { search, plan, status }), sort, direction),
    [groups, search, plan, status, sort, direction],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, admin, reference…"
          aria-label="Search groups"
          className={`${control} min-w-48 flex-1`}
        />
        <select value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Filter by plan" className={control}>
          <option value="">All plans</option>
          <option value="founding">Founding</option>
          <option value="standard">Standard</option>
          <option value="complimentary">Complimentary</option>
          <option value="none">No plan row</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by billing status" className={control}>
          <option value="">All statuses</option>
          <option value="none">None</option>
          <option value="trial">Trial</option>
          <option value="active">Active</option>
          <option value="past_due">Past due</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort by" className={`${control} md:hidden`}>
          {COLUMNS.map((c) => <option key={c.key} value={c.key}>Sort: {c.label}</option>)}
        </select>
        <button type="button" onClick={() => setDirection(direction === "asc" ? "desc" : "asc")} className={`${control} md:hidden`} aria-label="Reverse the order">
          {direction === "asc" ? "↑" : "↓"}
        </button>
      </div>
      <p className="text-xs text-zinc-500">{rows.length} of {groups.length} groups</p>

      {/* Wide screens: a table. */}
      <div className="hidden overflow-x-auto rounded-lg border border-zinc-200 bg-white md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-3 py-2 font-medium">
                  <button
                    type="button"
                    onClick={() => {
                      if (sort === c.key) setDirection(direction === "asc" ? "desc" : "asc");
                      else { setSort(c.key); setDirection("asc"); }
                    }}
                    className="font-medium hover:text-zinc-900"
                  >
                    {c.label}{sort === c.key ? (direction === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
              <th className="px-3 py-2 font-medium">Aircraft</th>
              <th className="px-3 py-2 font-medium">Group admins</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.group_id} className="border-t border-zinc-100 align-top">
                <td className="px-3 py-2">
                  <Link href={`/platform-admin/groups/${g.group_id}`} className="font-medium underline underline-offset-4">{g.name}</Link>
                  <div className="text-xs text-zinc-500">{g.slug}</div>
                </td>
                <td className="px-3 py-2">{g.member_count}</td>
                <td className="px-3 py-2">{g.plan ?? "—"}{g.cohort ? <div className="text-xs text-zinc-500">{g.cohort}</div> : null}</td>
                <td className="px-3 py-2">{g.billing_status ?? "—"}</td>
                <td className="px-3 py-2">{formatMoment(g.created_at)}</td>
                <td className="px-3 py-2">{formatMoment(g.last_activity)}</td>
                <td className="px-3 py-2">{formatMoment(g.trial_ends_at)}</td>
                <td className="px-3 py-2">{formatDate(g.paid_until)}</td>
                <td className="px-3 py-2">{g.aircraft_count}</td>
                <td className="px-3 py-2 text-xs">{adminLine(g)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phones: one card per group. */}
      <ul className="flex flex-col gap-2 md:hidden">
        {rows.map((g) => (
          <li key={g.group_id} className="rounded-lg border border-zinc-200 bg-white p-3 text-sm">
            <Link href={`/platform-admin/groups/${g.group_id}`} className="font-medium underline underline-offset-4">{g.name}</Link>
            <p className="text-xs text-zinc-500">{g.slug} · {g.member_count} members · {g.aircraft_count} aircraft</p>
            <p className="mt-1">{g.plan ?? "no plan"} · {g.billing_status ?? "—"}{g.cohort ? ` · ${g.cohort}` : ""}</p>
            <p className="text-xs text-zinc-500">
              Created {formatMoment(g.created_at)} · active {formatMoment(g.last_activity)}
              {g.trial_ends_at ? ` · trial ends ${formatMoment(g.trial_ends_at)}` : ""}
              {g.paid_until ? ` · paid until ${formatDate(g.paid_until)}` : ""}
            </p>
            <p className="mt-1 text-xs text-zinc-600">{adminLine(g)}</p>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="text-sm text-zinc-500">No group matches.</p>}
    </div>
  );
}
