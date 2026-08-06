// Vite/Vitest's `import.meta.glob`, declared for `tsc --noEmit`.
//
// Same reason raw-modules.d.ts exists: this project's tsconfig sets
// `types: ["@cloudflare/workers-types"]` and nothing else, deliberately, so that
// production code cannot reach for an API the Workers runtime does not have.
// Pulling in `vite/client` to type ONE call in ONE test would widen the ambient
// surface for `src/` too.
//
// 🔴 WHY A GLOB AND NOT A LIST OF IMPORTS. insights-queries.test.ts has to be
// able to notice that a `.sql` file DISAPPEARED. A hand-written list of
// `import q1 from '../queries/insights/01-…sql?raw'` cannot: deleting the file
// and deleting its import line is one edit, and the suite then passes over four
// queries while the requirement says five. The glob makes the set a fact about
// the directory, which the test then compares against REQUIRED_COVERAGE.
//
// Typed narrowly — only the eager + `?raw` form is declared, because that is the
// only form whose return type is `Record<string, string>` rather than a record
// of thunks. A wider declaration would let a future `eager: false` call
// type-check and then hand every assertion a Promise-returning function that is
// truthy, non-empty, and completely wrong.
interface ImportMeta {
  glob(
    pattern: string,
    options: { query: '?raw'; import: 'default'; eager: true },
  ): Record<string, string>;
}
