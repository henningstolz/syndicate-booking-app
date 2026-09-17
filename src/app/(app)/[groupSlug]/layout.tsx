import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGroupBySlug } from "@/lib/groups";
import { signOut } from "@/app/login/actions";

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
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <span className="font-mono text-sm text-zinc-500">{group.name}</span>
        <form action={signOut}>
          <button
            type="submit"
            className="text-sm text-zinc-500 underline underline-offset-4"
          >
            Sign out
          </button>
        </form>
      </header>
      {children}
    </div>
  );
}
