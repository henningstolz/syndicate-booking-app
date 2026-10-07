import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createDemoClient } from "@/lib/demo/client";
import { isDemoRequest } from "@/lib/demo/mode";

type ServerClient = SupabaseClient;

export async function createClient(): Promise<ServerClient> {
  // Requests under /demo run on invented data and never reach the database
  // (see src/lib/demo).
  if (await isDemoRequest()) {
    return (await createDemoClient()) as unknown as ServerClient;
  }

  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore because
            // middleware refreshes the session on every request anyway.
          }
        },
      },
    },
  );
}
