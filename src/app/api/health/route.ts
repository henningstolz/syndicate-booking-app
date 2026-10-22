import { createClient } from "@supabase/supabase-js";

// For the uptime monitor: 200 {"ok":true} when the app can reach the database,
// 503 {"ok":false} when it cannot. It says nothing else: no version, no details, no
// data. The question put to the database is one that is public anyway and answers
// "nothing" (the calendar function asked about a link that cannot exist), so no data is
// read and no new database object is needed.
export const dynamic = "force-dynamic";

const HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
};

async function databaseAnswers(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await supabase.rpc("calendar_feed", { p_token: "0".repeat(64) }).abortSignal(AbortSignal.timeout(4000));
    return !error;
  } catch {
    return false;
  }
}

async function answer(): Promise<Response> {
  const ok = await databaseAnswers();
  return new Response(JSON.stringify({ ok }), { status: ok ? 200 : 503, headers: HEADERS });
}

export const GET = answer;

// Some monitors ask with HEAD: same status, no body.
export async function HEAD(): Promise<Response> {
  const ok = await databaseAnswers();
  return new Response(null, { status: ok ? 200 : 503, headers: HEADERS });
}
