"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LAST_GROUP_COOKIE } from "@/lib/pick-group";
import { BrandMark } from "@/components/BrandMark";
import { GroupSwitcher, type GroupOption } from "./GroupSwitcher";
import { UserMenu } from "./UserMenu";

const NAV_ITEMS = [
  { path: "", label: "Dashboard" },
  { path: "/calendar", label: "Calendar" },
  { path: "/chat", label: "Chat" },
  { path: "/tech-log", label: "Tech log" },
  { path: "/costs", label: "Costs" },
  { path: "/reports", label: "Reports" },
  { path: "/aircraft", label: "Aircraft" },
  { path: "/documents", label: "Documents" },
  { path: "/members", label: "Members" },
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
  user,
  demo = false,
  children,
}: {
  groupSlug: string;
  groupName: string;
  groups: GroupOption[];
  signOutAction: () => void;
  // Who is signed in, for the round account button and its menu.
  user: { name: string | null; email: string | null; isAdmin: boolean };
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
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 pt-[calc(env(safe-area-inset-top)+8px)] pb-2 text-xs text-amber-900"
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
      {/* From the home screen the page runs under the phone's status bar, so the header
          starts below it (the safe-area padding) and stays put while the page scrolls:
          content never slides up into the faded strip at the top. In a browser tab it
          is an ordinary header. */}
      <header className="standalone:sticky standalone:top-0 standalone:z-30 flex items-center justify-between border-b border-zinc-200 bg-white px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
            className="text-xl text-zinc-500 md:hidden"
          >
            ☰
          </button>
          <Link
            href={`/${groupSlug}`}
            aria-label="Blocktime home"
            className="shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
          >
            <BrandMark size={28} />
          </Link>
          <GroupSwitcher
            groups={groups}
            currentSlug={groupSlug}
            currentName={groupName}
          />
        </div>
        <UserMenu
          groupSlug={groupSlug}
          name={user.name}
          email={user.email}
          isAdmin={user.isAdmin}
          demo={demo}
          signOutAction={signOutAction}
        />
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
