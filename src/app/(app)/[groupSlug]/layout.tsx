import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGroupBySlug } from "@/lib/groups";
import { signOut } from "@/app/login/actions";
import { AppShell } from "./AppShell";

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
  const group = await getGroupBySlug(supabase, groupSlug);

  if (!group) {
    redirect("/pending");
  }

  return (
    <AppShell groupSlug={groupSlug} groupName={group.name} signOutAction={signOut}>
      {children}
    </AppShell>
  );
}
