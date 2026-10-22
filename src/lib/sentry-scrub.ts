// What is removed from an error report before it leaves the app for Sentry. Pure and
// import-free (it does not even import Sentry's types), so the tests can run it in
// plain Node. The rule is: report WHAT went wrong and WHERE in the code, never WHO or
// any secret. Besides personal data (emails, names, request bodies, cookies, headers,
// IP addresses), some web addresses are secrets themselves: the calendar link
// (/cal/<64 hex>.ics), invitation links (/join/<id>), sign-in and reset links, and the
// signed file links (a token in the query string). Those are removed too.

type Json = Record<string, unknown>;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g;
const LONG_HEX = /\b[0-9a-f]{32,}\b/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const SECRET_PARAM = /\b(token|access_token|refresh_token|apikey|api_key|key|secret|code|password|signature|sig)=([^&\s"')]+)/gi;

// Free text (an error message, a breadcrumb): emails, tokens, ids and secret-looking
// parameters become placeholders.
export function scrubText(value: string): string {
  return value
    .replace(BEARER, "$1 [token]")
    .replace(SECRET_PARAM, "$1=[removed]")
    .replace(JWT, "[token]")
    .replace(EMAIL, "[email]")
    .replace(UUID, "[id]")
    .replace(LONG_HEX, "[token]");
}

// A web address: no query string and no fragment (they carry tokens and codes), and the
// secret path parts replaced. The scheme, host and the shape of the path stay, which is
// all that is needed to find a bug.
export function scrubUrl(url: string): string {
  if (!url) return url;
  let rest = url.split("#")[0].split("?")[0];
  rest = rest
    .replace(/(\/cal\/)[^/]+/i, "$1[removed]")
    .replace(/(\/join\/)[^/]+/i, "$1[removed]")
    .replace(/(\/auth\/v1\/verify)[^/]*/i, "$1")
    .replace(/(\/storage\/v1\/object\/(?:sign|public|authenticated)\/)[^/]+\/.*/i, "$1[removed]");
  return scrubText(rest);
}

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

// Walks a value and scrubs every string in it (used for the small `data` bags).
function scrubDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubText(value);
  if (depth > 4) return "[removed]";
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v, depth + 1)]));
  return value;
}

export function scrubBreadcrumb<T extends Json>(crumb: T): T | null {
  const out: Json = { ...crumb };
  // What someone typed or clicked on is not needed to find a bug.
  if (out.category === "ui.input") return null;
  if (typeof out.message === "string") out.message = scrubText(out.message);
  if (isRecord(out.data)) {
    const data: Json = { ...out.data };
    for (const key of ["url", "from", "to"]) if (typeof data[key] === "string") data[key] = scrubUrl(data[key] as string);
    delete data.request_body_size;
    out.data = scrubDeep(data);
  }
  return out as T;
}

export function scrubEvent<T extends Json>(event: T): T {
  const out: Json = { ...event };

  // Who it happened to: never sent.
  delete out.user;
  delete out.server_name;

  // The request: only the address (scrubbed) and the method.
  if (isRecord(out.request)) {
    const request = out.request;
    out.request = {
      ...(typeof request.url === "string" ? { url: scrubUrl(request.url) } : {}),
      ...(typeof request.method === "string" ? { method: request.method } : {}),
    };
  }

  if (typeof out.message === "string") out.message = scrubText(out.message);
  if (typeof out.transaction === "string") out.transaction = scrubUrl(out.transaction);

  if (isRecord(out.exception) && Array.isArray(out.exception.values)) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((v) => (isRecord(v) && typeof v.value === "string" ? { ...v, value: scrubText(v.value) } : v)),
    };
  }

  if (Array.isArray(out.breadcrumbs)) {
    out.breadcrumbs = out.breadcrumbs.map((b) => (isRecord(b) ? scrubBreadcrumb(b) : null)).filter(Boolean);
  }

  // Anything attached by hand could hold anything: dropped.
  delete out.extra;
  if (isRecord(out.tags)) out.tags = scrubDeep(out.tags);
  if (isRecord(out.contexts)) {
    const contexts: Json = { ...out.contexts };
    delete contexts.request;
    delete contexts.user;
    // Next.js adds the path that was requested, query string included.
    if (isRecord(contexts.nextjs) && typeof contexts.nextjs.request_path === "string") {
      contexts.nextjs = { ...contexts.nextjs, request_path: scrubUrl(contexts.nextjs.request_path) };
    }
    out.contexts = scrubDeep(contexts) as Json;
  }
  return out as T;
}
