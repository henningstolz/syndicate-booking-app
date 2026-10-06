"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export type GroupOption = {
  slug: string;
  name: string;
  aircraft_registration: string;
};

// The group name in the header. With more than one group it opens a small
// menu to jump between them (and to start another).
export function GroupSwitcher({
  groups,
  currentSlug,
  currentName,
}: {
  groups: GroupOption[];
  currentSlug: string;
  currentName: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  if (groups.length < 2) {
    return <span className="font-mono text-sm text-zinc-500">{currentName}</span>;
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="true"
        className="flex min-h-9 items-center gap-1.5 rounded-md px-2 py-1 font-mono text-sm text-zinc-700 hover:bg-zinc-100"
      >
        {currentName}
        <span aria-hidden="true" className="text-xs text-zinc-400">
          ▾
        </span>
      </button>

      {open && (
        <div className="absolute left-0 z-40 mt-1 w-64 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
          <p className="px-3 py-1.5 text-xs text-zinc-500">Your groups</p>
          {groups.map((group) => {
            const current = group.slug === currentSlug;
            return (
              <Link
                key={group.slug}
                href={`/${group.slug}`}
                onClick={() => setOpen(false)}
                aria-current={current ? "true" : undefined}
                className={`flex items-baseline justify-between gap-3 rounded-md px-3 py-2 text-sm ${
                  current
                    ? "bg-zinc-100 text-zinc-900"
                    : "text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                <span className="truncate">{group.name}</span>
                <span className="shrink-0 font-mono text-xs text-zinc-500">
                  {group.aircraft_registration}
                </span>
              </Link>
            );
          })}
          <div className="mt-1 border-t border-zinc-100 pt-1">
            <Link
              href="/groups/new"
              onClick={() => setOpen(false)}
              className="block rounded-md px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
            >
              + Start another group
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
