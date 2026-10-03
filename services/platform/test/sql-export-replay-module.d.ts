// tooling/ops/sql-export-replay.mjs, declared for `tsc --noEmit` — the reason is
// smoke-module.d.ts's: this Worker's `types` is ["@cloudflare/workers-types"]
// alone, so a plain JS import from outside the package is TS7016. The test runs
// the SHIPPED replay over the SHIPPED dump; this file only gives it a shape.
declare module '*/sql-export-replay.mjs' {
  export const EXPORT_GENERATORS: ReadonlySet<string>;
  export function readExportFile(path: string): string;
  export function replayExport(args: { root: string; jsonl: string }): {
    verdict: 'PASS' | 'FAIL' | 'LOST';
    detail: string;
    lines: string[];
  };
}
