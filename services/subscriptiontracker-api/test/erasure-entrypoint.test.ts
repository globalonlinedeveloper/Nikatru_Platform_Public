import { describe, it, expect } from 'vitest';
import * as worker from '../src/index';
import { ErasureEntrypoint, eraseSubjectForOrder } from '../src/erasure-entrypoint';
import { realAppDb } from './harness';
import routeSource from '../src/routes/account.ts?raw';
import entrypointSource from '../src/erasure-entrypoint.ts?raw';

// ─────────────────────────────────────────────────────────────────────────────
// erasure-entrypoint.test.ts — [ADR 081] the Service Binding retry door.
//
// ⏱ 2026-09-15. The platform retries an erasure it could not finish by calling
// `ErasureEntrypoint.eraseSubject(subjectRef, orderId)` over a binding. What the
// ADR requires of this side, and what each case below pins:
//   · it runs the SAME deletion code the public route runs;
//   · it is idempotent — a second call for an erased subject is success;
//   · it is exported under the name the platform's binding names;
//   · it refuses rather than reporting success over nothing.
// ─────────────────────────────────────────────────────────────────────────────

const SUBJECT = 'entrypoint-subject-4b1d';
const BYSTANDER = 'entrypoint-bystander-8e2a';

function dbWithReports() {
  const db = realAppDb(['CREATE TABLE saved_reports (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, body TEXT);']);
  db.db.prepare('INSERT INTO saved_reports (id,user_id,body) VALUES (?,?,?)').run('r1', SUBJECT, 'x');
  db.db.prepare('INSERT INTO saved_reports (id,user_id,body) VALUES (?,?,?)').run('r2', BYSTANDER, 'y');
  return db;
}

const countFor = (db: ReturnType<typeof realAppDb>, userId: string) =>
  (db.db.prepare('SELECT COUNT(*) AS n FROM saved_reports WHERE user_id = ?').get(userId) as { n: number }).n;

describe('ErasureEntrypoint — the retry door erases exactly one subject', () => {
  it('erases the subject and leaves a bystander untouched', async () => {
    const db = dbWithReports();
    const answer = await eraseSubjectForOrder({ APP_DB: db as unknown as D1Database }, SUBJECT, 'order-1');
    expect(answer.ok).toBe(true);
    expect(answer.ok && answer.deleted.saved_reports).toBe(1);
    expect(countFor(db, SUBJECT)).toBe(0);
    expect(countFor(db, BYSTANDER)).toBe(1);
  });

  it('is IDEMPOTENT: a second call for an erased subject is success with nothing deleted', async () => {
    const db = dbWithReports();
    await eraseSubjectForOrder({ APP_DB: db as unknown as D1Database }, SUBJECT, 'order-1');
    const again = await eraseSubjectForOrder({ APP_DB: db as unknown as D1Database }, SUBJECT, 'order-1');
    expect(again.ok).toBe(true);
    expect(again.ok && again.deleted.saved_reports).toBe(0);
  });

  it('never echoes the subject back — the platform receives counts and its own order id', async () => {
    const db = dbWithReports();
    const answer = await eraseSubjectForOrder({ APP_DB: db as unknown as D1Database }, SUBJECT, 'order-9');
    expect(JSON.stringify(answer)).not.toContain(SUBJECT);
    expect(answer.orderId).toBe('order-9');
  });

  it('refuses an empty subject rather than reporting success', async () => {
    const db = dbWithReports();
    const answer = await eraseSubjectForOrder({ APP_DB: db as unknown as D1Database }, '', 'order-2');
    expect(answer.ok).toBe(false);
    expect(countFor(db, BYSTANDER)).toBe(1);
  });

  it('the RPC method on the class runs the same body over its own env', async () => {
    const db = dbWithReports();
    const entry = new ErasureEntrypoint({} as ExecutionContext, { APP_DB: db } as never);
    const answer = await entry.eraseSubject(SUBJECT, 'order-3');
    expect(answer.ok).toBe(true);
    expect(countFor(db, SUBJECT)).toBe(0);
  });
});

describe('ErasureEntrypoint — wired the way the platform binding expects', () => {
  it('the Worker module exports it under the name services/platform/wrangler.jsonc binds', () => {
    expect((worker as Record<string, unknown>).ErasureEntrypoint).toBe(ErasureEntrypoint);
  });

  it('the public route and the entrypoint call the SAME deletion function', () => {
    expect(routeSource).toMatch(/import \{ eraseSubjectRows \} from '\.\.\/lib\/erase-subject';/);
    expect(routeSource).toMatch(/await eraseSubjectRows\(c\.env\.APP_DB, userId\)/);
    expect(entrypointSource).toMatch(/await eraseSubjectRows\(env\.APP_DB, subjectRef\)/);
    expect(routeSource).not.toMatch(/DELETE FROM \$\{table\}/);
  });
});
