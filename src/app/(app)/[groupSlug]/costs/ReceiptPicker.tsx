"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ACCEPT_RECEIPT, formatBytes } from "@/lib/documents";
import { prepareFile, removeUploaded, uploadPrepared } from "@/lib/upload-document";

// An optional receipt on the "Add expense" form: pick a photo (or take one) or a PDF.
// The file goes straight to the store as soon as it is chosen; the form then carries its
// place in two hidden fields, and "Add expense" registers it as a document (category
// Receipts) and links it to the expense.
export function ReceiptPicker({ groupId, demo }: { groupId: string; demo: boolean }) {
  const [state, setState] = useState<
    { kind: "none" } | { kind: "busy" } | { kind: "ready"; path: string; name: string; size: number } | { kind: "error"; text: string }
  >({ kind: "none" });

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    if (demo) {
      input.value = "";
      setState({ kind: "error", text: "This is a demo, so receipts can't be uploaded." });
      return;
    }
    setState({ kind: "busy" });
    const prepared = await prepareFile(file);
    if ("error" in prepared) {
      input.value = "";
      setState({ kind: "error", text: prepared.error });
      return;
    }
    const uploaded = await uploadPrepared(createClient(), groupId, prepared);
    input.value = "";
    if ("error" in uploaded) {
      setState({ kind: "error", text: uploaded.error });
      return;
    }
    setState({ kind: "ready", path: uploaded.path, name: prepared.name, size: prepared.blob.size });
  }

  async function remove(path: string) {
    await removeUploaded(createClient(), path);
    setState({ kind: "none" });
  }

  return (
    <div className="flex flex-col gap-1 text-xs text-zinc-600">
      <span>Receipt (optional)</span>
      {state.kind === "ready" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-green-200 bg-green-50 px-2 py-1.5 text-sm text-green-900">
          <span className="min-w-0 truncate">
            Attached: {state.name} ({formatBytes(state.size)})
          </span>
          <button type="button" onClick={() => remove(state.path)} className="text-xs underline underline-offset-4">
            Remove
          </button>
          <input type="hidden" name="receiptPath" value={state.path} />
          <input type="hidden" name="receiptName" value={state.name} />
        </div>
      ) : (
        <input
          type="file"
          accept={ACCEPT_RECEIPT}
          onChange={onPick}
          disabled={state.kind === "busy"}
          className="text-base text-zinc-900 file:mr-3 file:rounded-full file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1 file:text-sm file:text-zinc-700"
        />
      )}
      {state.kind === "busy" && <span className="text-zinc-500">Uploading…</span>}
      {state.kind === "error" && <span className="text-red-800">{state.text}</span>}
      <span className="text-zinc-500">A photo of the bill or a PDF. It is kept in Documents, where the group can see it.</span>
    </div>
  );
}
