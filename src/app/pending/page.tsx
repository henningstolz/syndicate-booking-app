import { signOut } from "@/app/login/actions";

export default function PendingPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
        You&apos;re signed in
      </h1>
      <p className="max-w-xs text-sm text-zinc-600">
        Your account isn&apos;t linked to a group yet — ask Henning to add
        you.
      </p>
      <form action={signOut}>
        <button
          type="submit"
          className="text-sm text-zinc-500 underline underline-offset-4"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
