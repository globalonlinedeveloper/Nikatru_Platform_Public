// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/entitlements?app_id=<id> — ANY product reads ITS entitlement from the
// host every stamped app already has. GET /v1/entitlements/subject — "what do I
// own".
//
// [pipeline 5]M-4. Unblocked by stage 4's [4]B-3 landing `platformAuth` on this
// Worker; this route is the money half that lift existed for.
//
// ── ⏱ 2026-09-10 · THE READ NO LONGER LIVES IN THIS FILE ─────────────────────
// It lives in services/_shared/src/entitlement-read.ts, THE ONE READER, and
// this file is the carrier: it validates nothing the reader does not, decides
// nothing, and renders the reader's answer into the wire envelope. The per-app
// Worker (services/subscriptiontracker-api/src/routes/entitlements.ts) mounts
// the SAME module and renders the SAME literal, and
// tooling/ci/assert-one-entitlement-reader.mjs refuses a second
// `FROM entitlements` anywhere a route could grow one. The five fail-closed
// rules, the union ([ADR 057] §5), G8/G10/G11 and the [5]M-12 refusal are all
// enumerated in that module's header; nothing about the ANSWER changed and
// test/entitlements.test.ts + test/bundle-entitlements.test.ts are unchanged
// and green, which is the measurement that the move preserved every rule.
//
// WHY IT LIVES HERE AND NOT ONLY IN A PER-APP WORKER. The brick's DEFAULT stamp
// is CLIENT-ONLY — it deploys no Worker of its own ([ADR 020]). Fifty apps
// cannot each grow a Worker to answer one question about a table they all share.
//
// ── 🔴 THE ORIGINAL ACCEPTANCE CRITERION COULD NOT FAIL ──────────────────────
// "An unauthenticated request to the same route is refused" is satisfied by a
// route that DOES NOT EXIST: a 404 is non-2xx, i.e. "refused". Three things
// replace it, and a 404 satisfies none of them:
//   1. an unauthenticated request returns **401 specifically**;
//   2. a token signed by the LEGACY HS256 shared secret is rejected — the
//      shared Worker deliberately has no symmetric fallback (middleware/auth.ts
//      records why), and that divergence has to be exercised, not asserted;
//   3. a request for **app B never returns app A's rows** — the app_id scoping
//      limb the whole shared-table design rests on.
//
// ── WHAT THIS FILE INJECTS INTO THE READER, AND WHY ──────────────────────────
//   · `isKnownProduct` = `isAttributableProduct` from ../config — every product
//     register but the bundle one, read through catalog JSON that esbuild
//     inlines. A bundle id stays 404 here: a bundle is read through the subject
//     route's `bundles[]`, and a per-product row for it would unlock nothing, so
//     answering 200 `is_pro:false` would be a false NO to a bundle owner. The
//     subject route never consults this set. The reader cannot import
//     it (services/_shared may carry no `..` import, and nothing a guard loads
//     under bare Node may import config.ts — ERR_IMPORT_ATTRIBUTE_MISSING).
//   · `isMoneyEnvironment` from ../lib/mor/contract — contracts/entitlement's
//     two-value vocabulary, which this Worker imports rather than restates.
//   · `allRows` from ../lib/d1 — this Worker's transient-D1 retry.
//
// ── THE RESPONSE LITERAL IS WRITTEN HERE ON PURPOSE ──────────────────────────
// tooling/ci/assert-analytics-contract.mjs pins the envelope of THIS route
// against the released Dart client by parsing the `c.json({ … })` literal in
// this file, and FOLLOWS `entitlements: read.entitlements` into the reader for
// the item shape. The per-app carrier writes the identical literal, and each
// Worker's test/one-entitlement-reader.test.ts asserts its own carrier against
// the same expected bytes (services/_shared/test/entitlement-parity.ts) — the
// two are held byte-identical without either suite importing the other Worker.
//
// 🔴 `bundle` IS A NAMED KEY, NOT A SPREAD, AND THAT IS NOT A STYLE CHOICE. The
// first version wrote `...(bundleBlock === null ? {} : { bundle })`, and
// assert-analytics-contract.mjs refused it: a key the scan cannot name is a key
// it cannot compare. `undefined` is dropped by JSON serialisation, so the key is
// ABSENT rather than null when no grant exists ([ADR 057] §6 — additive only).
// ─────────────────────────────────────────────────────────────────────────────
import type { SqlDb } from '../../../_shared/src/ports/sql';
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { allRows } from '../lib/d1';
import { isAttributableProduct } from '../config';
import { isMoneyEnvironment } from '../lib/mor/contract';
import {
  type EntitlementReadDeps,
  readProductEntitlement,
  readSubjectEntitlements,
} from '../../../_shared/src/entitlement-read';

const entitlements = new Hono<AppEnv>();

/** The reader's dependencies, all of them this Worker's own plumbing. */
const readerDeps = (db: SqlDb): EntitlementReadDeps => ({
  db,
  allRows,
  isMoneyEnvironment,
  isKnownProduct: isAttributableProduct,
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
});

entitlements.get('/entitlements', async (c) => {
  const userId = c.get('userId');
  const rid = c.get('requestId') ?? '-';

  // THE PRODUCT IS A REQUEST PARAMETER on the shared host — on a per-app Worker
  // it is `c.env.APP_ID`. The parameter is still spelled `app_id` (a released
  // contract) but the set it is checked against is every product register:
  // apps, extensions, scripts. The reader does the check.
  const appId = c.req.query('app_id') ?? '';
  const read = await readProductEntitlement(readerDeps(c.env.PLATFORM_DB), {
    userId,
    productId: appId,
    environment: c.env.MONEY_ENVIRONMENT,
    rid,
  });

  // An unknown id is a 404 rather than an empty list: an empty list says "you
  // own nothing here", a different and misleading answer to "no such product".
  if (read.kind === 'unknown_product') {
    return c.json({ error: 'unknown_app' }, 404);
  }
  c.set('appId', appId); // [pipeline B-16] attribution, post-validation.

  // [5]M-12 — no safe default exists for the money world.
  if (read.kind === 'money_rail_not_configured') {
    return c.json({ error: 'money_rail_not_configured' }, 503);
  }

  return c.json({
    app_id: read.app_id,
    is_pro: read.is_pro,
    granted_via: read.granted_via,
    entitlements: read.entitlements,
    bundle: read.bundle ?? undefined,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/entitlements/subject — "what do I own", which the per-app route
// cannot answer.
//
// WHY A SECOND ROUTE RATHER THAN A WIDER FIRST ONE. `/entitlements?app_id=X` is
// scoped to one app by design and every shipped client depends on that scoping
// ([ADR 057] §6). Widening it would change the response of a released contract;
// adding a route changes nothing that exists. The account page and the "manage
// your subscription where you bought it" copy both need the subject-wide answer,
// and `bundle_grants.source` is what makes that copy honest — cross-rail
// cancellation is impossible by construction on every store rail, so naming the
// rail that holds the subscription is the only truthful thing a UI can say.
//
// Same auth (`platformAuth`), same environment refusal, same five rules through
// the same reader.
// ─────────────────────────────────────────────────────────────────────────────
entitlements.get('/entitlements/subject', async (c) => {
  const userId = c.get('userId');
  const rid = c.get('requestId') ?? '-';

  const read = await readSubjectEntitlements(readerDeps(c.env.PLATFORM_DB), {
    userId,
    environment: c.env.MONEY_ENVIRONMENT,
    rid,
  });
  if (read.kind === 'money_rail_not_configured') {
    return c.json({ error: 'money_rail_not_configured' }, 503);
  }

  return c.json({
    products: read.products,
    bundles: read.bundles,
  });
});

export default entitlements;
