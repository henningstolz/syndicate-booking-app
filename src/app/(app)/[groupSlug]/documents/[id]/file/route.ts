import { type NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createClient } from "@/lib/supabase/server";
import { isDemoRequest } from "@/lib/demo/mode";
import { opensInBrowser } from "@/lib/documents";

// Opens or downloads a document: /<group>/documents/<id>/file. The database only shows
// a document to members of its group, and only then is a link made: a signed link to
// the file that stops working after five minutes. The file itself never passes
// through our server.
export const dynamic = "force-dynamic";

const NOT_FOUND = () => NextResponse.json({ error: "That document was not found, or it was deleted." }, { status: 404 });

export async function GET(request: NextRequest, { params }: { params: Promise<{ groupSlug: string; id: string }> }) {
  const { id } = await params;
  // Real ids are UUIDs (the demo has short ones); anything else cannot exist.
  if (!/^[A-Za-z0-9-]{1,40}$/.test(id)) return NOT_FOUND();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  // Row-level security: members of the group only, and not deleted ones.
  const { data: doc } = await supabase
    .from("documents")
    .select("title, file_name, content_type, storage_path")
    .eq("id", id)
    .maybeSingle<{ title: string; file_name: string; content_type: string; storage_path: string }>();
  if (!doc) return NOT_FOUND();

  // The demo has no file store: it hands out a one-page sample.
  if (await isDemoRequest()) {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText("Sample document (demo)", { x: 60, y: 760, size: 20, font, color: rgb(0.09, 0.13, 0.15) });
    page.drawText(doc.title.slice(0, 80), { x: 60, y: 730, size: 12, font, color: rgb(0.3, 0.33, 0.31) });
    page.drawText("In the demo no files are stored. In a real group this is the file someone uploaded.", { x: 60, y: 700, size: 10, font, color: rgb(0.3, 0.33, 0.31) });
    return new Response(Buffer.from(await pdf.save()), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="sample.pdf"`, "Cache-Control": "private, no-store" },
    });
  }

  // Photos and PDFs open in the browser; everything else downloads under its own name.
  const download = !opensInBrowser(doc.content_type) || request.nextUrl.searchParams.get("download") === "1";
  const { data: signed, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(doc.storage_path, 300, download ? { download: doc.file_name } : undefined);
  if (error || !signed?.signedUrl) return NOT_FOUND();

  const response = NextResponse.redirect(signed.signedUrl);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
