// ─────────────────────────────────────────────────────────────────────────────
// supabaseAuth / erasureAuth — this Worker's two auth boundaries, BOUND, not
// implemented. Together with services/_shared/src/auth-middleware.ts this is the
// ONLY code that knows we use Supabase (the provider seam); the rest of the app
// reads c.get('userId') / c.get('userEmail').
//   PRIMARY  — asymmetric ES256 via Supabase JWKS, with a KV-cached key set as
//              the second attempt when, and ONLY when, the key set could not be
//              fetched at all.
//   FALLBACK — legacy HS256 shared secret, if SUPABASE_JWT_SECRET is set, and
//              the result is LABELLED `symmetric` so an irreversible route can
//              refuse it.
//
// ⏱ 2026-10-01 · rv2 SYN-S2 (services-012).
// This template carried its own copy of that plumbing — the third, beside
// services/subscriptiontracker-api's and services/platform's — and was ported
// from the app Worker by hand twice (2026-09-04, after #433/#435 reached the live
// Workers and not here). It now binds the one home, so a correction made
// there reaches every app ever stamped from this brick.
//
// ── 🔴 TWO AUTH BOUNDARIES, AND THE DIFFERENCE IS THE POINT ──────────────────
// [supabaseAuth] may fall back to the shared secret, and this file is where that
// secret is named — the one option the kit takes from its carrier. [erasureAuth]
// does only the asymmetric half, with no environment in scope, and `index.ts`
// mounts DELETE /v1/account behind it. `routes/account.ts` then RE-CHECKS the
// assurance label — two independent limbs, because the mounting is one line
// somebody can move and the route-level check is not.
// ─────────────────────────────────────────────────────────────────────────────
import { supabaseAuthWith } from '../../../_shared/src/auth-middleware';
import type { Env } from '../types';

/** The strict boundary, re-exported as it is: it takes no option at all. */
export { erasureAuth } from '../../../_shared/src/auth-middleware';

/** The permissive, labelled boundary, with this Worker's legacy secret. */
export const supabaseAuth = supabaseAuthWith<Env>({ legacyHs256Secret: (env) => env.SUPABASE_JWT_SECRET });
