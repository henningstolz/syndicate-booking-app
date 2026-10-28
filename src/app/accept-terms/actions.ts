"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { recordAcceptance } from "@/lib/legal-server";
import { legalDocsLive } from "@/lib/legal";
import { safeNextPath } from "@/lib/safe-next-path";

export type AcceptState = { error?: string };

export async function acceptTerms(_prev: AcceptState, formData: FormData): Promise<AcceptState> {
  if (!legalDocsLive()) redirect("/");
  if (formData.get("acceptTerms") !== "on") return { error: "Please tick the box to continue." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!(await recordAcceptance(supabase, user.id, null))) {
    return { error: "Something went wrong. Please try again." };
  }
  redirect(safeNextPath(String(formData.get("next") ?? "")));
}
