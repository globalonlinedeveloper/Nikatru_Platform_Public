import { describe, it, expect, vi, afterEach } from 'vitest';
import { app } from '../src/index';
import { DAY_MS, FEEDBACK_RETENTION_DAYS } from '../src/feedback/limits';
import { FEEDBACK_CRON_JOB, purgeExpired, runFeedbackCron, sweepOrphans } from '../src/feedback/cron';
import { CTX, harness, multipart, pngWithMetadata, validReport, type Harness } from './feedback-harness';

// ─────────────────────────────────────────────────────────────────────────────
// scheduled.test.ts — 🔴 [Do 7] the 90-day purge, and 🔴 [Do 8] the screenshot
// half of account deletion (the orphan sweep).
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => vi.restoreAllMocks());

async function file(h: Harness, over: Record<string, unknown> = {}): Promise<string> {
  const res = await app.fetch(
    new Request('https://feedback.example.test/v1/feedback', { method: 'POST', body: multipart(validReport(over), pngWithMetadata()) }),
    h.env as never,
    CTX as never,
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe('🔴 [Do 7] 90-day retention, enforced in code', () => {
  it('each row carries purge_at = created_at + 90 days', async () => {
    const h = harness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await file(h);
    const [row] = h.db.rows('SELECT created_at, purge_at FROM feedback_reports');
    expect(Date.parse(String(row.purge_at)) - Date.parse(String(row.created_at))).toBe(FEEDBACK_RETENTION_DAYS * DAY_MS);
  });

  it('the cron at now+91 d leaves no row and no object, and keeps only an anonymised count', async () => {
    const h = harness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await file(h, { category: 'crash' });
    await file(h, { category: 'crash' });
    expect(h.bucket.keys()).toHaveLength(2);
    await runFeedbackCron(h.env, Date.now() + 91 * DAY_MS);
    expect(h.db.rows('SELECT * FROM feedback_reports')).toEqual([]);
    expect(h.bucket.keys()).toEqual([]);
    const counts = h.db.rows('SELECT * FROM feedback_counts');
    expect(counts).toEqual([
      { day: new Date().toISOString().slice(0, 10), app_id: 'subscriptiontracker', reported_version: '1.4.0', category: 'crash', status: 'new', n: 2 },
    ]);
    const beats = h.db.rows('SELECT target, ok FROM cron_heartbeat WHERE job = ? ORDER BY target', FEEDBACK_CRON_JOB);
    expect(beats).toEqual([
      { target: 'notices', ok: 1 },
      { target: 'orphans', ok: 1 },
      // ⏱ 2026-10-03 · lane dpdp-rights: the rights requests' clocks and purge.
      { target: 'privacy', ok: 1 },
      { target: 'purge', ok: 1 },
      { target: 'windows', ok: 1 },
    ]);
  });

  it('the cron at now+89 d purges nothing', async () => {
    const h = harness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await file(h);
    expect(await purgeExpired(h.env, Date.now() + 89 * DAY_MS)).toEqual({ purged: 0, capped: false });
    expect(h.db.rows('SELECT id FROM feedback_reports')).toHaveLength(1);
    expect(h.bucket.keys()).toHaveLength(1);
  });

  it('a purge limb that throws is a red heartbeat row, and the other limbs still run', async () => {
    const h = harness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await h.db.prepare('DROP TABLE feedback_reports').run();
    await runFeedbackCron(h.env, Date.now());
    const beats = h.db.rows('SELECT target, ok FROM cron_heartbeat ORDER BY target');
    expect(beats.find((b) => b.target === 'purge')).toEqual({ target: 'purge', ok: 0 });
    expect(beats.find((b) => b.target === 'windows')).toEqual({ target: 'windows', ok: 1 });
  });
});

describe('🔴 [Do 8] account deletion reaches the screenshots', () => {
  it('a row the erasure walk deleted leaves an object the next sweep deletes; a live report keeps its own', async () => {
    const h = harness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const erased = await file(h);
    const kept = await file(h);
    // What services/platform's schema-derived walk does for `user_id` tables.
    await h.db.prepare('DELETE FROM feedback_reports WHERE id = ?').bind(erased).run();
    expect(await sweepOrphans(h.env)).toBe(1);
    expect(h.bucket.keys()).toEqual([`shots/${kept}.png`]);
  });
});
