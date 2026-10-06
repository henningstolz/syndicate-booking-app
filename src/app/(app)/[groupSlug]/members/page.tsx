import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getGroupBySlug } from "@/lib/groups";
import { memberColor } from "@/lib/member-colors";

type MemberRow = {
  user_id: string;
  display_name: string | null;
  role: string;
  removed_at: string | null;
};

export default async function MembersPage({
  params,
}: {
  params: Promise<{ groupSlug: string }>;
}) {
  const { groupSlug } = await params;
  const supabase = await createClient();

  const group = await getGroupBySlug(supabase, groupSlug);
  if (!group) {
    // The layout already redirects before we get here.
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: members } = await supabase
    .from("group_members")
    .select("user_id, display_name, role, removed_at")
    .eq("group_id", group.id)
    .order("created_at")
    .returns<MemberRow[]>();

  // Colours follow a member's position among everyone ever in the group
  // (removed members included), so they match the calendar and tech log.
  const everyone = members ?? [];
  const active = everyone
    .map((member, index) => ({ member, index }))
    .filter(({ member }) => !member.removed_at);
  const isAdmin = active.some(
    ({ member }) => member.user_id === user?.id && member.role === "admin",
  );

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500">Members</h2>
        {active.map(({ member, index }) => (
          <div
            key={member.user_id}
            className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${memberColor(index).dot}`}
              />
              <span className="text-sm text-zinc-900">
                {member.display_name ?? "Member"}
              </span>
            </div>
            <span className="text-xs font-medium text-zinc-500 uppercase">
              {member.role}
            </span>
          </div>
        ))}
      </section>

      {isAdmin && (
        <p className="text-sm text-zinc-600">
          To invite people, change roles or remove someone, go to{" "}
          <Link
            href={`/${groupSlug}/settings`}
            className="text-zinc-900 underline underline-offset-4"
          >
            Settings
          </Link>
          .
        </p>
      )}
    </main>
  );
}
