"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { path: "", label: "Dashboard" },
  { path: "/calendar", label: "Calendar" },
  { path: "/squawks", label: "Squawks" },
  { path: "/reports", label: "Reports" },
];

function NavLinks({
  groupSlug,
  onNavigate,
}: {
  groupSlug: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      {NAV_ITEMS.map((item) => {
        const href = `/${groupSlug}${item.path}`;
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={`rounded-lg px-3 py-2 text-sm ${
              active
                ? "bg-zinc-900 text-white"
                : "text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

export function AppShell({
  groupSlug,
  groupName,
  signOutAction,
  children,
}: {
  groupSlug: string;
  groupName: string;
  signOutAction: () => void;
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
            className="text-xl text-zinc-500 md:hidden"
          >
            ☰
          </button>
          <span className="font-mono text-sm text-zinc-500">{groupName}</span>
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-sm text-zinc-500 underline underline-offset-4"
          >
            Sign out
          </button>
        </form>
      </header>

      <div className="flex flex-1">
        <nav className="hidden w-44 shrink-0 flex-col gap-1 border-r border-zinc-200 p-4 md:flex">
          <NavLinks groupSlug={groupSlug} />
        </nav>

        {navOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <nav className="flex w-56 flex-col gap-1 bg-white p-4 shadow-lg">
              <NavLinks
                groupSlug={groupSlug}
                onNavigate={() => setNavOpen(false)}
              />
            </nav>
            <div
              className="flex-1 bg-black/30"
              onClick={() => setNavOpen(false)}
            />
          </div>
        )}

        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
