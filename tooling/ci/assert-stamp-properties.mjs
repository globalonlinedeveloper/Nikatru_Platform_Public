#!/usr/bin/env node
// [pipeline C-16] The rule: no chassis requirement lands without an assertion in
// the stamped app's own property test.
//
// WHY. CI's `app_brick` lane stamps a throwaway app, compiles it and runs its
// tests — and that is all. So a capability that is merely ABSENT passes: before
// this landed, `themeMode` appeared zero times repo-wide, `Semantics(` zero
// times, and the account-delete button called `Navigator.pop` and nothing else.
// All three were green.
//
// The assertions themselves live in the BRICK TEMPLATE (owner decision
// 2026-07-27) so every stamped app inherits them and keeps checking itself for
// life. This guard defends that file: if it is deleted, emptied, or stops
// covering a declared property, the build fails. Without it the property test is
// one careless commit from vanishing, and vanishing looks exactly like passing.
//
// TO ADD A PROPERTY: land its assertion in the template test, then add its key
// here. The list is the contract; the file is the implementation.
//
// ── 2026-07-28 · C-16 NARROWED-LOCK FIXES. Two holes, both proven by mutating
//    the REAL template and watching this guard stay green. ────────────────────
//
// HOLE 1 — 'theme-mode-persisted' had no `source` anchor, so the one property
// whose entire name is "persisted" was the only one not anchored to anything.
// Deleting the `kv.write` out of `ThemeModeController.set` — turning a persisted
// setting into an in-memory one that resets at every launch — left this guard
// printing `ok`. Now anchored to BOTH limbs: the write and the read-back. Either
// alone is a half-feature (write with no read = a value nothing ever restores;
// read with no write = a value that is never there), so both are required.
//
// HOLE 2 — the requirement says the lane asserts EVERY mechanically checkable
// property. `REQUIRED_COVERAGE` was a hand-kept list, so "every" ranged over
// whatever somebody remembered to add: a brand-new provider in the template was
// invisible here. Adding a new provider to the real template changed nothing.
// (The original example was `onboardingSeenProvider`, which has since been built
// for real and is classified below — so the fixture that stands in for "a
// behaviour nobody classified" now uses a name that is not a real capability.) So "every" now has a TRACKED DOMAIN (see DOMAIN_FILES below): the
// chassis behaviours are read out of the template itself, and each one must be
// classified — either covered by a named property, or listed as a dated,
// reasoned gap. A behaviour in neither FAILS THE BUILD. That is what makes the
// word "every" mean something a person cannot quietly shrink.
//
// The domain is the PROVIDERS FILES — `lib/state/providers.dart` and, since
// [pipeline 5]M-13, `lib/state/money_providers.dart` — the surfaces every
// stamped app inherits its capabilities through. It does NOT cover widgets in
// app.dart or features/; those are anchored individually by `source` above.
// Naming the limit here so nobody reads this guard as broader than it is.
//
// ⚠️ AND `DOMAIN_FILES` IS A LIST FOR A REASON. It was a single constant, so
// when the money rail arrived in a NEW providers file the whole capability had
// no obligation to be classified at all — hole 2 above, arriving through a file
// rather than through a provider. Add a providers file to the list the same day
// you create it.
//
// ── 2026-08-01 · [pipeline N-4 clause 7 / N-7 clause 4] THE SCAN NOW READS EVERY
//    APP, NOT ONLY THE BRICK. One change, two requirements — build it once. ─────
//
// 🔴 THE HOLE: these paths were hardcoded to the brick, and NOTHING looked under
// `apps/`. So a stamped app could delete its own `test/chassis_properties_test.dart`
// — one `rm`, no lint suppression, no `skip:` — and drop every inherited property
// assertion with EVERY GUARD IN THE TREE STILL GREEN. That is the single
// highest-leverage gate-weakening move available, and the requirement that exists
// to stop apps weakening the inherited gates did not name it.
//
// The domain is now the brick template PLUS every non-exempt `apps/*` member of
// the root `pubspec.yaml` `workspace:` list — the same domain assert-app-dod.mjs
// uses, and for the same reason: a directory listing differs between this box and
// CI, while the workspace block is a maintained field the stamper itself writes.
// `apps/subly` is exempt by name (39-CHASSIS §4 cut 1 — it predates the brick and
// was never stamped, so it has no inherited property test to keep).
//
// SOURCE ANCHORS ARE APP-RELATIVE UNLESS THEY NAME A SHARED TREE. A path starting
// `packages/`, `services/` or `tooling/` is repo-absolute (the design-system
// scaffold, the stamped Worker's account route); everything else — `lib/…`,
// `test/…` — is resolved under each root in turn. The Worker route deliberately
// stays repo-absolute: it exists only on a `needs_backend` stamp, so anchoring it
// per app would fail the client-only probe for being what it is.
import { readFileSync, existsSync } from 'node:fs';
import { listDir } from './tree-walk.mjs';
import { join } from 'node:path';

const repo = process.cwd();
/** Declared, dated limbs of a property that this guard cannot assert. */
const propertyGaps = new Set();
let failed = false;
const fail = (m) => { console.error(`FAIL ${m}`); failed = true; };
const ok = (m) => console.log(`ok   ${m}`);

const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
/** App-relative: resolved under the brick AND under every stamped app. */
const PROP_TEST = 'test/chassis_properties_test.dart';
const APP_ROOT = 'lib/app.dart';
// [13]T-9. The subscription itself, app-relative: every stamped app carries its
// own copy, and this one file is enough to make the tap loop silent again
// without a single test going red. (`MAIN` is already declared above.)
const TAP_OBSERVER = 'lib/state/notification_tap_observer.dart';
const PROVIDERS = 'lib/state/providers.dart';
const SETTINGS = 'lib/features/settings/settings_screen.dart';
const ROUTER = 'lib/core/router.dart';
const SIGN_UP = 'lib/features/auth/sign_up_screen.dart';
const MAIN = 'lib/main.dart';
const HOME = 'lib/features/home/home_screen.dart';
// The stamped WEB SHELL. App-relative on purpose: every app carries its own
// copy, and the line anchored below can be lost from any one of them
// independently — it was already missing from the template while the app the
// template was derived from had it.
const WEB_INDEX = 'web/index.html';
// [pipeline 5]M-13's wiring. A SECOND providers file, so the domain scan below
// reads both — a new providers file with no coverage requirement is a hole the
// size of a whole capability.
const MONEY_PROVIDERS = 'lib/state/money_providers.dart';
/** Trees that are shared rather than owned by an app; never re-rooted. */
const SHARED_PREFIX = /^(packages|services|tooling)\//;
// ── PHASE 5 · MEASURED 2026-08-12 · WHAT THIS EXEMPTION IS ACTUALLY HOLDING
//    BACK. Read off the tree, not re-derived from the header. (RE-MEASURED
//    2026-08-12 on main @ 981481c with the method below: brick 0, apps/subly
//    3 groups + 10 anchors = 13, REQUIRED_COVERAGE 26. Unchanged from the
//    2026-08-11 reading even though commits since then touched THIS guard and
//    apps/subly/lib. RE-DERIVE IT; do not trust the date on this line.)
//
// METHOD, so it can be redone rather than believed: every REQUIRED_COVERAGE
// anchor below was resolved against `apps/subly` using this file's own
// `resolveSource` rule (SHARED_PREFIX = repo-absolute, everything else re-rooted)
// and tested. The BRICK came back with ZERO problems, which is what validates the
// method. `apps/subly` came back with THIRTEEN — 3 missing property GROUPS and 10
// failing source ANCHORS — in three classes, and the CLASS is the whole finding,
// because only one of the three is a missing behaviour.
//
// ⚠️ THIRTEEN, not ten. A group and an anchor are separate problems, and the
// notification-tap group takes THREE anchors down with it, so the two numbers are
// easy to conflate — an earlier draft of this very comment did.
//
// 🔴 BUT 13 IS NOT WHAT RUNNING THE GUARD PRINTS, AND THIS COMMENT USED TO SAY
// "Reproducing this must give 3 + 10 = 13". It does not. MEASURED 2026-08-13 by
// dropping `apps/subly` from EXEMPT_APPS and running the real guard: it prints
// **NINE** `FAIL apps/subly` lines — 3 groups NOT ASSERTED + 6 properties whose
// IMPLEMENTATION is gone — because the anchor loop `break`s on the FIRST failing
// anchor of a property, so one line is emitted per property, not per anchor.
// 13 is the count of failing ANCHORS, which is only obtainable from an
// exhaustive per-anchor extraction that was never committed. `_verdicts.json:37`
// records the same 9 ("3 groups + 6 anchors"). Both numbers are real and they
// count different things; the reproduction instruction quoted the one you cannot
// reproduce, so a maintainer who did the repo-mandated thing — run the real
// thing — would get 9 and conclude the comment had drifted.
// REPRODUCE LIKE THIS: drop `apps/subly` from EXEMPT_APPS (line ~195), run
// `node tooling/ci/assert-stamp-properties.mjs`, expect **9** FAIL lines for
// apps/subly and **0** for the brick; a brick count other than 0 means the
// extraction drifted, and that is fixed BEFORE the subly number is read as
// anything at all. Restore the exemption afterwards.
//
// 🔴 THE EXPECTED NUMBER IS NOW **TEN**, AND THE 2026-08-13 RECORD ABOVE IS LEFT
// AS WRITTEN because it was true of the guard as it stood that day. MEASURED
// 2026-08-21, both ways, on a copy of this file with the exemption dropped:
// with the anchor read RAW (as it was until today) — **9**; with the anchor read
// COMMENT-STRIPPED (as it is now, see the read at the top of the anchor loop) —
// **10**. The tenth is `content-pack-consumed`, whose first anchor was matching
// a `///` line in `apps/subly/lib/state/providers.dart:158` while that app's
// real config reads `contentPack: null` on :172. It is CLASS D below. So a
// maintainer reproducing this against today's guard should expect 10, and
// getting 9 now means the comment-stripping has been undone.
//
// A · THREE PROPERTY GROUPS ARE ABSENT from apps/subly/test/chassis_properties_test.dart
//     (it declares 23 `group('property: …')` markers; the brick declares 26):
//       · password-recovery-routes
//       · notification-tap-observed
//       · sessionless-signup-reaches-check-inbox
//     🔴 `password-recovery-routes` is the surprising one: ALL ELEVEN of its
//     anchors already resolve in Subly. The feature is built — the adapter
//     mapping, both controllers, the launch-uri read, the /reset-password route.
//     Only the group that asserts it is missing. That one is a pure test port.
//
// B · SIX ANCHORS PIN THE BRICK'S SPELLING OF A BEHAVIOUR SUBLY HAS. The
//     `(?:signedIn|loggedIn)` alternation further down this file — grep the
//     alternation, never a line number, this file gets edited — already
//     anticipated EXACTLY ONE of these and named this drop as the reason. The
//     measurement says there are six, not one: an anticipation right about the
//     class and wrong about the size, which is the useful kind of wrong to record:
//       · auth-seam-wired / PROVIDERS      `Provider<core.AuthRepository>` — Subly
//         imports the type unprefixed: `final Provider<AuthRepository> authRepositoryProvider`
//       · promo-card-fails-closed / HOME   `const UpgradePromoCard()` — Subly mounts
//         `UpgradePromoCard(),` (non-const, though the ctor is const-capable)
//       · no-silent-channel / HOME         `const CatchUpNudgeBanner(),` — Subly
//         mounts `CatchUpNudgeBanner(),`
//       · legal-reacceptance-gated / ROUTER `matchedLocation == '/reaccept-terms'`
//         — Subly carries the path as an entry in a signed-out allowlist ARRAY and
//         tests it as `loc == '/reaccept-terms'`
//       · sessionless-signup… / ROUTER     `matchedLocation == '/check-inbox'` —
//         same allowlist shape; that property's other two anchors already resolve
//       · notification-tap-observed / MAIN  `overrideWithValue(notifications)` —
//         Subly's variable is named `taps`
//     Widening each to an alternation is the same act as the `signedIn|loggedIn`
//     one and is NOT a loosening: the anchor still cannot be satisfied by an
//     absent feature. Negative-test each against the REAL tree, never a fixture.
//
// C · THREE ANCHORS NAME A FILE SUBLY DOES NOT PUT THE BEHAVIOUR IN. These are
//     real chassis divergence and cost a code move, not a regex:
//       · analytics-consent-gated / PROVIDERS — Subly's `controller.record(purpose,
//         granted: granted, …)` lives in `lib/state/analytics_providers.dart`, a
//         FOURTH providers file the brick has no equivalent of
//       · paywall-gate-driven-by-server / HOME — Subly mounts `PaywallGate(locked:)`
//         in `lib/core/router.dart` (`_GatedInsights`); its 5-tab nav has no
//         Explore tab. The property's other four anchors resolve
//       · notification-tap-observed / TAP_OBSERVER — the event NAME is
//         `_safe('notification_opened', …)` in `lib/state/analytics_funnel.dart`;
//         the brick declares it as `static const String kEvent` on the observer
//
// …and the TENTH anchor is not a divergence at all: `notification-tap-observed`
// also anchors `notes.taps.add(` inside PROP_TEST itself, so it arrives and leaves
// with group A-2. Port that group and this anchor closes with it — which is why
// 13 problems are NOT 13 pieces of work.
//
// D · ONE ANCHOR WAS NOT MEASURING SUBLY AT ALL — it was reading a sentence.
//     (Added 2026-08-21 with the comment-stripping fix; it is the whole reason
//     the reproduction number moved from 9 to 10.)
//       · content-pack-consumed / PROVIDERS  `/contentPack:\s*'https:\/\//` —
//         the ONLY match in `apps/subly/lib/state/providers.dart` is :158, a
//         `///` line reading "The chassis template's `features: {}` +
//         `contentPack: 'https://packs…/latest'` would put the client and the
//         server into disagreement". The app's real config is `contentPack:
//         null` on :172.
//     🔴 THIS IS NOT CLASS B. B and C are anchors pointed at the wrong SPELLING
//     or the wrong FILE for a behaviour Subly HAS, and the repair is to widen or
//     re-point. Here the behaviour is genuinely ABSENT — the pointer is null —
//     so the correct outcome is the FAIL, and widening anything would be the
//     silencing this file exists to prevent. Recorded as its own class so nobody
//     later reads "10 anchor problems" as "10 regexes to relax".
//     It stayed invisible because it needed BOTH holes at once: `apps/subly` is
//     exempt, AND the anchor read was raw. Closing the read is what makes the
//     exemption the only thing still hiding it.
//
// 🔴 AND THE FIXTURE IS THE OTHER HALF OF THE ACT. `tooling/ci/test/guards.test.mjs`
// builds EVERY assert-stamp-properties case over a workspace that LISTS
// `apps/subly` while creating only its `lib/main.dart` and one notifications file.
// Emptying this Set therefore reddens roughly fifty currently-passing cases at
// once with `apps/subly/test/chassis_properties_test.dart is MISSING`, and the
// case named 'does NOT demand a property test from the frozen apps/subly' asserts
// the exact opposite of the new behaviour. Guard and fixture move together, or
// neither moves. (`bootRoots` below deliberately ignores this Set, so the [13]T-4
// walk already covers Subly and is untouched by any of the above.)
// --- APPENDED 2026-08-25 . THE SET IS NOW A MAP, AND IT IS NO LONGER SILENT ---
// Everything above is left exactly as written; this corpus appends dated
// corrections rather than rewriting them. What changed today and why:
//
// [RED] THE EXEMPTION WAS INVISIBLE IN OUTPUT AND SELF-CHECKED NOTHING. Measured
// before the change: `node tooling/ci/assert-stamp-properties.mjs` exited 0 and
// ended with "ok - 26 property/properties enforced across 1 root(s):
// tooling/bricks/app/__brick__/apps/{{app_id}}". `grep -ci exempt` over that
// stdout returned 1, and the single hit was an unrelated brand-seed sentence. So
// the ONE APP THAT SHIPS was dropped from the graded set and no line of output
// said so - a reader could see `ok` and never learn what was not graded.
// Nothing checked that the entry still named a real path either, and the SIZE of
// what it hides lived only in the prose above, where the number moved 9 -> 10 on
// 2026-08-21 with nothing executable tracking it.
//
// Three limbs, all of them strictly stricter than what was here:
//   (1) VISIBLE - a white-square line per member on every run, and the skipped
//       count is inside the final `ok` line itself, so `ok` cannot be read
//       without it.
//   (2) SELF-CHECKING EXISTENCE - the path must appear in the root pubspec.yaml
//       `workspace:` block. `bootRoots` below already collects every apps/ entry
//       BEFORE the exemption filter, so this is a set difference over a list that
//       exists; no second pubspec reader (the COVERAGE LOST beside that read is
//       there because a second reader is this file's recurring failure).
//   (3) SELF-CHECKING SIZE - the property audit is RUN over the exempted app
//       anyway, through the same `auditPropertyRoot` the graded roots use, the
//       count of FAIL lines it WOULD have printed is printed, and it is pinned to
//       `floor`. Both directions redden: drifting further fails, and CATCHING UP
//       fails too, because a floor nobody lowers is a floor that stops measuring.
//
// `floor` IS A MEASURED NUMBER, NOT A BUDGET. Re-derive it the way the prose
// above says - except that the line this guard now prints on every run IS the
// reproduction, so there is nothing left to run by hand.
const EXEMPT_APPS = new Map([
  [
    'apps/subly',
    {
      why: '39-CHASSIS \u00a74 cut 1 \u2014 it predates the brick and was never stamped, so it carries no inherited property test to keep.',
      // MEASURED 2026-08-25 by this very limb, on main @57e6e10 with the anchor read
      // COMMENT-STRIPPED: ten FAIL lines - 3 property groups absent from
      // apps/subly/test/chassis_properties_test.dart and 7 source anchors whose
      // implementation this file classes A/B/C/D in the prose above. It agrees with
      // the 2026-08-21 hand measurement to the line, which is what makes it a
      // reproduction rather than a new claim.
      floor: 10,
      floorAsOf: '2026-08-25',
      floorNote:
        'The prose above records 9 with the anchors read RAW and 10 with them COMMENT-STRIPPED (2026-08-21); ' +
        'the strip is on, so that is the read this number comes from. Getting the RAW number back means the stripping was undone.',
    },
  ],
]);
const SCAFFOLD = 'packages/design_system/lib/src/widgets/app_scaffold.dart';
// [pipeline 11]E-5. Shared tree, deliberately: the launch trio is implemented
// ONCE for every stamp. Anchoring the event names inside an app would be
// anchoring the fork this requirement exists to prevent.
const CORE_LIFECYCLE = 'packages/core/lib/src/analytics/analytics_lifecycle.dart';
// [pipeline 11]E-6. The screen that emits the four money events — app-relative,
// because every stamped app carries its own copy of the paywall and any one of
// them can drop a stage from the funnel on its own.
const PAYWALL = 'lib/features/monetization/paywall_screen.dart';
// …and their one shared implementation. Same reason as CORE_LIFECYCLE: the event
// NAMES belong to the package, or fifty stamps grow fifty funnels.
const MONEY_FUNNEL = 'packages/purchases/lib/src/money_funnel.dart';
// [pipeline 10]D-8. The two server-side halves of the update destination: the
// wire contract that lets a config carry one, and the registry that serves it.
const PLATFORM_TYPES = 'services/platform/src/types.ts';
// [pipeline 4]B-2 — the served set is DATA now. `services/platform/src/config.ts`
// no longer holds the registry (it derives it), so the two files below are what
// "the registry that serves it" means: WHICH apps (the public catalogue the stamp
// writes) × WHAT each is served (the value document, `defaults` + per-app).
const PLATFORM_CATALOGUE = 'catalog/apps.json';
const PLATFORM_CONFIG_DATA = 'services/platform/src/app-config-data.json';
// …and the set of channels a binary can be built for. `update_url` is resolved
// per app but SPENT per channel: each channel compiles its own `UPDATE_URL`
// define (or inherits the brick's `defaultValue`), so "equals the compile-time
// default" is a question with one answer per channel, not one answer.
const CHANNEL_REGISTER = 'tooling/channel-register.json';
// The stamped Worker's half of G2. Only present on a needs_backend stamp; the
// mustache section IS the directory name on disk, so this path resolves in the
// brick source even though it vanishes from a client-only stamp.
const ACCOUNT_ROUTE =
  'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/src/routes/account.ts';

// REQUIRED_COVERAGE. Each entry is a property the stamped app must assert about
// itself. `group` is the marker the test file must declare; `sources` are the
// lines in the app that the property is about, so a deleted implementation is
// caught even if somebody leaves a hollow test behind.
// ── [pipeline 8]K-6 · THE IN-APP LEGAL SET EQUALS THE PUBLISHED LEGAL SET ────
//
// 🔴 THE DEFECT THIS REPLACES. The brick declared TWO legal URLs
// (`privacyUrl`, `termsUrl`); `check-site-integrity.mjs` publishes FOUR; and
// NOTHING compared the two lists. So every app the factory stamps shipped a
// legal surface silently missing the refund policy — the page a store reviewer
// opens first when a charge is disputed — and no guard anywhere could say so.
//
// A RELATIONSHIP BETWEEN TWO ARTEFACTS, in both directions, never a count.
// Publishing a fifth legal page fails the build until the chassis links it or
// the exclusion below is extended with a reason; deleting a link fails too.
// There is no number here to lower.
const SITE_INTEGRITY = 'tooling/ci/check-site-integrity.mjs';
const APP_CONFIG = 'lib/core/app_config.dart';

// The ONE named exclusion, with its reason attached — not a silent filter.
// `delete-account.html` is reached from a real in-app CONTROL rather than from
// a link (the erasure path performs the deletion; the page explains it), and
// that control is already asserted by the `account-deletion-works` key
// including its `ACCOUNT_ROUTE` identity-delete anchor. Linking it as a third
// document as well would put two different affordances for the same
// irreversible action next to each other, which [pipeline C-13] deliberately
// avoided when it ordered sign-out above delete.
const LINK_EXEMPT_LEGAL_PAGES = new Map([
  [
    'delete-account.html',
    'reached by the in-app delete control, asserted by the account-deletion-works key, not by a link',
  ],
]);

function checkLegalLinkSet() {
  let published;
  try {
    const src = readFileSync(join(repo, SITE_INTEGRITY), 'utf8');
    // Parsed off the declaration, not grepped for the filenames: the file's own
    // prose names `pricing.html` and `LEGAL_PAGES` several times while
    // explaining why pricing is NOT in the list, and a text search would
    // happily "find" it. [pipeline F-10]'s recorded lesson.
    const decl = src.match(/const\s+LEGAL_PAGES\s*=\s*\[([^\]]*)\]/);
    if (!decl) {
      fail(
        `COVERAGE LOST — could not parse LEGAL_PAGES out of ${SITE_INTEGRITY}. ` +
          `The in-app legal set would be compared against nothing and this check would report clean.`,
      );
      return;
    }
    published = [...decl[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  } catch (e) {
    fail(`COVERAGE LOST — ${SITE_INTEGRITY} unreadable: ${e.message}`);
    return;
  }
  if (published.length === 0) {
    fail(`COVERAGE LOST — LEGAL_PAGES parsed as EMPTY, so set equality below is vacuously true.`);
    return;
  }

  const brickConfig = join(repo, BRICK, APP_CONFIG);
  let declared;
  try {
    const src = readFileSync(brickConfig, 'utf8');
    // Only `nikatru.com/<page>` constants count. `companyUrl` is the site root
    // and is not a legal document; `apiBaseUrl` is not a page at all.
    //
    // 🔴 THE URL FORM WENT EXTENSIONLESS ON 2026-08-21 AND THIS PATTERN MOVED
    // WITH IT. It matched `([\w-]+\.html)` — the form the site no longer
    // publishes — so left alone it would have matched ZERO constants and this
    // guard would have gone on printing a count while grading nothing.
    //
    // `LEGAL_PAGES` in check-site-integrity.mjs stays `.html`: those are the
    // FILENAMES on disk, not the URLs. This is the one seam where the two
    // spellings legitimately differ, so the page token is normalised to the
    // filename here and nowhere else.
    declared = [...src.matchAll(/static\s+const\s+String\s+(\w+)\s*=\s*'https:\/\/nikatru\.com\/([\w-]+)'/g)].map(
      (m) => ({ name: m[1], page: `${m[2]}.html` }),
    );
  } catch (e) {
    fail(`COVERAGE LOST — ${BRICK}/${APP_CONFIG} unreadable: ${e.message}`);
    return;
  }

  const mustLink = published.filter((p) => !LINK_EXEMPT_LEGAL_PAGES.has(p));
  if (mustLink.length === 0) {
    fail(
      `COVERAGE LOST — every published legal page is on the link-exemption list, so the ` +
        `set equality below ranges over nothing. An exemption list that has eaten its own domain ` +
        `is the self-disabling shape this guard exists to catch.`,
    );
    return;
  }

  // The published half has its floor immediately above; this is the in-app half's.
  // ORDER MATTERS AND IS DELIBERATE: it sits AFTER `mustLink`, because the
  // `legal-all-exempt` case deliberately empties the chassis in order to reach
  // that floor, and a check for an empty `declared` placed first would intercept
  // it and the older floor would stop being exercised.
  //
  // An empty `declared` does not fail vacuously today — the loop below reports
  // every published page as missing its constant — but that is a property of code
  // further down, and this pattern has already had to move once, when the site's
  // URL form went extension-less on 2026-08-21.
  if (declared.length === 0) {
    fail(
      `COVERAGE LOST — no \`https://nikatru.com/<page>\` constant parsed out of ${BRICK}/${APP_CONFIG}, ` +
        `so the in-app half of the set equality below is EMPTY.`,
    );
    return;
  }

  // ── A CONSTANT IS NOT A LINK. ────────────────────────────────────────────
  // [pipeline 3]S-2's recorded lesson, one level down: declaring
  // `refundUrl` and never putting it on a screen leaves the page exactly as
  // unreachable as not declaring it, while making the set equality above go
  // green. So each constant must also be OPENED from the settings screen.
  //
  // ⚠️ HONEST LIMIT, stated rather than implied: this proves a call site exists
  // on the screen the settings register row claims, NOT that a tap reaches the
  // platform URL launcher. Proving that needs a launcher SEAM the chassis does
  // not have (`_openUrl` calls `url_launcher` directly), which is a stage-2/3
  // chassis change and is not claimed here.
  let settingsSrc = '';
  try {
    settingsSrc = readFileSync(join(repo, BRICK, SETTINGS), 'utf8');
  } catch (e) {
    fail(`COVERAGE LOST — ${BRICK}/${SETTINGS} unreadable: ${e.message}`);
    return;
  }

  const declaredSet = new Set(declared.map((d) => d.page));
  for (const { name, page } of declared) {
    if (LINK_EXEMPT_LEGAL_PAGES.has(page)) continue;
    if (!new RegExp(`_openUrl\\(\\s*AppConfig\\.${name}\\s*\\)`).test(settingsSrc)) {
      fail(
        `[8]K-6 — ${BRICK}/${APP_CONFIG} declares '${name}' for '${page}' but ` +
          `${BRICK}/${SETTINGS} never opens it. A constant nobody links leaves the page as ` +
          `unreachable as not declaring it at all, while making the set equality go green.`,
      );
    }
  }
  for (const page of mustLink) {
    if (!declaredSet.has(page)) {
      fail(
        `[8]K-6 — sites/nikatru publishes '${page}' and ${BRICK}/${APP_CONFIG} declares no URL for it. ` +
          `Every stamped app would ship a legal surface missing a page the site publishes. ` +
          `Add the constant and link it from the settings LEGAL section, or add '${page}' to ` +
          `LINK_EXEMPT_LEGAL_PAGES with the reason it is reached another way.`,
      );
    }
  }
  // The OTHER direction, and the one that stops the chassis pointing at pages
  // that do not exist: a link to an unpublished page is a 404 in front of a
  // user looking for the refund policy.
  const publishedSet = new Set(published);
  for (const page of declaredSet) {
    if (!publishedSet.has(page)) {
      fail(
        `[8]K-6 — ${BRICK}/${APP_CONFIG} links 'https://nikatru.com/${page}' but ${SITE_INTEGRITY} ` +
          `does not publish it. Every stamped app would send a user to a 404.`,
      );
    }
  }
  ok(
    `[8]K-6 legal set: ${mustLink.length} published page(s) linked in the chassis` +
      `${LINK_EXEMPT_LEGAL_PAGES.size ? `, ${LINK_EXEMPT_LEGAL_PAGES.size} reached by an in-app control instead` : ''}`,
  );
}

// ── [pipeline 10]D-8 limb (c) · A RESOLVED UPDATE URL MAY NEVER EQUAL THE ────
//    COMPILE-TIME DEFAULT OF ANY CHANNEL.
//
// 🔴 WHY THIS IS A SEPARATE LIMB AND NOT A LINE IN THE WIDGET TEST. Limb (b) —
// the stamped-app probe — asserts the button opens the URL the config served. It
// can only tell the two sources apart while the injected value DIFFERS from the
// compiled-in fallback. The day somebody "fixes" a red probe by injecting
// `AppConfig.updateUrl`, every assertion in that group goes green with the whole
// runtime resolution deleted: it would be measuring the fallback and reporting
// the feature. That is the assertion-that-cannot-fail shape, arriving through a
// test edit rather than through a code edit, and no test can catch it about
// itself.
//
// AND IT IS PER CHANNEL, because the compile-time default is. `AppConfig
// .updateUrl` is `String.fromEnvironment('UPDATE_URL', defaultValue: …)`, so a
// release lane can compile a different destination into each artifact; the value
// a given binary falls back to is its channel's, not the template's. A check
// against the template's default alone would pass while a channel's own build
// made the two indistinguishable.
//
// TWO SUBJECTS, both structural:
//   (1) the probe's injected constant, parsed off the brick's property test;
//   (2) every `update_url` the config service SERVES, parsed off DEFAULT_CONFIGS.
// (2) ranges over `null` today — no non-web channel is live, so there is nowhere
// to send anybody and null is the finding. That is printed rather than hidden,
// and the check is written so the one-line edit that makes it wrong
// (`update_url: 'https://nikatru.com'`) turns it red. Since 2026-08-07 the
// TOLERANCE of that null is derived too, from the channel register's `served` /
// `deferral` fields — see limb (2a) below for the mutation that proved the
// previous wording was a claim nothing checked.
const CHANNEL_CONFIG_FLOOR = 1;

// ⚠️ A HAND-ROLLED `stripTsComments` LIVED HERE AND IS GONE — DELETED, NOT
// PARKED. It existed for exactly one caller: the block below, which used to
// regex `services/platform/src/config.ts` for the served `update_url` values.
// [pipeline 4]B-2 made that set DATA, the block now `JSON.parse`s it, and a
// 40-line TypeScript comment stripper with no caller is dead code that reads as
// capability. This repo's own rule — mutation testing is how you find dead code,
// and a limb you cannot write a failing input for is deleted rather than kept
// "for safety" — applies to a guard's helpers as much as to its assertions.
// The remaining TS read in this file (PLATFORM_TYPES, ~line 900) is a line-
// anchored `^\s*update_url: string \| null;` over the interface and needs no
// stripping: a commented-out declaration does not start a line with two spaces
// and the field name.

/** The literal `AppConfig.updateUrl` falls back to, or null if unparseable. */
function compiledInUpdateUrl(brickConfigSrc) {
  const decl = brickConfigSrc.match(
    /static\s+const\s+String\s+updateUrl\s*=\s*String\.fromEnvironment\(\s*'UPDATE_URL'\s*,\s*defaultValue:\s*([^,)]+?)\s*,?\s*\)/,
  );
  if (!decl) return null;
  const expr = decl[1].trim();
  const literal = expr.match(/^'([^']*)'$/) ?? expr.match(/^"([^"]*)"$/);
  if (literal) return literal[1];
  // An identifier — resolve it in the same class, so `defaultValue: companyUrl`
  // is followed to the URL it actually is rather than compared as a name.
  const named = brickConfigSrc.match(
    new RegExp(`static\\s+const\\s+String\\s+${expr}\\s*=\\s*'([^']*)'`),
  );
  return named ? named[1] : null;
}

function checkUpdateDestinationIsRepointable() {
  let compiled;
  try {
    compiled = compiledInUpdateUrl(
      stripDartComments(readFileSync(join(repo, BRICK, APP_CONFIG), 'utf8')),
    );
  } catch (e) {
    fail(`COVERAGE LOST — ${BRICK}/${APP_CONFIG} unreadable: ${e.message}`);
    return;
  }
  if (!compiled) {
    fail(
      `COVERAGE LOST — [10]D-8: could not parse the compile-time default out of ${BRICK}/${APP_CONFIG} ` +
        "(`static const String updateUrl = String.fromEnvironment('UPDATE_URL', defaultValue: …)`). " +
        'Every comparison below is against that value, so an unparsed one makes this whole limb ' +
        'compare against nothing while printing ok.',
    );
    return;
  }

  // ── the per-channel compile-time value ────────────────────────────────────
  let channels;
  try {
    channels = JSON.parse(readFileSync(join(repo, CHANNEL_REGISTER), 'utf8')).channels;
  } catch (e) {
    fail(`COVERAGE LOST — ${CHANNEL_REGISTER} unreadable: ${e.message}`);
    return;
  }
  if (!Array.isArray(channels) || channels.length === 0) {
    fail(
      `COVERAGE LOST — ${CHANNEL_REGISTER} declares no channels, so "the compile-time default for ` +
        'any channel" ranges over nothing and cannot reject a value.',
    );
    return;
  }
  /** channel id → the UPDATE_URL a build for it compiles in. */
  const compiledByChannel = new Map();
  for (const row of channels) {
    let value = compiled;
    const wf = row?.lane?.workflow;
    if (typeof wf === 'string' && existsSync(join(repo, wf))) {
      for (const line of readFileSync(join(repo, wf), 'utf8').split('\n')) {
        // A COMMENT NAMING A DEFINE IS NOT A DEFINE — the same discrimination
        // assert-channel-register.mjs makes for RELEASE_CHANNEL.
        const code = line.replace(/#.*$/, '');
        const m = /--dart-define(?:=|\s+)UPDATE_URL=(\S+)/.exec(code);
        if (m) value = m[1];
      }
    }
    compiledByChannel.set(row.id, value);
  }

  // ── (1) the probe's injected constant ─────────────────────────────────────
  let probeUrl = null;
  try {
    const propSrc = stripDartComments(readFileSync(join(repo, BRICK, PROP_TEST), 'utf8'));
    probeUrl = propSrc.match(/const\s+String\s+kProbeUpdateUrl\s*=\s*'([^']*)'/)?.[1] ?? null;
  } catch { /* the missing-PROP_TEST case already failed hard above */ }
  if (probeUrl === null) {
    fail(
      `[10]D-8(c): ${BRICK}/${PROP_TEST} declares no \`kProbeUpdateUrl\`. That constant is the URL the ` +
        'update-url property injects as the SERVED value; without it the property is either gone or ' +
        'testing something else, and this limb has nothing to compare.',
    );
  } else {
    for (const [id, value] of compiledByChannel) {
      if (probeUrl === value) {
        fail(
          `[10]D-8(c): the property test injects '${probeUrl}' as the served update_url, which is EXACTLY ` +
            `what a '${id}' build compiles in as its fallback. The assertion that the button opens the ` +
            'RESOLVED url would then pass with the runtime resolution deleted — it would be measuring ' +
            'the fallback and reporting the feature.',
        );
      }
    }
  }

  // ── (2) every value the config service serves ─────────────────────────────
  //
  // 🔴 PARSED, NOT GREPPED, AND THE SUBJECT MOVED ON 2026-08-07. This block used
  // to slice `services/platform/src/config.ts` from the text `DEFAULT_CONFIGS`
  // onwards and match `/^\s{2}(\w+):\s*\{/gm` for app bodies. [pipeline 4]B-2
  // made the served app set DATA — the set now comes from the public catalogue
  // and the values from `app-config-data.json` — so that regex matched zero apps
  // and this guard went COVERAGE LOST on the first run after the refactor. It
  // did exactly what it was built to do; the fix is to re-point it, not to
  // loosen it.
  //
  // The domain is now the REAL served set rather than whatever a regex found in
  // one file: every catalogue slug, with its update_url resolved the way the
  // Worker resolves it (per-app entry, else `defaults`). That is strictly wider
  // than before — an app onboarded by a catalogue row alone was previously
  // invisible here.
  let catalogue;
  let data;
  try {
    catalogue = JSON.parse(readFileSync(join(repo, PLATFORM_CATALOGUE), 'utf8'));
    data = JSON.parse(readFileSync(join(repo, PLATFORM_CONFIG_DATA), 'utf8'));
  } catch (e) {
    fail(`COVERAGE LOST — ${PLATFORM_CATALOGUE} / ${PLATFORM_CONFIG_DATA} unreadable or unparseable: ${e.message}`);
    return;
  }
  const defaults = data && typeof data.defaults === 'object' && data.defaults !== null ? data.defaults : null;
  const perApp = data && typeof data.apps === 'object' && data.apps !== null ? data.apps : {};
  const apps = (Array.isArray(catalogue) ? catalogue : [])
    .map((r) => (r && typeof r.slug === 'string' ? r.slug : null))
    .filter((s) => s !== null);
  if (defaults === null) {
    fail(`COVERAGE LOST — ${PLATFORM_CONFIG_DATA} has no \`defaults\`, so no app's served value could be resolved.`);
    return;
  }
  if (apps.length < CHANNEL_CONFIG_FLOOR) {
    fail(
      `COVERAGE LOST — parsed ${apps.length} app(s) out of ${PLATFORM_CATALOGUE}, expected ` +
        `>= ${CHANNEL_CONFIG_FLOOR}. A served set that parsed as empty makes every comparison below ` +
        'vacuously true, which is the shape this guard exists to refuse.',
    );
    return;
  }
  // ── (2a) WHEN IS A SERVED `null` TOLERABLE? THE REGISTER ANSWERS. ──────────
  //
  // 🔴 THIS COUPLING REPLACES A SENTENCE NOTHING DERIVED. `nullServed` was
  // counted, printed, and compared against nothing, while the passing line
  // asserted in prose that null was "the recorded state while no non-store
  // channel is served". Measured 2026-08-07 on the real tree: flipping
  // `linux-appimage` to `"served": true, "deferral": null` — leaving
  // `defaults.update_url` null — left this guard at EXIT 0 reprinting that exact
  // sentence about a tree that had just falsified it. A claim in an `ok(...)`
  // string reads to every future maintainer as a checked fact; if no code derives
  // it, it is prose wearing a guard's clothes, which is this repository's
  // signature defect.
  //
  // THE RULE. A channel that is not the web channel gets no store reload and no
  // refreshed browser tab, so [10]D-8's locked path (config `min_supported_version`
  // → `ForceUpdateGate` → `update_url`) is the only way a user of that channel is
  // ever told to update. If such a channel is LIVE, a served `update_url` of null
  // means the wall opens the compiled-in fallback with no way to repoint it —
  // exactly the circular kill-switch owner decision #19 removed.
  //
  // LIVE = `served: true`, OR nothing defers it. The register's own convention is
  // that a deferral and `served: false` travel together (all seven non-web rows
  // carry a deferral object; the served `web` row carries none), so `deferral:
  // null`, an absent `deferral`, or a non-object one all read the same way: this
  // row claims nothing holds it back. Reading only `=== null` would leave
  // `delete row.deferral` as a one-key escape from the check.
  //
  // ⚠️ WIDER THAN D-8's OWN WORDING, DELIBERATELY. D-8 names channels with "no
  // store-driven auto-update", which is `kind: "direct"`. `kind !== "web"` also
  // covers a SERVED store row, and that is the fail-closed direction rather than
  // an invented limit: the force-update wall ships inside the store build too, and
  // with null served it opens the company home page instead of that store's
  // listing. A store channel going live is a reviewed event, and "what does the
  // wall open?" is a question that should be answered at exactly that moment.
  const isDeferred = (d) => typeof d === 'object' && d !== null;
  const liveNonWeb = channels
    .filter((row) => row?.kind !== 'web' && (row?.served === true || !isDeferred(row?.deferral)))
    .map(
      (row) =>
        `${row?.id ?? '<unnamed row>'} (kind=${row?.kind ?? 'none'}, served=${row?.served === true}, ` +
        `deferral=${isDeferred(row?.deferral) ? 'declared' : 'none'})`,
    );

  let nullServed = 0;
  let compared = 0;
  for (const appId of apps) {
    const own = Object.prototype.hasOwnProperty.call(perApp, appId) ? perApp[appId] : null;
    const hasOwnKey = own !== null && typeof own === 'object' && Object.prototype.hasOwnProperty.call(own, 'update_url');
    const hasDefault = Object.prototype.hasOwnProperty.call(defaults, 'update_url');
    if (!hasOwnKey && !hasDefault) {
      fail(
        `[10]D-8: ${PLATFORM_CONFIG_DATA} serves app '${appId}' with NO \`update_url\` key at all — ` +
          'neither its own nor a default. The force-update wall would fall back to the compiled-in ' +
          'destination with no way to repoint it, which is the circular kill-switch owner decision #19 ' +
          'removed.',
      );
      continue;
    }
    const raw = hasOwnKey ? own.update_url : defaults.update_url;
    const value = typeof raw === 'string' ? raw : null;
    if (value === null) {
      if (liveNonWeb.length > 0) {
        fail(
          `[10]D-8: ${PLATFORM_CONFIG_DATA} serves '${appId}' an update_url of null while ` +
            `${CHANNEL_REGISTER} carries ${liveNonWeb.length} live non-web channel(s) — ${liveNonWeb.join('; ')}. ` +
            'A channel is live here when it is `served: true` or when nothing defers it, and such a ' +
            'channel has no store reload to fall back on: config `min_supported_version` → ' +
            '`ForceUpdateGate` → `update_url` is the only way its users are ever told to update, and a ' +
            'null destination leaves the wall opening the compiled-in fallback with no way to repoint ' +
            "it. Serve a real update_url for this app, or record the channel's deferral in the " +
            'register — live and null cannot both be true.',
        );
      }
      nullServed++;
      continue;
    }
    for (const [id, base] of compiledByChannel) {
      compared++;
      if (value === base) {
        fail(
          `[10]D-8(c): ${PLATFORM_CONFIG_DATA} serves '${appId}' an update_url of '${value}', which is ` +
            `EXACTLY what a '${id}' build already compiles in. Serving a value identical to the fallback ` +
            'means the wall opens the same place whether config resolved or not, so nothing — no test, ' +
            'no user, no incident — can tell the runtime path from a dead one.',
        );
      }
    }
  }
  // The null count is printed BESIDE the number that licenses it, both derived —
  // so the passing line states the coupling instead of claiming it. A rise in the
  // second number with the first still non-zero is not a line to read past: it is
  // a build failure above.
  ok(
    `[10]D-8 update destination: ${compiledByChannel.size} channel(s) × ${apps.length} served app(s) — ` +
      `${compared} comparison(s), ${nullServed} app(s) serve null, ${liveNonWeb.length} live non-web ` +
      `channel(s) (the wall keeps its compiled-in fallback, tolerated only while that second number ` +
      `is 0 — derived from ${CHANNEL_REGISTER}'s \`served\`/\`deferral\`, not asserted here)` +
      `${probeUrl ? `; the probe injects '${probeUrl}', distinct from every channel's default` : ''}`,
  );
}

const REQUIRED_COVERAGE = [
  {
    key: 'theme-mode-persisted',
    group: /group\(\s*'property: theme-mode-persisted'/,
    // Both limbs, deliberately. The write alone would pass with `_hydrate`
    // deleted — a choice saved to disk and never read back, which looks exactly
    // like no persistence at all from the user's chair.
    sources: [
      { file: PROVIDERS, re: /kv\.write\(\s*_themeModeKey/, what: 'ThemeModeController.set must WRITE the choice — an in-memory-only setting silently resets at every launch' },
      { file: PROVIDERS, re: /kv\.read\(\s*_themeModeKey/, what: 'the controller must READ the stored choice back at launch — a write nobody reads restores nothing' },
    ],
    why: 'a stored light/dark choice must survive a restart',
  },
  {
    key: 'theme-triplet-supplied',
    group: /group\(\s*'property: theme-triplet-supplied'/,
    sources: [{ file: APP_ROOT, re: /themeMode:\s*ref\.watch\(themeModeProvider\)/, what: 'app.dart must pass themeMode to MaterialApp' }],
    why: 'theme + darkTheme + themeMode must all reach MaterialApp',
  },
  {
    key: 'brand-seed-drives-paint',
    group: /group\(\s*'property: brand-seed-drives-paint'/,
    // Anchored to the SEED REACHING THE BUILDER, in app.dart. The builder could
    // be perfect and the app still uniform if somebody drops the argument — and
    // `buildAppTheme(` alone would match the parameterless call in smoke_test.
    //
    // ⚠️ THESE THREE ANCHORS ARE TWO LINKS OF A THREE-LINK CHAIN. They prove the
    // seed reaches both builders and that the tokens are derived; they do NOT
    // prove any shipped widget READS those tokens back off the theme. The third
    // link is measured — and printed, never failed — by
    // `checkBrandSeedReachesPaint()` below, which says why the difference is an
    // owner decision rather than a repair. Do not fold that limb in here: as a
    // `source` anchor it would red CI on a judgement only the owner can make.
    sources: [
      // BOTH themes, not "at least one". The first version of this anchor was
      // /buildAppTheme\(\s*seed:/ — it survived deleting the seed from `theme:`
      // because `darkTheme:` still had one, so an app could ship a branded dark
      // theme and a generic light one and the guard stayed green. Found by
      // mutating the real template; the single-match version passed.
      { file: APP_ROOT, re: /theme:\s*buildAppTheme\(\s*seed:/, what: 'app.dart must pass its stamped seed to the LIGHT theme' },
      { file: APP_ROOT, re: /darkTheme:\s*buildAppTheme\(\s*\n?\s*seed:/, what: 'app.dart must pass its stamped seed to the DARK theme too' },
      { file: 'packages/design_system/lib/src/theme/app_theme_x.dart', re: /factory\s+AppThemeX\.fromScheme/, what: 'brand tokens must be DERIVED from the scheme — a const AppThemeX makes every stamp share one gradient and one ramp' },
    ],
    why: 'identical-looking apps are treated as spam by both stores, and Play enforcement reaches related accounts',
  },
  {
    key: 'paywall-gate-driven-by-server',
    group: /group\(\s*'property: paywall-gate-driven-by-server'/,
    // 🔴 THE PROPERTY THAT COULD NOT EXIST UNTIL [5]M-5 LANDED. `PaywallGate`
    // and `EntitlementCache` both shipped, both were tested, and no code path in
    // this repo had ever asked the server whether anybody had paid. Nothing went
    // red, because refusing is correct when nobody has paid.
    //
    // FIVE anchors, because deleting any one of them re-breaks the chain while
    // leaving the other four looking healthy — and a chain is exactly what this
    // property is about.
    sources: [
      { file: MONEY_PROVIDERS, re: /\.fetch\(\s*\n?\s*appId:/, what: 'the chassis must actually ASK the server — a lock decision reached without asking is the dead capability C-6 exists to catch' },
      { file: MONEY_PROVIDERS, re: /cache\.saveVerified\(/, what: 'a server answer must be written through as VERIFIED, or the M-8 staleness ceiling can never be crossed' },
      { file: MONEY_PROVIDERS, re: /paywallLockedProvider/, what: 'the answer must reach a LOCK DECISION — a fetch nothing consults is the same dead capability wearing a network call' },
      { file: HOME, re: /PaywallGate\(\s*\n?\s*locked:/, what: 'the lock must reach the GATE in the stamped chassis, or PaywallGate goes back to having zero consumers' },
      { file: 'packages/core/lib/src/entitlement_cache.dart', re: /kEntitlementStalenessCeiling\s*=\s*Duration\(/, what: 'M-8 needs a NAMED bound; "within the declared bound" with nothing declared cannot fail' },
    ],
    why: 'a paywall that is not driven by a real server answer is either a wall nobody paid past or a product given away',
  },
  {
    key: 'promo-card-fails-closed',
    group: /group\(\s*'property: promo-card-fails-closed'/,
    // 🔴 THE PROPERTY WHOSE CORRECT BEHAVIOUR IS INVISIBLE. `features.
    // promo_card_enabled` is absent from every config this portfolio serves and
    // an absent feature key reads false, so the shipped card draws a collapsed
    // `SizedBox.shrink()` — identical, from outside, to a card nobody mounted,
    // a card somebody deleted, and a card that never worked. The stamped app has
    // to prove BOTH halves about itself: mounted-and-zero-height with the flag
    // absent, and a real labelled card with a derived price once it is served.
    //
    // EIGHT anchors, because deleting any one leaves the other seven healthy
    // while the surface stops being what it claims. The last three were added
    // 2026-08-10 after an adversarial review MUTATED THE REAL TREE and found
    // three limbs nothing depended on:
    //   · the paid-user check could be deleted with all 18 surface rows and all
    //     7 property rows still green — the row carrying its name asserted the
    //     card SHOWED, for an UNPAID user;
    //   · the hydration barrier did not exist, so a device holding an Art 21
    //     objection was shown a promotional card for the length of the disk
    //     read (measured: t+0 through t+20 ms against a 40 ms store) and every
    //     widget test hid that window behind `pumpAndSettle()`;
    //   · a corrupt record fell back to the empty default AND was then
    //     overwritten with `"suppressed":false`, erasing the objection from
    //     disk in one launch.
    sources: [
      { file: HOME, re: /const UpgradePromoCard\(\)/, what: 'the card must be MOUNTED in the stamped home body — a surface nothing mounts cannot be turned on by a config edit, and it renders the same nothing either way' },
      { file: HOME, re: /featureEnabled:\s*cfg\?\.feature\(kPromoCardFeature\)/, what: 'the on-switch must be the CONFIG key, read with its absent-means-false default — research/44 §4.5: an app that has never reached the network shows no promo' },
      { file: HOME, re: /hasContent:\s*offerings\.isNotEmpty/, what: 'an eligible user and nothing to promote must be a REFUSAL, not a silent show — research/44 opens its DO-NOT-BUILD list with the empty directory that is "wired, guarded, green and useless"' },
      { file: HOME, re: /onManageAction:\s*\(\)\s*=>\s*context\.go\('\/manage-plan'\)/, what: 'ROSCA parity — the cancel entry rides on the same surface as the offer, not one level below it' },
      { file: PROVIDERS, re: /if\s*\(current\.dismissed\s*\|\|\s*current\.suppressed\)\s*return;/, what: 'a latch that arrived from storage while an impression was in flight must WIN — writing the decision through verbatim erased a GDPR Art 21 objection from disk, which the property test caught' },
      // ⚠️ ANCHORED ON THE NULL TEST, NOT ON `valueOrNull`. `?? const
      // PromoGateState()` also contains `valueOrNull` and is precisely the
      // mutation this exists to catch — it compiles, analyzes clean, and puts
      // the card back in front of a user whose record has not been read.
      { file: HOME, re: /if\s*\(stored\s*==\s*null\)\s*return const SizedBox\.shrink\(\);/, what: 'the HYDRATION BARRIER — a record that has not been read yet is not a record that says nobody objected, and Art 21(3) has no grace period in it. Without this the card renders for the whole duration of the disk read and no settled widget test can see it' },
      // 🔴 ANCHORED ON THE WHOLE CLAUSE, NOT ON `ref.watch(paywallLockedProvider)`.
      // MEASURED 2026-08-10: the bare read shipped as this anchor and was BLIND
      // to the only mutation it names. `home_screen.dart` already watches that
      // provider for the PaywallGate's own `locked:` — a different feature, the
      // one the file existed for before this card arrived — so deleting the
      // card's paid-user check from BOTH real home screens left this guard at
      // exit 0. Proven by mutating the real tree, which is the only thing that
      // could have shown it: a fixture written beside the anchor encodes the
      // same misunderstanding as the anchor.
      //
      // The clause is the anchor because the clause is the claim. `paywall.enabled`
      // is in it for a reason of its own: `paywallLockedProvider` is false for
      // everyone in an app that sells nothing, and "false for everyone" must not
      // read as "everybody has paid".
      { file: HOME, re: /\(cfg\?\.paywall\.enabled\s*\?\?\s*false\)\s*&&\s*!ref\.watch\(paywallLockedProvider\)/, what: 'a user who has ALREADY PAID must not be promoted to — this limb survived deletion with every promo test in both suites green until the review mutated the real tree' },
      { file: PROVIDERS, re: /if\s*\(!_recordRead\)\s*return;/, what: 'no write may land on a record we failed to read — an impression counter is the least important thing on this key and must never be what destroys the most important one' },
    ],
    why: 'a promotional surface whose off state and whose dead state are pixel-identical can only be told apart by an assertion',
  },
  {
    key: 'ui-invariants-inherited',
    group: /group\(\s*'property: ui-invariants-inherited'/,
    sources: [
      { file: APP_ROOT, re: /MediaQuery\.withClampedTextScaling\(/, what: 'app.dart must clamp text scaling at the root — unbounded scaling overflows, and an overflowing screen is one the user cannot finish' },
      { file: SCAFFOLD, re: /static const double medium = 600;/, what: 'AppScaffold must use Material’s 600 boundary — it was 640, so every window 600–639 got the phone layout' },
      { file: SCAFFOLD, re: /enum WindowClass \{\s*compact,\s*medium,\s*expanded,\s*large,\s*extraLarge\s*\}/, what: 'all FIVE Material window classes must exist — the tree covered three' },
      // 🔴 THE ONE ANCHOR NO WIDGET TEST CAN STAND IN FOR. `setSurfaceSize`
      // sets the logical size directly, so every width assertion in the
      // property test passes on a web build where real phones report ~980 px
      // and land in `expanded`. A missing viewport meta discards the whole
      // window-class decision in the browser, before Flutter runs.
      //
      // Matched on the TAG, never on prose: the template carries a comment
      // explaining this line, and a looser /viewport/ would be satisfied by
      // the explanation of the thing it is checking for. (The r2_buckets
      // lesson — assert on structure, not on words.)
      { file: WEB_INDEX, re: /<meta\s+name="viewport"[^>]*content="[^"]*width=device-width/, what: 'the stamped web shell must declare a device-width viewport — without it a mobile browser lays the app out at ~980px and scales it down, so every window class is resolved from a lie and the compact layout is unreachable on real phones' },
    ],
    why: 'these are near-free in the chassis and near-impossible to retrofit across 50 shipped apps',
  },
  {
    // [pipeline 7]P-9 consumer half · [pipeline 8]K-9.
    //
    // 🔴 THE SHAPE THIS REPLACES. K-9's own acceptance was "fail if any shipped
    // app declares the content-pack chassis live while its resolved config has
    // no consumer" — an antecedent NO app could satisfy, because `contentPack`
    // was the literal `null` in the brick and in apps/subly both. Empty
    // antecedent, vacuously true, and it got greener the less was built. The
    // replacement is red for a reason nobody can remove by declining to act:
    // the brick now names a pack, and something has to serve it.
    key: 'content-pack-consumed',
    group: /group\(\s*'property: content-pack-consumed'/,
    sources: [
      // NOT `contentPack:` alone — that matches the `null` this property exists
      // to have replaced. The anchor is a non-null pointer.
      {
        file: PROVIDERS,
        re: /contentPack:\s*'https:\/\//,
        what: 'the brick must NAME a pack — `contentPack: null` is the empty antecedent that made every content-pack check vacuously true',
      },
      {
        file: PROVIDERS,
        re: /ContentPackLoader\(\s*\n?\s*verifier:/,
        what: 'the loader must be CONSTRUCTED in the stamped chassis — it had zero non-test call sites tree-wide while being fully implemented and exported',
      },
      {
        file: PROVIDERS,
        re: /\.load\(\s*\n?\s*expectPackId:/,
        what: 'something must actually ASK for a pack, and ask for THIS app’s pack — a signature says who made a pack, never which pack it is',
      },
    ],
    why: 'a rights complaint has to be actionable in hours without a store release, which is only true if a pointer flip really stops the pack being served',
  },
  {
    key: 'auth-seam-wired',
    group: /group\(\s*'property: auth-seam-wired'/,
    sources: [
      // ⚠️ `\s+`, NOT A LITERAL SPACE, AND IT WENT RED TO PROVE IT MATTERS. This
      // read `AuthRepository> authRepositoryProvider` with one space, and on
      // 2026-08-11 `dart format` moved the break: growing the provider's body by
      // one argument was enough for the formatter to wrap after the TYPE rather
      // than after the `=`, so the declaration became two lines and this anchor
      // stopped matching a line that had not changed in meaning at all. An
      // anchor whose truth depends on the formatter's line-breaking is an anchor
      // that fails on whitespace and passes on a deletion.
      { file: PROVIDERS, re: /final Provider<core\.AuthRepository>\s+authRepositoryProvider/, what: 'the brick must wire an AuthRepository — before C-15 it wired none, so every stamped app was born unable to sign anyone in' },
      // NOT just `tokenProvider:` — the acceptance is that it reaches the SHARED
      // client, so both halves are anchored.
      { file: PROVIDERS, re: /tokenProvider:\s*ref\.watch\(authTokenProvider\)/, what: 'the token provider must reach the shared RestClient, or the app authenticates and no request ever carries a token' },
      { file: 'packages/auth_supabase/lib/nikatru_auth_supabase.dart', re: /localStorage:\s*SecureSessionStorage\(/, what: 'the session must go in the SECURE store — the Supabase SDK defaults to plaintext shared_preferences for the access AND refresh tokens [G-43]' },
      // 🔴 THE CALL SITE, and it is the anchor that was missing for the whole
      // life of this property. The line above matches text INSIDE
      // `initNikatruAuth` — a function that had ZERO callers tree-wide. The
      // guard printed `ok ... auth-seam-wired` while the brick initialised
      // Supabase nowhere at all (so a backend-live stamp crashed at launch on
      // `Supabase.instance`) and the one shipping app called
      // `Supabase.initialize` bare (so its refresh token sat in plaintext).
      // Neither could ever have turned this property red, because a declaration
      // cannot tell you anything about who calls it. There is no `declares:`
      // exclusion needed here only because the anchor names main.dart, which is
      // not where the function is declared — that is the point of naming it.
      { file: MAIN, re: /await\s+initNikatruAuth\(/, what: 'the brick’s main.dart must CALL initNikatruAuth — the SDK was initialised nowhere, so a stamp built with the documented identity dart-defines died at launch on an uninitialised Supabase.instance' },
      { file: MAIN, re: /secureStore:\s*FlutterSecureStore\(/, what: 'the launch call must hand it a REAL platform secure store — initialising without one is how the refresh token ends up in a plaintext file [G-43]' },
      // A 401 used to sign the user out unconditionally. An access token that
      // merely EXPIRED looks identical from the Worker's chair, and expiry is
      // routine (the SDK stops its refresh ticker while the app is paused), so
      // the normal act of resuming the app logged people out of it.
      { file: PROVIDERS, re: /onUnauthorized:\s*\(\)\s*=>\s*\n?\s*signOutOnlyIfSessionIsGone\(/, what: 'a 401 must go through signOutOnlyIfSessionIsGone — signing out on ANY 401 turns a routine expired token into a forced logout' },
      { file: PROVIDERS, re: /await auth\.currentAccessToken\(\) == null/, what: 'that decision must ASK the seam for a token first — without the check the function is an unconditional sign-out under a reassuring name' },
    ],
    why: 'the auth seam had no home: the only implementations lived inside apps/subly, and the brick wired no auth and no tokenProvider',
  },
  {
    key: 'auth-redirect-follows-session',
    group: /group\(\s*'property: auth-redirect-follows-session'/,
    sources: [
      // The join that was missing. `redirect:` alone was present the whole time
      // the app was unusable, so anchoring on the guard would assert nothing.
      { file: ROUTER, re: /refreshListenable:\s*ref\.watch\(routerRefreshProvider\)/, what: 'the router must be TOLD when the session changes — redirect re-runs on navigation, not on a session appearing, so signing in left the user on the form they had just completed' },
      { file: PROVIDERS, re: /class AuthRefreshNotifier extends ChangeNotifier/, what: 'the auth stream must be bridged to a Listenable — without it refreshListenable has nothing to listen to' },
      { file: PROVIDERS, re: /_sub\s*=\s*changes\.listen\(/, what: 'the notifier must actually SUBSCRIBE to authStateChanges — a ChangeNotifier that never fires is indistinguishable from no refresh at all' },
      { file: PROVIDERS, re: /Listenable\.merge\(<Listenable>\[\s*ref\.watch\(authRefreshProvider\)/, what: 'the merged refresh must still carry the AUTH signal — the onboarding flag was added to it, and dropping auth from the merge would restore the original bug in a place nobody would look' },
    ],
    why: 'a stamped app signed the user in and went on showing them the sign-in form; the seam and the guard both worked and nothing joined them',
  },
  {
    key: 'password-recovery-routes',
    group: /group\(\s*'property: password-recovery-routes'/,
    sources: [
      // 🔴 THE MAPPING, AND IT IS THE WHOLE FEATURE. `authStateChanges()` maps
      // `AuthState` down to `AuthUser?`, so the `AuthChangeEvent` that produced
      // it is discarded at the seam — and a user arriving on a recovery link is
      // then byte-for-byte an ordinary sign-in. The reason exists ONLY at
      // delivery; no later read of the user, the session or the JWT can
      // reconstruct it.
      { file: 'packages/auth_supabase/lib/src/supabase_auth_repository.dart', re: /sb\.AuthChangeEvent\.passwordRecovery\s*=>\s*core\.AuthEventKind\.passwordRecovery/, what: 'the adapter must carry the recovery event across the seam — mapped away, a reset link is indistinguishable from a sign-in and the router sends the user home' },
      { file: PROVIDERS, re: /class PasswordRecoveryController extends Notifier<bool>/, what: 'something must HOLD the recovery reason: the event is a single instant and the redirect guard is consulted long afterwards' },
      { file: PROVIDERS, re: /if\s*\(event\.startsPasswordRecovery\)/, what: 'the controller must arm on the recovery event itself — a controller subscribed to the stream and switching on nothing is a gate that never fires' },
      { file: PROVIDERS, re: /core\.AuthEventKind\.signedOut\)\s*\{\s*state = false/, what: 'and it must CLEAR on sign-out, which is the only release: without it a user who finishes the reset is held on the screen forever, because every location they try answers /reset-password' },
      // The refresh signal. Same defect as `auth-redirect-follows-session` two
      // gates later, and worse here: the recovery event arrives while the user
      // sits still, so NOTHING navigates and the gate is never consulted at all.
      { file: PROVIDERS, re: /ref\.listen<bool>\(\s*passwordRecoveryProvider/, what: 'the router must be TOLD when the recovery flag changes — redirect fires on navigation, and a reset link arrives with the user sitting on whatever screen the browser opened' },
      { file: ROUTER, re: /ref\.read\(passwordRecoveryProvider\)/, what: 'the redirect guard must READ the flag — a provider nothing consults is a screen no link can reach' },
      { file: ROUTER, re: /'\/reset-password'/, what: 'the route must exist: sendPasswordReset shipped, real mail was delivered, and there was no path for the link to land on' },
      // 🔴 THE FAILURE HALF, ADDED 2026-08-11. Everything above proves the
      // SUCCESS path. A link that cannot be exchanged emits an error and never
      // `passwordRecovery`, so none of it fires — the dead-link screen was
      // unreachable from the failure it explains, and the same arrival with a
      // `?code=` and no PKCE verifier was an UNCAUGHT FATAL (GlitchTip SUBLY-8).
      // These four are what make the other direction real.
      { file: 'packages/auth_supabase/lib/src/supabase_auth_repository.dart', re: /handleError:/, what: 'the adapter must convert the stream ERROR into an event — `supabase_flutter` re-emits a failed exchange through `notifyException`, and an unhandled stream error is a fatal crash, not a message to anybody' },
      { file: PROVIDERS, re: /class PasswordResetArrivalController/, what: 'something must HOLD the failed arrival, for the same reason the recovery flag is held: the error is one instant and the redirect guard is consulted afterwards' },
      { file: PROVIDERS, re: /passwordResetArrivalOf\(ref\.watch\(launchUriProvider\)\)/, what: 'and it must read the LAUNCH URL — the failure redirect replaces the fragment with its error parameters, so the route the link asked for is gone and only the query says what this arrival was' },
      { file: ROUTER, re: /passwordResetArrivalProvider/, what: 'the redirect guard must read the arrival too — reading only the success flag is what made the explanation reachable by typing the URL and by nothing else' },
    ],
    why: 'password reset shipped with only its REQUEST half — a working sendPasswordReset, a delivered mail, and no updatePassword, no route and no redirectTo, so a user who forgot their password could ask for help and not accept it',
  },
  {
    key: 'account-deletion-works',
    group: /group\(\s*'property: account-deletion-works'/,
    sources: [
      // NOT merely that the method exists — that the BUTTON calls it. The defect
      // was a confirm action of `Navigator.pop(dialogContext)` and nothing else,
      // which looks exactly like a button that worked.
      { file: SETTINGS, re: /onConfirm:\s*\(\)\s*=>\s*_deleteAccount\(/, what: 'the confirm button must call _deleteAccount — it used to call Navigator.pop and nothing else' },
      { file: SETTINGS, re: /await auth\.deleteAccount\(\)/, what: 'the delete flow must reach AuthRepository.deleteAccount' },
      { file: SETTINGS, re: /await auth\.signInWithEmail\(/, what: 'deletion is irreversible and must REAUTH first — a borrowed or unattended device must not be enough to destroy an account' },
      // 🔴 THE THREE ANCHORS ABOVE ALL LIVE IN settings_screen.dart, so every
      // one of them was satisfied by a call chain whose terminal branch was an
      // unconditional throw: providers.dart hard-coded `requestServerDeletion:
      // null`, the repository took the refusal branch every time, and the user
      // was signed out and never deleted. Same shape as the `Navigator.pop`
      // confirm button this property was built for, one layer deeper.
      { file: PROVIDERS, re: /requestServerDeletion:\s*\(\)\s*=>/, what: 'the deletion request must be WIRED to the server route — hard-coding it to null makes every anchor above pass against a flow that can only ever refuse' },
      // …and it must be wired through the helper that KEEPS THE STATUS. A bare
      // `delete('/account')` throws an ApiException that `deleteAccount` flattens
      // into an AuthFailure, so by the time the screen catches it, 501 (nothing
      // was deleted) and 502 (data gone, login alive) are the same object.
      { file: PROVIDERS, re: /requestAccountDeletion\(/, what: 'the deletion must go through requestAccountDeletion, which maps the HTTP status while it still exists — a bare delete() call loses the 501-vs-502 distinction before any screen can read it [ADR 027]' },
      // 🔴 THE ANCHOR FOR THE MESSAGE ITSELF. Every anchor above was satisfied by
      // a `catch (_)` printing ONE string for every refusal — including 502,
      // where "your account has NOT been deleted" is simply false.
      { file: SETTINGS, re: /core\.accountDeletionOutcomeOf\(/, what: 'the failure path must resolve WHICH refusal it was — one message for every outcome tells a user whose data is already gone that nothing happened [ADR 027]' },
      // …and wiring it to a route that leaves the identity behind would be
      // worse than the refusal: "your account is deleted" followed by a login
      // that still works is the one failure a user cannot detect.
      { file: ACCOUNT_ROUTE, re: /auth\/v1\/admin\/users\//, what: 'the stamped route must delete the IDENTITY record too — purging rows and entitlements while the login still works is a deletion the user can never verify [master §0.1 G2]' },
      { file: ACCOUNT_ROUTE, re: /SUPABASE_SERVICE_ROLE_KEY/, what: 'the identity delete needs the service-role credential, and the route must refuse rather than report a success it cannot deliver' },
    ],
    why: 'both stores require a WORKING in-app deletion path wherever an account can be created',
  },
  {
    key: 'profile-edit-works',
    group: /group\(\s*'property: profile-edit-works'/,
    sources: [
      // The BUTTON calls it, not merely that the method exists. This is the
      // exact anchor shape the account-deletion property needed after its
      // confirm action turned out to be `Navigator.pop` and nothing else.
      { file: SETTINGS, re: /onSave:\s*\(\)\s*=>\s*_saveProfile\(/, what: 'the save button must call _saveProfile — a dialog whose action only pops looks exactly like one that worked' },
      { file: SETTINGS, re: /\.updateProfile\(displayName:/, what: 'the save flow must reach AuthRepository.updateProfile, or the name changes on screen and nowhere else' },
      // The tile must read the STREAM. Reading `currentUser` compiles, renders,
      // and never updates after a save — the failure is invisible in review.
      { file: SETTINGS, re: /ref\.watch\(authUserProvider\)/, what: 'the profile tile must watch the identity STREAM — a currentUser snapshot never rebuilds, so a saved name goes on displaying the old value' },
      { file: 'packages/core/lib/src/auth/auth_repository.dart', re: /Future<AuthUser> updateProfile\(\{required String displayName\}\)/, what: 'the seam must declare updateProfile — the screen was refused because "there is no profile data model", and this is the model' },
    ],
    why: 'a profile screen that saves nowhere is the dead feature C-6 exists to catch, and refusing to build it on the strength of a symptom is what kept it unbuilt',
  },
  {
    key: 'onboarding-shown-once',
    group: /group\(\s*'property: onboarding-shown-once'/,
    sources: [
      { file: `${BRICK}/lib/features/firstrun/onboarding_screen.dart`, re: /class OnboardingScreen extends ConsumerStatefulWidget/, what: 'the carousel must exist in the chassis — the refusal was that the CONTENT is app-specific, which is true of the words and false of the mechanism' },
      // 🔴 THE ANCHOR THAT MATTERS. AppConfig.text(key) returns the KEY when
      // there is no override, and a fresh stamp has none — so a carousel wired
      // to it greets its first user with `onboarding.1.title`.
      { file: `${BRICK}/lib/features/firstrun/onboarding_screen.dart`, re: /_copy\(cfg, 'onboarding\.1\.title', l10n\.onboarding1Title\)/, what: 'the copy must fall back to the l10n string, NEVER to the key — AppConfig.text() returns the key itself when unset, which would ship a raw key to a real user' },
      { file: ROUTER, re: /return state\.matchedLocation == '\/onboarding' \? null : '\/onboarding';/, what: 'the router must send a fresh install to onboarding AND exempt it from the auth gate — falling through hands /onboarding to the signed-out rule, which sends it to /sign-in and the user never sees it' },
      { file: PROVIDERS, re: /kv\.write\(_onboardingSeenKey/, what: 'the choice must be WRITTEN, or onboarding returns at every launch forever' },
    ],
    why: 'a first run shown twice is an irritation; one shown never drops the user into an app nobody introduced, and one showing raw config keys ships something no reviewer would read as a bug',
  },
  {
    key: 'review-prompt-gated',
    group: /group\(\s*'property: review-prompt-gated'/,
    sources: [
      { file: PROVIDERS, re: /class ReviewPromptController extends Notifier<core\.ReviewGateState>/, what: 'the chassis must own the review history — a prompt with no persisted history asks on every launch, and the store discards all but the first' },
      { file: PROVIDERS, re: /\.decide\(/, what: 'the ask must go through ReviewGate.decide — a call site that decides for itself is how the one request a store honours gets spent at a bad moment' },
      // The CALL SITE, not merely the machinery. A review seam with no caller is
      // invisible: the gate refuses on almost every launch by design, so
      // "nothing happened" is the correct outcome nearly always.
      { file: APP_ROOT, re: /await review\.recordLaunch\(\)/, what: 'app.dart must count the launch, or the gate never reaches its threshold and the prompt is dead code' },
      { file: APP_ROOT, re: /await review\.maybeAsk\(\)/, what: 'app.dart must actually ask — the seam having a caller is the whole difference between this and the four fail-closed seams C-6 was written for' },
    ],
    why: 'iOS silently discards requests beyond its quota, so a prompt asked at the wrong moment is not a dismissed dialog — it is the whole opportunity the app gets, spent',
  },
  {
    key: 'reminder-intent-persisted',
    group: /group\(\s*'property: reminder-intent-persisted'/,
    sources: [
      { file: PROVIDERS, re: /kv\.write\(\s*_remindersKey/, what: 'the reminder choice must be WRITTEN — an in-memory toggle resets at every launch' },
      { file: PROVIDERS, re: /kv\.read\(\s*_remindersKey/, what: 'it must be READ back at launch — a write nobody reads restores nothing' },
      // `\s*` around the dot because `dart format` wraps this call across two
      // lines in the stamped app, and an anchor that only matches the unwrapped
      // form fails on the very file it is guarding.
      { file: SETTINGS, re: /NotificationCapabilities\s*\.\s*forPlatform\(/, what: 'the toggle must consult the platform matrix — a switch that silently does nothing on Linux/Windows is worse than an honest sentence' },
      // 🔴 ADDED 2026-08-01 AFTER THE TOGGLE WAS FOUND INERT. Everything above
      // was green while the ON path called `requestPermission()` and stored the
      // answer and NOTHING ELSE: no `init()`, no `scheduleDaily`, no call site
      // for either anywhere in the brick. Persisting the intent was never the
      // feature — these three anchors are the feature.
      { file: PROVIDERS, re: /scheduleDaily\(\s*core\.DailyReminder\(/, what: 'the toggle must really SCHEDULE — the ON path used to end at requestPermission(), so every stamped app spent the one OS prompt and then scheduled nothing, on every platform' },
      { file: PROVIDERS, re: /svc\.init\(\)/, what: 'the service must be initialised — without it the timezone database and the plugin never load, and scheduleDaily has nothing to schedule against' },
      { file: SETTINGS, re: /applyReminderChoice\(/, what: 'the switch must call the path that schedules; a switch wired only to the persisted flag is the toggle-with-no-feature shape' },
    ],
    why: 'a toggle that reads ON while every notification is dropped is the C-6 shape',
  },
  {
    // [pipeline T-5/T-7] The measured finding this closes: `set(false)` persisted
    // OFF and left every schedule ARMED, because the only route to `cancelAll`
    // was `applyReminderChoice`, reachable from one `SwitchListTile.onChanged`.
    // And there was no repair path at all — an Android reboot drops pending
    // alarms, a DST shift moves the wall-clock hour a schedule was built
    // against, so "reminders are on" decayed to "reminders were on once" with
    // nothing red anywhere.
    key: 'reminders-resync-on-start',
    group: /group\(\s*'property: reminders-resync-on-start'/,
    sources: [
      // THE CALL SITE, not the declaration. The reconciler exists to be RUN at
      // start-up; a method nobody calls is the C-6 shape with extra steps, and a
      // declaration-matching anchor is the exact trap assert-seams-wired shipped.
      { file: APP_ROOT, re: /\.resyncOnStart\(/, what: 'app.dart must re-arm from the persisted intent at start-up — without a call site the reboot/DST repair path is dead code' },
      { file: PROVIDERS, re: /Future<void> resyncOnStart\(/, what: 'the chassis must own the reconciler; an app-local one is a fork of the seam' },
      // The cancel must hang off the PERSISTED INTENT, not off the widget
      // callback. This is the line whose absence let the schedule outlive the
      // switch for every writer of the flag other than the toggle itself.
      { file: PROVIDERS, re: /if \(!on\) await _cancelSchedules\(\);/, what: 'set(false) must itself cancel — with the cancel only in applyReminderChoice, a settings sync or a restore leaves every schedule armed behind a switch reading OFF' },
    ],
    why: 'an opt-out that only holds when a particular widget was tapped is not an opt-out, and a schedule with no repair path silently stops existing after the first reboot',
  },
  {
    // [pipeline T-8] Half of this requirement — the matrix-honest settings tile —
    // has been green since the toggle landed. This is the OTHER half: three of
    // the six platforms cannot schedule a repeating local notification and NO
    // version of the pinned plugin family can (its own limitations text records
    // that Windows throws on repeating notifications, Linux has no scheduler
    // API, and browsers support neither), so the in-app catch-up is a standing
    // part of the chassis rather than a bridge. It was promised in six doc
    // comments and implemented in zero places.
    key: 'no-silent-channel',
    group: /group\(\s*'property: no-silent-channel'/,
    sources: [
      // The MOUNT, not the class. A widget declared and never placed is the
      // dead-control shape, and `class CatchUpNudgeBanner` would match with the
      // banner deleted from the tree it is supposed to appear in.
      { file: HOME, re: /const CatchUpNudgeBanner\(\),/, what: 'the home shell must MOUNT the nudge — a banner nothing places is the dead-control shape, and on Web/Windows/Linux it is the only delivery mechanism there is' },
      { file: HOME, re: /core\.CatchUpNudge\(\)\.decide\(/, what: 'the banner must decide through the shared predicate; a local `if` re-derives the rule per app and drifts' },
      { file: PROVIDERS, re: /kv\.write\(_lastNudgeShownKey/, what: 'the dismissal must be PERSISTED — an in-memory one comes straight back at the next launch, which is a nag rather than a nudge' },
      // The RELATIONSHIP, asserted in the test rather than named here: the loop
      // must range over the enum, so a platform Flutter adds later cannot arrive
      // with neither half of the promise and nothing red.
      { file: PROP_TEST, re: /for \(final TargetPlatform p in TargetPlatform\.values\)/, what: 'the platform loop must enumerate TargetPlatform.values — a hand-written list is a list somebody shortens, and it would keep passing over Android alone' },
    ],
    gap:
      'the WEB row of no-silent-channel cannot be exercised from a widget test — `kIsWeb` is a ' +
      'compile-time constant, and web is the only live platform this factory ships to. The DECISION is ' +
      'covered for that row in packages/core/test/catch_up_nudge_test.dart (platformCanSchedule is a ' +
      'parameter); the widget\'s own kIsWeb read is not. Closing it needs `isWeb` as an injectable seam ' +
      'value — a [2]C-1/C-7 edit. Declared 2026-08-03.',
    why: 'a reminder the platform cannot schedule and the app never mentions is a switch that reads ON over a device that says nothing, on three of six platforms',
  },
  {
    // ── [13]T-9 · THE TAP LOOP, IN THE TEMPLATE ─────────────────────────────
    //
    // 🔴 THE MEASURED GAP. The tap loop was wired into `apps/subly` and stopped
    // there. The brick carried the whole OUTBOUND rail — `notificationService
    // Provider`, `applyReminderChoice`, `resyncOnStart`, the platform matrix,
    // the settings toggle — and had NO subscriber to `notificationTaps()`
    // anywhere. So app #2 through #50 were born able to wake a user at 09:00 and
    // unable to notice they answered, and `notification_opened` had zero
    // emitters in every app but one.
    //
    // ⚠️ AND `assert-capability-register.mjs` COULD NOT SAY SO: its `emitter`
    // for this surface is pinned to `apps/subly/lib/state/analytics_funnel.dart`
    // (a real file, a real caller), so the register stayed green about a
    // capability the template did not have. A guard pointed at one app cannot
    // answer a question about the factory — which is why this anchor set is
    // app-relative and therefore re-checked for every stamped app.
    //
    // FIVE anchors across FOUR files, because each one alone leaves the other
    // three looking healthy while the loop is dead:
    //   · the MOUNT in app.dart — the gate widget existing but unplaced is the
    //     dead-control shape, and `class _NotificationTapGate` would match it;
    //   · the CONSTRUCTION in app.dart — the mount with an empty gate is a
    //     wrapper that forwards its child;
    //   · the SUBSCRIPTION in the observer — the only line that makes the OS
    //     stream reach anything;
    //   · the single-instance OVERRIDE in main.dart — without it the tree gets a
    //     second, uninitialised adapter whose stream is silent forever;
    //   · the widget limb of the property test — the unit chain passes with the
    //     gate deleted from app.dart, so the limb that pushes a real tap through
    //     the stamped app root is the one that cannot be faked.
    key: 'notification-tap-observed',
    group: /group\(\s*'property: notification-tap-observed'/,
    sources: [
      { file: APP_ROOT, re: /child:\s*_NotificationTapGate\(/, what: 'app.dart must MOUNT the tap gate — a widget declared and never placed leaves the tap stream with no subscriber, which is indistinguishable from no tap at all' },
      { file: APP_ROOT, re: /NotificationTapObserver\(\s*\n?\s*service:/, what: 'the gate must really CONSTRUCT the observer over the notification seam; a gate that only forwards its child is a mount with nothing behind it' },
      { file: TAP_OBSERVER, re: /notificationTaps\(\)\.listen\(/, what: 'the observer must SUBSCRIBE — this single line is the entire inbound half, and without it the adapter delivers taps to nobody' },
      { file: TAP_OBSERVER, re: /kEvent\s*=\s*'notification_opened'/, what: 'the emitted event must be `notification_opened` — the taxonomy name the funnel is built on, not an app-invented one' },
      { file: MAIN, re: /notificationServiceProvider\.overrideWithValue\(\s*\n?\s*notifications,?\s*\n?\s*\)/, what: 'main.dart must hand the tree the adapter it INITIALISED — the default provider body builds a second instance whose tap stream is silent forever, and nothing about that looks wrong' },
      { file: PROP_TEST, re: /notes\.taps\.add\(/, what: 'the property must push a tap through the STAMPED APP ROOT — the real-classes limb stays green with the gate deleted from app.dart, so only this limb can tell an app that observes taps from one that merely could' },
    ],
    why: 'a reminder that opens nothing when tapped is a dead feature reporting healthy, and it is the half of the notification seam a stamped app could not have',
  },
  {
    key: 'locale-actually-switches',
    group: /group\(\s*'property: locale-actually-switches'/,
    sources: [
      // A SECOND locale file must exist. With one, the seam can never open — the
      // state the chassis was in while claiming internationalisation.
      { file: `${BRICK}/lib/l10n/app_ta.arb`, re: /"@@locale":\s*"ta"/, what: 'a second locale must exist — with one language file the i18n seam can never be exercised' },
      { file: APP_ROOT, re: /locale:\s*ref\.watch\(localeProvider\)/, what: 'MaterialApp must READ the override, or the picker stores a choice the app ignores' },
      { file: PROVIDERS, re: /kv\.write\(\s*_localeKey/, what: 'the choice must be written — an in-memory language resets at every launch' },
    ],
    why: 'the chassis claimed i18n while shipping one locale, so the seam had never once run',
  },
  {
    key: 'analytics-consent-gated',
    group: /group\(\s*'property: analytics-consent-gated'/,
    // 🔴 RE-POINTED 2026-08-10, the third guard to move for the same edit and
    // for the same reason. This read the literal `ConsentPurpose.analytics,`
    // followed by `granted: granted` — i.e. the call's FIRST ARGUMENT. research
    // /44 rung 4 made the purpose a PARAMETER of `applyConsentDecision` so the
    // Art 21 objection reuses one decision path instead of forking it ([C-3]),
    // and that literal left the call site. The anchor now accepts either shape:
    // the argument spelled out (any app that has not parameterised it) or the
    // parameter passed through — and the second alternative is bounded by
    // `granted: granted` exactly as the first was, so `controller.record(` alone
    // never satisfies it. Relaxing to `\.record\(` would have matched the terms
    // and marketing-email calls further down the same file, which are different
    // purposes entirely and say nothing about the analytics rail.
    sources: [
      {
        file: PROVIDERS,
        re: /ConsentPurpose\.analytics\s*,[\s\S]{0,200}?granted:\s*granted|\.record\(\s*\n?\s*purpose\s*,[\s\S]{0,200}?granted:\s*granted/,
        what: 'the template must really call ConsentController.record',
      },
    ],
    why: 'a stamped app must refuse without consent AND deliver with it',
  },
  {
    key: 'analytics-on-switch-mounted',
    // NOT /AnalyticsGate\(/ — that matches the constructor DECLARATION, so the
    // check passed with the gate deleted from app.dart. Same declaration-vs-caller
    // trap that shipped in assert-seams-wired.mjs earlier today; caught here by
    // mutating the real tree rather than a fixture.
    group: /group\(\s*'property: analytics-on-switch-mounted'/,
    sources: [{ file: APP_ROOT, re: /child:\s*AnalyticsGate\(/, what: 'app.dart must mount AnalyticsGate — the analytics on-switch' }],
    why: 'the rail is fail-closed: with nothing calling record() it goes silent and no test goes red',
  },
  {
    // ── [pipeline 11]E-5 · THE LAUNCH TRIO, FROM THE CHASSIS ────────────────
    //
    // 🔴 THE DEFECT THIS CLOSES. `analytics-on-switch-mounted` above asserts
    // `contains('app_open')` — and `app_open` was the ONLY lifecycle event a
    // stamped app could ever emit, because `first_launch` and `return_visit`
    // lived in `apps/subly/lib/state/analytics_funnel.dart`, a file the brick
    // does not carry. So "the lifecycle events fire" ranged over the one event
    // that existed and a stamp that would never emit the other two passed the
    // lane. 1 of 3, reported as green.
    //
    // FIVE anchors in THREE files, because each one alone survives the others'
    // deletion while still looking healthy: the shared implementation can emit
    // all three and nothing call it; the call site can exist over an
    // implementation that emits one. The event-name anchors sit in `core` on
    // purpose — that is the whole point of the requirement, one implementation
    // for fifty stamps rather than fifty copies of an app-local funnel.
    key: 'analytics-lifecycle-complete',
    group: /group\(\s*'property: analytics-lifecycle-complete'/,
    sources: [
      // The CALL SITE, not the declaration — the declaration lives in
      // providers.dart and takes `WidgetRef ref`, so it cannot match this.
      // Same declaration-vs-caller trap the key above records.
      { file: APP_ROOT, re: /logLaunchLifecycle\(ref\)/, what: 'app.dart must CALL the launch path from inside the consent-gated branch — an implementation nobody calls emits nothing, which is the fail-closed shape [pipeline C-6] exists to catch' },
      { file: PROVIDERS, re: /core\.AnalyticsLifecycle\(/, what: 'the chassis must build core.AnalyticsLifecycle — re-implementing the trio per app is the fork this requirement exists to prevent' },
      { file: CORE_LIFECYCLE, re: /log\(\s*'first_launch'\s*\)/, what: "core must emit 'first_launch' — the denominator every activation and retention ratio is divided by" },
      { file: CORE_LIFECYCLE, re: /log\(\s*'app_open'\s*\)/, what: "core must emit 'app_open' on every launch" },
      { file: CORE_LIFECYCLE, re: /log\(\s*'return_visit'\s*,/, what: "core must emit 'return_visit' — with no return event the D1/D7/D30 curve cannot be drawn at all" },
    ],
    why: 'the taxonomy names THREE launch events and a stamped app emitted one, so every retention and activation number a stamp could produce was missing its denominator',
  },
  {
    // ── [pipeline 11]E-6 · THE PURCHASE FUNNEL ARRIVES AS A SET ─────────────
    //
    // 🔴 WHAT WAS ALREADY GREEN, AND WHY IT WAS NOT THE REQUIREMENT. All four
    // calls fire from the brick's own paywall and assert-pseudonymity-firewall
    // resolves them BY SYMBOL, so "the four events exist" has been true for a
    // while. Nothing anywhere asserted the thing a conversion rate is actually
    // made of: that they arrive TOGETHER, in one session, under one anon id.
    // Four individually-correct events scattered across three sessions describe
    // three users who each did a third of a purchase — not a noisy funnel, a
    // different one, and a plausible-looking one.
    //
    // NINE anchors in three files, and the split is the point. The four in the
    // PAYWALL are call sites; the four in the package are the event NAMES; the
    // provider line is what puts them on the consented rail. Any one of them
    // deleted leaves the other eight looking healthy while a stamped app emits
    // less than a funnel: the screen can call a funnel that logs nothing, and
    // the package can emit perfect names nobody calls.
    key: 'money-funnel-emitted-as-a-set',
    group: /group\(\s*'property: money-funnel-emitted-as-a-set'/,
    sources: [
      // CALL SITES. The declarations live in MONEY_FUNNEL, which is a different
      // file, so none of these can be satisfied by the method existing — the
      // declaration-vs-caller trap this guard has been bitten by twice.
      { file: PAYWALL, re: /funnel\.onPaywallViewed\(/, what: 'the paywall must emit the DENOMINATOR — with no paywall_viewed there is nothing to divide by and the conversion rate cannot be computed at all' },
      { file: PAYWALL, re: /funnel\.onCheckoutStarted\(/, what: 'the intent must be emitted where the checkout is opened, or the drop-off between seeing a price and trying to pay is invisible' },
      { file: PAYWALL, re: /funnel\.onPurchaseSuccess\(/, what: 'the SERVER-confirmed unlock must be emitted — this is the numerator, and it is the one event that must never fire on the checkout’s return' },
      { file: PAYWALL, re: /funnel\.onPurchaseFailed\(/, what: 'both refusal paths must be emitted, or a rail that refuses every buyer looks identical to one nobody tried' },
      // …and the NAMES, in the shared package. An app-local funnel is the fork
      // [5]M-16 moved this class out of apps/subly to prevent.
      { file: MONEY_FUNNEL, re: /_log\(\s*'paywall_viewed'/, what: "the shared funnel must emit 'paywall_viewed' — a renamed event is a silently empty column, not an error" },
      { file: MONEY_FUNNEL, re: /_log\(\s*'checkout_started'/, what: "the shared funnel must emit 'checkout_started'" },
      { file: MONEY_FUNNEL, re: /_log\(\s*'purchase_success'/, what: "the shared funnel must emit 'purchase_success'" },
      { file: MONEY_FUNNEL, re: /_log\(\s*'purchase_failed'/, what: "the shared funnel must emit 'purchase_failed'" },
      // The JOIN. Building the funnel over the CONSENTED recorder is what gives
      // the four events one session id and one anon id; a funnel handed its own
      // Analytics would emit four correct events belonging to nobody.
      { file: MONEY_PROVIDERS, re: /MoneyFunnel\(await ref\.watch\(analyticsProvider\.future\)\)/, what: 'the funnel must ride the SAME recorder as every other event — a second one mints a second session and a second anon id, and the paying cohort stops being joinable to anything' },
    ],
    why: 'a funnel is only a funnel as a set: a missing stage does not make the rate imprecise, it makes it the answer to a different question, and nothing downstream can tell',
  },
  {
    // ── [pipeline 10]D-8 · THE WALL OPENS THE URL THE CONFIG RESOLVED ───────
    //
    // 🔴 THE DEFECT SHAPE. A compiled-in destination makes the kill-switch
    // circular: the one thing the wall must do in an emergency is send users
    // somewhere else, and moving it would mean shipping the very build the wall
    // exists to replace — to installs that, by definition, are not updating.
    // Owner decision #19 moved it to runtime; `types.ts` declares `update_url`,
    // `config.ts` serves it, `app.dart` reads it with the define as the offline
    // fallback — and for the whole life of that work NOTHING proved a resolved
    // value ever reached the button, because the wall had never been raised on a
    // stamped app in any test (`packageVersionProvider` answers null in a widget
    // test, so the gate fails open). `mustForceUpdateProvider` sat in UNASSERTED
    // below as "the switch that was inert for 55 builds".
    //
    // Limb (c) — a resolved URL must never equal any channel's compile-time
    // default — is enforced structurally by checkUpdateDestinationIsRepointable
    // above, because it is a statement about the TEST as much as the code.
    key: 'update-url-resolved-from-config',
    group: /group\(\s*'property: update-url-resolved-from-config'/,
    sources: [
      { file: APP_ROOT, re: /ref\.watch\(appConfigProvider\)\.valueOrNull\?\.updateUrl\s*\?\?/, what: 'app.dart must RESOLVE the destination at runtime and fall back to the define — dropping the runtime half restores the circular kill-switch, and dropping the fallback leaves the button with nowhere to go while config is unresolved' },
      { file: APP_ROOT, re: /onUpdate:\s*\(\)\s*=>\s*_openUpdate\(updateUrl\)/, what: 'the BUTTON must be wired to the resolved value — wiring it to AppConfig.updateUrl leaves the resolution above computed and unused, which reads as a working feature in review' },
      { file: PLATFORM_TYPES, re: /^\s*update_url:\s*string \| null;/m, what: 'the wire contract must carry the key, or there is nothing for the client to resolve and the runtime branch is unreachable in production' },
    ],
    why: 'a force-update wall whose destination is frozen at build time cannot be repointed by the builds that need it most, which is the whole reason the kill-switch exists',
  },
  {
    key: 'legal-reacceptance-gated',
    group: /group\(\s*'property: legal-reacceptance-gated'/,
    sources: [
      // 🔴 THE `signedIn`/`loggedIn` CONDITION. Without it the gate fires for
      // signed-OUT visitors, whom the auth rule bounces straight back:
      // /sign-in → /reaccept-terms → /sign-in → … past go_router's redirect
      // limit, errorBuilder draws NotFoundScreen, and the app cannot be signed
      // into on ANY install — every install owes an acceptance, because nobody
      // has a clickwrap record yet. Anchored on the ternary rather than on the
      // gate existing: the gate existed the whole time the app was unusable.
      // `signedIn|loggedIn`: the template calls it `signedIn` and apps/subly
      // calls it `loggedIn`. Spelling only — and EXEMPT_APPS means only the
      // brick is scanned today, so pinning the template's spelling alone would
      // quietly stop asserting the moment Phase 5 drops Subly's exemption.
      { file: ROUTER, re: /(?:signedIn|loggedIn)\s*\n?\s*\?\s*ref\.read\(legalReacceptanceNeededProvider\)\s*\n?\s*:\s*false/, what: 'the re-acceptance gate must be conditioned on there being a SESSION — a person with no session cannot owe an acceptance, and firing on them costs the sign-in form itself' },
      // The containment half. Belt to the braces above, and cheap: with it the
      // worst case if that condition is ever edited away is a visitor parked on
      // an interstitial they can complete, never a 404 with no way back.
      { file: ROUTER, re: /matchedLocation == '\/reaccept-terms'/, what: 'a signed-out visitor must be ALLOWED to sit on /reaccept-terms rather than be bounced off it, or the two rules send each other in a circle' },
      // 🔴 THE REFRESH SIGNAL, AND IT MUST NAME THE DERIVED PROVIDER. Listening
      // to `legalAcceptanceProvider` (the source) fires the bump while Riverpod
      // is still publishing that source's new state, so the redirect re-runs
      // and reads a STALE null from the derived provider — traced, with the
      // router settling on home for a signed-in user who owes an acceptance.
      // Gated in principle, ungated in fact, on every launch.
      { file: PROVIDERS, re: /ref\.listen<bool\?>\(\s*legalReacceptanceNeededProvider,/, what: 'the refresh signal must be taken from the SAME provider the redirect reads — listening one layer down re-runs the gate against a value that has not been recomputed yet, which is a gate that never fires and never fails a test' },
      { file: PROVIDERS, re: /class LegalAcceptanceController extends Notifier<String\?>/, what: 'the chassis must own the acceptance record; a gate with nothing persisted behind it asks at every launch forever' },
    ],
    why: 'research/43: a material change to the terms has to be re-accepted, and the gate that does it shipped both backwards (blocking the way IN) and inert (never re-running after hydration) without a single test going red',
  },
  {
    // ── A SIGN-UP THAT RETURNS NO SESSION HAS SOMEWHERE TO GO ───────────────
    //
    // 🔴 THE DEFECT LIVED IN THE GAP BETWEEN TWO CORRECT PIECES, WHICH IS WHY
    // NOTHING WAS RED. With Supabase's "Confirm email" ON, `signUp` returns a
    // user and NO SESSION, so `currentUser` stays null and every gate in the
    // router reads the registrant as SIGNED OUT — including the verification
    // gate, whose test is `sessionIsUnverified`, and that answers FALSE for a
    // null user BY DESIGN. The screen worked, the gate worked, and the person
    // who had just registered was left with no word about the mail in their
    // inbox. Measured on the live project: 2 of 4 accounts unconfirmed with
    // `last_sign_in_at` NULL. The sign-up screen even carried a comment
    // asserting the OPPOSITE ("that guard lands them on /verify-email"), which
    // is why nobody looked.
    //
    // Three anchors, because three separate edits each restore the stranding on
    // their own and the property test cannot tell you WHICH one went.
    key: 'sessionless-signup-reaches-check-inbox',
    group: /group\(\s*'property: sessionless-signup-reaches-check-inbox'/,
    sources: [
      { file: SIGN_UP, re: /if \(auth\.currentUser == null\) \{\s*context\.go\('\/check-inbox', extra:/, what: 'the sign-up screen must navigate for the NO-SESSION case specifically — unconditional navigation races the redirect guard for the session case, and no navigation at all is the stranding this closes' },
      { file: ROUTER, re: /path: '\/check-inbox'/, what: 'the destination must be MOUNTED; a screen file with no route is a pane no user can open, and the sign-up screen would navigate into the errorBuilder' },
      { file: ROUTER, re: /matchedLocation == '\/check-inbox'/, what: 'the destination must be on the SIGNED-OUT allowlist — its whole audience has no session, so without this entry the auth rule bounces them to /sign-in the instant the sign-up screen sends them here' },
    ],
    why: 'a registration that produces no session is the DEFAULT shape once "Confirm email" is on, and the app said nothing at all about it — the screen, the gate and the router were each correct and none of them owned the gap between them',
  },
];

// ── THE TRACKED DOMAIN — what "every" ranges over. ──────────────────────────
// Read out of the template, not typed here, so the set grows when the chassis
// grows. Every top-level `*Provider` in this file is a capability a stamped app
// inherits; each must appear in COVERED_BY or UNASSERTED below, or the build
// fails with the provider's name in the message.
// 🔴 BOTH PROVIDER FILES. [pipeline 5]M-13 landed `money_providers.dart`, and a
// single-file domain would have let a whole capability — the money rail —
// arrive with no obligation to be asserted about at all. That is the failure
// this guard's own header describes, arriving through a new file rather than
// through a new provider.
const DOMAIN_FILES = [PROVIDERS, MONEY_PROVIDERS];
// Parens are in the class because a provider's TYPE can contain them —
// `Provider<Future<String?> Function()>` is the token getter C-15 wires into the
// REST client. Without them this scan silently skipped every function-typed
// provider, and the only reason that surfaced is that the stale-entry check
// below fired on a key the domain scan could no longer see. The two halves
// caught each other; either alone would have stayed quiet.
const DOMAIN_RE = /^final\s+[\w<>,?\s.()]*?\b(\w+Provider)\s*=/gm;
// Coverage self-check on the domain parse itself: this file has held 19 since
// the analytics rail landed, and a regex that silently matches nothing is the
// exact failure mode this repo keeps hitting. A shrinking domain is a real
// event — deleting a capability — so it must be an explicit edit, not a drift.
//
// This moves ONLY when a capability is deliberately added or removed — it is
// the floor that makes a silently-shrinking domain an explicit edit rather than
// a drift, so raising it is part of adding the capability, never a fix for a red.
//
// 41 since 2026-08-03: [pipeline 13]T-8 added `catchUpNudgeProvider`.
// 45 since 2026-08-03: the content-pack rail added four more providers
// (packVerifier, contentPackSource, contentPackLoader, contentPack). Landing
// them without moving this number would have left FOUR capabilities' worth of
// slack under the floor — the scan could have stopped seeing a quarter of the
// rail it was just given and still reported clean, which is the precise
// failure this self-check exists to make impossible.
// 46 since 2026-08-06: [pipeline 2]C-13 wired `OfflineNotice` and its
// `networkUnreachableProvider` joined the domain. RAISED WITH THE TREE ON
// PURPOSE — left at 45, deleting a behaviour would leave exactly 45 and the
// floor would stop catching the deletion it exists to catch. A ratchet that
// does not follow the thing it measures is a ratchet that has stopped.
// 48 since 2026-08-10: the cut-1 reversal's legal-gate riders added
// `legalAcceptanceProvider` and `legalReacceptanceNeededProvider`. Raised with
// the tree for the reason stated above and not restated as a rule of thumb —
// left at 46, deleting BOTH of them would leave exactly 46 and the floor would
// stop catching the deletion it exists to catch.
// 50 since 2026-08-10: research/44 §7 rung 3 added `promoGateProvider` and
// `promoCardStateProvider`. RAISED WITH THE TREE, for the reason the lines above
// give — a floor left behind the tree stops catching the deletion it exists to
// catch. 🔴 THE TWO RAISES LANDED ON THE SAME DAY ON DIFFERENT BRANCHES AND BOTH
// READ "48": each was 46+2, computed against a tree that did not yet contain the
// other's pair. A floor is a measurement of the merged tree, so the merge is
// 46+2+2 and taking either side's number verbatim would have silently lowered it
// by two — a ratchet quietly slackened is the failure this comment block exists
// to prevent.
// 53 since 2026-08-10: research/44 rung 4 added `privacySignalProvider`,
// `promoObjectedProvider` and `promoObjectionKnownProvider` to the stamped
// chassis. Raised with the tree, same reason as every line above it.
// 56 since 2026-08-11: password-reset completion added `launchUriProvider`
// (overridable, so the FAILURE path is drivable at all), `passwordRecoveryProvider`
// and `passwordResetArrivalProvider`. It was left at 53 when those three landed,
// and the cost was not theoretical: the floor sat THREE behind the tree, so the
// fixture case that deletes one behaviour still measured 55 — above the floor —
// and `COVERAGE LOST` stopped firing entirely. The negative test went green by
// losing the thing it tests. A floor that lags the tree is a floor with slack,
// and slack is indistinguishable from absence until something is deleted.
// 2026-08-11: 56 → 57 with `authProvidersProvider`. Raised IN THE SAME COMMIT
// as the provider, which is the only way this floor stays a floor — the note
// above records what it costs to defer it.
// 2026-09-04: 57 → 59 with `lastAccountDeletionOutcomeProvider` and
// `lastAccountDeletionDetailProvider` ([ADR 027] / [ADR 065] chassis step 2 —
// the deletion outcome, parked above the screen the sign-out tears down). Both
// are in COVERED_BY under `account-deletion-works`, so the domain and the
// classification move together, and both moved in the SAME COMMIT as the
// providers — the rule the 2026-08-11 note above exists to enforce.
const MIN_DOMAIN = 59;

// Each key names the property that actually exercises it — the property test
// must drive this provider, not merely construct it.
const COVERED_BY = {
  // [pipeline C-15] The auth seam. All four are DRIVEN by the property, not just
  // constructed: it signs in, reads the token back, and asserts the REST client
  // was built with that exact getter.
  authRepositoryProvider: 'auth-seam-wired',
  authTokenProvider: 'auth-seam-wired',
  restClientProvider: 'auth-seam-wired',
  authCapabilitiesProvider: 'auth-seam-wired',
  // The OTHER axis of the same question, and the one whose absence shipped a
  // dead "Continue with Apple" to every user: what the PLATFORM can do vs what
  // the SERVER will honour. Driven by the same property, which reads the
  // declaration and asserts the stamp offers exactly the providers it declares.
  authProvidersProvider: 'auth-seam-wired',
  // Driven, not constructed: the property delivers a real recovery event through
  // the real repository and asserts the app moves to the reset screen with
  // nothing having navigated — then types a password and asserts the seam got
  // that exact value.
  passwordRecoveryProvider: 'password-recovery-routes',
  // The FAILURE half of the same property, driven the same way: the chassis test
  // delivers a real unusable arrival through the real repository and asserts the
  // app lands on the explanation with nothing having navigated.
  passwordResetArrivalProvider: 'password-recovery-routes',
  // Overridable so that arrival can be constructed at all: `Uri.base` is a
  // property of the process, so without this the failure path could only ever be
  // reached by hand — which is exactly how it came to be untested.
  launchUriProvider: 'password-recovery-routes',
  // Driven, not merely constructed: the property signs in through the real form
  // and asserts the user ends up somewhere else.
  authRefreshProvider: 'auth-redirect-follows-session',
  // Driven: the property watches this stream and asserts the new name arrives
  // on it, which is the only thing that makes an edit visible.
  authUserProvider: 'profile-edit-works',
  // Driven, not constructed: the property fakes the prompter and asserts a real
  // request arrives once the gate agrees.
  reviewPrompterProvider: 'review-prompt-gated',
  reviewGateProvider: 'review-prompt-gated',
  reviewPromptProvider: 'review-prompt-gated',
  onboardingSeenProvider: 'onboarding-shown-once',
  // Driven by the onboarding property: it is what lets the router look again
  // once the first-run flag resolves from disk.
  routerRefreshProvider: 'onboarding-shown-once',
  // [pipeline 7]P-9 · [8]K-9. DRIVEN, not merely constructed: the property
  // overrides the pointer and the pack BYTES and leaves the real loader in
  // place, so the key pinning, the identity binding and the content-hash check
  // all run — then flips the pointer and asserts the pack stops arriving.
  contentPackSourceProvider: 'content-pack-consumed',
  contentPackLoaderProvider: 'content-pack-consumed',
  contentPackProvider: 'content-pack-consumed',
  // The verifier is SUBSTITUTED by that property rather than exercised: the
  // Ed25519 mathematics is proven for real in core's own suite against a
  // throwaway keypair, and re-proving it here would need the PRIVATE seed,
  // which is not in the repository and never reaches CI. Named here so the
  // substitution is a recorded choice rather than a gap nobody noticed.
  //
  // 📌 CORRECTED 2026-08-21. Recorded rather than swapped: a note about stale
  // prose that quietly rewrites itself is this file's own subject, one level up.
  //
  // ⚠️ AND THE LOCATOR IN THIS NOTE WAS ITSELF WRONG TWICE BEFORE IT WAS RIGHT,
  // which is worth one line because it is the same defect a third time: the
  // first version said the stale clause was what the paragraph "used to end"
  // with, the second said it was the "THIRD sentence". The paragraph above has
  // exactly TWO sentences. Count them before citing one.
  //
  // (1) The FIRST sentence above used to end "...would need the signing key the
  // owner has not generated (OWNER_QUEUE S-3)". Its second and closing sentence,
  // "Named here so the substitution is a recorded choice...", was already there
  // and is unchanged. That clause was STALE, and it was stale against a number THIS FILE
  // ALREADY PRINTS: limb (d) of content-pack-consumed counts the pinned keys
  // ~1000 lines below, and the note above pinnedPackKeys() records the same
  // check. Re-measured today, not cited:
  // `kContentPackPublicKeys` in packages/core/lib/src/content/
  // pack_verifier.dart carries ONE key, `'k1'` (a real 44-char base64 value,
  // not a placeholder), and assert-seams-wired.mjs prints `1 production key(s)
  // pinned` on the same tree. So the public half was never what blocked a
  // substitution here — the private seed is, and that is owner custody by design.
  //
  // (2) The clause that REPLACED it said the seed was "deliberately outside the
  // agent's reach". MEASURED FALSE on this working tree: `.claude/
  // pack-signing.seed` is on disk (45 bytes, mtime 2026-07-27), at exactly the
  // path packages/core/lib/src/content/pack_verifier.dart:28 documents, and
  // nikatru/OWNER_QUEUE.md's S-3 row records a pack ALREADY signed with that
  // seed and verified through the production `Ed25519PackVerifier` — i.e. the
  // proof the sentence called impossible has been done. What IS true and
  // checkable is narrower, and is what now stands above: `.gitignore:13` is a
  // bare `.claude/`, `git ls-files .claude/pack-signing.seed` finds nothing, so
  // the seed is absent from the repository and from every CI checkout.
  // Re-measured this run, both commands. Emphasis is not evidence — (2) was the
  // same species of unverifiable assertion as (1), one revision later.
  //
  // LATENT, not live, for both: this text sits in a `//` comment inside
  // COVERED_BY, no regex in this file or any other matches on it, and no exit
  // path moved when either was rewritten. What they cost was READER trust —
  // emphatic sentences asserting EXTERNAL state, believed because they were
  // emphatic; (1) disagreed with the guard's own printed measurement in the
  // same run, and (2) disagreed with a file sitting in this directory.
  //
  // What remains OPEN on S-3 is owner custody work, not key generation:
  // tooling/channel-register.json `content-pack-k1.restoreDrill.date` is still
  // `null` with `required: true` (read 2026-08-21). Pointed at that FIELD
  // rather than restated in prose, so the next reader checks a value instead of
  // trusting a sentence — but do NOT expect a guard to go red when it goes stale.
  //
  // 📌 LOCATOR CORRECTED 2026-08-21, and this is the third instance of the same
  // defect in one comment: the line above used to read "the next reader
  // falsifies this mechanically — assert-channel-register.mjs §2/§3 read it".
  // They do NOT, and both loops were re-read this run rather than grepped.
  // §2/§3 is headed at assert-channel-register.mjs:233, loops
  // `for (const c of channels)` at :327 (closing at :618), and its two
  // restoreDrill limbs — :373-376 and :575-581 — read
  // `channels[].signing.restoreDrill` only. `content-pack-k1` is NOT a channel:
  // it lives in `nonChannelSigningIdentities`, which is reached at exactly two
  // sites, :1322 (header at :1311, "non-channel signing identities: shape only,
  // printed") and :1550 (the `collectSigning` sweep in §8b, secrets — §8's own
  // header is at :1346, 8b's at :1493). And :1322's drill limb is a PRINT, not a
  // verdict — :1340-1342 pushes "UNDRILLED IDENTITY: content-pack-k1" onto
  // `prints`, and the guard exits 0 carrying it (measured this run: EXIT 0,
  // that line present). Nothing in the tree FAILS on this field in either
  // direction; when the drill lands the print just stops appearing. So the date
  // above is a READER's checkpoint that a machine can re-read, not one a
  // machine will defend. Saying so is the honest version of the sentence it
  // replaces, which claimed a mechanical falsifier that does not exist.
  // NOT CLAIMED HERE: WHICH custody step is outstanding. The sources disagree
  // and this guard cannot settle it — nikatru/OWNER_QUEUE.md:470 calls PRINTING
  // the seed the only remaining step, while the private release plan and this
  // register's own `restoreDrill.note` both assert it is already printed and
  // name the drill as what is left. Left unresolved on purpose; `restoreDrill
  // .date` is the half that is a FIELD rather than a sentence — re-readable
  // even though no guard fails on it — so it is the half named.
  packVerifierProvider: 'content-pack-consumed',
  remindersEnabledProvider: 'reminder-intent-persisted',
  notificationServiceProvider: 'reminder-intent-persisted',
  // Driven, not constructed: the property taps the banner's dismiss action and
  // asserts the stamp really persisted it, then that tomorrow's reminder brings
  // it back. [pipeline T-8]
  catchUpNudgeProvider: 'no-silent-channel',
  localeProvider: 'locale-actually-switches',
  keyValueStoreProvider: 'theme-mode-persisted',
  themeModeProvider: 'theme-mode-persisted',
  installIdProvider: 'analytics-consent-gated',
  analyticsEnabledProvider: 'analytics-consent-gated',
  consentControllerProvider: 'analytics-consent-gated',
  consentDecidedProvider: 'analytics-consent-gated',
  consentTransportProvider: 'analytics-consent-gated',
  eventTransportProvider: 'analytics-consent-gated',
  analyticsProvider: 'analytics-consent-gated',
  // ── [pipeline 5] THE MONEY RAIL. Every one of these is DRIVEN by the
  //    property, not merely constructed: it fakes the SERVER, lets the real
  //    cache and the real lock decision run, and asserts the gate follows.
  //
  //    `entitlementCacheProvider` and `secureStoreProvider` were both UNASSERTED
  //    until 2026-08-01 — the first "BLOCKED, the paid path is stage 5", the
  //    second "needs a platform channel a widget test has not got". Stage 5
  //    landed and the second turned out to need an in-memory SecureStore, which
  //    is four methods. An admitted gap is not a permanent one.
  entitlementCacheProvider: 'paywall-gate-driven-by-server',
  secureStoreProvider: 'paywall-gate-driven-by-server',
  railConfigProvider: 'paywall-gate-driven-by-server',
  entitlementTransportProvider: 'paywall-gate-driven-by-server',
  entitlementsProvider: 'paywall-gate-driven-by-server',
  paywallLockedProvider: 'paywall-gate-driven-by-server',
  purchaseRailProvider: 'paywall-gate-driven-by-server',
  // ── [pipeline 11]E-6 · reclassified 2026-08-07, and the moves are the point.
  //
  // `moneyFunnelProvider` was an admitted gap ("no stamped-app property watches
  // an event reach a transport from the paywall") and `entitlementConvergence
  // Provider` was another ("a checkout cannot be opened in a widget test"). The
  // second was the load-bearing one and it was simply not true: the rail is an
  // INTERFACE with exactly one implementation precisely so a test can construct
  // a purchase path, and a fake rail that opens one lets the REAL convergence
  // poll the fake server until the entitlement appears. Both are now DRIVEN —
  // the property taps the real upgrade button and reads what reached the wire.
  // An admitted gap is not a permanent one.
  moneyFunnelProvider: 'money-funnel-emitted-as-a-set',
  entitlementConvergenceProvider: 'money-funnel-emitted-as-a-set',
  // [pipeline 10]D-8. DRIVEN, not constructed: the property serves a version
  // floor above the running version, asserts the wall really appears on a
  // stamped app, and taps its button. This was "the switch that was inert for 55
  // builds" and nothing had ever raised it.
  mustForceUpdateProvider: 'update-url-resolved-from-config',
  // [research/44 §7 rung 3]. DRIVEN, not merely constructed: the property
  // serves the feature flag for real, taps the card's own decline control, and
  // reads back the latched record from the stamp's own storage — then relaunches
  // over the same store and asserts the card stays gone.
  promoGateProvider: 'promo-card-fails-closed',
  promoCardStateProvider: 'promo-card-fails-closed',
  // ── research/43's legal gate. RECLASSIFIED 2026-08-10 from UNASSERTED, and
  //    the move is the finding rather than tidying.
  //
  // The entry that stood here for a day said the stamped-app shape "could NOT
  // be made green" because the bump fires and the router does not move, and
  // carried it to integration as an open risk. That trace was a real defect
  // being written down as a gap: `routerRefreshProvider` listened to
  // `legalAcceptanceProvider` while the redirect read the DERIVED
  // `legalReacceptanceNeededProvider`, so the bump arrived one recomputation
  // early and the redirect re-ran against a stale null. Signed-in users with no
  // acceptance on record settled on home — gated in principle, ungated in fact.
  //
  // Both providers are now DRIVEN by the property, not constructed: it pumps
  // the app over an empty store with NOTHING overridden and NAVIGATES NOWHERE,
  // so the interstitial can only appear if the refresh path really re-runs the
  // gate. An admitted gap is not a permanent one — and a gap that is really a
  // bug stops being either once it is fixed.
  legalAcceptanceProvider: 'legal-reacceptance-gated',
  legalReacceptanceNeededProvider: 'legal-reacceptance-gated',
  // [research/44 rung 4] The Art 21 objection, read on the RENDER path. DRIVEN,
  // not constructed, and the distinction is checkable: since the D2 signature
  // the stamped home screen renders the creative through
  // `PromoSurface(objected: ref.watch(promoObjectedProvider), …)`, and
  // `PromoSurface` returns `SizedBox.shrink()` when `objected` is true. So a
  // provider that answered wrongly in either direction turns
  // `promo-card-fails-closed` red — "the flag SERVED TRUE opens the path" needs
  // it false, and "a GDPR Art 21 objection outranks a live campaign" needs it to
  // be able to say true.
  promoObjectedProvider: 'promo-card-fails-closed',
  // ── [ADR 027] / [ADR 065] chassis step 2. The deletion outcome, and it is
  //    DRIVEN THROUGH THE REAL ROUTER rather than constructed — which is the
  //    whole reason it counts as coverage here.
  //
  // The pair exists because the screen that asks for the deletion cannot report
  // it: `deleteAccount()` signs the user out either way, the router replaces the
  // page stack, and the dialog and any SnackBar go with it. So a widget test
  // that pumps the notice directly would prove the notice renders and would say
  // nothing at all about the only thing in doubt — whether the surface the
  // redirect LANDS on is the one reading these. `account-deletion-works` parks
  // an outcome, pumps the whole app, lets the redirect settle, and asserts the
  // sentence is on the sign-in screen; its second new limb asserts an ORDINARY
  // arrival paints nothing, without which the first is satisfied by a notice
  // that is always on.
  //
  // ⚠️ NOT AN `UNASSERTED` ENTRY, and the distinction is this file's own rule:
  // an admitted gap must name what a stamped app cannot DEMONSTRATE, never what
  // it appears unable to DO. Before the sign-in surface read them, these two
  // were written and never read — a half-wired feature, not an unprovable one,
  // and writing it down as a gap would have been the mistake this map's own
  // note about `legalAcceptanceProvider` records.
  lastAccountDeletionOutcomeProvider: 'account-deletion-works',
  lastAccountDeletionDetailProvider: 'account-deletion-works',
};

// Dated, reasoned gaps. NOT an excuse list — it is the honest inventory of what
// a stamped app does NOT currently prove about itself, printed on every run so
// it stays uncomfortable. Per the C-16 lock, new properties arrive WITH their
// features; nothing here is to be invented to empty the list.
const UNASSERTED = {
  // The money rail's remaining gaps. Each is exercised in packages/purchases'
  // own suite; what is missing is a STAMPED-APP assertion, which is a different
  // and stronger claim.
  cancellationTransportProvider: '2026-08-01 · the ROSCA cancel call. Driven end-to-end in packages/purchases/test/hosted_checkout_rail_test.dart and against a real SQL engine in services/platform/test/cancellation.test.ts; a stamped-app property would need the manage screen pumped with a fake host, which is a widget test worth writing and is not written',
  // [pipeline 2]C-13 wired `OfflineNotice` in 2026-08-06 — it had ZERO consumers
  // before that, a dead feature reporting healthy. Its reachability anchor proves
  // the widget is MOUNTED and driven by a failed config fetch; it does NOT prove
  // the banner appears, because no chassis property drives this provider. Recorded
  // as an honest gap rather than counted as coverage — `reachable` and `proven`
  // are different claims and this file is where the difference is kept.
  networkUnreachableProvider: '2026-08-06 · the offline banner’s input. A stamped app mounts OfflineNotice and a failed config fetch flips it, but nothing asserts the banner RENDERS on a stamp — the widget test would need a transport that fails on demand.',
  configTransportProvider: '2026-07-28 · CFG-1 config resolution has no stamped-app property; a stamp cannot prove network → last-good → default actually degrades in that order',
  configLoaderProvider: '2026-07-28 · as above — the fallback chain is unit-tested in core, never asserted on a stamped app',
  appConfigProvider: '2026-07-28 · as above',
  packageVersionProvider: '2026-08-07 · SUBSTITUTED rather than driven by `update-url-resolved-from-config`: the real provider reads a platform channel a widget test has not got and answers null BY DESIGN, which is what made the wall fail open and kept it unproven. The property overrides it to raise the wall; the plugin read itself is still asserted nowhere',
  featureFlagsProvider: '2026-07-28 · rollout bucketing is unasserted in the stamp; core tests the maths, nothing tests that a stamped app buckets',
  analyticsConsentProvider: '2026-07-28 · the UI-facing read; consentDecidedProvider is the limb the property test drives, and it is the one that decides whether to prompt',
  privacySignalProvider: '2026-08-10 · the Global Privacy Control seam (K-15), added as an OVERRIDABLE provider by research/44 rung 4 precisely so the honoured-GPC branch is reachable at all — on the VM the real signal is always false, so the branch could otherwise be driven by nothing. It IS driven, in promo_objection_surface_test.dart in both roots ("a device signal alone means ZERO renders, and writes nothing"), which is a stamped-app file. What is missing is a CHASSIS PROPERTY: the property suite never overrides it, so the stamp does not prove it about ITSELF. Recorded rather than counted, because "asserted somewhere in the root" and "asserted by the lane that runs on every stamp" are different claims and this file keeps the difference.',
  promoObjectionKnownProvider: '2026-08-10 · the third state — has the rail been READ yet — that keeps the Settings row blank and untappable while consent is loading, so a tap in that window cannot upload a `granted: true` artifact recording a decision nobody made. Asserted in promo_objection_surface_test.dart ("🔴 THE ROW CLAIMS NOTHING WHILE THE RAIL IS STILL LOADING"); no chassis property reaches it, because the property suite never pumps the Settings screen. The gap is the SUITE\'s shape, not the provider\'s: closing it means a stamped-app property that opens Settings, which is worth writing and is not written.',
  // ⚠️ A NOTE FOR WHOEVER ADDS THE NEXT ENTRY HERE, kept because it is the most
  // expensive lesson this map has produced. `legalAcceptanceProvider` and
  // `legalReacceptanceNeededProvider` were written into this list on 2026-08-10
  // with a careful, honest, entirely accurate trace: the bump fires, the router
  // does not move, a hand-called `router.refresh()` does move it, the onboarding
  // bump in the same harness works. Every observation was true and the
  // conclusion — "a stamped-app property here would assert the harness rather
  // than the app" — was wrong. The trace WAS the bug: the refresh signal was
  // taken from the source provider instead of the derived one the redirect
  // reads, so the gate never fired on a real launch. The pair now sits in
  // COVERED_BY above.
  //
  // The rule that follows: an entry here must name what a stamped app cannot
  // DEMONSTRATE, never what it appears unable to DO. "The property will not go
  // green" is a symptom, and this file is the last place a symptom should be
  // allowed to settle as an explanation.
};

// ── strip Dart comments (STRINGS KEPT) before scanning the test file ─────────
// 🔴 2026-08-01 full-corpus review: the test source was scanned RAW, so the
// header's promise — "deleted, emptied, or stops covering a property → the build
// fails" — was false on "emptied". Commenting the ENTIRE file out (the realistic
// form: somebody /* */-ing one flaky property group during triage, or the whole
// file while chasing a red lane) left every `group(...)` regex matching inside
// the comment and `// testWidgets(` still counting toward the block floor:
// mutation-proven, "14 property/properties enforced" over a file that asserts
// nothing. Same prose-vs-structure class as the sibling guards' comment traps.
//
// A comment-ONLY stripper, hand-rolled and string-aware, because the group
// markers this guard matches ARE string literals (`group('property: …')`) — the
// blank-strings scanner the wiring guard exports would erase the very evidence
// being looked for. String contents pass through verbatim; comment spans are
// blanked with their newlines kept.
//
// `blankStrings` is OFF by default because the group markers this guard matches
// ARE string literals. The boot-path scan below turns it ON: there a call must
// be a real call and never a mention inside a doc string or a log message.
function stripDartComments(src, { blankStrings = false } = {}) {
  let out = '';
  let i = 0;
  const n = src.length;
  const blank = (ch) => (ch === '\n' ? '\n' : ' ');
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    // line comment
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    // block comment — Dart allows nesting
    if (c === '/' && c2 === '*') {
      let depth = 0;
      while (i < n) {
        if (src[i] === '/' && src[i + 1] === '*') { depth++; out += '  '; i += 2; continue; }
        if (src[i] === '*' && src[i + 1] === '/') {
          depth--; out += '  '; i += 2;
          if (depth === 0) break;
          continue;
        }
        out += blank(src[i]); i++;
      }
      continue;
    }
    // string literal (raw / triple / either quote) — copied through UNCHANGED,
    // so a `//` inside a URL string is not mistaken for a comment.
    if (c === "'" || c === '"' || (c === 'r' && (c2 === "'" || c2 === '"'))) {
      const isRaw = c === 'r';
      const q = isRaw ? c2 : c;
      let j = isRaw ? i + 1 : i;
      const triple = src[j] === q && src[j + 1] === q && src[j + 2] === q;
      const closeLen = triple ? 3 : 1;
      out += src.slice(i, j + closeLen);
      j += closeLen;
      while (j < n) {
        if (!isRaw && src[j] === '\\') { out += blankStrings ? '  ' : src.slice(j, j + 2); j += 2; continue; }
        if (src[j] === q && (!triple || (src[j + 1] === q && src[j + 2] === q))) {
          out += src.slice(j, j + closeLen);
          j += closeLen;
          break;
        }
        // an unterminated single-quoted string cannot cross a line
        if (!triple && src[j] === '\n') { out += '\n'; j++; break; }
        out += blankStrings ? blank(src[j]) : src[j]; j++;
      }
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// ── comment-strip ONE SOURCE ANCHOR FILE, by what kind of file it is ─────────
// The anchor loop reads `.dart`, `.ts`, `.mjs`, `.arb`, `.json` and `.html`, and
// `stripDartComments` above only knows `//` and `/* */`. That is exactly right
// for Dart and for the TypeScript/JS anchors — same two comment forms — and it
// is a no-op on JSON and `.arb`, which have no comment form at all (MEASURED
// 2026-08-21: `lib/l10n/app_ta.arb` comes back byte-identical). HTML is the one
// type with a comment form it cannot see, and that is not hypothetical here:
//
// 🔴 MEASURED 2026-08-21 — `apps/subly/web/index.html:11` reproduces the exact
// `<meta name="viewport" … content="…width=device-width…"` shape INSIDE an
// `<!-- -->` block, while explaining the tag. So `ui-invariants-inherited`'s
// viewport anchor — the one whose own comment says "Matched on the TAG, never on
// prose" — is satisfiable by prose in a real file in this tree. It is latent
// rather than live twice over: `apps/subly` is in `EXEMPT_APPS`, and the real
// tag is on :20 anyway, so deleting the tag is what this would have hidden. The
// brick's own shell is clean — its :27 prose says "with no viewport meta", which
// the tag-shaped anchor does not match — which is why nothing was red.
//
// Stripping HTML comments FIRST, then running the C-style pass, is deliberate:
// the C-style pass still has work to do inside `<style>` and `<script>`, where a
// `/* … */` or `//` comment is a comment. MEASURED on both shells: no anchor
// result changes, and the only lines the pass touches are comments.
function stripAnchorComments(path, src) {
  const html = /\.html?$/i.test(path);
  // Blanked, not deleted — offsets and line numbers stay usable for any future
  // caller that wants to report WHERE a match landed.
  return stripDartComments(html ? src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' ')) : src);
}

// ── [pipeline 13]T-4 · THE BOOT PATH NEVER SPENDS THE OS PERMISSION ASK ──────
//
// THE SENTENCE: *"Notification permission is never requested on the launch
// path."* The observation that makes it FALSE: booting the app issues an OS
// permission request without the user having asked for anything.
//
// ⚠️ WHAT THIS LIMB CAN AND CANNOT SEE — say it, do not imply a gate that isn't
// here. The RUNTIME observation is the brick's own property test: mount, settle
// the first frame, assert `notes.requestPermissionCalls == 0`
// (`test/chassis_properties_test.dart`). That is the real measurement — and it
// covers the TEMPLATE only. `apps/subly` is `EXEMPT_APPS` below (39-CHASSIS §4
// cut 1: it predates the brick, was never stamped, and carries no inherited
// property test), so the ONE BINARY THAT ACTUALLY SHIPS had no limb at all —
// and it was the one violating the rule: `main.dart` → `NotificationService
// .instance.init()` → `_requestPermissions()`, the OS dialog at first frame.
//
// So this limb is a STATIC over-approximation of the runtime property: a call
// GRAPH walk, not a call COUNT. It proves "no path from `main()` reaches a
// permission ask", which is strictly weaker than "no ask happened" — a reflective
// or plugin-mediated ask is invisible to it. It is not a substitute for the
// property test; it is the only thing that reaches an app the property test
// cannot, and it catches the exact defect that shipped.
//
// THREE LIMBS, because `main()` is not the whole launch path — and because
// "never at launch" is only half of the requirement:
//   A. REACHABILITY FROM `main()`. Transitive over FUNCTION/METHOD calls
//      resolved inside the app's own `lib/`. Constructors (capitalised) are the
//      BARRIER: `runApp(const ProviderScope(child: XApp()))` is where the widget
//      tree begins, and descending through it would make every gesture handler
//      in the app "reachable from main" and the check useless.
//   B. UNGESTURED LIFECYCLE HOOKS. `initState` / `didChangeDependencies` run at
//      first frame with no user action, so an ask there is a launch-time ask
//      that limb A cannot see (the framework calls them, no call site does).
//      `build` is deliberately NOT in the list — it legitimately contains the
//      gesture closures the ask is supposed to live behind.
//   C. 🔴 THE ENABLE PATH ASKS AT ALL. Added 2026-08-07. Limbs A and B and the
//      brick's runtime `requestPermissionCalls == 0` are ALL absence assertions
//      pointing the same way, so DELETING every call site made this property
//      report greener than the real tree: 2 → 0 asks in apps/subly, every limb
//      still ok, CI still green — and the app is then a notification channel
//      that can never be turned on, because nothing ever asks. That is the
//      *other* half of the same defect and it had no limb at all.
//
// ⚠️ A AND C PULL IN OPPOSITE DIRECTIONS, so the naive positive check — "the
// symbol `requestPermissions` appears somewhere under lib/" — asserts NOTHING
// NEW: the very call site limb A/B would fail on satisfies it, and so does the
// ask's OWN DECLARATION plus its delegation to the plugin. Limb C is therefore
// defined over the COMPLEMENT of the domain limbs A and B police:
//
//   D⁻ = bodies of every function limb A actually reached from `main()`
//        ∪ bodies of `initState` / `didChangeDependencies`
//   D⁺ = every other byte of `lib/`, MINUS the ask's own declarations (head
//        included), because `requestPermissions() { … ios.requestPermissions(…) }`
//        is the implementation, not a caller of it. That is precisely the trap
//        `assert-seams-wired.mjs` fell into — matching a declaration and calling
//        it a usage — and it is why limb C strips the declaration first.
//
// D⁻ ∩ D⁺ = ∅ BY CONSTRUCTION, so no single call site can satisfy both limbs:
// move the only ask into an `initState` and A/B go red while C ALSO goes red for
// want of an ask outside the launch path. Limb C is an over-approximation in the
// same direction as limb A — it proves an ask exists somewhere no launch path
// reaches, not that a user gesture reaches it. The gesture requirement itself is
// carried by review and by the runtime property test; this limb closes the hole
// where there is nothing left to review.
//
// EXEMPTIONS ARE NOT APPLIED HERE, on purpose. `EXEMPT_APPS` excuses an app from
// carrying the inherited property TEST. It cannot excuse it from the boot path:
// every app that ships has one, and the exempt app is precisely where the defect
// was. A rule whose only violator is exempt from it is not a rule.
const BOOT_ROOT_LIB = 'lib';
// The OS-ask API surface, as the plugins actually name it. Kept in sync by the
// self-check below, which reddens if this pattern stops recognising the real
// implementation in packages/notifications — a scanner that silently matches
// nothing is the failure this repo keeps re-learning.
// ONE list, two consumers: the ask matcher below and limb C's "this is the
// declaration, not a caller" exclusion. Kept as one array on purpose — a second
// hand-maintained copy of these names is a drift bug waiting to happen, and the
// drift would silently *widen* limb C (a renamed ask would start counting its
// own declaration as a caller and the limb would assert nothing).
// Each entry is a regex fragment: `requestPermissions?` covers both spellings.
const ASK_NAMES = [
  'requestPermissions?',
  'requestNotificationsPermission',
  'requestExactAlarmsPermission',
  'requestFullScreenIntentPermission',
];
const PERMISSION_ASK_RE = new RegExp(`\\b(?:${ASK_NAMES.join('|')})\\s*\\(`);
const PERMISSION_ASK_PROBE = 'packages/notifications/lib/src/local_notification_service_io.dart';
const UNGESTURED_HOOKS = ['initState', 'didChangeDependencies'];
// Not a Dart parser: these are the words that appear as `word(` without being a
// call to anything the walk should follow.
const NOT_A_CALL = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'assert', 'await', 'super',
  'this', 'new', 'throw', 'yield', 'else', 'do', 'rethrow', 'case', 'when',
  'is', 'as', 'in', 'var', 'final', 'const', 'void', 'sync', 'async', 'on',
]);

/** Index just past the balanced closer for the opener at `open`. -1 if unbalanced. */
function matchDelim(src, open, o, c) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++;
    else if (src[i] === c) { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

/**
 * Bodies of every declaration named `name` in `src` (already comment- AND
 * string-stripped). A DECLARATION is `name(...)` followed — past an optional
 * `async`/`async*`/`sync*` — by `{` or `=>`. Anything else with that shape is a
 * CALL SITE. That one-token lookahead is how the two are told apart without a
 * Dart parser, and it is the distinction this repo has already got wrong once:
 * `assert-seams-wired.mjs` shipped matching a function's own declaration and
 * stayed green with every real caller deleted.
 */
function declarationSpans(src, name) {
  const spans = [];
  const re = new RegExp(`(?:^|[^\\w$.])${name}\\s*(?:<[^<>()]*>\\s*)?\\(`, 'g');
  for (const m of src.matchAll(re)) {
    const open = m.index + m[0].length - 1;
    const afterParams = matchDelim(src, open, '(', ')');
    if (afterParams === -1) continue;
    const rest = src.slice(afterParams);
    const head = rest.match(/^\s*(?:(?:async|sync)\s*\*?\s*)?/)[0];
    const at = afterParams + head.length;
    // `at` is where the BODY starts; `m.index` is one char before the declared
    // NAME (or 0 at a line start). Limb C needs both: the body to say "an ask in
    // here is a launch-path ask", the head to say "this occurrence of the name
    // is the declaration itself, not a call to it".
    if (src[at] === '{') {
      const end = matchDelim(src, at, '{', '}');
      if (end !== -1) spans.push({ head: m.index, start: at, end, text: src.slice(at, end) });
    } else if (src[at] === '=' && src[at + 1] === '>') {
      const semi = src.indexOf(';', at);
      const end = semi === -1 ? src.length : semi;
      spans.push({ head: m.index, start: at, end, text: src.slice(at, end) });
    }
  }
  return spans;
}

/** The bodies alone — limbs A and B only ever ask "does an ask appear in here". */
function declarationBodies(src, name) {
  return declarationSpans(src, name).map((s) => s.text);
}

/** Lower/underscore-initial callees in a body. Capitalised names are constructors
 *  — the widget-tree barrier described above — and are never followed. */
function calledNames(body) {
  const out = new Set();
  for (const m of body.matchAll(/(?:^|[^\w$])([a-z_][\w$]*)\s*\(/g)) {
    if (!NOT_A_CALL.has(m[1])) out.add(m[1]);
  }
  return out;
}

/** Every `.dart` under `dir`, recursively.
 *
 * ⚠️ `listDir`, never a raw `readdirSync` — this is the FOURTH time the nested-
 * checkout defect has landed in `tooling/ci`, and it is invisible to every test:
 * CI creates no worktrees, so a raw walk is green there and red only on the
 * machine of the person actually looking. `assert-walks-bounded.mjs` caught this
 * one at the merge, not in the branch, because the branch's fixture copied the
 * script without `tree-walk.mjs` — a fixture cannot model the tree it walks.
 */
function dartFilesUnder(dir) {
  const out = [];
  let entries;
  try {
    entries = listDir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...dartFilesUnder(p));
    else if (e.name.endsWith('.dart')) out.push(p);
  }
  return out;
}

/** Walk both limbs for one app root. Returns a report; never throws. */
function auditBootPath(root) {
  const libDir = join(repo, root, BOOT_ROOT_LIB);
  const files = dartFilesUnder(libDir).map((abs) => ({
    rel: abs.slice(join(repo, root).length + 1).split('\\').join('/'),
    src: stripDartComments(readFileSync(abs, 'utf8'), { blankStrings: true }),
  }));

  // Limb A — breadth-first over the call graph, carrying the chain so a failure
  // names the route rather than just the endpoint.
  const seen = new Set();
  const queue = [{ name: 'main', chain: ['main()'] }];
  let reached = 0;
  let sawMain = false;
  const violations = [];
  while (queue.length) {
    const { name, chain } = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    for (const f of files) {
      for (const body of declarationBodies(f.src, name)) {
        reached++;
        if (name === 'main' && f.rel === 'lib/main.dart') sawMain = true;
        if (PERMISSION_ASK_RE.test(body)) {
          violations.push({ limb: 'A', chain: chain.join(' → '), file: `${root}/${f.rel}` });
          continue;
        }
        for (const callee of calledNames(body)) {
          if (!seen.has(callee)) queue.push({ name: callee, chain: [...chain, `${callee}()`] });
        }
      }
    }
  }

  // Limb B — the hooks the framework calls for you.
  for (const hook of UNGESTURED_HOOKS) {
    for (const f of files) {
      for (const body of declarationBodies(f.src, hook)) {
        if (PERMISSION_ASK_RE.test(body)) {
          violations.push({ limb: 'B', chain: `${hook}() [first frame, no gesture]`, file: `${root}/${f.rel}` });
        }
      }
    }
  }

  // Limb C — THE ENABLE PATH ASKS AT ALL. The complement of what A and B police;
  // see D⁻/D⁺ in the header. Everything excluded here is excluded because some
  // OTHER limb already owns it, which is what makes the two halves disjoint
  // rather than merely different.
  const askGlobalRe = new RegExp(PERMISSION_ASK_RE.source, 'g');
  const enablePathAsks = [];
  for (const f of files) {
    const excluded = [];
    // D⁻(A): every function the walk above actually reached from `main()`. An
    // ask in one of these is limb A's violation, never limb C's evidence.
    for (const name of seen) {
      for (const s of declarationSpans(f.src, name)) excluded.push([s.start, s.end]);
    }
    // D⁻(B): the hooks the framework calls for you at first frame.
    for (const hook of UNGESTURED_HOOKS) {
      for (const s of declarationSpans(f.src, hook)) excluded.push([s.start, s.end]);
    }
    // NOT A CALLER. `head` and not `start`, so the declaration's own name token
    // is excluded along with its body — otherwise `Future<bool>
    // requestPermissions() async { … ?.requestPermissions(alert: true) … }`
    // supplies THREE "callers" while nothing in the app calls it, and limb C
    // stays green on a tree with every real call site deleted. That is the
    // recorded assert-seams-wired.mjs defect, reproduced exactly.
    for (const name of ASK_NAMES) {
      for (const s of declarationSpans(f.src, name)) excluded.push([s.head, s.end]);
    }
    for (const m of f.src.matchAll(askGlobalRe)) {
      if (excluded.some(([a, b]) => m.index >= a && m.index < b)) continue;
      enablePathAsks.push({
        file: `${root}/${f.rel}`,
        line: f.src.slice(0, m.index).split('\n').length,
      });
    }
  }

  return { files: files.length, reached, sawMain, violations, enablePathAsks };
}

// ── THE ROOTS. The brick, plus every non-exempt app on the workspace list. ───
// The workspace block is the domain rather than `ls apps/` for the reason
// assert-app-dod.mjs states at length: a directory listing differs between this
// box and CI (the brick lane stamps `apps/probe` and `apps/probeapi` and never
// removes them), and a domain that depends on which machine reads it is not one.
const roots = [BRICK];
/** [13]T-4: the same domain WITHOUT the exemption. See the boot-path header. */
const bootRoots = [BRICK];
let workspaceRead = false;
try {
  const lines = readFileSync(join(repo, 'pubspec.yaml'), 'utf8').replace(/^\s*#.*$/gm, '').split('\n');
  const at = lines.findIndex((l) => /^workspace:\s*$/.test(l));
  if (at !== -1) {
    workspaceRead = true;
    for (const line of lines.slice(at + 1)) {
      if (/^\S/.test(line)) break;
      const m = line.match(/^\s*-\s*(\S+)\s*$/);
      if (!m || !m[1].startsWith('apps/')) continue;
      bootRoots.push(m[1]);
      if (!EXEMPT_APPS.has(m[1])) roots.push(m[1]);
    }
  }
} catch { /* handled by workspaceRead below */ }
if (!workspaceRead) {
  fail(
    'COVERAGE LOST — the root pubspec.yaml has no readable `workspace:` block, so the set of stamped ' +
      'apps this guard checks could not be built. It would then have audited the brick template alone, ' +
      'which is exactly the blind spot [N-4 clause 7] exists to close: an app can delete its inherited ' +
      'property test with every guard in the tree still green.',
  );
}
// The one root that must always be there. Losing it means the template every app
// is stamped from stopped being audited, and on a clean checkout it is the ONLY
// root, so its absence would empty the whole scan.
if (!existsSync(join(repo, BRICK, PROP_TEST))) {
  fail(
    `COVERAGE LOST — ${BRICK}/${PROP_TEST} is MISSING. Every stamped app inherits its property ` +
      'assertions from this file; without it a stamped app asserts nothing about its own behaviour, and ' +
      'this guard has no template to compare an app against.',
  );
  console.error('\nassert-stamp-properties: FAILED');
  process.exit(1);
}

/** Resolve a source anchor: shared trees are repo-absolute, everything else is
 *  read under the root currently being audited. */
const resolveSource = (root, file) => (SHARED_PREFIX.test(file) ? file : `${root}/${file}`);

/**
 * The file(s) ONE source anchor may be satisfied by — normally exactly the file
 * it names, and for a providers spine, the spine.
 *
 * 🔴 ADDED 2026-09-04, AND IT IS THE DIFFERENCE BETWEEN "THE PROPERTY IS GONE"
 * AND "THE FILE IS BIGGER THAN ONE FILE". `apps/subly`'s spine was split behind
 * a barrel: `lib/state/providers.dart` now re-exports `lib/state/providers/*.dart`,
 * one file per capability, with every declaration and every doc comment carried
 * verbatim. Read as a single file, NINE properties this app really does
 * implement — theme-mode-persisted, locale-actually-switches,
 * onboarding-shown-once, reminder-intent-persisted, reminders-resync-on-start,
 * review-prompt-gated, auth-seam-wired, auth-redirect-follows-session,
 * account-deletion-works, analytics-lifecycle-complete — read as ABSENT, and the
 * only other repair available was raising the EXEMPT_APPS floor from 10 to 19.
 * That is precisely the slack the ratchet's own [RED] note forbids: a floor
 * above the real number is room a later regression reappears inside.
 *
 * The domain WIDENS to the spine and to nothing else. Every anchor still has to
 * match real, comment-stripped code in the app's own provider wiring; what it no
 * longer has to do is care which capability file that wiring sits in. A stamped
 * app that has not split keeps a one-element domain and is read exactly as
 * before — `money_providers.dart` included, since the suffix test requires a
 * path separator immediately before `providers.dart`.
 *
 * 🔴 WIDENED AGAIN 2026-09-04 (P1b) FOR THE ROUTER, AND FOR THE SAME REASON.
 * `apps/subly`'s `lib/core/router.dart` is now a barrel over `lib/core/router/`
 * — the ORDERED gate chain, the route table, the shell wiring, the navigator key
 * and the `GoRouter` those assemble into. Three ROUTER anchors this app really
 * does satisfy are evaluated for it today (the `refreshListenable` join, the
 * first-run destination statement, and the `loggedIn ? … : false` guard on the
 * re-acceptance read); read as a single file after the split, all three read as
 * ABSENT and the ratchet would have gone 10 -> 13. It is back at exactly 10 and
 * the ten witnesses are the SAME ten properties as before.
 *
 * ⚠️ THE WIDENING DOES NOT WEAKEN THE ANCHORS THAT ARE MEANT TO FAIL. The one
 * ROUTER anchor `apps/subly` misses — `matchedLocation == '/reaccept-terms'`,
 * which this app spells through a hoisted local — still misses across the whole
 * spine, and it is one of the ten. A widened domain that turned a recorded gap
 * green would be the ratchet failing in the CAUGHT-UP direction, which is a FAIL
 * here and not a pass.
 */
const SPINE_BARRELS = ['/providers.dart', '/router.dart'];

const anchorDomain = (path) => {
  if (!SPINE_BARRELS.some((b) => path.endsWith(b))) return [path];
  const dir = path.slice(0, -'.dart'.length);
  let entries;
  try {
    entries = listDir(join(repo, dir));
  } catch {
    return [path]; // no sibling directory: an unsplit spine
  }
  return [path, ...entries.filter((e) => e.endsWith('.dart')).sort().map((e) => `${dir}/${e}`)];
};

// ─────────────────────────────────────────────────────────────────────────────
// DELEGATION — AN ANCHOR FOLLOWS ITS SPELLING INTO THE CHASSIS PACKAGE
// (ADR 067 decision 2)
//
// [ADR 066] measured 88 literal shapes anchored to 10 named brick files and
// called each one "re-pointable, but each is a guard edit, never a free move".
// This is that edit, made ONCE, generically: an anchor whose file DELEGATES to
// `package:nikatru_chassis_screens` searches the package file too.
//
// WHY A DEFAULT AND NOT AN OPT-IN PER MOVE. An anchor is a claim about a
// BEHAVIOUR ("app.dart must pass its stamped seed to the light theme"), not
// about a byte offset in a particular file. If every screen that moves needs a
// hand edit here, then either every spine unit edits this guard — which is how
// 88 anchors drift out of step one at a time — or somebody re-points an anchor
// at the package and quietly drops the assertion that the BRICK still wires it.
// So the default is: read the anchor file, and read what it delegates to.
//
// AND THERE IS NO OPT-OUT FIELD, WHICH IS A DELETION AND NOT AN OMISSION. This
// carried a per-anchor `delegatesTo` (`false` to refuse the follow, a path to
// re-point by hand) until it was asked what would ever set it. Nothing: every
// anchor here is a POSITIVE `re.test`, following a delegation only ever ADDS
// text to the search, so an anchor that matched still matches and `false` could
// not change a verdict. And an anchor that really is about one named file
// already says so — `sources[].file` takes any path, and a `packages/…` one is
// resolved repo-absolute by `resolveSource`. Two branches nothing could reach
// and no test could exercise is the assertion-that-cannot-fail shape wearing a
// configuration costume, so they are not here.
//
// EVERY REFUSAL IS LOUD. A delegation that cannot be followed — two different
// chassis imports, or a target that is not on disk — is COVERAGE LOST, never a
// quiet fall-back to reading the adapter alone. And the domain only ever GROWS:
// an anchor that matched before still matches, because its own file is still
// read first.
// ─────────────────────────────────────────────────────────────────────────────
const CHASSIS_PKG = 'nikatru_chassis_screens';
const CHASSIS_DIR = 'packages/chassis_screens';
const CHASSIS_IMPORT = new RegExp(`import\\s+'package:${CHASSIS_PKG}/([^']+\\.dart)'`, 'g');

/** The chassis file(s) `rel` delegates to, resolved ONE level.
 *  `null` = no delegation · `{ lost }` = a delegation that could not be followed
 *  · `{ files }`. The first two are different answers on purpose. */
function delegationOf(rel) {
  const abs = join(repo, rel);
  if (!existsSync(abs)) return null;
  CHASSIS_IMPORT.lastIndex = 0;
  const src = stripAnchorComments(rel, readFileSync(abs, 'utf8'));
  const paths = [...new Set([...src.matchAll(CHASSIS_IMPORT)].map((m) => m[1]))];
  if (paths.length === 0) return null;
  if (paths.length > 1) {
    return {
      lost:
        `imports ${paths.length} different \`package:${CHASSIS_PKG}\` paths (${paths.join(', ')}), so the ` +
        'file that now carries this behaviour cannot be identified; this guard reads NAMED files and will ' +
        'not guess between two of them',
    };
  }
  const target = `${CHASSIS_DIR}/lib/${paths[0]}`;
  if (!existsSync(join(repo, target))) {
    return {
      lost:
        `delegates to \`package:${CHASSIS_PKG}/${paths[0]}\`, which resolves to \`${target}\` and that file ` +
        'is not on disk — the behaviour left this file and arrived nowhere',
    };
  }
  const out = [target];
  for (const m of stripAnchorComments(target, readFileSync(join(repo, target), 'utf8')).matchAll(
    /export\s+'([^':]+\.dart)'/g,
  )) {
    const t = `${CHASSIS_DIR}/lib/${m[1]}`;
    if (existsSync(join(repo, t))) out.push(t);
  }
  return { files: out };
}

/** The files ONE anchor is read over: its own spine domain, plus wherever that
 *  domain delegates to. Returns `{ files }` or `{ lost }`. */
function anchorFiles(path) {
  const base = anchorDomain(path);
  const extra = [];
  for (const f of base) {
    const d = delegationOf(f);
    if (d && d.lost) return { lost: `\`${f}\` ${d.lost}.` };
    for (const t of (d && d.files) || []) if (!extra.includes(t)) extra.push(t);
  }
  return { files: [...base, ...extra] };
}

const MIN_BLOCKS = 12;
let rootsAudited = 0;

// ── ONE ROOT AUDITED, WITH ITS VERDICTS ROUTED THROUGH A SINK ───────────────
// 2026-08-25. This was the body of `for (const root of roots)` and it is not
// changed a line — only its `fail`/`ok` calls are routed through `sink`, so the
// EXEMPT_APPS ratchet below can run the SAME audit over an exempted app and
// COUNT what it would have said. The alternative was a second extraction of the
// property/anchor logic, which is the shape this file already fails on at the
// `COVERAGE LOST` beside the workspace read: a rival reader agrees with itself.
/** @param {{fail:(m:string)=>void, ok:(m:string)=>void, audited:()=>void, gap:(g:string)=>void}} sink */
function auditPropertyRoot(root, sink) {
  const testPath = `${root}/${PROP_TEST}`;
  let test;
  try {
    test = stripDartComments(readFileSync(join(repo, testPath), 'utf8'));
  } catch {
    sink.fail(
      `${testPath} is MISSING. A stamped app that deletes its inherited property test drops all ` +
        `${REQUIRED_COVERAGE.length} assertions with ONE rm — no lint suppression, no skip:, and until ` +
        'this guard read apps/ as well as the brick, every other guard in the tree stayed green.',
    );
    return;
  }
  sink.audited();

  // COVERAGE SELF-CHECK. A file that still exists but has been emptied of tests
  // would satisfy every `group` regex below only if they were also removed — but a
  // file gutted down to one token would otherwise pass the "exists" check alone.
  // Counted over the COMMENT-STRIPPED source: `// testWidgets(` is not a test.
  const blocks = (test.match(/\b(?:test|testWidgets)\(/g) ?? []).length;
  if (blocks < MIN_BLOCKS) {
    sink.fail(`COVERAGE LOST — ${testPath} declares only ${blocks} test block(s), expected >= ${MIN_BLOCKS}. The file exists but has stopped asserting.`);
  } else {
    sink.ok(`${root} — property test declares ${blocks} assertion block(s)`);
  }

  for (const p of REQUIRED_COVERAGE) {
    if (!p.group.test(test)) {
      sink.fail(`${root}: property '${p.key}' is NOT asserted in ${testPath} — ${p.why}`);
      continue;
    }
    const sources = p.sources ?? [];
    let anchored = true;
    for (const s of sources) {
      const path = resolveSource(root, s.file);
      let src = '';
      let domain = [path];
      try {
        // 🔴 2026-08-21 · THIS WAS THE ONE RAW READ IN THIS FILE. Every other
        // read here goes through `stripDartComments` — 7 sites — and this one
        // did not, so a source anchor could be satisfied by a DOC COMMENT.
        // "Assert on parsed structure, never by grepping prose" [CLAUDE.md],
        // failing inside the guard that exists to enforce it.
        //
        // MEASURED by running EVERY anchor of EVERY property over both roots
        // raw and stripped and diffing the two — 116 anchors resolve per root,
        // 232 comparisons (re-derive it; do not trust this line): exactly ONE
        // anchor result flips, and it is in apps/subly, not the brick (the
        // brick flips ZERO, which is what validates the method rather than the
        // finding). It is `content-pack-consumed` anchor 1,
        // `/contentPack:\s*'https:\/\//`, in
        // `apps/subly/lib/state/providers.dart`, whose only match in the whole
        // file is :158, a `///` line reading "The chassis template's
        // `features: {}` + `contentPack: 'https://packs…/latest'` would put the
        // client and the server into disagreement". apps/subly's real config is
        // `contentPack: null` (:172), so the implementation is genuinely ABSENT
        // and the anchor was green on a sentence ABOUT the file that has it.
        // Not re-anchored, therefore: there is nothing to re-anchor to.
        //
        // ⚠️ AND IT CHANGES NOTHING TODAY'S RUN LOOKS AT — say it rather than
        // let the fix imply a save. `apps/subly` is in `EXEMPT_APPS`, so `roots`
        // is the brick alone and the brick's match is real code at :49. This
        // closes a LATENT hole, which is the only kind [N-4 clause 7] leaves:
        // that clause exists so the NEXT stamped app is audited, and the first
        // one carrying a doc comment about a feature it has not built would
        // have inherited a green anchor for it.
        //
        // ⚠️ `blankStrings` STAYS OFF, and that is measured too: turning it on
        // breaks NINETEEN of the brick's 116 anchors (and 16 of apps/subly's,
        // counted the same way) — route paths (`path: '/check-inbox'`),
        // analytics event names (`'app_open'`), the ARB `"@@locale": "ta"`, the
        // viewport meta — because those anchors match STRING LITERALS. The
        // sibling read of the property test itself (grep `test =
        // stripDartComments`, never a line number — this file gets edited) is
        // off for exactly the same reason: `group('property: …')` is a string.
        const resolved = anchorFiles(path);
        if (resolved.lost) {
          sink.fail(
            `COVERAGE LOST — ${root}: property '${p.key}' anchor on ${path} could not be resolved: ` +
              `${resolved.lost}`,
          );
          anchored = false;
          break;
        }
        domain = resolved.files;
        src = domain
          .map((f) => stripAnchorComments(f, readFileSync(join(repo, f), 'utf8')))
          .join('\n');
      } catch {
        sink.fail(`${root}: property '${p.key}': ${path} could not be read`);
        anchored = false;
        break;
      }
      if (!s.re.test(src)) {
        sink.fail(`${root}: property '${p.key}' is asserted but its IMPLEMENTATION is gone in ${path} — ${s.what}${domain.length > 1 ? ` (searched the whole spine: ${domain.length} file(s))` : ''}`);
        anchored = false;
        break;
      }
    }
    if (!anchored) continue;
    if (sources.length === 0) {
      // Refused deliberately: an unanchored property is a test heading that
      // survives its own feature's deletion. That was hole 1.
      sink.fail(`${root}: property '${p.key}' has NO source anchor — it would still pass with the feature deleted`);
      continue;
    }
    sink.ok(`${root} — property '${p.key}' asserted and implemented (${sources.length} anchor${sources.length > 1 ? 's' : ''})`);
    // A limb of the property that CANNOT be exercised here, printed every run
    // rather than left in a comment nobody opens. Never blocking: the fix is
    // another stage's seam edit, and a guard that reddens CI over work this
    // branch may not do is one somebody switches off. [CLAUDE.md C-6]
    if (p.gap) sink.gap(`${p.key} — ${p.gap}`);
  }
}

const GRADED_SINK = { fail, ok, audited: () => { rootsAudited++; }, gap: (g) => propertyGaps.add(g) };
for (const root of roots) auditPropertyRoot(root, GRADED_SINK);

// --- EXEMPT_APPS . VISIBLE, EXISTENT, AND SIZED (2026-08-25) ----------------
// See the three limbs at EXEMPT_APPS above. Everything here prints on every run:
// an exemption nobody can see in output is an exemption nobody re-reads.
for (const [app, ex] of EXEMPT_APPS) {
  console.log(`\u2b1c NOT GRADED: ${app} is in EXEMPT_APPS \u2014 ${ex.why}`);
}

// LIMB (2). `bootRoots` is the workspace apps/ list BEFORE the exemption filter,
// so this is a set difference and not a second read of pubspec.yaml. Skipped when
// the workspace block itself could not be read: that is already a COVERAGE LOST
// above, and reporting it twice would attribute one defect to two causes.
if (workspaceRead) {
  for (const [app, ex] of EXEMPT_APPS) {
    if (bootRoots.includes(app)) continue;
    fail(
      `EXEMPT_APPS names "${app}", which is NOT in the root pubspec.yaml \`workspace:\` block. ` +
        'An exemption for a path that is not on the workspace list excuses nothing and hides that fact: it ' +
        'reads as a live carve-out for a shipped app while naming a directory that was renamed or removed, ' +
        `and the reason it carries \u2014 "${ex.why}" \u2014 is then a claim about nothing. ` +
        'Delete the entry or fix the path.',
    );
  }
}

// LIMB (3), THE RATCHET. The exempted app is audited by the SAME
// `auditPropertyRoot` the graded roots run through - same property groups, same
// source anchors, same comment-stripped anchor read - with the verdicts counted
// instead of printed. That count is what the prose above calls "9, now 10", and
// it is now a number this guard produces rather than one a maintainer is told to
// reproduce by hand.
//
// [RED] BOTH DIRECTIONS FAIL, and the second one is the point. Exceeding the
// floor means the exempted app drifted further from the chassis while nothing
// watched. Coming in UNDER it means the app caught up and the floor is now slack
// a future regression could hide inside - so it must be lowered in the same
// commit that earns it. A one-sided floor is a budget, and a budget nobody spends
// down becomes permission.
for (const [app, ex] of EXEMPT_APPS) {
  if (!bootRoots.includes(app)) continue; // limb (2) already failed this entry
  let would = 0;
  const witness = [];
  auditPropertyRoot(app, {
    fail: (m) => { would++; witness.push(m); },
    ok: () => {},
    audited: () => {},
    gap: () => {},
  });
  // IS THIS THE PACKAGE THE FLOOR WAS MEASURED OVER? A tree can NAME `apps/subly`
  // on its workspace list without being the app — every fixture that exercises
  // this guard does exactly that, seeding two files under `apps/subly/lib` so the
  // [13]T-4 boot walk has something to walk. Comparing a recorded count of a real
  // 56-file app against a two-file stub would fail those trees for being fixtures.
  //
  // The discriminator is the package manifest, and it is deliberately NOT an
  // opt-out: a `workspace:` member with no `pubspec.yaml` is not a Dart workspace
  // at all. `dart pub get` refuses it outright, so deleting this file to quiet the
  // ratchet takes the whole repository's dependency resolution — and the app's
  // build, its test lane and assert-app-dod — down with it. That is the opposite
  // of a quiet move. THE COUNT IS PRINTED EITHER WAY; only the comparison is held.
  const measurable = existsSync(join(repo, app, 'pubspec.yaml'));
  console.log(
    `\u2b1c ${app} is NOT GRADED, and this is the size of that: the same audit run over it produces ` +
      `${would} FAIL line(s)` +
      (measurable
        ? ` (recorded floor ${ex.floor}, set ${ex.floorAsOf}). ${ex.floorNote}`
        : ` \u2014 but this tree has no ${app}/pubspec.yaml, so it is not the package floor ${ex.floor} ` +
          'was measured over and the ratchet is NOT applied to it.'),
  );
  if (!measurable) continue;
  for (const m of witness) console.log(`   \u00b7 would fail: ${m}`);
  if (would > ex.floor) {
    fail(
      `${app} is exempt and has DRIFTED: the audit now produces ${would} FAIL line(s), above the recorded ` +
        `floor of ${ex.floor} (set ${ex.floorAsOf}). The exemption is a statement about a KNOWN gap, not a ` +
        'licence for it to grow; every line above the floor is a chassis property this app stopped meeting ' +
        'while the only thing tracking the number was a comment. Fix the drift, or raise the floor in the ' +
        'same commit and say what was traded.',
    );
  } else if (would < ex.floor) {
    fail(
      `${app} is exempt and has CAUGHT UP: the audit produces ${would} FAIL line(s), BELOW the recorded ` +
        `floor of ${ex.floor} (set ${ex.floorAsOf}). This is not a pass. A floor left above the real number ` +
        'is slack a later regression can reappear inside without this guard saying a word - the same shape ' +
        'as the hand-kept list REQUIRED_COVERAGE stopped being. Lower the floor to ' +
        `${would} in this commit.`,
    );
  }
}

// ── [pipeline C-11] `brand-seed-drives-paint` LIMB (c) · THE THIRD LINK ──────
//
// 🔴 THE PROPERTY IS NAMED FOR A CHAIN AND ITS ANCHORS PROVE TWO LINKS OF IT.
// seed → `theme:`, seed → `darkTheme:`, tokens DERIVED rather than `const`: all
// three are true today, and ALL THREE WOULD STILL BE TRUE of an app whose
// visible colour never came from the seed at all. The missing link is the READ.
// `packages/design_system/lib/src/theme/build_app_theme.dart:75` attaches the
// derived tokens to the theme (`extensions: [tokens]`); if no shipped widget
// calls `Theme.of(context).extension<AppThemeX>()` to get them back out, the
// seed reaches a builder whose output nobody paints with, and the colour a user
// sees comes from hardcoded `AppColors.*`. From outside the binary — which is
// exactly where a store's clone detector stands — that is indistinguishable
// from never having stamped a seed, which is the harm in this property's `why`.
//
// MEASURED 2026-08-21 by running this limb (re-derive it, do not trust this
// line): 0 of 159 Dart files under the 10 shipped lib trees call it, and the two
// files in the whole tree that DO are both the brick template's. The four
// `extension<AppThemeX>` hits in `apps/subly/lib` are doc comments arguing that
// the code deliberately does NOT read it — comments, so `stripDartComments`
// removes them and they do not count. The stamped chassis is the opposite case:
// the brick's `home_screen.dart` DOES read it, so every STAMPED app has the
// whole chain and only the un-stamped `apps/subly` and the packages do not.
//
// ⚠️ WHY THIS PRINTS INSTEAD OF FAILING, AND IT IS NOT SOFTNESS. The repair is
// not mechanical; it is a judgement about WHAT SUBLY'S INDIGO IS, and both
// answers are legitimate:
//   · a BRAND colour — deliberately constant across every build, the thing a
//     returning user recognises — in which case hardcoding `AppColors.*` is
//     CORRECT and this seam is simply the wrong tool for that app; or
//   · merely a STAMP SEED — one dial in a portfolio of look-alike apps — in
//     which case the painting widgets must read the extension and today do not.
// Nobody but the owner can pick, so failing here would red CI over owner work:
// "when a capability's on-switch is owner-gated, the guard must PRINT the gap on
// every run rather than fail the build" [CLAUDE.md C-6]. The print is modelled
// on assert-privacy-manifest.mjs's owner-gated `.xcprivacy` block, and carries
// the count and the decision so it is actionable rather than a shrug.
//
// ⚠️ AND A ZERO MUST SAY WHETHER IT IS A MEASUREMENT. A pattern matching nothing
// anywhere would report "0 readers" with the same confidence as a real count —
// the dead-scanner shape this whole file exists to catch, one level up. So the
// pattern is also run over the trees that DO read it (the brick's lib and the
// audited property tests) and that WITNESS is printed beside the count; when the
// witness is empty the print says the zero is unwitnessed instead of asserting
// it. Why that is a caveat and not a `fail` is argued at the witness itself —
// short version: a stale pattern here over-reports a gap rather than hiding one,
// the class name is already hard-anchored by anchor 3, and the gate as first
// written reddened a healthy fixture.
//
// NEGATIVE-TESTED 2026-08-21, all three branches, by pointing the guard at a
// throwaway tree rather than by trusting the real one (a limb that has only ever
// printed one branch is a limb whose other branches are unrun):
//   · a two-file `apps/demo/lib` where ONE file calls it and one only MENTIONS
//     it in a doc comment → `ok … 1 of 2`, so the comment-stripping is what
//     makes the count a count;
//   · the same tree with the call removed → the ⬜ print;
//   · and with the witness's calls renamed away too → the same print carrying
//     the UNWITNESSED caveat.
const BRAND_TOKEN_READ_RE = /\.extension\s*<\s*AppThemeX\s*>\s*\(/;
/** The trees whose `lib/` is compiled into something a user looks at. Derived
 *  from the listing rather than typed out, so a new package that paints is
 *  inside the measurement the day it lands. */
const SHIP_TREES = ['apps', 'packages'];

/** Files under `libDir` that actually CALL the brand-token read.
 *
 *  `blankStrings: true` on purpose: a mention is not a read. `apps/subly/lib`
 *  holds four mentions and zero calls, and a scan that could not tell them apart
 *  would report this property healthy on the strength of comments explaining
 *  that it is not. */
function brandTokenReaders(libDir) {
  const hits = [];
  for (const abs of dartFilesUnder(libDir)) {
    let src;
    try {
      src = stripDartComments(readFileSync(abs, 'utf8'), { blankStrings: true });
    } catch {
      continue;
    }
    if (BRAND_TOKEN_READ_RE.test(src)) hits.push(abs.slice(repo.length + 1).split('\\').join('/'));
  }
  return hits;
}

function checkBrandSeedReachesPaint() {
  const shipRoots = [];
  for (const tree of SHIP_TREES) {
    let entries;
    try {
      entries = listDir(join(repo, tree), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const abs = join(repo, tree, e.name, 'lib');
      if (existsSync(abs)) shipRoots.push({ rel: `${tree}/${e.name}/lib`, abs });
    }
  }
  if (shipRoots.length === 0) {
    fail(
      'COVERAGE LOST — no `apps/*/lib` or `packages/*/lib` exists under this root, so the brand-seed read ' +
        'count ranges over no code at all. It would print 0 whatever the tree contained, and 0 is the ' +
        'answer this limb exists to interpret.',
    );
    return;
  }

  const shipHits = shipRoots.flatMap((r) => brandTokenReaders(r.abs));
  const scanned = shipRoots.reduce((n, r) => n + dartFilesUnder(r.abs).length, 0);

  // The blindness witness: the trees KNOWN to read the tokens today. Deliberately
  // NOT part of the count — a template is not a shipped app and a test is not
  // paint — but it is what tells a reader whether a zero above is a fact about
  // the shipped code or a fact about this regex having gone stale.
  const witness = brandTokenReaders(join(repo, BRICK, 'lib'));
  for (const root of roots) {
    try {
      const src = stripDartComments(readFileSync(join(repo, root, PROP_TEST), 'utf8'), { blankStrings: true });
      if (BRAND_TOKEN_READ_RE.test(src)) witness.push(`${root}/${PROP_TEST}`);
    } catch { /* a missing property test has already failed hard above */ }
  }

  // ⚠️ THE WITNESS IS A CAVEAT IN THE PRINT, NOT A GATE — and the first version
  // of this limb got that wrong. It `fail`ed when the pattern matched nothing
  // anywhere, and that reddened guards.test.mjs's `sp-ok` fixture immediately
  // (MEASURED 2026-08-21: `1 !== 0` at guards.test.mjs:6520). That fixture is
  // healthy: it carries a real `app_theme_x.dart` with the factory, so anchor 3
  // above passes, and 11 shipped lib files none of which read the extension.
  // A minimal tree with no reader is a legitimate tree, not a broken scanner.
  //
  // And the gate was wrong on the REAL tree too, for two reasons worth keeping:
  //  · a blind pattern here fails LOUD, not quiet — it would print "ZERO
  //    readers" while readers existed, an OVER-report. The direction that
  //    inflates apparent coverage is a pattern matching too MUCH and printing
  //    `ok`, and that branch is witnessed by the hits it prints;
  //  · the only realistic way this pattern goes stale is the class being
  //    renamed, and `factory\s+AppThemeX\.fromScheme` — anchor 3 above — is a
  //    HARD failure on exactly that, in the same property. `.extension<T>()` is
  //    Flutter's own `ThemeData` API and is not a shape this repo can drift.
  // So an unwitnessed zero is REPORTED IN THE PRINT, where a reader can weigh
  // it, rather than reddening a build over it.

  if (shipHits.length > 0) {
    ok(
      `brand-seed limb (c) — ${shipHits.length} of ${scanned} shipped lib file(s) across ${shipRoots.length} ` +
        `tree(s) READ the derived tokens (${shipHits.join(', ')}); the seed reaches PAINT, not merely a builder`,
    );
    return;
  }

  console.log('   ── printed, not failed (owner decision: brand colour vs stamp seed) ──');
  console.log(
    `   ⬜ brand-seed-drives-paint limb (c): ZERO of ${scanned} Dart file(s) under ${shipRoots.length} shipped ` +
      `lib tree(s) (${shipRoots.map((r) => r.rel).join(', ')}) call \`.extension<AppThemeX>()\`. The three ` +
      'anchors above are TRUE — the seed reaches both themes and the tokens are derived from the scheme — but ' +
      'nothing shipped reads those tokens back out, so the colour a user sees comes from hardcoded ' +
      '`AppColors.*` and the stamp seed moves nothing a store\'s clone detector can see. ' +
      (witness.length
        ? `${witness.length} file(s) OUTSIDE those trees DO read them (${witness.join(', ')}), which is how ` +
          'this pattern is proven live and why the zero is a measurement rather than a blind one. '
        : 'CAVEAT — nothing in this tree reads them at all, not even the brick template, so the pattern ' +
          'has no live witness here and this zero is UNWITNESSED. Not failed on that account: a stale ' +
          'pattern would over-report a gap rather than hide one, and the class name itself is hard-anchored ' +
          'by `factory AppThemeX.fromScheme` above. ') +
      'RESOLVING IT IS AN OWNER DECISION and ' +
      'both answers are legitimate: if Subly\'s indigo is a BRAND colour — constant on purpose — then ' +
      'hardcoding is CORRECT, this property is the wrong tool for that app, and the exemption should be ' +
      'recorded here by name; if it is merely a STAMP SEED, the painting widgets must read the extension. ' +
      'Failing would block CI on a judgement only the owner can make [CLAUDE.md C-6].',
  );
}

checkBrandSeedReachesPaint();

// ── `content-pack-consumed` LIMB (d) · THE PROPERTY IS NAMED "CONSUMED" AND ──
//    NOTHING SHIPPED CONSUMES IT. ───────────────────────────────────────────
//
// 🔴 THE SHAPE. The three anchors above assert a pack is NAMED, a
// `ContentPackLoader` is CONSTRUCTED, and `.load(expectPackId:)` is CALLED. All
// three are true in the brick today. But that `.load` call site is the body of
// `contentPackProvider`, a Riverpod `FutureProvider`, and a provider body is
// LAZY: it runs when something watches or reads the provider, and never
// otherwise. So the third anchor proves a call site EXISTS, not that anything
// ever reaches it — and anchor 3's own `what` says "something must actually ASK
// for a pack". Nothing shipped does.
//
// MEASURED 2026-08-21 (re-derive it, do not trust this line): `grep -rn
// contentPackProvider --include=*.dart` returns ELEVEN hits, and the split is
// the finding — TWO declarations (the brick's `lib/state/providers.dart:201`
// and apps/subly's :336), THREE mentions inside comments, and SIX reads through
// a ref, EVERY ONE of them inside a `chassis_properties_test.dart`. Zero
// non-test readers anywhere in the tree. `assert-seams-wired.mjs`'s
// `pack_verifier` row records the same thing from the seam side, and says in as
// many words that its `.load(expectPackId:)` need "is satisfied by a
// DECLARATION nothing runs".
//
// ⚠️ SO IS IT A DEAD RAIL OR AN OWNER-GATED ONE? IT IS BOTH, AND THE FIRST
// ANSWER WRITTEN HERE WAS HALF-RIGHT — recorded rather than quietly replaced,
// because the mistake is the instructive part. The brief named OWNER_QUEUE S-3
// (generate the pack-signing keypair) as the gate to check before invoking it.
// CHECKED, and it does NOT apply: `kContentPackPublicKeys` in packages/core
// carries ONE pinned key today (`'k1'`), and `assert-seams-wired.mjs` prints
// `1 production key(s) pinned` on the same tree. That was written up as "so
// nothing here is owner-gated" — which is a claim about EVERY gate derived from
// measuring ONE, the same over-reach this file exists to catch.
//
// 🔴 THE SECOND GATE IS THE SHELF, and it IS shut: `services/platform/
// wrangler.jsonc` binds no `r2_buckets`, so the bucket, the packs.nikatru.com
// binding and `latest.json` hosting do not exist, no pack has ever been
// published, and a consumer built today could only ever render the fallback.
// MEASURED 2026-08-21 by reading the file: its only occurrence of the key name
// is the closing comment `NO "r2_buckets" YET`. So the honest verdict is: the
// rail is DEAD (zero shipped readers, and that is ours), and building its reader
// is currently blocked upstream on owner infrastructure. Both halves are printed
// on every run, each from its own measurement, so neither can go stale silently.
//
// ⚠️ THIS OVERLAPS `assert-seams-wired.mjs`'s PACK CONSUMER LIMB (c) — say so
// rather than let two guards print the same finding as if independently. That
// limb asks the same question from the SEAM side, over a wider domain (all
// shipped non-test Dart), and it GATES: it fails once a bucket is bound and the
// rail still has no reader. This one is scoped to the trees a STAMPED app's
// consumer could live in — the brick's `lib` plus `apps/*/lib` — because that is
// what a chassis property can speak for, so the two denominators differ ON
// PURPOSE and a reader comparing them is not looking at a contradiction.
//
// ⚠️ AND WHY THIS ONE ONLY PRINTS. `brand-seed-drives-paint` limb (c) prints
// because the repair is a judgement only the owner can make [CLAUDE.md C-6].
// This limb has a weaker reason and is stated as the weaker thing it is: the
// repair lands in the brick template's WIDGETS — files this change does not own
// — and it is blocked on the shelf besides. The moment the shelf opens, the
// excuse expires; the seam-side limb is the one that turns that into a failure,
// which is why this one does not duplicate the gate as well as the measurement.
//
// ⚠️ AND A ZERO MUST SAY WHETHER IT IS A MEASUREMENT — the same discipline limb
// (c) argues at length. The reader pattern is also run over the property tests,
// which DO read the provider, and that WITNESS is printed beside the count.
// With no witness the print says the zero is unwitnessed rather than asserting
// it, for limb (c)'s reason: a stale pattern here OVER-reports a gap, and the
// direction that inflates apparent coverage is a pattern matching too much.

/** A READ of the pack rail, never its declaration. `final FutureProvider<…>
 *  contentPackProvider =` is the declaration and must not count — a scan that
 *  counted it would report the rail consumed by the very line that creates it,
 *  which is this limb's failure mode written backwards. Riverpod's three read
 *  verbs are the whole surface: `watch`, `read`, `listen`. */
const PACK_READ_RE = /\b(?:watch|read|listen)\(\s*contentPackProvider\b/;
/** Where the OWNER GATE's state is readable. Parsed as a MAP below, never
 *  grepped: the doc comment around it discusses keys at length, so a text
 *  search would "find" keys the map does not contain — the same trap
 *  assert-seams-wired.mjs:701 names at its own copy of this parse. */
const PACK_KEYS_FILE = 'packages/core/lib/src/content/pack_verifier.dart';
/** Where the OTHER gate's state is readable — the object store a published pack
 *  would sit in. See `boundPackBuckets` for why this is parsed, not grepped. */
const PACK_SHELF_FILE = 'services/platform/wrangler.jsonc';

/** Files under `libDir` that READ the pack provider.
 *
 *  `blankStrings: true` for limb (c)'s reason: a mention is not a read, and this
 *  rail's own providers file carries a doc comment naming `contentPackProvider`
 *  three lines above the declaration. */
function contentPackReaders(libDir) {
  const hits = [];
  for (const abs of dartFilesUnder(libDir)) {
    let src;
    try {
      src = stripDartComments(readFileSync(abs, 'utf8'), { blankStrings: true });
    } catch {
      continue;
    }
    if (PACK_READ_RE.test(src)) hits.push(abs.slice(repo.length + 1).split('\\').join('/'));
  }
  return hits;
}

/** Pinned production pack-signing keys, or `null` when the count could NOT be
 *  taken (unreadable file, or a map shape this parse does not recognise).
 *
 *  🔴 null IS NOT ZERO, and the distinction is the whole point: reporting an
 *  owner gate as SHUT on the strength of a failed read would let this limb
 *  blame the owner for a gap that is ours. assert-seams-wired.mjs:679 hoists its
 *  own count for the same stated reason. */
function pinnedPackKeys() {
  try {
    const src = stripDartComments(readFileSync(join(repo, PACK_KEYS_FILE), 'utf8'));
    const body = src.match(/kContentPackPublicKeys\s*=\s*<String,\s*String>\{([\s\S]*?)\}/)?.[1];
    if (body === undefined) return null;
    return (body.match(/['"][^'"]+['"]\s*:/g) ?? []).length;
  } catch {
    return null;
  }
}

/** THE SECOND GATE — the SHELF. A pinned key lets a pack be VERIFIED; it does
 *  not make one exist. Nothing has ever been published because the Worker binds
 *  no object storage, so a consumer built today could only render the fallback.
 *
 *  🔴 READ AS STRUCTURE, NOT PROSE, and this one is not theoretical: the file's
 *  closing comment is the literal sentence `NO "r2_buckets" YET`, quotes and
 *  all. A grep for the key name FINDS IT and concludes the shelf exists — the
 *  exact prose-match failure the read at the top of the anchor loop was fixed
 *  for, in a different file type. Comments are blanked first and the array BODY
 *  is counted, so an empty `"r2_buckets": []` reads as shut too.
 *
 *  Same `null`-is-not-zero rule as `pinnedPackKeys`.
 *
 *  ⚠️ `assert-seams-wired.mjs`'s PACK CONSUMER LIMB (c) reads the same shelf and
 *  is the limb that GATES on it — it fails once a bucket is bound and the rail
 *  still has no reader. This one only REPORTS, because the property's own job is
 *  to say what the stamped app can and cannot prove about itself. Cited by name
 *  rather than by line: that file is under active edit. */
function boundPackBuckets() {
  try {
    const src = stripDartComments(readFileSync(join(repo, PACK_SHELF_FILE), 'utf8'));
    const body = src.match(/"r2_buckets"\s*:\s*\[([\s\S]*?)\]/)?.[1];
    if (body === undefined) return 0; // the key is absent entirely — a measured shut, not an unread one
    return (body.match(/\{/g) ?? []).length;
  } catch {
    return null;
  }
}

/** The trees a pack CONSUMER could live in: the brick's `lib` — where a consumer
 *  belongs, so every stamped app inherits it, exactly as the brick's
 *  `home_screen.dart` is what gives every stamped app the brand-token read —
 *  plus every `apps/*\/lib`, because an exempt app still SHIPS. `packages/` is
 *  deliberately OUT: `contentPackProvider` is declared per app, so a package
 *  file structurally cannot read it and including them would only inflate the
 *  denominator. */
function packConsumerTrees() {
  const out = [];
  const brickLib = join(repo, BRICK, 'lib');
  if (existsSync(brickLib)) out.push({ rel: `${BRICK}/lib`, abs: brickLib });
  let entries = [];
  try {
    entries = listDir(join(repo, 'apps'), { withFileTypes: true });
  } catch { /* no apps tree on a clean checkout; the brick alone is legitimate */ }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const abs = join(repo, 'apps', e.name, 'lib');
    if (existsSync(abs)) out.push({ rel: `apps/${e.name}/lib`, abs });
  }
  return out;
}

function checkContentPackIsConsumed() {
  const trees = packConsumerTrees();
  if (trees.length === 0) {
    fail(
      'COVERAGE LOST — no brick `lib/` and no `apps/*/lib` exists under this root, so the content-pack ' +
        'consumer count ranges over no code at all. It would print 0 whatever the tree contained, and 0 is ' +
        'the answer this limb exists to interpret.',
    );
    return;
  }

  const hits = trees.flatMap((t) => contentPackReaders(t.abs));
  const scanned = trees.reduce((n, t) => n + dartFilesUnder(t.abs).length, 0);

  // The blindness witness: the property tests, which DO read the provider.
  // Deliberately NOT part of the count — a test is not a shipped consumer — but
  // it is what tells a reader whether a zero above is a fact about the code or a
  // fact about `PACK_READ_RE` having gone stale.
  const witness = [];
  for (const root of roots) {
    try {
      const src = stripDartComments(readFileSync(join(repo, root, PROP_TEST), 'utf8'), { blankStrings: true });
      if (PACK_READ_RE.test(src)) witness.push(`${root}/${PROP_TEST}`);
    } catch { /* a missing property test has already failed hard above */ }
  }

  if (hits.length > 0) {
    ok(
      `content-pack limb (d) — ${hits.length} of ${scanned} app lib file(s) across ${trees.length} tree(s) ` +
        `READ \`contentPackProvider\` (${hits.join(', ')}); the rail has a shipped consumer, so the ` +
        '`.load(expectPackId:)` anchor is a call something reaches rather than a lazy body nothing runs',
    );
    return;
  }

  const keys = pinnedPackKeys();
  const keyGate =
    keys === null
      ? `The KEY gate could NOT be read (${PACK_KEYS_FILE} is missing, or its \`kContentPackPublicKeys\` ` +
        'map has a shape this parse does not recognise), so this limb says NOTHING about whether ' +
        'OWNER_QUEUE S-3 is open — an unread gate is not a shut one.'
      : keys === 0
        ? "OWNER_QUEUE S-3's KEY half IS STILL SHUT: 0 production pack-signing key(s) are pinned in " +
          `${PACK_KEYS_FILE}, so every remote pack fails closed and a consumer today would be handed ` +
          'nothing it could verify. That half is owner work [CLAUDE.md C-6].'
        : `OWNER_QUEUE S-3's KEY half IS OPEN — ${keys} production pack-signing key(s) pinned in ` +
          `${PACK_KEYS_FILE} — so the keypair is NOT what is holding this rail shut.`;
  const shelf = boundPackBuckets();
  const shelfGate =
    shelf === null
      ? `The SHELF gate could NOT be read (${PACK_SHELF_FILE} is missing or unparseable), so this limb ` +
        'claims nothing about it either.'
      : shelf === 0
        ? `But the SHELF IS SHUT: ${PACK_SHELF_FILE} binds 0 R2 bucket(s), so no pack has ever been ` +
          'published and a consumer built today could only ever render the fallback. THAT is the gate ' +
          "this gap is really behind, and it is the owner's infrastructure, not the keypair."
        : `And the SHELF IS OPEN: ${shelf} R2 bucket(s) bound in ${PACK_SHELF_FILE}. With both gates ` +
          'open, NOTHING about this gap is owner work any more — it is a missing consumer, which is ' +
          'agent work, and it should stop being printed and start being built.';
  const gate = `${keyGate} ${shelfGate}`;

  console.log('   ── printed, not failed (the repair is a brick-template widget edit, not this branch\'s) ──');
  console.log(
    `   ⬜ content-pack-consumed limb (d): ZERO of ${scanned} Dart file(s) under ${trees.length} app lib ` +
      `tree(s) (${trees.map((t) => t.rel).join(', ')}) READ \`contentPackProvider\`. The three anchors above ` +
      'are TRUE — a pack is named, the loader is constructed, `.load(expectPackId:)` is called — but that ' +
      'call is the body of a LAZY Riverpod FutureProvider, so a property named "consumed" is green on a ' +
      'rail nothing consumes. ' +
      (witness.length
        ? `${witness.length} file(s) OUTSIDE those trees DO read it (${witness.join(', ')}), which is how ` +
          'this pattern is proven live and why the zero is a measurement rather than a blind one — and it ' +
          'is also the finding: every reader the rail has is a test. '
        : 'CAVEAT — nothing in this tree reads it at all, not even the property tests that are supposed to, ' +
          'so the pattern has no live witness here and this zero is UNWITNESSED. Not failed on that ' +
          'account: a stale pattern over-reports a gap rather than hiding one, and `contentPackProvider` ' +
          'is hard-anchored as a construct by anchors 2 and 3 above. ') +
      gate,
  );
}

checkContentPackIsConsumed();

// ── "EVERY" — the domain check. ─────────────────────────────────────────────
// Deliberately BRICK-ONLY, and that is not an oversight: COVERED_BY/UNASSERTED
// classify the CHASSIS's capabilities, and a stamped app's providers files are
// rendered copies of the template's. Classifying the same set once per app would
// report the same judgement N times and invite N places to edit it.
let domainSrc = '';
for (const f of DOMAIN_FILES.map((f) => `${BRICK}/${f}`)) {
  try {
    domainSrc += `
${readFileSync(join(repo, f), 'utf8')}`;
  } catch {
    fail(`${f} could not be read — the tracked domain of chassis behaviours is unreadable, so "every property" ranges over nothing`);
  }
}

if (domainSrc) {
  const domain = [...domainSrc.matchAll(DOMAIN_RE)].map((m) => m[1]);
  if (domain.length < MIN_DOMAIN) {
    fail(`COVERAGE LOST — the domain parse found ${domain.length} chassis behaviour(s) in ${DOMAIN_FILES.join(' + ')}, expected >= ${MIN_DOMAIN}. Either capabilities were deleted, or this guard has stopped seeing them. A scanner that quietly matches less is the failure this repo keeps re-learning.`);
  } else {
    ok(`tracked domain: ${domain.length} chassis behaviour(s) in ${DOMAIN_FILES.length} providers file(s)`);
  }

  checkLegalLinkSet();

  const known = new Set([...Object.keys(COVERED_BY), ...Object.keys(UNASSERTED)]);
  const propertyKeys = new Set(REQUIRED_COVERAGE.map((p) => p.key));

  for (const name of domain) {
    if (COVERED_BY[name]) {
      if (!propertyKeys.has(COVERED_BY[name])) {
        fail(`'${name}' claims coverage by property '${COVERED_BY[name]}', which is not a declared property. A claim pointing at nothing is worse than an admitted gap.`);
      }
      continue;
    }
    if (UNASSERTED[name]) continue;
    fail(
      `NEW CHASSIS BEHAVIOUR '${name}' is in ${DOMAIN_FILES.join(' / ')} but classified nowhere. ` +
        `Every capability a stamped app inherits must either be exercised by a property assertion ` +
        `(add it to COVERED_BY) or be an admitted, dated gap (add it to UNASSERTED with a reason). ` +
        `Shipping it unclassified is how "the lane asserts every property" quietly stopped being true.`,
    );
  }

  // A classification for something that no longer exists is a stale claim, and
  // stale claims inflate apparent coverage exactly like an assertion that
  // cannot fail. Both directions, or the list drifts from the tree.
  const present = new Set(domain);
  for (const name of known) {
    if (!present.has(name)) {
      fail(`'${name}' is classified in this guard but no longer exists in ${DOMAIN_FILES.join(' / ')}. Remove the stale entry — a list that has drifted from the tree stops meaning anything.`);
    }
  }

  const gaps = Object.keys(UNASSERTED).filter((n) => present.has(n));
  if (gaps.length) {
    console.log(`\n⬜ ${gaps.length} chassis behaviour(s) a stamped app does NOT prove about itself:`);
    for (const n of gaps) console.log(`   · ${n} — ${UNASSERTED[n]}`);
    console.log('   (printed, not failed: per the C-16 lock new properties arrive WITH their features.)');
  }
}

// ── [10]D-8 limb (c) · run the update-destination check. ────────────────────
// OUTSIDE the `if (domainSrc)` block on purpose: this limb is about the config
// service and the channel register, not about the chassis's provider domain, and
// an unrelated failure to read a providers file must not be able to skip it.
checkUpdateDestinationIsRepointable();

// ── [13]T-4 · run the boot-path walk. ───────────────────────────────────────
//
// SELF-CHECK FIRST, and it is the one that matters: prove `PERMISSION_ASK_RE`
// can still SEE an OS ask by pointing it at the real implementation. If the
// plugin renames its API, this pattern quietly matches nothing and every app
// reports a clean boot path forever. An absence assertion whose scanner has gone
// blind is indistinguishable from compliance — that is this guard's whole
// subject, and it applies to this guard.
let askRePointsAtSomething = false;
try {
  askRePointsAtSomething = PERMISSION_ASK_RE.test(
    stripDartComments(readFileSync(join(repo, PERMISSION_ASK_PROBE), 'utf8'), { blankStrings: true }),
  );
} catch { /* reported immediately below */ }
if (!askRePointsAtSomething) {
  fail(
    `COVERAGE LOST — the [13]T-4 permission pattern no longer matches any call in ${PERMISSION_ASK_PROBE}, ` +
      'the shared adapter that actually asks the OS. Either the plugin renamed its API or this regex has ' +
      'gone stale; in both cases the boot-path scan below now proves nothing while printing ok.',
  );
}

// And the RUNTIME half this static walk defers to: the brick's own property test
// counts the calls. If that assertion is deleted, the only real measurement of
// the property is gone and the static walk would be all that is left — so the
// deletion must be loud rather than a quiet downgrade.
const BRICK_BOOT_COUNT_RE = /requestPermissionCalls\s*,\s*0\s*,/;
try {
  const brickTest = stripDartComments(readFileSync(join(repo, BRICK, PROP_TEST), 'utf8'));
  if (!BRICK_BOOT_COUNT_RE.test(brickTest)) {
    fail(
      `[13]T-4: ${BRICK}/${PROP_TEST} no longer asserts \`requestPermissionCalls == 0\` after a boot. ` +
        'That is the only RUNTIME measurement of this property in the tree; the static walk below is an ' +
        'over-approximation and cannot replace it.',
    );
  } else {
    ok('[13]T-4 boot ask: the brick property test still counts the calls (runtime limb intact)');
  }
} catch { /* the missing-PROP_TEST case already failed hard above */ }

let bootRootsScanned = 0;
for (const root of bootRoots) {
  if (!existsSync(join(repo, root, 'lib', 'main.dart'))) continue;
  bootRootsScanned++;
  const r = auditBootPath(root);
  if (!r.sawMain) {
    fail(
      `COVERAGE LOST — ${root}/lib/main.dart exists but no \`main()\` DECLARATION could be parsed out of it, ` +
        'so the [13]T-4 boot-path walk started from nothing and would have reported a clean launch path for ' +
        'any code at all.',
    );
    continue;
  }
  for (const v of r.violations) {
    fail(
      `[13]T-4 ${root}: THE LAUNCH PATH SPENDS THE OS PERMISSION ASK — ${v.chain}, in ${v.file}. ` +
        'Android 13+ turns a SECOND denial into USER_FIXED, permanently non-promptable, so a launch-time ' +
        'prompt can burn the return channel for the life of the install. Ask when the user enables a ' +
        'reminder-bearing feature, never before the app has shown any value.',
    );
  }
  if (!r.violations.length) {
    ok(
      `[13]T-4 ${root} — launch path asks for no OS permission ` +
        `(${r.reached} function(s) reached from main() across ${r.files} lib file(s); ` +
        `${UNGESTURED_HOOKS.join('/')} clean)`,
    );
  }

  // Limb C. Deliberately NOT nested under `if (!r.violations.length)`: a tree
  // whose only ask sits on the launch path must read as TWO failures — one ask
  // in the wrong place, and no ask in the right one — because deleting the
  // offending line fixes exactly one of them.
  if (!r.enablePathAsks.length) {
    fail(
      `[13]T-4 ${root}: THE ENABLE PATH NEVER ASKS — ${r.files} lib file(s) contain no call to the OS ` +
        'permission ask outside the launch path, so every reminder-bearing switch in this app is a ' +
        'channel the user can never turn on: the flag persists, the switch reads ON, and no notification ' +
        'can ever be posted because the OS was never asked. The ask\'s own declaration and its delegation ' +
        'to the plugin are NOT callers and do not satisfy this. Limbs A/B above go GREENER as this one ' +
        'goes red — that opposition is the point: "never at launch" and "somewhere on the enable path" ' +
        'are both required, and until this limb existed only the first was checked.',
    );
  } else {
    ok(
      `[13]T-4 ${root} — the enable path asks: ${r.enablePathAsks.length} call site(s) outside the ` +
        `launch path (${r.enablePathAsks.map((a) => `${a.file}:${a.line}`).join(', ')})`,
    );
  }
}
// Zero and one must not read the same. The exempt app is on this list precisely
// because it is the one that shipped the defect, so an empty scan is a red flag.
if (bootRootsScanned === 0 && workspaceRead) {
  fail(
    'COVERAGE LOST — the [13]T-4 boot-path walk found no `lib/main.dart` under any root, so it audited ' +
      'nothing. On a real checkout the brick template alone guarantees one.',
  );
} else {
  console.log(`ok   [13]T-4 boot-path walk covered ${bootRootsScanned} app root(s): ${bootRoots.join(', ')}`);
}

// Limbs of a declared property that cannot be exercised where the property
// lives, printed on EVERY run. The count is printed too: zero and one read
// identically once the loop has nothing to iterate, which is exactly how
// `missingMethods` spent its whole life unvalidated next door.
console.log(
  `\n⬜ ${propertyGaps.size} property limb(s) that cannot be exercised in the stamp:`,
);
for (const g of propertyGaps) console.log(`   · ${g}`);

if (failed) {
  console.error('\nassert-stamp-properties: FAILED');
  process.exitCode = 1;
} else {
  // The skipped count is INSIDE the ok line, not beside it. Before 2026-08-25
  // this sentence ended at the root list, and a reader could take "ok" for
  // "everything was graded" while the only shipped app was not in it.
  console.log(
    `\nassert-stamp-properties: ok — ${REQUIRED_COVERAGE.length} property/properties enforced across ` +
      `${rootsAudited} root(s): ${roots.join(', ')} — and ${EXEMPT_APPS.size} app root(s) NOT GRADED ` +
      `(EXEMPT_APPS: ${[...EXEMPT_APPS.keys()].join(', ')})`,
  );
}
