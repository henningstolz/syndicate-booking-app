import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./ResetPasswordForm";

// Reached from the reset email (the link signs the person in first) or from
// "Change password" in Settings. Without a signed-in session there is
// nothing to change, so send them to request a link.
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/forgot-password?error=expired");
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
        Choose a new password
      </h1>
      <p className="max-w-xs text-center text-sm text-zinc-600">
        For {user.email}. You will stay signed in here and be signed out
        everywhere else.
      </p>
      <ResetPasswordForm />
    </main>
  );
}
