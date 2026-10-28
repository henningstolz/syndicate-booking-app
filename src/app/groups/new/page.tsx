import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { legalDocsLive } from "@/lib/legal";
import { ensureTermsAccepted } from "@/lib/legal-server";
import { CreateGroupForm } from "./CreateGroupForm";

export default async function NewGroupPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  await ensureTermsAccepted(supabase, user, "/groups/new");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
        Create a group
      </h1>
      <p className="max-w-sm text-center text-sm text-zinc-600">
        Set up a new syndicate — you&apos;ll be its admin, and can invite
        others once it&apos;s created.
      </p>
      <CreateGroupForm requireTerms={legalDocsLive()} />
    </main>
  );
}
