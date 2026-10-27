import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { adminState } from "@/lib/platform-admin/guard";
import { signOut } from "@/app/login/actions";
import { homePathFor } from "@/lib/user-home";

// The platform owner's page. Everyone who is not a platform admin (signed out, an ordinary member,
// a group admin) gets the plain 404 page, with no hint that this page exists. There is no link to
// it anywhere in the app. See docs/platform-admin.md.
export const dynamic = "force-dynamic";

// No page title or other metadata is set here on purpose: it would also be sent with the 404 page
// that everyone else sees, and give the page away. (Next.js marks a 404 as noindex by itself.)

export default async function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const state = await adminState(supabase);
  if (state === "not_admin") notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const home = user ? await homePathFor(supabase, user.id) : "/";

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/platform-admin" className="font-mono text-sm font-semibold">
            blocktime · platform admin
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href={home} className="text-zinc-600 underline underline-offset-4">
              Back to the app
            </Link>
            <form action={signOut}>
              <button type="submit" className="text-zinc-600 underline underline-offset-4">
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
