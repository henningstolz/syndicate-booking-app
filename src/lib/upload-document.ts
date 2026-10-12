// Browser side of an upload: check the file, shrink a photo, and put it in the group's
// folder of the file store. The file goes straight from the phone to the store (not
// through our server, which could not take a big file). Registering it as a document
// is a separate step (the add_document database function).
import { checkFile, contentTypeOf, MAX_FILE_BYTES, scaledSize, storagePath, formatBytes } from "./documents.ts";

type Client = {
  storage: {
    from: (bucket: string) => {
      upload: (path: string, body: Blob, options: { contentType: string; upsert: boolean }) => Promise<{ error: { message: string } | null }>;
      remove: (paths: string[]) => Promise<unknown>;
    };
  };
};

export type PreparedFile = { blob: Blob; type: string; name: string };

const SHRINKABLE = ["image/jpeg", "image/png", "image/webp"];

// A photo from a phone is often 4 to 12 MB; shrunk to 2400 pixels it is a few hundred KB.
async function shrink(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const { width, height } = scaledSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#ffffff"; // a PNG's transparent areas become white, not black
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  } catch {
    return null; // the browser cannot read it (for example HEIC outside Safari): use it as it is
  }
}

export async function prepareFile(file: File): Promise<PreparedFile | { error: string }> {
  const problem = checkFile(file);
  if (problem) return { error: problem };
  const type = contentTypeOf(file) as string;

  if (SHRINKABLE.includes(type)) {
    const smaller = await shrink(file);
    if (smaller && smaller.size < file.size) {
      return { blob: smaller, type: "image/jpeg", name: file.name.replace(/\.[A-Za-z0-9]{1,5}$/, "") + ".jpg" };
    }
  }
  if (file.size > MAX_FILE_BYTES) return { error: `That file is too large (${formatBytes(MAX_FILE_BYTES)} at most).` };
  return { blob: file, type, name: file.name };
}

// Puts the prepared file in the store. Returns where it went, or what went wrong.
export async function uploadPrepared(
  supabase: Client,
  groupId: string,
  file: PreparedFile,
): Promise<{ path: string } | { error: string }> {
  const path = storagePath(groupId, crypto.randomUUID(), file.type);
  const { error } = await supabase.storage.from("documents").upload(path, file.blob, { contentType: file.type, upsert: false });
  if (error) {
    const quota = /row-level security|policy|exceed/i.test(error.message);
    return {
      error: quota
        ? "The upload was refused. Your group may have used up its 200 MB of space, or the file is too large."
        : `The upload failed: ${error.message}`,
    };
  }
  return { path };
}

export async function removeUploaded(supabase: Client, path: string): Promise<void> {
  try {
    await supabase.storage.from("documents").remove([path]);
  } catch {
    // Best effort: an unregistered file left behind is harmless and counts only toward the space.
  }
}
