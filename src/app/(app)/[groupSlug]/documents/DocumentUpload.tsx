"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ACCEPT, DOCUMENT_CATEGORIES, formatBytes, titleFromFileName } from "@/lib/documents";
import { prepareFile, removeUploaded, uploadPrepared } from "@/lib/upload-document";

const inputClass = "w-full rounded-md border border-zinc-300 px-2 py-1.5 text-base text-zinc-900";
const labelClass = "flex flex-col gap-1 text-xs text-zinc-600";

const REASONS: Record<string, string> = {
  title_required: "Please give the document a title.",
  title_too_long: "That title is too long (120 characters at most).",
  category_invalid: "Please choose a category.",
  file_missing: "The file didn't arrive. Please try again.",
  already_added: "That file was already added.",
  not_allowed: "You don't have permission to add documents here.",
};

// The upload form on the Documents page: pick a file (or take a photo), give it a title
// and a category. The file goes straight to the store, then it is registered.
export function DocumentUpload({
  groupId,
  demo,
  defaultCategory,
}: {
  groupId: string;
  demo: boolean;
  defaultCategory: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (demo) {
      setMessage({ ok: false, text: "This is a demo, so uploads aren't saved." });
      return;
    }
    if (!(file instanceof File) || file.size === 0) {
      setMessage({ ok: false, text: "Please choose a file." });
      return;
    }
    const finalTitle = title.trim() || titleFromFileName(file.name);
    if (!finalTitle) {
      setMessage({ ok: false, text: "Please give the document a title." });
      return;
    }

    setBusy(true);
    setMessage(null);
    const prepared = await prepareFile(file);
    if ("error" in prepared) {
      setBusy(false);
      setMessage({ ok: false, text: prepared.error });
      return;
    }
    const supabase = createClient();
    const uploaded = await uploadPrepared(supabase, groupId, prepared);
    if ("error" in uploaded) {
      setBusy(false);
      setMessage({ ok: false, text: uploaded.error });
      return;
    }
    const { data: answer, error } = await supabase.rpc("add_document", {
      p_group_id: groupId,
      p_title: finalTitle,
      p_category: String(data.get("category") ?? "general"),
      p_path: uploaded.path,
      p_file_name: prepared.name,
    });
    const result = (answer as { result?: string } | null)?.result;
    if (error || result !== "ok") {
      await removeUploaded(supabase, uploaded.path);
      setBusy(false);
      setMessage({ ok: false, text: REASONS[result ?? ""] ?? "Something went wrong. Please try again." });
      return;
    }
    form.reset();
    setTitle("");
    setBusy(false);
    setMessage({ ok: true, text: `Uploaded "${finalTitle}" (${formatBytes(prepared.blob.size)}).` });
    router.refresh();
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex max-w-md flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
      <label className={labelClass}>
        File (photo, PDF, Word, Excel; up to 10 MB)
        <input
          type="file"
          name="file"
          accept={ACCEPT}
          required
          disabled={busy}
          onChange={(event) => {
            const picked = event.target.files?.[0];
            if (picked && !title.trim()) setTitle(titleFromFileName(picked.name));
          }}
          className="text-base text-zinc-900 file:mr-3 file:rounded-full file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1 file:text-sm file:text-zinc-700"
        />
      </label>
      <label className={labelClass}>
        Title
        <input
          type="text"
          name="title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={120}
          placeholder="Insurance certificate 2026"
          disabled={busy}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        Category
        <select name="category" defaultValue={defaultCategory} disabled={busy} className={inputClass}>
          {DOCUMENT_CATEGORIES.map((category) => (
            <option key={category.key} value={category.key}>
              {category.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={busy}
        className="self-start rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
      >
        {busy ? "Uploading…" : "Upload"}
      </button>
      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-green-800" : "text-red-800"}`}>
          {message.text}
        </p>
      )}
      <p className="text-xs text-zinc-500">
        Everyone in the group can see and download what you upload here. Photos are shrunk automatically.
      </p>
    </form>
  );
}
