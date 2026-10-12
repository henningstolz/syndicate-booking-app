"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { initialsOf } from "@/lib/initials";

// The round button at the top right, showing the person's initials. It opens a
// small menu: their account (name, emails, calendar link, phone), the group's
// settings (admins only) and sign out. In the demo, "Exit demo" replaces sign out.
export function UserMenu({
  groupSlug,
  name,
  email,
  isAdmin,
  demo,
  signOutAction,
}: {
  groupSlug: string;
  name: string | null;
  email: string | null;
  isAdmin: boolean;
  demo: boolean;
  signOutAction: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

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

  const accountHref = `/${groupSlug}/account`;
  const settingsHref = `/${groupSlug}/settings`;
  const onAccount = pathname === accountHref;
  const onSettings = pathname === settingsHref;
  const initials = initialsOf(name, email);

  const item = (active: boolean) =>
    `block rounded-md px-3 py-2 text-sm ${active ? "bg-zinc-100 text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"}`;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account menu for ${name ?? email ?? "you"}`}
        className={`flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${
          onAccount || onSettings ? "ring-2 ring-zinc-300 ring-offset-2" : ""
        }`}
      >
        {initials}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-64 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg"
        >
          <div className="border-b border-zinc-100 px-3 py-2">
            <p className="truncate text-sm font-medium text-zinc-900">{name ?? "You"}</p>
            {email && <p className="truncate text-xs text-zinc-500">{email}</p>}
          </div>
          <div className="py-1">
            <Link
              href={accountHref}
              role="menuitem"
              onClick={() => setOpen(false)}
              aria-current={onAccount ? "page" : undefined}
              className={item(onAccount)}
            >
              Account
              <span className="block text-xs font-normal text-zinc-500">Your name, emails and calendar link</span>
            </Link>
            {isAdmin && (
              <Link
                href={settingsHref}
                role="menuitem"
                onClick={() => setOpen(false)}
                aria-current={onSettings ? "page" : undefined}
                className={item(onSettings)}
              >
                Settings
                <span className="block text-xs font-normal text-zinc-500">The group: members, invites, details</span>
              </Link>
            )}
          </div>
          <div className="border-t border-zinc-100 pt-1">
            {demo ? (
              <Link href="/" role="menuitem" className={item(false)}>
                Exit demo
              </Link>
            ) : (
              <form action={signOutAction}>
                <button type="submit" role="menuitem" className={`${item(false)} w-full text-left`}>
                  Sign out
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
