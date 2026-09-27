// Vite/Vitest's `?raw` import suffix, declared for `tsc --noEmit`.
//
// This exists so a test can read the DEPLOYED wrangler.jsonc without pulling
// @types/node into a Workers tsconfig whose `types` array is deliberately just
// ["@cloudflare/workers-types"] — a Worker has no `node:fs`, and widening the
// ambient types so a test can read a file would let production code reach for
// APIs the runtime does not have.
declare module '*?raw' {
  const content: string;
  export default content;
}
