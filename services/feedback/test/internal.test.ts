import { describe, it, expect, vi, afterEach } from 'vitest';
import { app } from '../src/index';
import { FeedbackInternal, reportsOf, screenshotOf } from '../src/internal';
import { CTX, harness, multipart, pngWithMetadata, validReport } from './harness';

// ─────────────────────────────────────────────────────────────────────────────
// internal.test.ts — the ONE read path (src/internal.ts): a screenshot is read
// through the Service Binding entrypoint, and a person's reports export through
// it for lane dpdp-rights (DSAR). Nothing here is reachable by URL
// (test/intake.test.ts walks the route table).
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => vi.restoreAllMocks());

describe('FeedbackInternal', () => {
  it('reads a stored screenshot by report id, and nothing for an id it does not know', async () => {
    const h = harness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await app.fetch(
      new Request('https://feedback.example.test/v1/feedback', { method: 'POST', body: multipart(validReport(), pngWithMetadata()) }),
      h.env as never,
      CTX as never,
    );
    const { id } = (await res.json()) as { id: string };
    const entry = new FeedbackInternal(CTX, h.env);
    const shot = await entry.screenshot(id);
    expect(shot?.contentType).toBe('image/png');
    expect(new Uint8Array(shot!.bytes).slice(1, 4)).toEqual(new TextEncoder().encode('PNG'));
    expect(await screenshotOf(h.env, 'FB-NOTAREPORT')).toBeNull();
    expect(await screenshotOf(h.env, '../shots/x')).toBeNull();
  });

  it('exports exactly one person’s reports, and an empty id exports nothing', async () => {
    const h = harness();
    await h.db
      .prepare(
        "INSERT INTO feedback_reports (id, idempotency_key, user_id, app_id, surface, category, description, created_at, purge_at) VALUES ('FB-AAAAAAAAAA', 'k1', 'u-1', 'subscriptiontracker', 'app', 'bug', 'mine', '2026-10-01T00:00:00.000Z', '2026-12-30T00:00:00.000Z'), ('FB-BBBBBBBBBB', 'k2', 'u-2', 'subscriptiontracker', 'app', 'bug', 'theirs', '2026-10-01T00:00:00.000Z', '2026-12-30T00:00:00.000Z')",
      )
      .run();
    expect((await reportsOf(h.env, 'u-1')).map((r) => r.description)).toEqual(['mine']);
    expect(await reportsOf(h.env, '')).toEqual([]);
  });
});
