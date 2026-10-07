"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LAST_GROUP_COOKIE } from "@/lib/pick-group";
import { GroupSwitcher, type GroupOption } from "./GroupSwitcher";

const NAV_ITEMS = [
  { path: "", label: "Dashboard" },
  { path: "/calendar", label: "Calendar" },
  { path: "/chat", label: "Chat" },
  { path: "/tech-log", label: "Tech log" },
  { path: "/reports", label: "Reports" },
  { path: "/aircraft", label: "Aircraft" },
  { path: "/members", label: "Members" },
  { path: "/settings", label: "Settings" },
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
  groups,
  signOutAction,
  demo = false,
  children,
}: {
  groupSlug: string;
  groupName: string;
  groups: GroupOption[];
  signOutAction: () => void;
  // The invented demo group: show a banner and "Exit demo" instead of "Sign out".
  demo?: boolean;
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);

  // Remember this group so the next sign-in opens it again.
  useEffect(() => {
    const secure = location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${LAST_GROUP_COOKIE}=${groupSlug}; path=/; max-age=31536000; samesite=lax${secure}`;
  }, [groupSlug]);

  return (
    <div className="flex flex-1 flex-col">
      {demo && (
        <div
          role="note"
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900"
        >
          <p>
            <strong className="font-semibold">Demo.</strong> Made-up data. What
            you change here stays in your browser and isn&apos;t saved.
          </p>
          <p className="flex gap-4">
            <Link href="/demo/reset" prefetch={false} className="underline underline-offset-4">
              Reset demo
            </Link>
            <Link href="/login" className="font-semibold underline underline-offset-4">
              Create your group
            </Link>
          </p>
        </div>
      )}
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
          <GroupSwitcher
            groups={groups}
            currentSlug={groupSlug}
            currentName={groupName}
          />
        </div>
        {demo ? (
          <Link
            href="/"
            className="flex min-h-9 items-center rounded-full border border-zinc-300 px-3.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
          >
            Exit demo
          </Link>
        ) : (
          <form action={signOutAction}>
            <button
              type="submit"
              className="flex min-h-9 items-center rounded-full border border-zinc-300 px-3.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
            >
              Sign out
            </button>
          </form>
        )}
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
