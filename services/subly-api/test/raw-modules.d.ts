// Vite/Vitest's `?raw` import suffix, declared for `tsc --noEmit`.
//
// Mirrors services/platform/test/raw-modules.d.ts. It exists so a test can read
// a file that ships with the Worker — the deployed wrangler.jsonc, the real
// migrations — WITHOUT pulling @types/node into a Workers tsconfig whose `types`
// array is deliberately just ["@cloudflare/workers-types"]. A Worker has no
// `node:fs`, and widening the ambient types so a test can read a file would let
// production code reach for APIs the runtime does not have.
declare module '*?raw' {
  const content: string;
  export default content;
}
