// ─────────────────────────────────────────────────────────────────────────────
// supabaseAuth / erasureAuth — this Worker's two auth boundaries, BOUND, not
// implemented.
//
// ⏱ 2026-10-01 · rv2 SYN-S2 (services-012).
// The plumbing — the remote JWKS getter, the KV warm, the cached-key-set
// fallback, the HS256 fallback, the revocation read and both middlewares — moved
// WHOLE to services/_shared/src/auth-middleware.ts; this file binds it.
// It was a hand copy of the brick's template's (the same code under different
// comments) and of the plumbing inlined in services/platform; the header there
// holds the history: #433 reaching platform and not this Worker, the
// twice-corrected `isKeySetUnavailable`, the silent HS256 downgrade on a JWKS
// outage, and why the erasure boundary takes no environment.
//
// SWAP-PROVIDER NOTE: this file and services/_shared/src/auth-middleware.ts are
// the only code that knows we use Supabase; the rest of the app reads
// c.get('userId') / c.get('userEmail').
//
// ── 🔴 WHAT STAYS HERE IS THE ONE LINE THAT NAMES THE SECRET ────────────────
// `supabaseAuth` may fall back to the legacy HS256 shared secret and LABELS the
// result `tokenAssurance: 'symmetric'`; `erasureAuth` verifies ES256 only, with
// no environment in scope. Which secret, if any, the permissive boundary may use
// is this Worker's to declare, so the kit takes it as an option and this file is
// where SUPABASE_JWT_SECRET is read — which is also where
// tooling/ci/assert-erasure-reach.mjs limb 3 looks for it. `index.ts` mounts
// DELETE /v1/account behind `erasureAuth`, and `routes/account.ts` re-checks the
// label: two limbs, because a mounting is a line somebody can move.
// ─────────────────────────────────────────────────────────────────────────────
import { supabaseAuthWith } from '../../../_shared/src/auth-middleware';
import type { Env } from '../types';

/** The strict boundary, re-exported as it is: it takes no option at all. */
export { erasureAuth } from '../../../_shared/src/auth-middleware';

/** The permissive, labelled boundary, with this Worker's legacy secret. */
export const supabaseAuth = supabaseAuthWith<Env>({ legacyHs256Secret: (env) => env.SUPABASE_JWT_SECRET });
