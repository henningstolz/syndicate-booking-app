// A small, readable page for when a file link cannot be opened (a deleted document, a
// month with no statement...). The file routes used to answer with bare JSON, which in
// the app installed on a phone is a dead end: no browser bar and no back button. This
// page always has a link back into the app.
const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function fileErrorPage(message: string, back: { href: string; label: string }, status = 404): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Blocktime</title>
</head>
<body style="margin:0;padding:max(24px, env(safe-area-inset-top)) 20px 24px;background:#f4f5f0;color:#172026;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<main style="max-width:420px;margin:0 auto;">
<p style="margin:0 0 20px;font-family:Menlo,Consolas,monospace;font-size:13px;color:#4f5a54;">blocktime</p>
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;">${escapeHtml(message)}</h1>
<p style="margin:24px 0;"><a href="${escapeHtml(back.href)}" style="display:inline-block;padding:12px 22px;background:#172026;color:#f4f5f0;text-decoration:none;border-radius:999px;font-weight:600;font-size:15px;">${escapeHtml(back.label)}</a></p>
</main>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" },
  });
}
