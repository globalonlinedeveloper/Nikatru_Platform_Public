import { describe, it, expect } from 'vitest';
import * as worker from '../src/index';
import { ErasureEntrypoint, eraseSubjectForOrder } from '../src/erasure-entrypoint';

// ─────────────────────────────────────────────────────────────────────────────
// erasure-entrypoint.test.ts — [ADR 081] the Service Binding retry door every
// stamped app inherits. Behaviour over a minimal in-memory D1 (this template has
// no SQL harness), wiring by reading the source the way chassis-wiring.test.ts does.
// ─────────────────────────────────────────────────────────────────────────────

const nodeProcess = (
  globalThis as unknown as {
    process: { cwd(): string; getBuiltinModule(id: 'node:fs'): { readFileSync(p: string, enc: 'utf8'): string } };
  }
).process;
const read = (rel: string) => nodeProcess.getBuiltinModule('node:fs').readFileSync(`${nodeProcess.cwd()}/${rel}`, 'utf8');

/** One table, `records (id, user_id)`, answering exactly the statements the shared walk sends. */
function fakeDb(rows: Array<{ id: string; user_id: string }>) {
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => {
      if (/FROM sqlite_master/i.test(sql)) return { results: [{ name: 'records' }] };
      if (/pragma_table_info\('records'\)/i.test(sql)) return { results: [{ name: 'id' }, { name: 'user_id' }] };
      return { results: [] };
    },
    run: async () => {
      if (/^DELETE FROM records WHERE user_id = \?/i.test(sql)) {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i].user_id === args[0]) rows.splice(i, 1);
        return { meta: { changes: before - rows.length } };
      }
      return { meta: { changes: 0 } };
    },
  });
  return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}

describe('ErasureEntrypoint — the retry door erases exactly one subject, idempotently', () => {
  it('erases the subject and leaves a bystander', async () => {
    const rows = [{ id: '1', user_id: 'subject' }, { id: '2', user_id: 'bystander' }];
    const answer = await eraseSubjectForOrder({ APP_DB: fakeDb(rows) }, 'subject', 'order-1');
    expect(answer).toMatchObject({ ok: true, orderId: 'order-1', deleted: { records: 1 } });
    expect(rows).toEqual([{ id: '2', user_id: 'bystander' }]);
  });

  it('a second call for an erased subject is success with nothing deleted', async () => {
    const rows = [{ id: '1', user_id: 'subject' }];
    const db = fakeDb(rows);
    await eraseSubjectForOrder({ APP_DB: db }, 'subject', 'order-1');
    expect(await eraseSubjectForOrder({ APP_DB: db }, 'subject', 'order-1')).toMatchObject({ ok: true, deleted: { records: 0 } });
  });

  it('the RPC method on the class runs the same body over its own env', async () => {
    const rows = [{ id: '1', user_id: 'subject' }];
    const entry = new ErasureEntrypoint({} as ExecutionContext, { APP_DB: fakeDb(rows) } as never);
    expect((await entry.eraseSubject('subject', 'o')).ok).toBe(true);
    expect(rows).toHaveLength(0);
  });
});

describe('ErasureEntrypoint — wired the way the platform binding expects', () => {
  it('the Worker module exports it by the name the binding names', () => {
    expect((worker as Record<string, unknown>).ErasureEntrypoint).toBe(ErasureEntrypoint);
  });

  it('the public route and the entrypoint call the SAME APP_DB deletion function', () => {
    expect(read('src/routes/account.ts')).toMatch(/await eraseSubjectRows\(c\.env\.APP_DB, userId\)/);
    expect(read('src/erasure-entrypoint.ts')).toMatch(/await eraseSubjectRows\(env\.APP_DB, subjectRef\)/);
  });
});
