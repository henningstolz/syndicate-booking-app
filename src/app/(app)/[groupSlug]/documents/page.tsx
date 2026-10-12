import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isDemoRequest } from "@/lib/demo/mode";
import { getGroupBySlug } from "@/lib/groups";
import { directFileLinks } from "@/lib/file-links";
import { LONDON_TZ } from "@/lib/datetime";
import { DOCUMENT_CATEGORIES, categoryLabel, formatBytes, typeBadge } from "@/lib/documents";
import { deleteDocument } from "./actions";
import { DocumentUpload } from "./DocumentUpload";

type DocumentRow = {
  id: string;
  title: string;
  category: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_by: string;
  created_at: string;
  storage_path: string;
};

const NOTICES: Record<string, { ok: boolean; text: string }> = {
  deleted: { ok: true, text: "Document deleted." },
  demo: { ok: false, text: "This is a demo, so changes to documents aren't saved." },
  not_allowed: { ok: false, text: "Only the person who uploaded a document, or an admin, can delete it." },
  not_found: { ok: false, text: "That document no longer exists." },
  error: { ok: false, text: "Something went wrong. Please try again." },
};

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: LONDON_TZ });
const sectionTitle = "text-sm font-medium text-zinc-500";
const chip = (active: boolean) =>
  `rounded-full px-3 py-1 text-sm ${active ? "bg-zinc-900 text-white" : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100"}`;

export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupSlug: string }>;
  searchParams: Promise<{ category?: string; notice?: string }>;
}) {
  const { groupSlug } = await params;
  const { category: categoryParam, notice: noticeCode } = await searchParams;
  const supabase = await createClient();

  const group = await getGroupBySlug(supabase, groupSlug);
  if (!group) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const demo = await isDemoRequest();
  const category = DOCUMENT_CATEGORIES.some((c) => c.key === categoryParam) ? categoryParam : undefined;

  const [{ data: rows }, { data: members }] = await Promise.all([
    supabase
      .from("documents")
      .select("id, title, category, file_name, content_type, size_bytes, uploaded_by, created_at, storage_path")
      .eq("group_id", group.id)
      .order("created_at", { ascending: false })
      .returns<DocumentRow[]>(),
    supabase
      .from("group_members")
      .select("user_id, display_name, role")
      .eq("group_id", group.id)
      .returns<{ user_id: string; display_name: string | null; role: string }[]>(),
  ]);

  const all = rows ?? [];
  // Straight links to the files (see lib/file-links.ts); the demo has no file store.
  const direct = demo ? new Map<string, string>() : await directFileLinks(supabase, all.map((d) => d.storage_path));
  const shown = category ? all.filter((d) => d.category === category) : all;
  const nameOf = (userId: string) => members?.find((m) => m.user_id === userId)?.display_name ?? "A member";
  const isAdmin = members?.find((m) => m.user_id === user?.id)?.role === "admin";
  const counts = new Map<string, number>();
  for (const d of all) counts.set(d.category, (counts.get(d.category) ?? 0) + 1);
  const notice = noticeCode ? NOTICES[noticeCode] : undefined;

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-6">
      {notice && (
        <p
          role="status"
          className={`rounded-lg border px-3 py-2 text-sm ${
            notice.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {notice.text}
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h1 className="text-base font-semibold text-zinc-900">Documents</h1>
        <p className="max-w-xl text-sm text-zinc-600">
          Files for the whole group: insurance, manuals, scans, photos. Everyone in {group.name} can see and download
          them. Receipts attached to expenses on the Costs page appear here too.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={sectionTitle}>Add a document</h2>
        <DocumentUpload groupId={group.id} demo={demo} defaultCategory={category ?? "general"} />
      </section>

      <section className="flex flex-col gap-3">
        <nav aria-label="Categories" className="flex flex-wrap gap-2">
          <Link href={`/${groupSlug}/documents`} className={chip(!category)}>
            All ({all.length})
          </Link>
          {DOCUMENT_CATEGORIES.filter((c) => counts.get(c.key)).map((c) => (
            <Link key={c.key} href={`/${groupSlug}/documents?category=${c.key}`} className={chip(category === c.key)}>
              {c.label} ({counts.get(c.key)})
            </Link>
          ))}
        </nav>

        {shown.length === 0 ? (
          <p className="text-sm text-zinc-500">
            {all.length === 0 ? "No documents yet. Add the first one above." : "Nothing in this category."}
          </p>
        ) : (
          <ul className="flex max-w-2xl flex-col gap-2">
            {shown.map((doc) => {
              const canDelete = doc.uploaded_by === user?.id || isAdmin;
              return (
                <li key={doc.id} className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2.5">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-100 font-mono text-[10px] font-medium text-zinc-600">
                      {typeBadge(doc.content_type)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <a
                        href={direct.get(doc.storage_path) ?? `/${groupSlug}/documents/${doc.id}/file`}
                        className="block truncate text-sm font-medium text-zinc-900 underline-offset-4 hover:underline"
                      >
                        {doc.title}
                      </a>
                      <p className="text-xs text-zinc-500">
                        {categoryLabel(doc.category)} · {nameOf(doc.uploaded_by)} · {dateFormat.format(new Date(doc.created_at))} ·{" "}
                        {formatBytes(doc.size_bytes)}
                      </p>
                    </div>
                    <a
                      href={`/${groupSlug}/documents/${doc.id}/file?download=1`}
                      className="shrink-0 rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                    >
                      Download
                    </a>
                  </div>
                  {canDelete && (
                    <details className="text-xs text-zinc-600">
                      <summary className="w-fit text-zinc-500 underline underline-offset-4">Delete</summary>
                      <form action={deleteDocument} className="mt-2 flex flex-wrap items-center gap-2">
                        <input type="hidden" name="groupSlug" value={groupSlug} />
                        <input type="hidden" name="documentId" value={doc.id} />
                        <span>Delete &ldquo;{doc.title}&rdquo; for everyone?</span>
                        <button
                          type="submit"
                          className="rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
                        >
                          Yes, delete
                        </button>
                      </form>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
