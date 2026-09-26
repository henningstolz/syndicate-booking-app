"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/slugify";

export type CreateGroupState = { error?: string };

const MAX_SLUG_ATTEMPTS = 20;

export async function createGroup(
  _prevState: CreateGroupState,
  formData: FormData,
): Promise<CreateGroupState> {
  const name = (formData.get("name") as string)?.trim();
  const aircraftRegistration = (
    formData.get("aircraftRegistration") as string
  )?.trim();
  const aircraftType = (formData.get("aircraftType") as string)?.trim() || null;
  const homeBase = (formData.get("homeBase") as string)?.trim() || null;
  const displayName = (formData.get("displayName") as string)?.trim();

  if (!name || !aircraftRegistration || !displayName) {
    return { error: "Please fill in the required fields." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // groups.slug is unique, and a non-member can't SELECT other groups
  // to pre-check availability (RLS hides them), so we just attempt
  // the insert and retry with a suffix on a collision instead of
  // trying to check-then-insert.
  const baseSlug = slugify(name);
  let groupId: string | null = null;
  let finalSlug = baseSlug;

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const candidateSlug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    const { data, error } = await supabase
      .from("groups")
      .insert({
        slug: candidateSlug,
        name,
        aircraft_registration: aircraftRegistration,
        aircraft_type: aircraftType,
        home_base: homeBase,
      })
      .select("id")
      .single();

    if (!error && data) {
      groupId = data.id;
      finalSlug = candidateSlug;
      break;
    }

    if (error && error.code !== "23505") {
      return { error: error.message };
    }
    // 23505 = slug already taken — loop and try the next suffix.
  }

  if (!groupId) {
    return { error: "Could not create a unique group. Try a different name." };
  }

  const { error: memberError } = await supabase.from("group_members").insert({
    group_id: groupId,
    user_id: user.id,
    role: "admin",
    display_name: displayName,
  });

  if (memberError) {
    return { error: memberError.message };
  }

  redirect(`/${finalSlug}`);
}
