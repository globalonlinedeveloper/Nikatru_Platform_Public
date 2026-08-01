// Minimal ambient declaration for node:sqlite, used ONLY by test/harness.ts.
//
// Mirrors services/subly-api/test/node-sqlite.d.ts, and for the same reason:
// this Worker's tsconfig exposes ["@cloudflare/workers-types"] and nothing else
// on purpose, so production code cannot reach for a Node API the Workers runtime
// does not have. The tests need a REAL SQL engine — a hand-written double cannot
// prove that an INSERT naming a column the migration never created writes
// nothing, because a double never parses the statement — so the surface
// node:sqlite actually provides is declared here rather than by widening `types`
// for the whole project.
declare module 'node:sqlite' {
  type SQLValue = string | number | bigint | null | Uint8Array;
  export class StatementSync {
    all(...params: SQLValue[]): Array<Record<string, unknown>>;
    get(...params: SQLValue[]): Record<string, unknown> | undefined;
    run(...params: SQLValue[]): { changes: number; lastInsertRowid: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
