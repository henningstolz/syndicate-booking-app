import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <p className="font-mono text-sm tracking-wide text-zinc-500 uppercase">
        G-BBFD · PA28R Arrow II · EGLM
      </p>
      <h1 className="max-w-md text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
        The syndicate booking board
      </h1>
      <p className="max-w-sm text-base text-zinc-600">
        A shared calendar and squawk log for the group — built for a phone in
        one hand at the airfield.
      </p>
      <Link
        href="/login"
        className="mt-2 rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
      >
        Sign in
      </Link>
    </main>
  );
}
