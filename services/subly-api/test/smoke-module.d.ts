// tooling/ops/post-deploy-smoke.mjs, declared for `tsc --noEmit`.
//
// Mirrors the reasoning in raw-modules.d.ts: this Worker's `types` array is
// deliberately just ["@cloudflare/workers-types"], so a plain JS import from
// outside the package resolves to an implicit `any` and TS7016 fails the
// typecheck — which is how `npx wrangler deploy --dry-run`'s sibling step in
// ci.yml found this before CI did.
//
// 🔴 WHY THE TEST IMPORTS THE REAL MODULE AT ALL. test/health.test.ts asserts
// that `/v1/health` going unhealthy makes the LIVE deploy smoke fail. Restating
// `judgeOk`'s logic in the test would be a second copy of the contract, free to
// drift from the first — and the drift would show up as a green test beside a
// broken smoke, which is the class of failure this whole change is about. So the
// test runs the SHIPPED decision function over the SHIPPED response body, and
// this file only tells the type checker what shape that function has.
//
// The signatures below are TYPES, not behaviour: the implementations still come
// from tooling/ops/post-deploy-smoke.mjs at runtime.
declare module '*/post-deploy-smoke.mjs' {
  /** The `ok:true` conjunct `--require-ok` reads. False for any body that does
   *  not parse, or whose `ok` is not exactly `true`. */
  export function judgeOk(body: string): boolean;

  /** The build-identity decision: did the live surface answer 200 with the
   *  `field` the deploy joins on set to `expected`. */
  export function judge(args: {
    status: number;
    body: string;
    field: string;
    expected: string;
  }): { ok: boolean; retry?: boolean; reason?: string; actual?: string };
}
