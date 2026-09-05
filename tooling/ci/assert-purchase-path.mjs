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
import { readFileSync, existsSync, statSync } from 'node:fs';
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
// Hoisted for §G, which has to compare the SAME parse of the shipped matrix
// against the register rather than re-deriving it. Two parsers of one file drift,
// and the drift shows up as §G quietly checking a matrix §A never saw.
let capsCode = null; // purchase_capabilities.dart, comments stripped
let capById = new Map(); // register channel id -> { member, tech, permitted, why }
let registerChannels = []; // the register's channel rows, whole
{
  const capsRaw = read(CAPS);
  const chRaw = read(CHANNELS);
  if (capsRaw === null) {
    problems.push(`COVERAGE LOST — ${CAPS} does not exist, so no platform declaration could be checked at all.`);
  } else if (chRaw === null) {
    problems.push(`COVERAGE LOST — ${CHANNELS} does not exist, so the channel set the matrix must equal is unknown.`);
  } else {
    const caps = code(capsRaw);
    capsCode = caps;
    let registered = [];
    try {
      // 🔴 THE MATRIX IS A DART FILE, SO ITS DOMAIN IS THE DART SURFACE.
      // `PurchaseChannel` lives in packages/purchases and is read by Flutter
      // apps; §G resolves it through `case TargetPlatform.X`, which no browser
      // extension has. On 2026-09-05 the register acquired three rows on the
      // `extension` surface — chrome-webstore, edge-addons, amo — and §A's
      // equality would have demanded an enum member, a `forChannel` case and a
      // `hosted_checkout_rail_test.dart` mention for a channel served by a ZIP
      // of JavaScript that never links this package. The answer would have been
      // written in Dart nothing on that channel executes.
      //
      // ⚠️ THIS IS A DOMAIN DECLARATION, NOT A SHRINK, AND THE RAIL IS STILL
      // ANSWERED: each extension row carries its own `purchaseRail` with a
      // sourced `why` and a `forbids` list, held by assert-channel-register.mjs
      // exactly as every app row's is. What is NOT asked of them is the Dart
      // matrix, because there is no Dart. The surface is read from the register's
      // own `surfaces` vocabulary rather than from a channel id, so a fourth
      // extension store joins this exclusion by declaring its surface and not by
      // anybody editing this list.
      // 🔴 `registerChannels` STAYS THE WHOLE SET. §G reads it to grade every
      // row's `purchaseRail` block — rail, why, source, forbids, the
      // contradiction check — and those questions are about the REGISTER, not
      // about Dart. Narrowing this variable (the first spelling of this change
      // did) silences §G on the extension rows, measured: deleting
      // `purchaseRail` from the chrome-webstore row then exited 0. It is ONLY
      // §A's enum equality below that is Dart-shaped, so only §A narrows.
      registerChannels = (JSON.parse(chRaw).channels ?? []).filter((c) => c && typeof c.id === 'string');
      const dartChannels = registerChannels.filter((c) => c.surface !== 'extension');
      const notDart = registerChannels.filter((c) => c.surface === 'extension').map((c) => c.id);
      if (notDart.length) {
        console.log(
          `note §A domain: ${notDart.length} \`surface: "extension"\` channel(s) (${notDart.join(', ')}) are OUTSIDE the PurchaseChannel matrix — ` +
            'they ship no Dart and resolve through no `TargetPlatform`. Their `purchaseRail` blocks are ' +
            'still graded by §G below — rail, why, source, forbids and the contradiction check — because ' +
            'those are questions about the REGISTER. Only this enum equality is Dart-shaped.',
        );
      }
      registered = dartChannels.map((c) => c.id).filter(Boolean);
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
    for (const d of declared) {
      const row = rows.get(d.member);
      if (row) capById.set(d.id, { member: d.member, ...row });
    }

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

    // ── E2 · A PROMOTIONAL SURFACE CARRIES THE SAME PARITY, AND OPENS NO
    //         CHECKOUT OF ITS OWN — [research/44 §4.3, V13, V14] ────────────
    //
    // The limb above measures SETTINGS, which is the right origin for the ROSCA
    // comparison and the wrong one for this question: an offer card is a
    // shortcut placed in front of a user who did not go looking for it, and
    // research/44 records the rule as "an offer shortcut to upgrade and a
    // matching manage/cancel entry land TOGETHER". `PromoCard` makes both
    // `manageLabel` and `onManageAction` required, so a card with no cancel
    // entry does not compile — but a required callback can still be `() {}`,
    // which is a control that is present and goes nowhere. This asserts the
    // navigation.
    //
    // The second clause is the one with money on it. ADR 038/039 lock ONE
    // merchant of record and one hosted rail; a promo surface that launched its
    // own URL would either be a second checkout (a second MoR, with its own
    // EU VAT/OSS, UK VAT and Indian GST posture — research/44 V14) or an
    // external steer on `ios-appstore`/`macos-appstore`/`android-play`, which
    // 3.1.1 makes a documented rejection cause (V13). The card must route to
    // `/paywall` and let the rail decide.
    const promoFiles = files.filter((f) => /\bPromoCard\s*\(/.test(code(readFileSync(f, 'utf8'))));
    if (promoFiles.length === 0) {
      // PRINTED, not failed: the promo surface is a research/44 rung and this
      // repository does not fail a build for a feature nobody has built. What it
      // will not do is let the clause read as satisfied when its domain is empty.
      console.log(
        'note DOMAIN EMPTY — no file under the stamped chassis constructs a `PromoCard(`, so the promo ' +
          'ROSCA-adjacency and no-second-rail clauses below ranged over nothing. If a promo surface has ' +
          'shipped, this scan has stopped reaching it.',
      );
    }
    for (const f of promoFiles) {
      const rel = f.replace(ROOT, '').replace(/\\/g, '/').replace(/^\//, '');
      const src = code(readFileSync(f, 'utf8'));
      if (!/context\.go\('\/manage-plan'\)/.test(src)) {
        problems.push(
          `PROMO SURFACE WITHOUT A CANCEL ENTRY — ${rel} builds a \`PromoCard(\` and never navigates to ` +
            "'/manage-plan'. research/44 §4.3: an offer shortcut to upgrade and a matching manage/cancel entry " +
            'land TOGETHER. `PromoCard` requires the callback, so this is the other half — a required callback ' +
            'that navigates nowhere is a control that is present and does not work.',
        );
      }
      if (!/context\.go\('\/paywall'\)/.test(src)) {
        problems.push(
          `PROMO SURFACE WITH NO BUY PATH — ${rel} builds a \`PromoCard(\` and never navigates to '/paywall'. ` +
            'The card is then an advertisement with no destination, and the ROSCA comparison above has no ' +
            'left-hand side on this surface.',
        );
      }
      const secondRail = /launchUrl\s*\(|RailConfig\.fill\s*\(|Uri\.parse\s*\(\s*'https:/.exec(src);
      if (secondRail) {
        problems.push(
          `SECOND CHECKOUT RAIL ON A PROMO SURFACE — ${rel} builds a \`PromoCard(\` and also carries ` +
            `\`${secondRail[0].trim()}\`. Every offer link resolves to the apex buy surface through the ONE ` +
            'hosted rail (ADR 038 · research/44 V14): anything else is either a second merchant of record — ' +
            'with its own EU VAT/OSS, UK VAT and Indian GST posture for a sole proprietorship — or an external ' +
            'checkout steer on ios-appstore/macos-appstore/android-play, which guideline 3.1.1 makes a ' +
            'documented rejection cause (V13). Navigate to /paywall and let the rail decide.',
        );
      }
    }
    if (promoFiles.length > 0 && problems.length === 0) {
      ok(
        `${promoFiles.length} promo surface(s): each offers /paywall AND /manage-plan, and none opens a checkout of its own`,
      );
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
      // 🔴 SCOPED TO `_restore`, NOT TO THE FILE: a file-level match would be
      // satisfied by any other call site the file grows, and so would pass
      // with the restore control's own server read deleted.
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

// ═══════════════════════════════════════════════════════════════════════════
// G · THE RAIL EACH CHANNEL SELLS THROUGH, AND THE SHIPPED CODE AGREES
//     [10]D-13 · [ADR 039] (LOCKED 2026-08-09, owner-locked twice)
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THE RAIL FOLLOWS THE CHANNEL, NOT THE PLATFORM. That single sentence is
// what this section exists to make mechanical, and the reason it needs a guard
// rather than a paragraph is on the record: the OWNER, five days after locking
// [ADR 039] themselves, read their own corpus and restated it as
//
//     "APK and iOS = own store, everything else Paddle."
//
// which is WRONG ON APK. The same Android artifact takes PADDLE when it is
// sideloaded and PLAY BILLING when it is shipped through Play — the artifact is
// identical, the CHANNEL differs, and the rail follows the channel. If the
// person who locked the decision can misread it in five days, prose will not
// hold it; a build failure will.
//
// WHAT [ADR 039] LOCKS:
//   paddle       · web · microsoft store (Store Policy §10.8.1/§10.8.6, 0% fee)
//                · windows/macos/linux direct download · snap · APK SIDELOAD
//   play-billing · google play (15% first-$1M tier)
//   apple-iap    · apple app store (15% Small Business Program)
//   glue         · RevenueCat over the two store rails (D5), ONE entitlement
//
// ⚠️ WHY LIMB (d) IS NOT A REGISTER TALKING TO ITSELF. The register says which
// rail a channel MAY use; `packages/purchases/lib/src/purchase_capabilities.dart`
// is where the shipped build DECIDES, and `HostedCheckoutRail` — the one
// `PurchaseRail` this repo implements — refuses or opens on exactly that
// decision (`canStartCheckout => _capabilities.canStartCheckout && …`). So for
// every channel there are two independently editable facts, in two files, in two
// languages, and this section fails when they disagree. §G0 asserts the premise
// that makes the comparison meaningful — that the only rail in the tree is still
// the Paddle hosted checkout — so the day a Play Billing rail lands, this
// section says it has stopped being able to reason instead of silently checking
// the wrong thing.
// ═══════════════════════════════════════════════════════════════════════════
// The rail vocabulary is DERIVED FROM THE REGISTER's own `purchaseRails.rails`
// dictionary — the same shape `signing.keyKind` takes against `keyKinds`, and
// for the [pipeline F-2] reason: a guard whose right-hand side is its own
// hand-kept list stops covering the file the day the file changes and never says
// so. `LOCKED_RAILS` is not a second copy of that list; it is the assertion that
// the DICTIONARY still says what [ADR 039] locked, so neither deleting an entry
// (which would silently make a forbidden rail unnameable) nor adding a fifth one
// (a rail nobody decided on) can pass as a data edit.
const LOCKED_RAILS = ['paddle', 'play-billing', 'apple-iap', 'none'];
const RAIL_CLIENT_IMPL = 'packages/purchases/lib/src/hosted_checkout_rail.dart';
const RAIL_SERVER_IMPL = 'services/platform/src/lib/mor/paddle.ts';
const PURCHASES_LIB = 'packages/purchases/lib';
// `TargetPlatform.X` -> the `platforms` token the register uses. Fuchsia is
// declared by Flutter and is not a channel, so it maps to nothing.
const TP_TO_REGISTER_PLATFORM = {
  android: 'android',
  iOS: 'ios',
  macOS: 'macos',
  windows: 'windows',
  linux: 'linux',
  fuchsia: null,
};

/** A register field that may be a string or an array of prose lines. */
const flat = (v) =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string').join(' ') : typeof v === 'string' ? v : '';

{
  // ── G0 · THE PREMISE THIS SECTION REASONS FROM ──────────────────────────
  // One production `PurchaseRail`, and it is the Paddle hosted checkout. If that
  // stops being true, `canStartCheckout == true` stops meaning "this build opens
  // PADDLE here" and every comparison below silently changes subject.
  let premiseHolds = true;
  {
    const impls = [];
    const walkLib = (d) => {
      for (const e of listDir(d)) {
        const f = join(d, e);
        if (statSync(f).isDirectory()) walkLib(f);
        else if (e.endsWith('.dart')) {
          const src = code(readFileSync(f, 'utf8'));
          for (const m of src.matchAll(/class\s+(\w+)\s+implements\s+PurchaseRail\b/g)) impls.push(m[1]);
        }
      }
    };
    try {
      walkLib(join(ROOT, PURCHASES_LIB));
    } catch {
      /* reported below */
    }
    if (impls.length !== 1 || impls[0] !== 'HostedCheckoutRail') {
      premiseHolds = false;
      problems.push(
        `COVERAGE LOST — §G reasons from "the only PurchaseRail this repo ships is HostedCheckoutRail, the PADDLE hosted checkout", and ${PURCHASES_LIB} now implements [${impls.join(', ') || 'none'}]. ` +
          `While that held, \`channelPermitted: true\` MEANT "this build opens Paddle here" and could be compared against the register's rail. It no longer does. ` +
          `Extend this section with the new rail's own code marker before re-greening it — a comparison whose left-hand side changed meaning is not a weaker check, it is a check of something else.`,
      );
    }
    for (const f of [RAIL_CLIENT_IMPL, RAIL_SERVER_IMPL]) {
      if (!existsSync(join(ROOT, f))) {
        premiseHolds = false;
        problems.push(
          `COVERAGE LOST — the \`paddle\` rail id is supposed to resolve to real code, and ${f} is missing. A rail id that names nothing is a label, and §G would be comparing the register against a word.`,
        );
      }
    }
  }

  // ── G1 (a) · EVERY CHANNEL DECLARES ITS RAIL ────────────────────────────
  // A channel with no `purchaseRail` is COVERAGE LOST, never a default. The
  // whole failure mode here is a NEW channel arriving and inheriting silence:
  // "which rail?" answered by absence is read by a human as "the usual one",
  // and the usual one is a 15% store fee or an app removal depending on which
  // way the reader guesses.
  if (registerChannels.length === 0) {
    problems.push(
      `COVERAGE LOST — no channel row could be read out of ${CHANNELS}, so every rail limb below ranged over nothing. An empty domain reads exactly like a compliant one.`,
    );
  }

  // The vocabulary, read off the register, then checked against what [ADR 039]
  // locked. Both directions: a MISSING id makes a real rail unnameable (and a
  // `forbids` entry naming it unwritable); an EXTRA one is a fifth rail that
  // entered as a data edit rather than as an amendment.
  let vocabulary = [];
  {
    const raw = read(CHANNELS);
    let block = null;
    try {
      block = raw === null ? null : JSON.parse(raw).purchaseRails;
    } catch {
      /* §A already reported the parse failure */
    }
    const dict = block && typeof block.rails === 'object' && !Array.isArray(block.rails) ? block.rails : null;
    if (!dict) {
      problems.push(
        `COVERAGE LOST — ${CHANNELS} declares no \`purchaseRails.rails\` dictionary, so every rail value below was checked against a vocabulary this guard invented. The register is the source of truth for the rail set; a guard carrying its own copy stops covering the file the day the file changes.`,
      );
      vocabulary = [...LOCKED_RAILS];
    } else {
      vocabulary = Object.keys(dict);
      for (const r of LOCKED_RAILS) {
        if (!vocabulary.includes(r)) {
          problems.push(
            `THE RAIL VOCABULARY LOST \`${r}\` — ${CHANNELS}'s \`purchaseRails.rails\` declares [${vocabulary.join(', ')}], and [ADR 039] locks ${LOCKED_RAILS.join(' | ')}. A rail id that is not in the dictionary cannot be written in a \`rail\` or a \`forbids\`, so deleting one does not remove a rail — it removes the ability to FORBID it.`,
          );
        }
      }
      for (const r of vocabulary) {
        if (!LOCKED_RAILS.includes(r)) {
          problems.push(
            `AN UNDECIDED RAIL — ${CHANNELS}'s \`purchaseRails.rails\` declares \`${r}\`, which [ADR 039] does not lock (${LOCKED_RAILS.join(' | ')}). A fifth rail is an amendment to an owner-locked decision, not a data edit; land the ADR and this line together.`,
          );
        }
      }
      for (const [id, desc] of Object.entries(dict)) {
        if (flat(desc).replace(/\s+/g, '').length < 20) {
          problems.push(`rail \`${id}\` in \`purchaseRails.rails\` carries no description. The dictionary is what a row's \`rail\` value resolves to; an entry with no text resolves to nothing.`);
        }
      }
    }
  }

  /**
   * G1 (a) / G2 (b) / G3 (c) for ONE `purchaseRail` block.
   *
   * Shared between the live `channels` rows and the `purchaseRails
   * .awaitingChannelRow` entries deliberately: a parked rail answer that nobody
   * validates is a researched fact rotting in place, and it is read at exactly
   * the moment somebody promotes it — i.e. the moment it stops being cheap to be
   * wrong.
   */
  const checkRailBlock = (label, pr) => {
    if (!pr || typeof pr !== 'object' || Array.isArray(pr)) {
      problems.push(
        `COVERAGE LOST — ${label} declares no \`purchaseRail\` in ${CHANNELS}. [ADR 039] assigns a rail to every channel (${LOCKED_RAILS.join(' | ')}); a row that answers "which rail?" with silence is how "APK and iOS = own store, everything else Paddle" survives — the reader supplies the answer, and on APK the owner supplied the wrong one.`,
      );
      return null;
    }
    const rail = typeof pr.rail === 'string' ? pr.rail : null;
    const forbids = Array.isArray(pr.forbids) ? pr.forbids.filter((x) => typeof x === 'string') : null;
    const why = flat(pr.why).trim();
    const source = flat(pr.source).trim();
    const forbidsWhy = flat(pr.forbidsWhy).trim();

    // ── (b) THE VALUE IS ONE THE REGISTER'S OWN DICTIONARY DEFINES ────────
    if (rail === null) {
      problems.push(`${label} has a \`purchaseRail\` with no \`rail\` string. The field that names the rail is the field.`);
    } else if (!vocabulary.includes(rail)) {
      problems.push(
        `${label} declares rail \`${rail}\`, which is not one of ${vocabulary.join(' | ')}. [ADR 039] locks the rail set; a value outside it is either a typo nothing enforces or a fifth rail nobody decided on.`,
      );
    }
    if (forbids === null) {
      problems.push(`${label} declares no \`forbids\` array. The rail a channel MAY NOT use is the half with the app removal behind it, and it must be written down, empty array included.`);
    } else {
      for (const f of forbids) {
        if (!vocabulary.includes(f)) {
          problems.push(
            `${label} forbids \`${f}\`, which is not one of ${vocabulary.join(' | ')}. A forbid that names no real rail forbids nothing, and it reads in review exactly like one that does.`,
          );
        }
      }
      // `forbids` IS NOT THE COMPLEMENT OF `rail`, and the register says so in
      // its own `_why`: on `web` Play Billing is absent MECHANICALLY (no Play
      // services in a browser); on `android-play` Paddle is absent because
      // Google FORBIDS it. "Cannot" and "may not" have different owners and
      // different remedies, and only `forbidsWhy` carries which one applies.
      if (forbids.length > 0 && forbidsWhy.replace(/\s+/g, '').length < 20) {
        problems.push(
          `${label} forbids [${forbids.join(', ')}] and says nothing about WHY. Collapsing "cannot" (mechanical) into "may not" (policy) is the exact conflation \`PurchaseCapabilities\` splits into technicallySupported vs channelPermitted — a mechanical absence becomes a policy claim nobody can re-check when the policy moves.`,
        );
      }
    }
    if (why.replace(/\s+/g, '').length < 20) {
      problems.push(
        `${label}'s \`purchaseRail\` declares no substantive \`why\`. Same rule as the capability matrix's own \`why\`: a rail assignment without its reason cannot be reviewed, and this is the field that would have said "sideloaded APKs are not a Play distribution, so Play Billing does not reach them".`,
      );
    }
    if (source.length === 0) {
      problems.push(
        `${label}'s \`purchaseRail\` cites no \`source\`. Every rail here traces to a primary text or a locked decision (Play Payments FAQ 10281818 · App Store 3.1.3(b) · Microsoft Store Policies §10.8.1/§10.8.6 · [ADR 039]); an uncited rail is somebody's recollection.`,
      );
    }

    // ── (c) A ROW MAY NOT FORBID ITS OWN RAIL ─────────────────────────────
    if (rail !== null && forbids !== null && forbids.includes(rail)) {
      problems.push(
        `CONTRADICTORY ROW — ${label} declares rail \`${rail}\` and also forbids \`${rail}\`. The row cancels itself, and whichever half a reader (or a later guard) happens to consult decides the money.`,
      );
    }
    return rail !== null && vocabulary.includes(rail) ? { rail, forbids: forbids ?? [] } : null;
  };

  const railOf = new Map(); // channel id -> { rail, forbids[] }
  for (const ch of registerChannels) {
    const parsed = checkRailBlock(`channel \`${ch.id}\``, ch.purchaseRail);
    if (parsed) railOf.set(ch.id, parsed);
  }

  // ── G1b · THE PARKED SPLITS — the APK trap, as data ─────────────────────
  // `purchaseRails.awaitingChannelRow` holds channels whose rail [ADR 039] has
  // decided and whose `channels` row does not exist yet (promotion needs the
  // enum member too, or §A fails on the same commit). Two things must stay true
  // of a parked entry, and neither is checkable by reading it:
  //   · it is not ALSO a live row — two rail answers for one channel is worse
  //     than none, because both look authoritative;
  //   · its `railSplitsFrom` names a real channel AND takes a DIFFERENT rail.
  //     An entry that splits from a channel with the same rail records a
  //     distinction that does not exist, which is how "the rail follows the
  //     channel" degrades back into "the rail follows the platform".
  {
    const raw = read(CHANNELS);
    let awaiting = [];
    try {
      const a = raw === null ? null : JSON.parse(raw).purchaseRails?.awaitingChannelRow;
      if (Array.isArray(a)) awaiting = a.filter((e) => e && typeof e.id === 'string');
    } catch {
      /* §A already reported the parse failure */
    }
    const liveIds = new Set(registerChannels.map((c) => c.id));
    for (const e of awaiting) {
      const parsed = checkRailBlock(`awaiting channel \`${e.id}\``, e.purchaseRail);
      if (liveIds.has(e.id)) {
        problems.push(
          `TWO RAIL ANSWERS FOR \`${e.id}\` — it is a live \`channels\` row AND still parked in \`purchaseRails.awaitingChannelRow\`. Promotion moves the entry; leaving both means a reader (or a guard) gets whichever they happen to open, and both look authoritative.`,
        );
      }
      const from = typeof e.railSplitsFrom === 'string' ? e.railSplitsFrom : null;
      if (!from) {
        problems.push(
          `awaiting channel \`${e.id}\` declares no \`railSplitsFrom\`. The entry exists because some LIVE channel's rail would otherwise be read as covering it — that channel has to be named, or the split is invisible exactly where it is expensive.`,
        );
      } else if (!railOf.has(from)) {
        problems.push(
          `awaiting channel \`${e.id}\` splits from \`${from}\`, which is not a channel with a declared rail in ${CHANNELS}. A split from nothing records no split.`,
        );
      } else if (parsed && railOf.get(from).rail === parsed.rail) {
        problems.push(
          `\`${e.id}\` SPLITS FROM \`${from}\` AND TAKES THE SAME RAIL (\`${parsed.rail}\`) — so it is not a rail split at all. This entry's whole purpose is to record that the SAME artifact takes a DIFFERENT rail through a different channel; with equal rails it is a row waiting to be promoted for no reason, and the distinction it was meant to preserve is gone.`,
        );
      }
      // The code half: a parked channel must NOT already have an enum member.
      // §A fails when the enum is missing a registered channel; this is the
      // mirror — an enum member for a channel the register has not promoted
      // means the shipped matrix answers for a channel the register does not
      // have, and the answer came from nowhere.
      if (capById.has(e.id)) {
        problems.push(
          `\`${e.id}\` IS PARKED IN THE REGISTER AND ALREADY LIVE IN THE CODE — ${CAPS} declares \`PurchaseChannel.${capById.get(e.id).member}\` for it while ${CHANNELS} still lists it under \`awaitingChannelRow\`. The shipped matrix is answering for a channel the register has not decided is real; promote the row or drop the enum member.`,
        );
      }
    }
  }

  // ── G4 (d) · THE SHIPPED CODE AGREES WITH THE REGISTER ──────────────────
  if (premiseHolds && railOf.size > 0 && capById.size > 0) {
    const offersPaddle = (id) => {
      const row = capById.get(id);
      return row ? row.tech && row.permitted : null;
    };
    let compared = 0;
    // Scoped to THIS limb, not to `problems.length`: an unrelated failure in §A
    // or §E must not be able to silence this limb's ok line, or "agreed" and
    // "something else was broken" read identically in the log.
    const problemsBeforeD = problems.length;
    for (const [id, { rail, forbids }] of railOf) {
      const opens = offersPaddle(id);
      if (opens === null) continue; // no enum row — §A already failed on it
      compared += 1;
      const row = capById.get(id);
      if (opens && (rail !== 'paddle' || forbids.includes('paddle'))) {
        problems.push(
          `THE SHIPPED CODE OFFERS A RAIL THE REGISTER FORBIDS — channel \`${id}\` declares rail \`${rail}\`${forbids.length ? ` and forbids [${forbids.join(', ')}]` : ''} in ${CHANNELS}, but ${CAPS} answers \`PurchaseChannel.${row.member}\` with technicallySupported: true, channelPermitted: true. ` +
            `The only PurchaseRail this repo implements is HostedCheckoutRail — the PADDLE hosted checkout — so that pair of booleans IS an instruction to open Paddle on \`${id}\`. On a store channel that is the documented rejection/removal cause, not a style disagreement.`,
        );
      } else if (!opens && rail === 'paddle' && !forbids.includes('paddle')) {
        problems.push(
          `THE REGISTER CLAIMS A RAIL THE SHIPPED CODE REFUSES — channel \`${id}\` declares rail \`paddle\`, but ${CAPS} answers \`PurchaseChannel.${row.member}\` with technicallySupported: ${row.tech}, channelPermitted: ${row.permitted}, so \`HostedCheckoutRail.startCheckout\` refuses there with \`${row.tech ? 'channelNotPermitted' : 'platformNotSupported'}\`. ` +
            `One of the two is wrong and the register is the decision: either the channel does not sell (fix the register) or the build refuses money it is allowed to take (fix the matrix). Silence between them is how a locked rail becomes a rail nobody ships.`,
        );
      }
    }
    if (compared > 0 && problems.length === problemsBeforeD) {
      ok(`${compared} channel(s): the register's rail and the shipped capability matrix agree`);
    }

    // ── G4b · THE PLATFORM→CHANNEL COLLAPSE STAYS RESTRICTIVE ─────────────
    // 🔴 THIS IS THE APK TRAP, GENERALISED. A build does NOT know at runtime
    // which channel installed it, so `forPlatform` picks one channel per
    // platform and every channel on that platform lives with the answer. If the
    // chosen channel opens Paddle while a SIBLING channel on the same platform
    // forbids Paddle, then the build that was installed from the sibling opens a
    // forbidden rail — which is precisely "the same Android artifact" reasoning
    // that the owner's own restatement got backwards.
    const platformPick = new Map(); // TargetPlatform member -> channel id
    if (capsCode) {
      const idOfMember = new Map([...capById].map(([id, r]) => [r.member, id]));
      for (const m of capsCode.matchAll(
        /case\s+TargetPlatform\.(\w+):\s*return\s+forChannel\(PurchaseChannel\.(\w+)\)\s*;/g,
      )) {
        const id = idOfMember.get(m[2]);
        if (id) platformPick.set(m[1], id);
      }
      if (platformPick.size === 0) {
        problems.push(
          `COVERAGE LOST — no \`case TargetPlatform.X: return forChannel(PurchaseChannel.Y);\` could be parsed out of ${CAPS}, so the platform→channel collapse was checked over nothing. That map is where a build with no knowledge of its own channel gets an answer, and it is the exact place the APK/Play confusion lands.`,
        );
      }
      for (const [tp, chosenId] of platformPick) {
        const token = TP_TO_REGISTER_PLATFORM[tp];
        if (!token) continue;
        if (offersPaddle(chosenId) !== true) continue;
        const siblings = registerChannels.filter(
          (c) => Array.isArray(c.platforms) && c.platforms.includes(token) && c.id !== chosenId,
        );
        for (const s of siblings) {
          const sr = railOf.get(s.id);
          if (!sr) continue;
          if (sr.rail !== 'paddle' || sr.forbids.includes('paddle')) {
            problems.push(
              `THE PLATFORM MAP TAKES THE PERMISSIVE ANSWER — \`forPlatform(TargetPlatform.${tp})\` resolves to \`${chosenId}\`, which opens Paddle, but \`${s.id}\` ships on \`${token}\` too and declares rail \`${sr.rail}\`${sr.forbids.length ? ` (forbids [${sr.forbids.join(', ')}])` : ''}. ` +
                `A build cannot tell at runtime which channel installed it, so this hands the Paddle checkout to the \`${s.id}\` build as well. That is the APK trap with a different platform's name on it: same artifact, different channel, different rail.`,
            );
          }
        }
      }
    }

    // ── G4c · THE GAP THAT IS PRINTED RATHER THAN FAILED ──────────────────
    // [ADR 039] assigns APK SIDELOAD to `paddle`, and the register has no
    // sideload row to hang that on — so the one assignment the owner actually
    // misread is the one this guard cannot bind. Printed on EVERY run, per this
    // repo's rule for owner-gated gaps: a limb whose domain is empty must say so
    // rather than resolve to ok. Adding the row is all it takes to arm it.
    const androidRows = registerChannels.filter(
      (c) => Array.isArray(c.platforms) && c.platforms.includes('android'),
    );
    const sideload = androidRows.filter((c) => c.kind === 'direct' || /apk|sideload/i.test(c.id));
    if (sideload.length === 0) {
      console.log(
        'note ⬜ [ADR 039] ASSIGNS APK SIDELOAD TO `paddle`, AND NO LIVE CHANNEL ROW CARRIES IT — ' +
          `${CHANNELS} registers ${androidRows.length} live android channel(s) (${androidRows.map((c) => c.id).join(', ') || 'none'}), all of them Play, ` +
          `and ${CAPS} maps EVERY android build to \`${platformPick.get('android') ?? '(unmapped)'}\`. So the rail ADR 039 grants to a sideloaded APK is unreachable in code, ` +
          'and limb (d) cannot fail on it — the SAFE direction (the build refuses rather than opening a forbidden rail), but not the decided one. ' +
          'This is the exact assignment the owner restated backwards on 2026-08-13. Promoting the parked `android-sideload` entry to a `channels` row, with its enum member, arms every limb in §G for it automatically.',
      );
    }
  } else if (premiseHolds && registerChannels.length > 0 && capById.size === 0) {
    problems.push(
      `COVERAGE LOST — no capability row could be parsed out of ${CAPS}, so limb (d) compared the register against nothing. A register-versus-register check is a decoration; it cannot fail for the reason it exists.`,
    );
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
