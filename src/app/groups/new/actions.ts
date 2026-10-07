"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { groupSlugFromName } from "@/lib/slugify";

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
  //
  // The id is generated here (rather than left to the DB default and
  // read back via .select()) because asking for the row back would
  // add a RETURNING clause, which Postgres also checks against the
  // groups SELECT policy (is_group_member) — and at this exact
  // moment the user isn't a member of the group yet, so that would
  // fail even though the insert itself is allowed.
  const baseSlug = groupSlugFromName(name);
  let groupId: string | null = null;
  let finalSlug = baseSlug;

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const candidateSlug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    const candidateId = randomUUID();
    const { error } = await supabase.from("groups").insert({
      id: candidateId,
      slug: candidateSlug,
      name,
      aircraft_registration: aircraftRegistration,
      aircraft_type: aircraftType,
      home_base: homeBase,
    });

    if (!error) {
      groupId = candidateId;
      finalSlug = candidateSlug;
      break;
    }

    if (error.code !== "23505") {
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
