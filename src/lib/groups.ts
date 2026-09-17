import type { createClient } from "@/lib/supabase/server";

export async function getGroupBySlug(
  supabase: Awaited<ReturnType<typeof createClient>>,
  slug: string,
) {
  const { data } = await supabase
    .from("groups")
    .select("id, name, aircraft_registration, aircraft_type, home_base")
    .eq("slug", slug)
    .maybeSingle();

  return data;
}
