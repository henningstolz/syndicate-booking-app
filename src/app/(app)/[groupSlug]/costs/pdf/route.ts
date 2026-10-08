import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGroupBySlug } from "@/lib/groups";
import { LONDON_TZ, londonDateKey } from "@/lib/datetime";
import { type CostStatement } from "@/lib/costs";
import { buildStatementPdf } from "@/lib/statement-pdf";
import { statementPdfInput } from "@/lib/statement-pdf-input";

// A month's cost statement as a printable A4 PDF:
//   /<group>/costs/pdf?month=2026-10                 your own
//   /<group>/costs/pdf?month=2026-10&member=<id>     one member (admins)
//   /<group>/costs/pdf?month=2026-10&member=all      everyone, with a summary page (admins)
// The figures come from cost_statement(), so a closed month prints exactly the
// saved figures, and a member can only ever get their own statement.
export const dynamic = "force-dynamic";

const stampFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupSlug: string }> },
) {
  const { groupSlug } = await params;
  const month = request.nextUrl.searchParams.get("month") ?? "";
  const who = request.nextUrl.searchParams.get("member") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: "Choose a month as YYYY-MM." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Row-level security only returns groups to their members.
  const group = await getGroupBySlug(supabase, groupSlug);
  if (!group) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  const { data: raw } = await supabase.rpc("cost_statement", {
    p_group_id: group.id,
    p_month: `${month}-01`,
  });
  const s = raw as CostStatement | { result: string } | null;
  if (!s || s.result !== "ok") {
    return NextResponse.json({ error: "No statement for that month." }, { status: 404 });
  }
  const statement = s as CostStatement;

  // Who gets a statement. A member only ever gets their own.
  const everyone = who === "all";
  if ((everyone || (who !== "" && who !== user.id)) && !statement.is_admin) {
    return NextResponse.json({ error: "Only admins can print other members' statements." }, { status: 403 });
  }
  const wanted = everyone ? statement.members : statement.members.filter((m) => m.user_id === (who || user.id));
  if (wanted.length === 0) {
    return NextResponse.json({ error: "No statement for that member and month." }, { status: 404 });
  }

  const bytes = await buildStatementPdf(
    statementPdfInput(
      statement,
      wanted,
      {
        groupName: group.name,
        registration: group.aircraft_registration,
        month,
        thisMonth: londonDateKey(new Date()).slice(0, 7),
        printedAt: stampFormat.format(new Date()).replace(" at ", ", "),
      },
      everyone,
    ),
  );

  const who_ = everyone ? "everyone" : wanted[0].name;
  const filename = `${group.aircraft_registration}-statement-${month}-${who_}.pdf`.replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // A private record: never cached by a shared cache.
      "Cache-Control": "private, no-store",
    },
  });
}
