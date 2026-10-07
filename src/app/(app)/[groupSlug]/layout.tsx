import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGroupBySlug } from "@/lib/groups";
import { homePathFor } from "@/lib/user-home";
import { isDemoRequest } from "@/lib/demo/mode";
import { signOut } from "@/app/login/actions";
import { AppShell } from "./AppShell";
import type { GroupOption } from "./GroupSwitcher";

// This is a live shared booking system — every page under a group
// must always reflect the current database state. Without this,
// Next.js's data cache can serve a stale render of a page (dashboard,
// calendar, reports) even right after revalidatePath() runs from a
// different route segment's server action.
export const dynamic = "force-dynamic";

// The demo is invented content: keep it out of search engines.
export async function generateMetadata(): Promise<Metadata> {
  return (await isDemoRequest())
    ? { robots: { index: false, follow: false } }
    : {};
}

export default async function GroupLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ groupSlug: string }>;
}) {
  const { groupSlug } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // RLS on `groups` only returns a row if the signed-in user belongs to
  // it, so a null result here covers both "no such group" and "signed
  // in but not a member of this one" — either way, send them onward.
  const [group, { data: groups }] = await Promise.all([
    getGroupBySlug(supabase, groupSlug),
    // Row-level security returns only the groups this person belongs to.
    supabase
      .from("groups")
      .select("slug, name, aircraft_registration")
      .order("name")
      .returns<GroupOption[]>(),
  ]);

  if (!group) {
    // Not (or no longer) in this group: open another of theirs if they
    // have one, otherwise the "no group yet" page.
    redirect(await homePathFor(supabase, user.id));
  }

  return (
    <AppShell
      demo={await isDemoRequest()}
      groupSlug={groupSlug}
      groupName={group.name}
      groups={groups ?? []}
      signOutAction={signOut}
    >
      {children}
    </AppShell>
  );
}
