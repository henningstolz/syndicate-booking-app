import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { legalDocsLive, hasAcceptedCurrent, PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal";
import { safeNextPath } from "@/lib/safe-next-path";
import { signOut } from "@/app/login/actions";
import { AcceptForm } from "./AcceptForm";

// Shown once to a signed-in person who has not yet accepted the current terms and privacy text (everyone
// is asked again whenever a version in src/lib/legal.ts changes). Exists only where the legal switch is on.
export const dynamic = "force-dynamic";

export default async function AcceptTermsPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (!legalDocsLive()) notFound();
  const next = safeNextPath((await searchParams).next ?? "");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("terms_acceptances")
    .select("document, version")
    .eq("user_id", user.id)
    .in("version", [TERMS_VERSION, PRIVACY_VERSION]);
  if (hasAcceptedCurrent(data ?? [])) redirect(next);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Before you continue</h1>
      <p className="max-w-sm text-center text-sm text-zinc-600">
        We have written down the terms of using Blocktime and what we do with your data. Please read them and accept to carry on.
      </p>
      <AcceptForm next={next} />
      <form action={signOut}>
        <button type="submit" className="text-sm text-zinc-500 underline underline-offset-4">Sign out</button>
      </form>
    </main>
  );
}
