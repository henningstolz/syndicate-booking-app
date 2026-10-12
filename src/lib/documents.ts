// Rules and small helpers for the document store, shared by the upload form (in the
// browser), the Documents page and the tests. No imports, so tests load it in plain Node.

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // what the file store accepts per file
// A photo straight from a phone can be bigger than that: it is shrunk first, so the
// photo itself may be larger, within reason.
export const MAX_PHOTO_BYTES = 40 * 1024 * 1024;

export const DOCUMENT_CATEGORIES = [
  { key: "general", label: "General" },
  { key: "aircraft", label: "Aircraft" },
  { key: "insurance", label: "Insurance" },
  { key: "manuals", label: "Manuals" },
  { key: "receipts", label: "Receipts" },
  { key: "other", label: "Other" },
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number]["key"];

export const categoryLabel = (key: string) => DOCUMENT_CATEGORIES.find((c) => c.key === key)?.label ?? "Other";

// What the file store accepts (matches the bucket in migration 0023).
const TYPES_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  csv: "text/csv",
};
const ALLOWED_TYPES = new Set(Object.values(TYPES_BY_EXTENSION));

// The file picker's "accept" list.
export const ACCEPT = [...Object.keys(TYPES_BY_EXTENSION).map((e) => `.${e}`), "image/*"].join(",");
export const ACCEPT_RECEIPT = "image/*,.pdf,.heic,.heif";

export const extensionOf = (fileName: string) => {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(fileName.trim());
  return match ? match[1].toLowerCase() : "";
};

// The type to upload a file as: its own, or, when the phone gives none, from its extension.
export function contentTypeOf(file: { name: string; type: string }): string | null {
  const own = file.type.toLowerCase();
  if (own && ALLOWED_TYPES.has(own)) return own;
  const byExtension = TYPES_BY_EXTENSION[extensionOf(file.name)];
  return byExtension ?? null;
}

export const isImageType = (type: string) => type.startsWith("image/");
// Types a browser shows itself; everything else is downloaded.
export const opensInBrowser = (type: string) => type === "application/pdf" || ["image/jpeg", "image/png", "image/webp"].includes(type);

// null if the file may be uploaded, otherwise what to tell the person.
export function checkFile(file: { name: string; type: string; size: number }): string | null {
  const type = contentTypeOf(file);
  if (!type) return "That kind of file isn't allowed. Use a photo, PDF, Word or Excel file, or plain text.";
  if (file.size === 0) return "That file is empty.";
  if (isImageType(type)) {
    if (file.size > MAX_PHOTO_BYTES) return "That photo is too large (40 MB at most).";
    return null;
  }
  if (file.size > MAX_FILE_BYTES) return `That file is too large (${formatBytes(MAX_FILE_BYTES)} at most).`;
  return null;
}

// The name a file is stored under: a random id and a safe extension. The original name
// is kept separately, for showing and downloading.
export function storagePath(groupId: string, id: string, type: string): string {
  const extension = Object.entries(TYPES_BY_EXTENSION).find(([, t]) => t === type)?.[0] ?? "bin";
  return `${groupId}/${id}.${extension === "jpeg" ? "jpg" : extension}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

// A title to suggest from a file name: "cert 2026_final.pdf" -> "cert 2026 final".
export function titleFromFileName(fileName: string): string {
  return fileName
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

// A badge for the list: "PDF", "JPG", "DOC", "XLS", "TXT".
export function typeBadge(type: string): string {
  if (type === "application/pdf") return "PDF";
  if (isImageType(type)) return type === "image/png" ? "PNG" : type === "image/jpeg" ? "JPG" : "IMG";
  if (type.includes("word")) return "DOC";
  if (type.includes("excel") || type.includes("spreadsheet")) return "XLS";
  return type === "text/csv" ? "CSV" : "TXT";
}

// The size to shrink a photo to: its longest side at most `max`, same shape.
export function scaledSize(width: number, height: number, max = 2400): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const ratio = max / longest;
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}
