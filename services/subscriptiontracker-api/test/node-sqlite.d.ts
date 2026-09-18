// Minimal ambient declaration for node:sqlite, used ONLY by test/harness.ts.
//
// Same reasoning as raw-modules.d.ts: this Worker's tsconfig exposes
// ["@cloudflare/workers-types"] and nothing else on purpose, so that production
// code cannot reach for a Node API the Workers runtime does not have. The tests
// need a REAL SQL engine — a hand-written mock cannot prove that dropping
// `AND user_id = ?` lets user B read user A's row, because a mock never
// evaluates the predicate — so the surface node:sqlite actually provides is
// declared here rather than by widening `types` for the whole project.
declare module 'node:sqlite' {
  type SQLValue = string | number | bigint | null | Uint8Array;
  export class StatementSync {
    all(...params: SQLValue[]): Array<Record<string, unknown>>;
    get(...params: SQLValue[]): Record<string, unknown> | undefined;
    run(...params: SQLValue[]): { changes: number; lastInsertRowid: number | bigint };
    /** ⏱ 2026-09-18: the result columns a statement WOULD return — empty for a
     *  write. Node added it in v23.11.0; CI installs the major in
     *  tooling/versions.json (24), so it exists wherever these tests run. The
     *  harness's `batchResult` reads it to answer a batched SELECT with its rows. */
    columns(): Array<{ name: string; column: string | null; table: string | null; database: string | null; type: string | null }>;
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
