import Link from "next/link";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
        Reset your password
      </h1>
      <p className="max-w-xs text-center text-sm text-zinc-600">
        Enter the email address you signed up with and we will send you a link
        to choose a new password.
      </p>

      <ForgotPasswordForm expired={error === "expired"} />

      <Link
        href="/login"
        className="text-sm text-zinc-500 underline underline-offset-4"
      >
        Back to sign in
      </Link>
    </main>
  );
}
