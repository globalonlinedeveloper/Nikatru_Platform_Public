import { describe, it, expect, vi, afterEach } from 'vitest';
import { ntfyNotifier } from '../src/adapters/telemetry/notify-ntfy';
import { webhookNotifier } from '../src/adapters/telemetry/notify-webhook';
import { mailNotifier } from '../src/adapters/telemetry/notify-mail';
import { recordingNotifier } from '../src/ports/fakes/telemetry';
import { ALERT_SEVERITIES, NOTIFIER_ROUTES, headerSafe, outcomeOfStatus, withFallback } from '../src/ports/telemetry';
import type { OwnerAlert } from '../src/ports/telemetry';
import { runNotifierConformance } from './telemetry-conformance';

// ─────────────────────────────────────────────────────────────────────────────
// notifier.test.ts — the telemetry port's `Notifier`: the owner-alert path.
//
// 🔴 THE RED CONTROL OF THIS PORT HALF: "ntfy answers 503 and the fallback
// receives the alert ONCE". ntfy, GlitchTip and the vault share Box B, so a Box B
// outage used to silence the very alert that would report it. Before port-telemetry
// there was no second channel at all; the case below fails on a tree whose
// `withFallback` does not try the fallback, or tries it twice.
// ─────────────────────────────────────────────────────────────────────────────

const ALERT: OwnerAlert = {
  severity: 'critical',
  title: 'Box B unreachable: 3 of 3 host(s)',
  body: 'https://ntfy.example.test/ — HTTP 530',
  dedupeKey: 'boxb_reachability',
};
const NTFY_ENV = { NTFY_ALERT_URL: 'https://ntfy.example.test/nikatru-page', NTFY_ALERT_TOKEN: 'tk_test_value' };
const HOOK_ENV = { ALERT_WEBHOOK_URL: 'https://hooks.example.test/alert/abc' };

afterEach(() => {
  vi.unstubAllGlobals();
});

/** fetch, answering per host; every call recorded. */
function stubHosts(answers: Record<string, number | 'throw'>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const a = answers[new URL(url).host];
    if (a === undefined) throw new Error(`unexpected host ${url}`);
    if (a === 'throw') throw new TypeError('fetch failed');
    return new Response(null, { status: a });
  });
  return calls;
}

describe('Notifier conformance', () => {
  const counted = (answers: Record<string, number | 'throw'>) => {
    const calls = stubHosts(answers);
    return () => calls.length;
  };
  runNotifierConformance('ntfy', {
    accepts: () => ({ adapter: ntfyNotifier(NTFY_ENV), requests: counted({ 'ntfy.example.test': 200 }) }),
    outage: () => ({ adapter: ntfyNotifier(NTFY_ENV), requests: counted({ 'ntfy.example.test': 503 }) }),
    unconfigured: () => ({ adapter: ntfyNotifier({}), requests: counted({}) }),
  });
  runNotifierConformance('webhook', {
    accepts: () => ({ adapter: webhookNotifier(HOOK_ENV), requests: counted({ 'hooks.example.test': 204 }) }),
    outage: () => ({ adapter: webhookNotifier(HOOK_ENV), requests: counted({ 'hooks.example.test': 'throw' }) }),
    unconfigured: () => ({ adapter: webhookNotifier({ ALERT_WEBHOOK_URL: 'http://plain.example.test/' }), requests: counted({}) }),
  });
  const fake = (answer?: Parameters<typeof recordingNotifier>[1], counts = true) => {
    const n = recordingNotifier('fake-notifier', answer);
    return { adapter: n, requests: () => (counts ? n.alerts.length : 0) };
  };
  runNotifierConformance('fake-notifier', {
    accepts: () => fake(),
    outage: () => fake({ ok: false, kind: 'unavailable', retryable: true, detail: 'fake outage' }),
    unconfigured: () => fake({ ok: false, kind: 'invalid', retryable: false, detail: 'fake unconfigured' }, false),
  });
});

describe('🔴 the fallback: an alert survives a Box B outage', () => {
  it('ntfy answers 503 and the fallback receives the alert ONCE', async () => {
    const calls = stubHosts({ 'ntfy.example.test': 503, 'hooks.example.test': 200 });
    const out = await withFallback(ntfyNotifier(NTFY_ENV), webhookNotifier(HOOK_ENV)).notify(ALERT);
    expect(out).toEqual({ ok: true, via: 'webhook' });
    expect(calls.map((c) => new URL(c.url).host)).toEqual(['ntfy.example.test', 'hooks.example.test']);
    const sent = JSON.parse(String(calls[1].init.body));
    expect(sent).toMatchObject({ severity: 'critical', title: ALERT.title, body: ALERT.body, dedupeKey: ALERT.dedupeKey });
  });

  it('the same, with fakes: the fallback sees exactly one alert, the original', async () => {
    const primary = recordingNotifier('ntfy', { ok: false, kind: 'unavailable', retryable: true, detail: 'HTTP 503' });
    const fallback = recordingNotifier('webhook');
    expect((await withFallback(primary, fallback).notify(ALERT)).ok).toBe(true);
    expect(primary.alerts).toEqual([ALERT]);
    expect(fallback.alerts).toEqual([ALERT]);
  });

  it('a primary that accepts is the only channel used', async () => {
    const primary = recordingNotifier('ntfy');
    const fallback = recordingNotifier('webhook');
    expect(await withFallback(primary, fallback).notify(ALERT)).toEqual({ ok: true, via: 'ntfy' });
    expect(fallback.alerts).toHaveLength(0);
  });

  it('a THROWING primary is graded, not propagated, and the fallback still runs once', async () => {
    const primary = { id: 'ntfy', notify: async () => { throw new Error('boom'); } };
    const fallback = recordingNotifier('webhook');
    expect((await withFallback(primary, fallback).notify(ALERT)).ok).toBe(true);
    expect(fallback.alerts).toHaveLength(1);
  });

  it('both down is ONE failure naming both, and still no throw', async () => {
    stubHosts({ 'ntfy.example.test': 530, 'hooks.example.test': 'throw' });
    const out = await withFallback(ntfyNotifier(NTFY_ENV), webhookNotifier(HOOK_ENV)).notify(ALERT);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.detail).toContain('ntfy');
      expect(out.detail).toContain('webhook');
    }
  });

  it('every critical and warning route has a fallback that is not its primary', () => {
    for (const s of ['critical', 'warning'] as const) {
      const r = NOTIFIER_ROUTES[s];
      expect(r.fallback, `${s} has no off-box fallback`).not.toBeNull();
      expect(r.fallback).not.toBe(r.primary);
      expect(r.fallback, 'mail is pending port-mail; it cannot carry the off-box leg yet').not.toBe('mail');
    }
    expect(Object.keys(NOTIFIER_ROUTES).sort()).toEqual([...ALERT_SEVERITIES].sort());
  });
});

describe('the ntfy adapter speaks ntfy', () => {
  it('POSTs the body to the topic URL with title, priority, tags and the bearer token', async () => {
    const calls = stubHosts({ 'ntfy.example.test': 200 });
    await ntfyNotifier(NTFY_ENV).notify(ALERT);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(NTFY_ENV.NTFY_ALERT_URL);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBe(ALERT.body);
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.Title).toBe(ALERT.title);
    expect(h.Priority).toBe('5');
    expect(h.Tags).toBe('critical,boxb-reachability');
    expect(h.Authorization).toBe(`Bearer ${NTFY_ENV.NTFY_ALERT_TOKEN}`);
  });

  it('sends no Authorization header when no token is configured', async () => {
    const calls = stubHosts({ 'ntfy.example.test': 200 });
    await ntfyNotifier({ NTFY_ALERT_URL: NTFY_ENV.NTFY_ALERT_URL }).notify(ALERT);
    expect(Object.keys(calls[0].init.headers as Record<string, string>)).not.toContain('Authorization');
  });

  it('a title cannot inject a header: CR/LF are flattened', async () => {
    const calls = stubHosts({ 'ntfy.example.test': 200 });
    await ntfyNotifier(NTFY_ENV).notify({ ...ALERT, title: 'x\r\nX-Evil: 1' });
    expect((calls[0].init.headers as Record<string, string>).Title).toBe('x X-Evil: 1');
    expect(headerSafe('a\nbé')).toBe('a b?');
  });
});

describe('the mail adapter is DECLARED pending, and says so', () => {
  it('refuses every alert without sending anything', async () => {
    const calls = stubHosts({});
    const out = await mailNotifier().notify(ALERT);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.detail).toContain('pending port-mail');
    expect(calls).toHaveLength(0);
  });
});

describe('outcomeOfStatus — one grading for every HTTP adapter', () => {
  it.each([
    [200, true, undefined],
    [204, true, undefined],
    [429, false, 'unavailable'],
    [503, false, 'unavailable'],
    [530, false, 'unavailable'],
    [401, false, 'refused'],
    [404, false, 'refused'],
  ])('HTTP %i', (status, ok, kind) => {
    const out = outcomeOfStatus('x', status);
    expect(out.ok).toBe(ok);
    if (!out.ok) expect(out.kind).toBe(kind);
  });
});
