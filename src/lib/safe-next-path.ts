// Email links carry a `?next=` path telling us where to send the person
// after sign-in. Only ever follow a plain path on our own site: anything
// else ("//evil.com", "@evil.com", "https://…", backslashes) falls back.
export function safeNextPath(next: string | null | undefined, fallback = "/login") {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  if (next.includes("\\") || /[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}
