"use client";

import { useRef, useState } from "react";
import { fetchFile, isStandalone, shareFile } from "@/lib/open-file";

// The "Monthly PDF" form on the tech log page: a month and a button. In a browser it is a
// plain form that opens the PDF; in the app installed on a phone's home screen (where the
// PDF would take over the screen with no way back) the file goes to the share sheet.
export function PdfMonthForm({
  action,
  months,
  defaultMonth,
  registration,
}: {
  action: string;
  months: { key: string; label: string }[];
  defaultMonth: string;
  registration: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "ready">("idle");
  const pending = useRef<{ month: string; file: File } | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!isStandalone()) return; // an ordinary form
    event.preventDefault();
    const month = String(new FormData(event.currentTarget).get("month") ?? defaultMonth);
    const href = `${action}?month=${encodeURIComponent(month)}`;

    if (pending.current?.month === month) {
      const outcome = await shareFile(pending.current.file);
      if (outcome === "unsupported") window.open(href, "_blank");
      setState(outcome === "blocked" ? "ready" : "idle");
      return;
    }
    setState("busy");
    const file = await fetchFile(href, `${registration}-flight-log-${month}.pdf`);
    if (!file) {
      setState("idle");
      window.open(href, "_self");
      return;
    }
    pending.current = { month, file };
    const outcome = await shareFile(file);
    if (outcome === "unsupported") {
      pending.current = null;
      setState("idle");
      window.open(href, "_blank");
      return;
    }
    setState(outcome === "blocked" ? "ready" : "idle");
  }

  return (
    <form method="get" action={action} onSubmit={onSubmit} className="mt-2 flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-zinc-600">
        Month
        <select
          name="month"
          defaultValue={defaultMonth}
          onChange={() => {
            pending.current = null;
            setState("idle");
          }}
          className="rounded-md border border-zinc-300 px-2 py-1.5 text-base text-zinc-900"
        >
          {months.map((month) => (
            <option key={month.key} value={month.key}>
              {month.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={state === "busy"}
        className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-60"
      >
        {state === "busy" ? "Preparing…" : state === "ready" ? "Tap to save or share" : "Download PDF"}
      </button>
      <p className="basis-full text-xs text-zinc-500">A4 landscape, laid out like the paper log, to print for the folder.</p>
    </form>
  );
}
