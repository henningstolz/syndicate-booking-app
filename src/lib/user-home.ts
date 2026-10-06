import type { createClient } from "@/lib/supabase/server";

// Where a signed-in person should land: their group's dashboard, or
// /pending when they belong to none.
export async function homePathFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const { data: membership } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId)
    .is("removed_at", null)
    .limit(1)
    .maybeSingle();
  if (!membership) return "/pending";

  const { data: group } = await supabase
    .from("groups")
    .select("slug")
    .eq("id", membership.group_id)
    .single();

  return group ? `/${group.slug}` : "/pending";
}
