"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isDemoRequest } from "@/lib/demo/mode";

// Deleting a document: the database hides it (the uploader or an admin may), then the
// server removes the file itself from the store. Ends by redirecting back to the list
// with a short notice code.
export async function deleteDocument(formData: FormData) {
  const groupSlug = String(formData.get("groupSlug") ?? "");
  const id = String(formData.get("documentId") ?? "");
  const back = (notice: string) => redirect(`/${groupSlug}/documents?notice=${notice}`);

  if (await isDemoRequest()) back("demo");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase.rpc("delete_document", { p_id: id });
  const answer = data as { result?: string; path?: string } | null;
  if (error || !answer?.result) back("error");
  if (answer!.result !== "ok") back(answer!.result === "not_allowed" ? "not_allowed" : "not_found");

  // The record is already hidden; removing the file frees the space. If this fails the
  // file is simply left behind (it still counts toward the group's space).
  if (answer!.path) await supabase.storage.from("documents").remove([answer!.path]);
  back("deleted");
}
