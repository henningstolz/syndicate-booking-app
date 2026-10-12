import type { SupabaseClient } from "@supabase/supabase-js";

// Links straight to files in the file store. They point at the store's own address, not
// at ours: in the app installed on a phone's home screen, a link to another address opens
// in the phone's small in-app browser with a Done button, so there is always a way back
// to the app (a link through our own address would take over the whole screen).
// The links expire after an hour, so they are made when the page is built.
export async function directFileLinks(
  supabase: SupabaseClient,
  paths: string[],
): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  if (paths.length === 0) return links;
  const { data } = await supabase.storage.from("documents").createSignedUrls(paths, 3600);
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl && !entry.error) links.set(entry.path, entry.signedUrl);
  }
  return links;
}
