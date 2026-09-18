import { createClient } from "@/lib/supabase/server";
import { getGroupBySlug } from "@/lib/groups";
import { memberColor } from "@/lib/member-colors";
import { LONDON_TZ } from "@/lib/datetime";
import { PostForm } from "./PostForm";

type MemberRow = { user_id: string; display_name: string | null };

type SquawkRow = {
  id: string;
  author_id: string;
  message: string;
  created_at: string;
};

const timestampFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TZ,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export default async function SquawksPage({
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

  const [{ data: members }, { data: squawks }] = await Promise.all([
    supabase
      .from("group_members")
      .select("user_id, display_name")
      .eq("group_id", group.id)
      .order("created_at")
      .returns<MemberRow[]>(),
    supabase
      .from("squawks")
      .select("id, author_id, message, created_at")
      .eq("group_id", group.id)
      .order("created_at", { ascending: false })
      .returns<SquawkRow[]>(),
  ]);

  const memberList = members ?? [];
  const memberIndex = new Map(memberList.map((m, i) => [m.user_id, i]));
  const memberName = (userId: string) =>
    memberList.find((m) => m.user_id === userId)?.display_name ?? "Member";

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 py-6">
      <PostForm groupId={group.id} groupSlug={groupSlug} />

      <div className="flex flex-col gap-2">
        {!squawks || squawks.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing posted yet.</p>
        ) : (
          squawks.map((squawk) => {
            const colorIndex = memberIndex.get(squawk.author_id) ?? 0;
            return (
              <div
                key={squawk.id}
                className={`flex flex-col gap-1 rounded-lg border-l-4 bg-white px-3 py-2 shadow-sm ${memberColor(colorIndex).border}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-zinc-900">
                    {memberName(squawk.author_id)}
                  </span>
                  <span className="font-mono text-xs text-zinc-400">
                    {timestampFormat.format(new Date(squawk.created_at))}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap text-zinc-700">
                  {squawk.message}
                </p>
              </div>
            );
          })
        )}
      </div>
    </main>
  );
}
