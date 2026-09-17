export default async function GroupDashboardPage({
  params,
}: {
  params: Promise<{ groupSlug: string }>;
}) {
  const { groupSlug } = await params;

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
        {groupSlug} — booking calendar
      </h1>
      <p className="text-sm text-zinc-600">
        Placeholder: the shared calendar and squawk log land here once
        Supabase auth and the group/booking tables are wired up.
      </p>
    </main>
  );
}
