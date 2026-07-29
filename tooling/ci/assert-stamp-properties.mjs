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
// invisible here. Adding `onboardingSeenProvider` to the real template changed
// nothing. So "every" now has a TRACKED DOMAIN (see DOMAIN_FILE below): the
// chassis behaviours are read out of the template itself, and each one must be
// classified — either covered by a named property, or listed as a dated,
// reasoned gap. A behaviour in neither FAILS THE BUILD. That is what makes the
// word "every" mean something a person cannot quietly shrink.
//
// The domain is deliberately ONE file, `lib/state/providers.dart` — the surface
// every stamped app inherits its capabilities through. It does NOT cover widgets
// in app.dart or features/; those are anchored individually by `source` above.
// Naming the limit here so nobody reads this guard as broader than it is.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.cwd();
let failed = false;
const fail = (m) => { console.error(`FAIL ${m}`); failed = true; };
const ok = (m) => console.log(`ok   ${m}`);

const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
const PROP_TEST = `${BRICK}/test/chassis_properties_test.dart`;
const APP_ROOT = `${BRICK}/lib/app.dart`;
const PROVIDERS = `${BRICK}/lib/state/providers.dart`;
const SETTINGS = `${BRICK}/lib/features/settings/settings_screen.dart`;
const ROUTER = `${BRICK}/lib/core/router.dart`;
const SCAFFOLD = 'packages/design_system/lib/src/widgets/app_scaffold.dart';

// REQUIRED_COVERAGE. Each entry is a property the stamped app must assert about
// itself. `group` is the marker the test file must declare; `sources` are the
// lines in the app that the property is about, so a deleted implementation is
// caught even if somebody leaves a hollow test behind.
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
    key: 'ui-invariants-inherited',
    group: /group\(\s*'property: ui-invariants-inherited'/,
    sources: [
      { file: APP_ROOT, re: /MediaQuery\.withClampedTextScaling\(/, what: 'app.dart must clamp text scaling at the root — unbounded scaling overflows, and an overflowing screen is one the user cannot finish' },
      { file: SCAFFOLD, re: /static const double medium = 600;/, what: 'AppScaffold must use Material’s 600 boundary — it was 640, so every window 600–639 got the phone layout' },
      { file: SCAFFOLD, re: /enum WindowClass \{\s*compact,\s*medium,\s*expanded,\s*large,\s*extraLarge\s*\}/, what: 'all FIVE Material window classes must exist — the tree covered three' },
    ],
    why: 'these are near-free in the chassis and near-impossible to retrofit across 50 shipped apps',
  },
  {
    key: 'auth-seam-wired',
    group: /group\(\s*'property: auth-seam-wired'/,
    sources: [
      { file: PROVIDERS, re: /final Provider<core\.AuthRepository> authRepositoryProvider/, what: 'the brick must wire an AuthRepository — before C-15 it wired none, so every stamped app was born unable to sign anyone in' },
      // NOT just `tokenProvider:` — the acceptance is that it reaches the SHARED
      // client, so both halves are anchored.
      { file: PROVIDERS, re: /tokenProvider:\s*ref\.watch\(authTokenProvider\)/, what: 'the token provider must reach the shared RestClient, or the app authenticates and no request ever carries a token' },
      { file: 'packages/auth_supabase/lib/nikatru_auth_supabase.dart', re: /localStorage:\s*SecureSessionStorage\(/, what: 'the session must go in the SECURE store — the Supabase SDK defaults to plaintext shared_preferences for the access AND refresh tokens [G-43]' },
    ],
    why: 'the auth seam had no home: the only implementations lived inside apps/subly, and the brick wired no auth and no tokenProvider',
  },
  {
    key: 'auth-redirect-follows-session',
    group: /group\(\s*'property: auth-redirect-follows-session'/,
    sources: [
      // The join that was missing. `redirect:` alone was present the whole time
      // the app was unusable, so anchoring on the guard would assert nothing.
      { file: ROUTER, re: /refreshListenable:\s*ref\.watch\(authRefreshProvider\)/, what: 'the router must be TOLD when the session changes — redirect re-runs on navigation, not on a session appearing, so signing in left the user on the form they had just completed' },
      { file: PROVIDERS, re: /class AuthRefreshNotifier extends ChangeNotifier/, what: 'the auth stream must be bridged to a Listenable — without it refreshListenable has nothing to listen to' },
      { file: PROVIDERS, re: /_sub\s*=\s*changes\.listen\(/, what: 'the notifier must actually SUBSCRIBE to authStateChanges — a ChangeNotifier that never fires is indistinguishable from no refresh at all' },
    ],
    why: 'a stamped app signed the user in and went on showing them the sign-in form; the seam and the guard both worked and nothing joined them',
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
    ],
    why: 'both stores require a WORKING in-app deletion path wherever an account can be created',
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
    ],
    why: 'a toggle that reads ON while every notification is dropped is the C-6 shape',
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
    sources: [{ file: PROVIDERS, re: /ConsentPurpose\.analytics\s*,[\s\S]{0,200}?granted:\s*granted/, what: 'the template must really call ConsentController.record' }],
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
];

// ── THE TRACKED DOMAIN — what "every" ranges over. ──────────────────────────
// Read out of the template, not typed here, so the set grows when the chassis
// grows. Every top-level `*Provider` in this file is a capability a stamped app
// inherits; each must appear in COVERED_BY or UNASSERTED below, or the build
// fails with the provider's name in the message.
const DOMAIN_FILE = PROVIDERS;
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
const MIN_DOMAIN = 26;

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
  // Driven, not merely constructed: the property signs in through the real form
  // and asserts the user ends up somewhere else.
  authRefreshProvider: 'auth-redirect-follows-session',
  remindersEnabledProvider: 'reminder-intent-persisted',
  notificationServiceProvider: 'reminder-intent-persisted',
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
};

// Dated, reasoned gaps. NOT an excuse list — it is the honest inventory of what
// a stamped app does NOT currently prove about itself, printed on every run so
// it stays uncomfortable. Per the C-16 lock, new properties arrive WITH their
// features; nothing here is to be invented to empty the list.
const UNASSERTED = {
  configTransportProvider: '2026-07-28 · CFG-1 config resolution has no stamped-app property; a stamp cannot prove network → last-good → default actually degrades in that order',
  configLoaderProvider: '2026-07-28 · as above — the fallback chain is unit-tested in core, never asserted on a stamped app',
  appConfigProvider: '2026-07-28 · as above',
  packageVersionProvider: '2026-07-28 · force-update input; returns null in widget tests by design, so a stamped-app assertion needs a seam that does not exist yet',
  mustForceUpdateProvider: '2026-07-28 · the force-update kill-switch. NOTHING proves the update wall appears on a stamped app — and this is the switch that was inert for 55 builds',
  secureStoreProvider: '2026-07-28 · no stamped-app property; the secure store needs a platform channel a widget test has not got',
  featureFlagsProvider: '2026-07-28 · rollout bucketing is unasserted in the stamp; core tests the maths, nothing tests that a stamped app buckets',
  entitlementCacheProvider: '2026-07-28 · BLOCKED — the paid path is stage 5. C-6 routed the entitlement instance there rather than half-build it',
  analyticsConsentProvider: '2026-07-28 · the UI-facing read; consentDecidedProvider is the limb the property test drives, and it is the one that decides whether to prompt',
};

let test;
try {
  test = readFileSync(join(repo, PROP_TEST), 'utf8');
} catch {
  fail(`${PROP_TEST} is MISSING. Every stamped app inherits its property assertions from this file; without it a stamped app asserts nothing about its own behaviour.`);
  console.error('\nassert-stamp-properties: FAILED');
  process.exit(1);
}

// COVERAGE SELF-CHECK. A file that still exists but has been emptied of tests
// would satisfy every `group` regex below only if they were also removed — but a
// file gutted down to one token would otherwise pass the "exists" check alone.
const blocks = (test.match(/\b(?:test|testWidgets)\(/g) ?? []).length;
const MIN_BLOCKS = 12;
if (blocks < MIN_BLOCKS) {
  fail(`COVERAGE LOST — ${PROP_TEST} declares only ${blocks} test block(s), expected >= ${MIN_BLOCKS}. The file exists but has stopped asserting.`);
} else {
  ok(`property test declares ${blocks} assertion block(s)`);
}

for (const p of REQUIRED_COVERAGE) {
  if (!p.group.test(test)) {
    fail(`property '${p.key}' is NOT asserted in ${PROP_TEST} — ${p.why}`);
    continue;
  }
  const sources = p.sources ?? [];
  let anchored = true;
  for (const s of sources) {
    let src = '';
    try {
      src = readFileSync(join(repo, s.file), 'utf8');
    } catch {
      fail(`property '${p.key}': ${s.file} could not be read`);
      anchored = false;
      break;
    }
    if (!s.re.test(src)) {
      fail(`property '${p.key}' is asserted but its IMPLEMENTATION is gone — ${s.what}`);
      anchored = false;
      break;
    }
  }
  if (!anchored) continue;
  if (sources.length === 0) {
    // Refused deliberately: an unanchored property is a test heading that
    // survives its own feature's deletion. That was hole 1.
    fail(`property '${p.key}' has NO source anchor — it would still pass with the feature deleted`);
    continue;
  }
  ok(`property '${p.key}' asserted and implemented (${sources.length} anchor${sources.length > 1 ? 's' : ''})`);
}

// ── "EVERY" — the domain check. ─────────────────────────────────────────────
let domainSrc = '';
try {
  domainSrc = readFileSync(join(repo, DOMAIN_FILE), 'utf8');
} catch {
  fail(`${DOMAIN_FILE} could not be read — the tracked domain of chassis behaviours is unreadable, so "every property" ranges over nothing`);
}

if (domainSrc) {
  const domain = [...domainSrc.matchAll(DOMAIN_RE)].map((m) => m[1]);
  if (domain.length < MIN_DOMAIN) {
    fail(`COVERAGE LOST — the domain parse found ${domain.length} chassis behaviour(s) in ${DOMAIN_FILE}, expected >= ${MIN_DOMAIN}. Either capabilities were deleted, or this guard has stopped seeing them. A scanner that quietly matches less is the failure this repo keeps re-learning.`);
  } else {
    ok(`tracked domain: ${domain.length} chassis behaviour(s) in ${DOMAIN_FILE}`);
  }

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
      `NEW CHASSIS BEHAVIOUR '${name}' is in ${DOMAIN_FILE} but classified nowhere. ` +
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
      fail(`'${name}' is classified in this guard but no longer exists in ${DOMAIN_FILE}. Remove the stale entry — a list that has drifted from the tree stops meaning anything.`);
    }
  }

  const gaps = Object.keys(UNASSERTED).filter((n) => present.has(n));
  if (gaps.length) {
    console.log(`\n⬜ ${gaps.length} chassis behaviour(s) a stamped app does NOT prove about itself:`);
    for (const n of gaps) console.log(`   · ${n} — ${UNASSERTED[n]}`);
    console.log('   (printed, not failed: per the C-16 lock new properties arrive WITH their features.)');
  }
}

if (failed) {
  console.error('\nassert-stamp-properties: FAILED');
  process.exitCode = 1;
} else {
  console.log(`\nassert-stamp-properties: ok — ${REQUIRED_COVERAGE.length} property/properties enforced`);
}
