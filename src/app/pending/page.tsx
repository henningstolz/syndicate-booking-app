import Link from "next/link";
import { signOut } from "@/app/login/actions";

export default function PendingPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
        You&apos;re signed in
      </h1>
      <p className="max-w-xs text-sm text-zinc-600">
        Your account isn&apos;t linked to a group yet. If someone invited
        you, ask them for the invite link — or start your own group below.
      </p>
      <Link
        href="/groups/new"
        className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
      >
        Create a group
      </Link>
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
