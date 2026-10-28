import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isDemoRequest } from "@/lib/demo/mode";
import { buildExportFiles, zipFiles, type ExportData } from "@/lib/export/build-export";
import { fetchAll } from "@/lib/export/fetch-all";

// A group admin downloads their group's data as a ZIP of CSV files. It runs as the admin (their own
// session), so the database's row-level security still limits every table to this group, and it first
// asks the database whether this person may export now (admins of the group only, at most 5 an hour),
// which also writes the log entry. See docs/architecture.md and docs/runbook-group-deletion.md.
export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

export async function POST(request: NextRequest, { params }: { params: Promise<{ groupSlug: string }> }) {
  const { groupSlug } = await params;
  const back = (notice: string) => NextResponse.redirect(new URL(`/${groupSlug}/settings?notice=${notice}`, request.url), 303);

  if (await isDemoRequest()) return back("demo");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url), 303);

  const { data: group } = await supabase.from("groups").select("*").eq("slug", groupSlug).maybeSingle<Row>();
  if (!group) return NextResponse.redirect(new URL("/", request.url), 303);

  const { data: logged } = await supabase.rpc("log_group_export", { p_group_id: group.id });
  const result = (logged as { result?: string } | null)?.result;
  if (result === "rate_limited") return back("export_limited");
  if (result !== "ok") return back("not_allowed");

  try {
    // Paged and in a fixed order (the id breaks ties), so no row is skipped or repeated between pages.
    const rows = (table: string, columns: string, orderBy = "created_at") =>
      fetchAll<Row>((from, to) =>
        supabase.from(table).select(columns).eq("group_id", group.id).order(orderBy).order("id").range(from, to).returns<Row[]>(),
      );
    const [members, bookings, flights, chat, rates, expenses, payments, closures, documents] = await Promise.all([
      rows("group_members", "id, user_id, display_name, role, created_at, removed_at"),
      rows("bookings", "*"),
      rows("flight_entries", "*"),
      rows("squawks", "id, author_id, message, created_at"),
      rows("cost_rates", "*"),
      rows("cost_expenses", "*"),
      rows("cost_payments", "*"),
      rows("cost_month_closures", "*", "closed_at"),
      rows("documents", "id, title, category, file_name, content_type, size_bytes, uploaded_by, created_at"),
    ]);

    const now = new Date();
    const data: ExportData = { generatedAt: now.toISOString(), group, members, bookings, flights, chat, rates, expenses, payments, closures, documents };
    const zip = zipFiles(buildExportFiles(data), now);
    const day = now.toISOString().slice(0, 10);
    return new Response(zip as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="blocktime-${groupSlug}-${day}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return back("export_failed");
  }
}
