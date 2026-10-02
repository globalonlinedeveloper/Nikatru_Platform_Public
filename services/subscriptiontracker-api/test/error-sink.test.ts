import { describe, it, expect, vi, afterEach } from 'vitest';
import app from '../src/index';

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline 11]E-8 — a Worker's unhandled error is CAPTURED, not console-only.
//
// 🔴 THE STATE THIS REPLACED, measured at HEAD before this file existed:
// `app.onError` in both Workers logged and returned 500, and
// `grep -rn "sentry|glitchtip|toucan" services/` returned ZERO HITS. The only
// artefact of an unhandled error on the shared Worker — the one every stamped
// app posts analytics, consent, entitlement and merchant-of-record traffic to —
// was a 500 the client saw. `wrangler tail` is a live stream nobody watches at
// 3am and Cloudflare Free keeps no searchable history.
//
// TWO ASSERTIONS HERE FAILED ON THAT TREE BY CONSTRUCTION, which is what makes
// them worth writing rather than describing:
//   · the envelope names the WORKER it came from (`server_name` / the `service`
//     tag) — there was no envelope;
//   · its release is NOT the literal "v1". `API_VERSION` is "v1" in both
//     Workers and has never changed, so using it would group every error the
//     factory will ever report into one bucket named after a URL prefix. The
//     release is the deployed SHA until [9]R-2 lands a real release id.
//
// And the PRIVACY assertions are the reason this ships to the same GlitchTip
// instance as the app's crashes at all: the query string, the body and the
// headers must never appear in the payload. `?email=` is a URL.
//
// ⏱ 2026-10-01 · services-033: the sink MODULE's cases (the DSN parse, the
// envelope, the privacy invariants, fail-open) moved to
// services/_shared/test/error-sink.test.ts, beside the one home; this file keeps
// this Worker's WIRING — its real onError reaching the sink.
// ─────────────────────────────────────────────────────────────────────────────

const DSN = 'https://abc123@glitchtip.example.test/7';
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the REAL onError reports through the shared sink', () => {
  it('the REAL onError reports, and the report names this Worker', async () => {
    // Driven through the real app rather than asserted about it. The env is a
    // Proxy that throws when the health route reads APP_ID — a genuine
    // unhandled error inside a real route, reaching the real handler, with a
    // query string on the URL that must not survive into the payload.
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent.push(String(init.body));
      return new Response('', { status: 200 });
    });
    const env = new Proxy(
      { GLITCHTIP_DSN: DSN, RELEASE: 'sha123' } as Record<string, string>,
      {
        get(target, prop: string) {
          if (prop === 'APP_ID') throw new TypeError('binding exploded');
          return target[prop];
        },
      },
    );
    const res = await app.fetch(
      new Request('https://api.example.test/v1/health?email=a@b.test', { method: 'GET' }),
      env as never,
      { waitUntil: (p: Promise<unknown>) => void p, passThroughOnException: () => {} } as never,
    );
    expect(res.status).toBe(500);
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain('email=');
    expect(sent[0]).toContain('"server_name":"subscriptiontracker-api"');
    expect(sent[0]).toContain('"release":"sha123"');
    expect(sent[0]).not.toContain('"release":"v1"');
  });
});
