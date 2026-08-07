#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-purchase-path.mjs — the CLIENT money rail's invariants.
// [pipeline 5]M-6 (checkout) · M-8 (the revocation bound) · M-9 (ROSCA) ·
// M-10 (restore) · M-15 (platform declaration).
//
// 🔴 EVERY LIMB HERE REPLACES AN ACCEPTANCE CRITERION THAT COULD NOT FAIL. That
// is not a stylistic note — it is what the file is for, and each replacement is
// named beside the limb that carries it:
//
//   · M-15's "purchase paths declare their platforms and degrade" is satisfied
//     by SIX ROWS OF `false`: a rail that is dead everywhere degrades perfectly.
//     → replaced by: the row set must EQUAL the registered channel set, at least
//       one channel must be genuinely sellable, and every `false` must carry a
//       reason.
//   · M-9's "cancel steps <= purchase steps" was VACUOUSLY TRUE. With no
//     purchase flow at all, `0 <= 0` passed — so a legal-conduct requirement was
//     green for exactly as long as the thing it protects was missing.
//     → replaced by: BOTH counts floored at >= 1, derived from the SAME router
//       graph, with the origin surface itself required to be reachable.
//   · M-8's "revoked within the declared bound" cannot fail either: declare 365
//     days and a refunded user keeps Pro for a year, green.
//     → replaced by: the named constant is compared against the trial length and
//       the shortest billing period, both read from the rail config.
//   · M-6's "a checkout is launched" is satisfied by a widget test of the poller
//     on an app that cannot open a checkout.
//     → replaced by: every channel the matrix marks sellable must be NAMED in
//       the launcher's test file. Claimed-but-unexercised is a build failure.
//
// Usage:  node tooling/ci/assert-purchase-path.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const problems = [];
const ok = (m) => console.log(`ok   ${m}`);

const CAPS = 'packages/purchases/lib/src/purchase_capabilities.dart';
const CAPS_TEST = 'packages/purchases/test/purchase_capabilities_test.dart';
const RAIL_TEST = 'packages/purchases/test/hosted_checkout_rail_test.dart';
const CONVERGENCE = 'packages/purchases/lib/src/entitlement_convergence.dart';
const CACHE = 'packages/core/lib/src/entitlement_cache.dart';
const CHANNELS = 'tooling/channel-register.json';
// [pipeline 4]B-2 — THE RAIL CONFIG IS DATA, AND THIS FILE USED TO GREP IT.
// The offerings (`product_id`, `term`, `trial_days`) and `paywall.enabled` were
// read out of `services/platform/src/config.ts` with regexes over TypeScript
// literals. B-2 moved the served values into a JSON document so onboarding an
// app needs no Worker source edit; the regexes then matched nothing and this
// guard went COVERAGE LOST on its first run after the refactor — which is
// exactly what it was built to do. It is re-pointed at the document and now
// PARSES rather than greps, which is what this repo asks for anyway.
const SERVER_CONFIG = 'services/platform/src/app-config-data.json';
const SERVER_TYPES = 'services/platform/src/types.ts';

/**
 * Every offering the rail declares, and whether any app's paywall is live.
 *
 * 🔴 RESOLVED PER APP, NOT READ OFF ONE OBJECT. An app with no entry of its own
 * is served `defaults`, so the domain is `defaults` ∪ every per-app entry — the
 * same union the Worker's `buildRegistry` produces. Reading only `defaults`
 * would report zero offerings while subly sells two, and "0 of 0" reads exactly
 * like a compliant portfolio, which is the ambiguity T-11 was deferred over.
 */
function railFromData(json) {
  const offerings = [];
  let paywallLive = false;
  const seen = new Set();
  const take = (label, node) => {
    if (!node || typeof node !== 'object') return;
    const pw = node.paywall;
    if (!pw || typeof pw !== 'object') return;
    if (pw.enabled === true) paywallLive = true;
    if (!Array.isArray(pw.offerings)) return;
    for (const o of pw.offerings) {
      if (!o || typeof o !== 'object') continue;
      // Keyed so an app that inherits `defaults` does not double-count the same
      // sku: the count is printed in the T-11 verdict and has to mean something.
      const key = `${label}:${o.product_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      offerings.push({
        id: typeof o.product_id === 'string' ? o.product_id : '(unnamed)',
        term: typeof o.term === 'string' ? o.term : null,
        trialDays: Number.isFinite(o.trial_days) ? Number(o.trial_days) : 0,
      });
    }
  };
  take('_defaults', json?.defaults);
  const apps = json?.apps;
  if (apps && typeof apps === 'object') for (const k of Object.keys(apps)) take(k, apps[k]);
  return { offerings, paywallLive };
}
const ROUTER = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/core/router.dart';
const BRICK_LIB = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib';

function read(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8');
}

/** Comments stripped. Every scan below is over CODE — this repo has already
 *  shipped a guard that matched the comment explaining why the thing it looked
 *  for was absent. */
const code = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

// ═══════════════════════════════════════════════════════════════════════════
// A · THE MATRIX COVERS EVERY REGISTERED CHANNEL — [5]M-15
// ═══════════════════════════════════════════════════════════════════════════
// Derived from the CHANNEL REGISTER, not from a list kept here. A guard whose
// right-hand side is its own hand-kept list stops covering a channel the day one
// is added and never says so.
let permitted = [];
{
  const capsRaw = read(CAPS);
  const chRaw = read(CHANNELS);
  if (capsRaw === null) {
    problems.push(`COVERAGE LOST — ${CAPS} does not exist, so no platform declaration could be checked at all.`);
  } else if (chRaw === null) {
    problems.push(`COVERAGE LOST — ${CHANNELS} does not exist, so the channel set the matrix must equal is unknown.`);
  } else {
    const caps = code(capsRaw);
    let registered = [];
    try {
      registered = (JSON.parse(chRaw).channels ?? []).map((c) => c.id).filter(Boolean);
    } catch (e) {
      problems.push(`COVERAGE LOST — ${CHANNELS} did not parse (${e.message}).`);
    }

    // The enum's registerId strings, parsed structurally.
    const declared = [...caps.matchAll(/^\s*([a-zA-Z]\w*)\('([^']+)'\)[,;]/gm)].map((m) => ({
      member: m[1],
      id: m[2],
    }));

    const MIN_CHANNELS = 6;
    if (registered.length < MIN_CHANNELS) {
      problems.push(
        `COVERAGE LOST — the channel register yields only ${registered.length} channel(s), expected >= ${MIN_CHANNELS}. A matrix compared against an empty set is a matrix that asserts nothing.`,
      );
    }

    const declaredIds = new Set(declared.map((d) => d.id));
    const missing = registered.filter((id) => !declaredIds.has(id));
    const extra = declared.map((d) => d.id).filter((id) => !registered.includes(id));
    if (missing.length) {
      problems.push(
        `PurchaseChannel does not cover ${missing.join(', ')} — channel(s) the factory ships through with NO declared purchase capability. "Where may we sell?" would be answered by silence, which every caller reads as no.`,
      );
    }
    if (extra.length) {
      problems.push(
        `PurchaseChannel declares ${extra.join(', ')}, which ${CHANNELS} does not register. A row for a channel nobody ships through inflates the matrix without covering anything.`,
      );
    }

    // Each row's two booleans and its reason, parsed from the switch.
    //
    // 🔴 `why` IS CAPTURED AS ITS OWN STRING LITERALS AND NOTHING ELSE. The
    // first version captured `[\s\S]*?` up to the closing `);`, so a row with
    // `why: ''` followed by any other long field passed the substance check by
    // borrowing that field's length. Mutation-proven on the real tree: a
    // capability row lost its reason entirely and this printed ok. Only adjacent
    // single-quoted literals now count, which is exactly what the field is.
    const rows = new Map();
    const ROW_RE = new RegExp(
      String.raw`case\s+PurchaseChannel\.(\w+):(?:\s*case\s+PurchaseChannel\.(\w+):)?\s*` +
        String.raw`return\s+const\s+PurchaseCapabilities\(\s*technicallySupported:\s*(true|false)\s*,\s*` +
        String.raw`channelPermitted:\s*(true|false)\s*,\s*why:\s*((?:\s*'(?:[^'\\]|\\.)*')+)\s*,?\s*\);`,
      'g',
    );
    for (const m of caps.matchAll(ROW_RE)) {
      const why = m[5].trim();
      for (const member of [m[1], m[2]]) {
        if (member) rows.set(member, { tech: m[3] === 'true', permitted: m[4] === 'true', why });
      }
    }

    for (const d of declared) {
      const row = rows.get(d.member);
      if (!row) {
        problems.push(`PurchaseChannel.${d.member} has no \`case\` in \`forChannel\`, so its capabilities are undeclared.`);
        continue;
      }
      // 🔴 A `false` WITH NO REASON IS INDISTINGUISHABLE FROM AN OVERSIGHT, and
      // this is the field that makes the matrix a compliance artifact rather
      // than a table of booleans: "we cannot" and "we are not allowed to" are
      // different facts with different owners.
      if (!/^['"]/.test(row.why) || row.why.replace(/['"\s+]/g, '').length < 20) {
        problems.push(
          `PurchaseChannel.${d.member} declares no substantive \`why\`. A capability row without its reason cannot be reviewed, and a \`channelPermitted: false\` without one is indistinguishable from somebody not having got to it.`,
        );
      }
    }

    permitted = declared.filter((d) => rows.get(d.member)?.tech && rows.get(d.member)?.permitted);

    // THE FLOOR THAT KILLS "six rows of false is a complete matrix".
    if (permitted.length === 0) {
      problems.push(
        `NO CHANNEL CAN SELL — every row is technically-unsupported or channel-forbidden. That is a complete matrix describing a dead rail, and it is exactly what M-15's original wording scored as a pass. At least one channel must have a working, permitted mechanism.`,
      );
    } else {
      ok(`${declared.length} channel(s) declared, ${permitted.length} sellable: ${permitted.map((p) => p.id).join(', ')}`);
    }

    // ── B · CLAIMED IS EXERCISED — [5]M-6(a) ────────────────────────────────
    // "For every platform the adapter marks supported, a test asserts the
    // launcher opens the checkout." A platform cannot be marked sellable without
    // a test that opens it.
    const railTest = read(RAIL_TEST);
    if (railTest === null) {
      problems.push(`${RAIL_TEST} does not exist, so no channel's launcher has ever been exercised.`);
    } else {
      const unexercised = permitted.filter(
        (p) => !new RegExp(`PurchaseChannel\\.${p.member}\\b`).test(railTest),
      );
      if (unexercised.length) {
        problems.push(
          `CLAIMED BUT UNEXERCISED — ${unexercised
            .map((p) => p.id)
            .join(', ')} are declared sellable but named nowhere in ${RAIL_TEST}. A rail marked working on a platform nobody has watched it work on is a claim, not a capability.`,
        );
      } else {
        ok(`all ${permitted.length} sellable channel(s) exercised in ${RAIL_TEST}`);
      }
    }
    if (!existsSync(join(ROOT, CAPS_TEST))) {
      problems.push(`${CAPS_TEST} does not exist — the capability matrix has no test of its own.`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// C · THE REVOCATION BOUND IS A RELATIONSHIP — [5]M-8
// ═══════════════════════════════════════════════════════════════════════════
// The ceiling must be <= the trial length AND <= the shortest billing period,
// both read from the RAIL CONFIG rather than from a number typed here.
{
  const cacheRaw = read(CACHE);
  const cfgRaw = read(SERVER_CONFIG);
  if (cacheRaw === null || cfgRaw === null) {
    problems.push(`COVERAGE LOST — ${CACHE} or ${SERVER_CONFIG} is missing, so the staleness ceiling was compared against nothing.`);
  } else {
    const m = code(cacheRaw).match(/kEntitlementStalenessCeiling\s*=\s*Duration\(days:\s*(\d+)\)/);
    if (!m) {
      problems.push(
        `\`kEntitlementStalenessCeiling\` is not declared as \`Duration(days: N)\` in ${CACHE}. M-8's bound must be a NAMED CONSTANT this guard can read — "within the declared bound" with no readable declaration is a sentence, not a bound.`,
      );
    } else {
      const ceilingDays = Number(m[1]);
      let railOfferings = [];
      try {
        railOfferings = railFromData(JSON.parse(cfgRaw)).offerings;
      } catch (e) {
        problems.push(`COVERAGE LOST — ${SERVER_CONFIG} does not parse (${e.message}); the rail's terms could not be read.`);
      }
      const trials = railOfferings.map((o) => o.trialDays);
      const terms = railOfferings.map((o) => o.term).filter((t) => t !== null);
      if (trials.length === 0 || terms.length === 0) {
        problems.push(
          `COVERAGE LOST — no \`trial_days\` / \`term\` found in ${SERVER_CONFIG}'s rail config, so the ceiling was compared against nothing. The two facts M-8's bound is relative to have to come from the config, not from this file.`,
        );
      } else {
        const shortestTrial = Math.min(...trials);
        // The shortest billing period the rail actually sells. `month` is
        // treated as 28 days: the bound must hold for February too.
        const PERIOD_DAYS = { month: 28, year: 365, one_time: Infinity };
        const shortestPeriod = Math.min(...terms.map((t) => PERIOD_DAYS[t] ?? Infinity));
        if (ceilingDays > shortestTrial) {
          problems.push(
            `THE BOUND OUTLIVES THE TRIAL — kEntitlementStalenessCeiling is ${ceilingDays}d but the shortest trial is ${shortestTrial}d. A user who cancels on the last trial day would keep honoured access past it.`,
          );
        } else if (ceilingDays > shortestPeriod) {
          problems.push(
            `THE BOUND OUTLIVES THE BILLING PERIOD — kEntitlementStalenessCeiling is ${ceilingDays}d but the shortest period the rail sells is ${shortestPeriod}d. A subscriber whose renewal failed keeps a period they did not pay for, and stage 13 cut dunning, so nothing else is coming to catch it.`,
          );
        } else {
          ok(`revocation bound ${ceilingDays}d <= trial ${shortestTrial}d and <= shortest period ${shortestPeriod}d`);
        }
      }
    }

    // The bound has to be CONSULTED, not merely declared. A constant nothing
    // reads is the shape this whole file exists to reject.
    // 🔴 THE CONJUNCTION, NOT THE TWO WORDS. The first version tested
    // `/isStaleAt\(/` and `/connectivityAvailable/` separately — and
    // `connectivityAvailable` is a PARAMETER NAME, so it stayed present when the
    // `&&` that actually consults it was deleted. Mutation-proven on the real
    // tree: the ceiling became an unconditional countdown that locks a paying
    // user out for being in a tunnel, and this printed ok.
    if (!/connectivityAvailable\s*&&\s*isStaleAt\s*\(/.test(code(cacheRaw))) {
      problems.push(
        `${CACHE} declares the ceiling but does not apply it through \`isStaleAt\` gated on \`connectivityAvailable\`. Without the connectivity half the bound is a countdown, and it locks a paying user out for being in a tunnel.`,
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// D · THE CONVERGENCE WAIT IS BOUNDED — [5]M-6(b)
// ═══════════════════════════════════════════════════════════════════════════
{
  const raw = read(CONVERGENCE);
  if (raw === null) {
    problems.push(`COVERAGE LOST — ${CONVERGENCE} is missing; nothing bounds the post-checkout wait.`);
  } else {
    const list = code(raw).match(/kCheckoutConvergenceDelays\s*=\s*<Duration>\[([\s\S]*?)\]/);
    const n = list ? (list[1].match(/Duration\(/g) ?? []).length : 0;
    // A bound, and a bound on the bound: the whole factory shares a 100k
    // Worker-requests/day ceiling across ~50 apps, so an over-generous plan is a
    // client-side denial of service against every other app's config resolution.
    if (n === 0) {
      problems.push(`${CONVERGENCE} declares no convergence delays, so the post-checkout poll is unbounded. A "poll until it arrives" loop spends a shared daily request ceiling.`);
    } else if (n > 8) {
      problems.push(`${CONVERGENCE} declares ${n} convergence attempts. The portfolio shares one 100k requests/day ceiling across ~50 apps; keep the plan at 8 or fewer.`);
    } else {
      ok(`post-checkout convergence is bounded at ${n + 1} server read(s)`);
    }
    if (!/stillPending/.test(code(raw)) || !/couldNotAsk/.test(code(raw))) {
      problems.push(
        `${CONVERGENCE} does not distinguish \`stillPending\` from \`couldNotAsk\`. "We asked and the answer is not yet" and "we could not ask" need different sentences and different retry advice; collapsing them tells a paying user their purchase failed.`,
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// E · ROSCA — [5]M-9, derived from the ROUTER, both counts floored at >= 1
// ═══════════════════════════════════════════════════════════════════════════
// THE ORIGIN IS SETTINGS, DELIBERATELY, and it is the only origin that makes the
// comparison mean what the rule means. ROSCA asks that cancelling be no harder
// than the mechanism used to subscribe; the subscription-management surface is
// where a user goes looking for either. Measuring from HOME would score the
// paywall gate's contextual upgrade button as a shortcut and mark the rail
// non-compliant for offering it — the opposite of the rule's intent.
//
// The origin's OWN reachability is asserted first. "One tap from Settings" is
// worth nothing if nothing is a tap from Settings — which was literally true in
// this chassis until 2026-08-01, when the Settings nav destination was found to
// set an index and navigate nowhere.
{
  const routerRaw = read(ROUTER);
  if (routerRaw === null) {
    problems.push(`COVERAGE LOST — ${ROUTER} is missing, so no step count could be derived.`);
  } else {
    const router = code(routerRaw);
    const routes = [...router.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
    const MIN_ROUTES = 5;
    if (routes.length < MIN_ROUTES) {
      problems.push(`COVERAGE LOST — the router declares only ${routes.length} route(s), expected >= ${MIN_ROUTES}.`);
    }

    // The navigation graph: every `context.go('X')` anywhere in the stamped
    // chassis is an edge INTO X. Edges are collected per FILE and mapped back to
    // the route whose builder names that file's screen, so the graph is the
    // router's, not a description of it.
    const edges = new Map(); // route -> Set(route)
    const fileOfRoute = new Map();
    for (const m of router.matchAll(/path:\s*'([^']+)'[\s\S]{0,200?}?/g)) void m;
    for (const m of router.matchAll(/path:\s*'([^']+)',\s*builder:[\s\S]*?const\s+(\w+)\(/g)) {
      fileOfRoute.set(m[1], m[2]);
    }

    const { statSync } = await import('node:fs');
    const files = [];
    const walk = (d) => {
      for (const e of listDir(d)) {
        const f = join(d, e);
        if (statSync(f).isDirectory()) walk(f);
        else if (e.endsWith('.dart')) files.push(f);
      }
    };
    try {
      walk(join(ROOT, BRICK_LIB));
    } catch {
      /* absent — reported by the COVERAGE LOST above */
    }

    const screenFile = new Map(); // ScreenClass -> file body
    for (const f of files) {
      const src = code(readFileSync(f, 'utf8'));
      for (const m of src.matchAll(/class\s+(\w+)\s+extends\s+(?:Consumer)?(?:Stateful|Stateless)?Widget/g)) {
        screenFile.set(m[1], src);
      }
      // ConsumerStatefulWidget / StatefulWidget bodies live with their State
      // class, so the go() calls are collected from the whole file either way.
      for (const m of src.matchAll(/class\s+(\w+)\s+extends\s+ConsumerStatefulWidget/g)) {
        screenFile.set(m[1], src);
      }
    }

    for (const [route, screen] of fileOfRoute) {
      const body = screenFile.get(screen);
      if (!body) continue;
      const outs = new Set([...body.matchAll(/context\.go\('([^']+)'\)/g)].map((m) => m[1]));
      edges.set(route, outs);
    }
    // The gate's upgrade button lives in the home screen, whose own class is
    // matched above, so `/` -> `/paywall` is already an edge.

    const hops = (from, to) => {
      const seen = new Set([from]);
      let frontier = [from];
      let d = 0;
      while (frontier.length) {
        d++;
        const next = [];
        for (const r of frontier) {
          for (const n of edges.get(r) ?? []) {
            if (n === to) return d;
            if (!seen.has(n)) {
              seen.add(n);
              next.push(n);
            }
          }
        }
        frontier = next;
      }
      return Infinity;
    };

    const settingsFromHome = hops('/', '/settings');
    if (!Number.isFinite(settingsFromHome)) {
      problems.push(
        `THE ORIGIN IS UNREACHABLE — no path of \`context.go\` calls leads from '/' to '/settings', so "one tap from Settings" measures a distance from nowhere. This was literally the case in this chassis until 2026-08-01: the Settings nav destination set an index and navigated nowhere, and every screen behind /settings was unreachable while assert-screen-set.mjs printed ok.`,
      );
    } else {
      ok(`/settings is ${settingsFromHome} hop(s) from '/'`);
    }

    const buy = hops('/settings', '/paywall');
    const cancel = hops('/settings', '/manage-plan');

    // 🔴 BOTH FLOORS. `0 <= 0` is what made the original criterion pass on an
    // app with no purchase flow at all.
    if (!Number.isFinite(buy) || buy < 1) {
      problems.push(`NO PURCHASE PATH from /settings — the subscribe mechanism is unreachable, so ROSCA's comparison has no left-hand side and would pass vacuously.`);
    }
    if (!Number.isFinite(cancel) || cancel < 1) {
      problems.push(`NO CANCEL PATH from /settings — a user cannot cancel in-app at all. This is the requirement, not an edge case.`);
    }
    if (Number.isFinite(buy) && Number.isFinite(cancel)) {
      if (cancel > buy) {
        problems.push(
          `ROSCA — cancelling is ${cancel} hop(s) from Settings and subscribing is ${buy}. Cancelling must be no harder than the mechanism used to subscribe.`,
        );
      } else {
        ok(`ROSCA — subscribe ${buy} hop(s), cancel ${cancel} hop(s), both from /settings`);
      }
    }

    // Both entry points in the SAME surface. Equal hop counts do not stop the
    // cancel entry being moved to a screen a user has to know exists.
    const settingsSrc = files.find((f) => f.endsWith(join('settings', 'settings_screen.dart')));
    if (!settingsSrc) {
      problems.push('COVERAGE LOST — the settings screen was not found, so the "same surface" check ranged over nothing.');
    } else {
      const s = code(readFileSync(settingsSrc, 'utf8'));
      const hasBuy = /context\.go\('\/paywall'\)/.test(s);
      const hasCancel = /context\.go\('\/manage-plan'\)/.test(s);
      if (!hasBuy || !hasCancel) {
        problems.push(
          `THE TWO ENTRY POINTS ARE NOT IN THE SAME SURFACE — settings_screen.dart offers ${hasBuy ? 'Upgrade' : 'no Upgrade'} and ${hasCancel ? 'Manage' : 'no Manage'}. A cancel entry a level deeper than the upgrade entry is the pattern ROSCA exists to stop, and it survives an equal hop count.`,
        );
      } else {
        ok('subscribe and cancel are offered from the same surface');
      }
    }

    // ── F · RESTORE — [5]M-10 ─────────────────────────────────────────────
    // On this rail the entitlement is a server row keyed (user_id, app_id), so
    // signing in IS the restore. The CONTROL still has to exist, and it has to
    // do a server read rather than consult the cache.
    const manage = files.find((f) => f.endsWith(join('monetization', 'manage_plan_screen.dart')));
    if (!manage) {
      problems.push(`COVERAGE LOST — the manage-plan screen is missing, so restore ([5]M-10) could not be checked.`);
    } else {
      const s = code(readFileSync(manage, 'utf8'));
      // 🔴 SCOPED TO `_restore`, NOT TO THE FILE. `refreshEntitlements(` also
      // appears in the CANCEL path, so a file-level match survived deleting the
      // restore control's own server read entirely. Mutation-proven.
      const restoreBody =
        new RegExp(String.raw`Future<void>\s+_restore\(\)\s*async\s*\{[\s\S]{0,600}?\n  \}`).exec(s)?.[0] ?? '';
      if (!/refreshEntitlements\(/.test(restoreBody) || !/restorePurchases/.test(s)) {
        problems.push(
          `NO RESTORE CONTROL — manage_plan_screen.dart has no \`_restore\` calling \`refreshEntitlements\`. Apple guideline 3.1.1 makes an explicit Restore control mandatory the day a native IAP rail ships, and its absence is a documented rejection cause.`,
        );
      } else {
        ok('restore control present and backed by a server read');
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// E · A QUALIFYING AUTO-RENEWING SKU MAY NOT GO LIVE WITH NO RENEWAL NOTICE
//     [pipeline 13]T-11
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 WHY THIS COULD NOT BE WRITTEN BEFORE AND CAN BE NOW. T-11 was deferred
// with the reason "no SKU declaration surface exists anywhere" — the predicate
// had no domain, and a guard printing `0 of 0 SKUs match` against a file that
// does not exist is the unfalsifiable shape this repo keeps deleting. [5]M-11
// landed the surface: `services/platform/src/config.ts`'s rail config now
// declares real offerings with a `term` and a `trial_days`, and
// `packages/purchases` parses them. The domain is non-empty and enumerable, so
// the tripwire is writable.
//
// ⚠️ WHAT THIS DELIBERATELY DOES **NOT** ENCODE. No notice window, no lead
// time, no cadence, no "N days before renewal". Whether an on-device
// notification can satisfy §17602(h)(1)'s medium clause given the statute's
// non-exhaustive wording, and whether a merchant of record's own renewal mail
// discharges the duty for these apps, are LEGAL DETERMINATIONS routed to
// [8]K-13. Writing a number here would be inventing the very thing that is
// under determination. What this asserts is only the conditional: a qualifying
// SKU must not reach a live paywall while the notice mechanism is undeclared.
//
// ⚠️ AND THE HONEST CONSEQUENCE, PRINTED RATHER THAN HIDDEN: this factory has
// NO qualifying notice medium at all today. Stage 13 deliberately cut an email
// channel, and [4]B-12 owns only transactional auth mail and is itself blocked
// on owner-only credentials. So a qualifying SKU cannot ship on the current
// stack — that is a stronger statement than "its timers are missing", and it is
// the one that should be read before anybody flips the switch.
{
  const cfgRaw = read(SERVER_CONFIG);
  const typesRaw = read(SERVER_TYPES);
  if (cfgRaw === null || typesRaw === null) {
    problems.push(
      `COVERAGE LOST — ${SERVER_CONFIG} or ${SERVER_TYPES} is missing, so the qualifying-SKU domain was computed over nothing. An empty domain reads exactly like a compliant one.`,
    );
  } else {
    // Parsed per offering, never by two independent greps: `[...trial_days]` and
    // `[...term]` collected separately cannot tell WHICH sku has which, so a
    // one-time sku with a trial and a renewing one without would classify as
    // the reverse and the count would still look right. That property is now
    // free — the document is JSON and each offering is one object.
    let offerings = [];
    let paywallLive = false;
    try {
      ({ offerings, paywallLive } = railFromData(JSON.parse(cfgRaw)));
    } catch (e) {
      problems.push(`COVERAGE LOST — ${SERVER_CONFIG} does not parse (${e.message}); T-11's SKU domain is empty for a reason that is not "no products".`);
    }
    if (offerings.length === 0) {
      problems.push(
        `COVERAGE LOST — no offering could be parsed out of ${SERVER_CONFIG}'s rail config. T-11's domain is the declared SKU set; with nothing parsed the tripwire below is satisfied by having no products, which is not the same as having compliant ones.`,
      );
    } else {
      // Qualifying = it renews by itself, or it starts free and then charges.
      // Both are the shape consumer-renewal law is written about; a genuine
      // one-time purchase with no trial is not.
      const qualifying = offerings.filter((o) => (o.term !== null && o.term !== 'one_time') || o.trialDays > 0);
      // `paywallLive` — the one readable "is it live" signal in the tree — is
      // resolved above, over `defaults` AND every per-app entry. A stamped app is
      // born with the paywall off, so today this is false for every app.
      // What would close the gap, named so the waiver cannot outlive it: a
      // typed `renewal_notice` on the config contract AND a non-null value.
      // Naming the closing evidence is what stops "we are still deciding" from
      // becoming permanent.
      //
      // ⚠️ THE SECOND OPERAND WAS A LATENT CRASH FOR ONE COMMIT. When this file
      // moved off the TS source it kept testing a variable (`cfg`) the refactor
      // had deleted — and NOTHING went red, because `renewal_notice` is absent
      // from types.ts today so `&&` short-circuited before reaching it. The
      // guard would have thrown `ReferenceError` on the exact day the feature
      // arrived, i.e. the one day it matters. It reads the parsed document now,
      // so the operand is evaluated on every run and cannot rot unobserved.
      //
      // BOTH PLACEMENTS ARE ACCEPTED — on the config or on its `paywall` — and
      // that is not laxity. Where the field lands is part of the [8]K-13 legal
      // determination that has not been made; the predecessor regex searched the
      // whole file and so accepted either, and narrowing it here would decide by
      // accident a question this guard explicitly refuses to decide.
      const noticeValues = [];
      {
        const collect = (node) => {
          if (!node || typeof node !== 'object') return;
          for (const scope of [node, node.paywall]) {
            if (scope && typeof scope === 'object' && Object.prototype.hasOwnProperty.call(scope, 'renewal_notice')) {
              noticeValues.push(scope.renewal_notice);
            }
          }
        };
        try {
          const parsed = JSON.parse(cfgRaw);
          collect(parsed?.defaults);
          if (parsed?.apps && typeof parsed.apps === 'object') {
            for (const k of Object.keys(parsed.apps)) collect(parsed.apps[k]);
          }
        } catch {
          // Already reported as COVERAGE LOST above; do not double-report.
        }
      }
      const noticeDeclared =
        /renewal_notice/.test(code(typesRaw)) && noticeValues.some((v) => v !== null && v !== undefined);

      if (qualifying.length > 0 && paywallLive && !noticeDeclared) {
        problems.push(
          `A QUALIFYING AUTO-RENEWING SKU IS LIVE WITH NO RENEWAL-NOTICE MECHANISM — ${qualifying.length} of ${offerings.length} offering(s) in ${SERVER_CONFIG} renew automatically or start with a free trial (${qualifying.map((o) => `${o.id}: term=${o.term ?? 'none'}, trial=${o.trialDays}d`).join('; ')}), and \`paywall.enabled\` is true. ` +
            `Nothing in this repo declares how, or through what medium, a renewal or end-of-trial notice reaches the buyer: there is no \`renewal_notice\` on the config contract in ${SERVER_TYPES}, and this factory has NO notice medium at all — stage 13 cut an email channel and [4]B-12 is blocked on owner-only credentials. ` +
            `The window and the medium are legal determinations for [8]K-13 and must NOT be invented here; what must not happen is the switch being flipped before either exists.`,
        );
      } else if (qualifying.length > 0) {
        // The uncomfortable half, printed EVERY run. The count is printed too:
        // "0 of 0" and "2 of 2" read identically once only a verdict is shown,
        // and that ambiguity is the exact reason T-11 was deferred.
        console.log(
          `⬜ [13]T-11 — ${qualifying.length} of ${offerings.length} declared offering(s) would qualify for a consumer renewal/trial notice ` +
            `(${qualifying.map((o) => `${o.id}: term=${o.term ?? 'none'}, trial=${o.trialDays}d`).join('; ')}), and NO notice mechanism exists: ` +
            `no \`renewal_notice\` on the config contract, and no notice medium in the portfolio at all (no email channel — [4]B-12 is owner-blocked). ` +
            `\`paywall.enabled\` is false, so nothing is live and this prints rather than fails. The medium question is [8]K-13's legal determination; ` +
            `the honest consequence is that a qualifying SKU cannot ship on the current stack, not merely that its timers are missing.`,
        );
        ok(`T-11 tripwire armed over ${offerings.length} declared offering(s); paywall not live`);
      } else {
        ok(`T-11 — no declared offering renews automatically or carries a trial (${offerings.length} scanned)`);
      }
    }
  }
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-purchase-path: FAILED');
  process.exitCode = 1;
} else {
  console.log('\nassert-purchase-path: ok');
}
