// Cloudflare Pages Function: POST /api/report — nikatru.com's "Report a problem"
// form (lane feedback-intake, Do 9), on /support.
//
// SITE PROMISE: "Your report goes to our private support system, never to a public page."
//
// WHAT IT DOES: reads the form, builds the same report JSON every app sends, and
// forwards it over a SERVICE BINDING to the platform Worker's POST /v1/feedback (services/platform/src/routes/feedback.ts),
// which validates, PII-masks, rate-limits and stores it. So the page posts
// SAME-ORIGIN: `form-action 'self'` and `connect-src 'self'` in `_headers` stay
// exactly as they are, and no browser ever talks to another host.
//
// WHAT IT DOES NOT DO: store anything, read or derive anything from the visitor's
// network address, or set a cookie. The Worker applies the intake's limits to the
// request it receives; the request's own headers are passed on unchanged apart
// from the ones dropped below, and nothing here reads any of them.
//
// THE BINDING: `PLATFORM` -> the Worker `platform`, declared in
// tooling/sites/nikatru-apex/wrangler.jsonc and the bindings table in
// sites/nikatru/README.md (tooling/ci/assert-site-bindings.mjs holds the three
// equal); the deploy job writes it onto the project. Without it every post answers
// the "could not send" message, which offers the support mail; nothing is lost
// silently.

// ⚠️ Every Response this file makes goes through `respond`, or it ships bare:
// `_headers` does not reach Pages Function responses (subscribe.js says why),
// and assert-function-headers.mjs holds every `new Response(` to this helper.
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

const respond = (status, location) =>
  new Response(null, {
    status,
    headers: { "cache-control": "no-store", ...(location ? { location } : {}), ...SECURITY_HEADERS },
  });

/** Back to the form, with the outcome in the query (js/report.js shows it). */
const back = (outcome, id) =>
  respond(303, `/support?report=${outcome}${id ? `&id=${encodeURIComponent(id)}` : ""}#report-a-problem`);

/** The form's largest honest body: two 4,000-character fields and a few small ones. */
const MAX_FORM_BYTES = 24 * 1024;
const CATEGORIES = new Set(["bug", "crash", "billing", "accessibility", "translation", "question", "other"]);
/** Headers never passed on to the Worker: credentials and the page's own context. */
const DROPPED = ["cookie", "authorization", "origin", "referer", "content-length", "content-type"];

const text = (form, name) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

export async function onRequestPost({ request, env }) {
  if (!env.PLATFORM || typeof env.PLATFORM.fetch !== "function") return back("failed");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > MAX_FORM_BYTES) return back("too-large");

  let form;
  try {
    form = await request.formData();
  } catch {
    return back("failed");
  }
  const category = text(form, "category");
  const report = {
    idempotencyKey: text(form, "key") || crypto.randomUUID(),
    appId: "nikatru",
    surface: "site",
    category: CATEGORIES.has(category) ? category : "other",
    description: text(form, "description"),
    steps: text(form, "steps") || undefined,
    diagnostics: { platform: "web", channel: "site" },
    consent: { reply: form.get("reply") === "on", notifyFixed: form.get("notify") === "on" },
    contactEmail: text(form, "email") || undefined,
    // The honeypot: a person never sees it; the Worker accepts and drops a filled one.
    website: text(form, "website") || undefined,
    // Set by js/report.js on submit; absent (no script) reads as "too fast", and
    // the page tells a visitor without scripts to use the support mail instead.
    elapsedMs: Number(text(form, "elapsed")) || 0,
  };

  const headers = new Headers(request.headers);
  for (const h of DROPPED) headers.delete(h);
  headers.set("content-type", "application/json");
  let res;
  try {
    res = await env.PLATFORM.fetch(
      new Request("https://platform.internal/v1/feedback", { method: "POST", headers, body: JSON.stringify(report) }),
    );
  } catch {
    return back("failed");
  }
  if (res.status === 201 || res.status === 202 || res.status === 200) {
    const body = await res.json().catch(() => ({}));
    return back("sent", typeof body.id === "string" ? body.id : "");
  }
  if (res.status === 429) return back("limited");
  if (res.status === 413) return back("too-large");
  if (res.status === 422 || res.status === 400) return back("invalid");
  return back("failed");
}

export async function onRequestGet() {
  return respond(303, "/support#report-a-problem");
}
