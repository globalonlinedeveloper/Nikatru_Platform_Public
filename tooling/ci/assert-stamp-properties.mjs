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
// behaviour nobody classified" now uses a name that is not a real capability.) So "every" now has a TRACKED DOMAIN (see DOMAIN_FILE below): the
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
const MAIN = `${BRICK}/lib/main.dart`;
const SCAFFOLD = 'packages/design_system/lib/src/widgets/app_scaffold.dart';
// The stamped Worker's half of G2. Only present on a needs_backend stamp; the
// mustache section IS the directory name on disk, so this path resolves in the
// brick source even though it vanishes from a client-only stamp.
const ACCOUNT_ROUTE =
  'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/src/routes/account.ts';

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
const MIN_DOMAIN = 32;

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
function stripDartComments(src) {
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
        if (!isRaw && src[j] === '\\') { out += src.slice(j, j + 2); j += 2; continue; }
        if (src[j] === q && (!triple || (src[j + 1] === q && src[j + 2] === q))) {
          out += src.slice(j, j + closeLen);
          j += closeLen;
          break;
        }
        // an unterminated single-quoted string cannot cross a line
        if (!triple && src[j] === '\n') { out += '\n'; j++; break; }
        out += src[j]; j++;
      }
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

let test;
try {
  test = stripDartComments(readFileSync(join(repo, PROP_TEST), 'utf8'));
} catch {
  fail(`${PROP_TEST} is MISSING. Every stamped app inherits its property assertions from this file; without it a stamped app asserts nothing about its own behaviour.`);
  console.error('\nassert-stamp-properties: FAILED');
  process.exit(1);
}

// COVERAGE SELF-CHECK. A file that still exists but has been emptied of tests
// would satisfy every `group` regex below only if they were also removed — but a
// file gutted down to one token would otherwise pass the "exists" check alone.
// Counted over the COMMENT-STRIPPED source: `// testWidgets(` is not a test.
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
