import { cookies } from "next/headers";
import type { createClient } from "@/lib/supabase/server";
import { LAST_GROUP_COOKIE, pickGroupSlug } from "@/lib/pick-group";

type MembershipRow = { groups: { slug: string } | null };

// Where a signed-in person should land: the dashboard of the group they used
// last (or their oldest group), or /pending when they belong to none.
export async function homePathFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const { data } = await supabase
    .from("group_members")
    .select("groups(slug)")
    .eq("user_id", userId)
    .is("removed_at", null)
    .order("created_at")
    .returns<MembershipRow[]>();

  const slugs = (data ?? []).flatMap((row) => (row.groups ? [row.groups.slug] : []));
  const lastUsed = (await cookies()).get(LAST_GROUP_COOKIE)?.value;
  const slug = pickGroupSlug(slugs, lastUsed);

  return slug ? `/${slug}` : "/pending";
}
