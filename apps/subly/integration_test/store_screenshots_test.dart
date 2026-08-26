// Subly — STORE LISTING screenshot capture.
//
// Drives the REAL widget tree and photographs it. Separate from
// `app_test.dart` on purpose: that suite exists to FAIL when the product is
// broken, this one exists to PRODUCE an artefact, and merging them would mean a
// listing asset silently changing whenever somebody re-ordered an assertion.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE POSTURE ASSERTION BELOW IS THE POINT OF THIS FILE.
//
// Until 2026-08-04 every store build of this app was a DEMO build (fixed in
// #150). A demo build is not a cosmetic difference from the shipping app — it
// is a DIFFERENT APP on screen, in two ways that both make a screenshot of it
// unusable as a listing asset:
//
//   1. `app_shell.dart` paints a permanent banner across the top of every
//      screen reading "Demo data - sample subscriptions, not your account".
//      It is shown exactly when `!AppConfig.isApiConfigured`. A store listing
//      carrying that banner advertises the app as a demo.
//
//   2. `lib/data/seed/demo_data.dart` seeds twelve subscriptions named after
//      real companies — Netflix, Spotify, Disney+, Adobe CC, 1Password and
//      friends. Google's own preview-asset page tells developers to avoid
//      "Third-party trademarked characters or logos without proper permission",
//      and [ADR 019]'s NO-IP rule forbids steering any generated asset toward
//      existing IP. Those names exist to make the demo feel real to a developer;
//      putting them on a public store listing is a different act entirely.
//
// Neither is visible to a user of the shipping build, so a demo screenshot
// misrepresents the product in both directions at once. The suite therefore
// REFUSES to run against a demo build unless the caller has explicitly asked
// for a mechanism proof, and the runner script sends proof output to a throwaway
// directory that is not the listing directory. See
// tooling/store/capture-play-screenshots.mjs.
// ─────────────────────────────────────────────────────────────────────────────
//
// 🔴 THE SECOND POSTURE QUESTION, ADDED 2026-08-05: WHOSE ACCOUNT IS ON SCREEN.
//
// This suite used to end by tapping "More" and photographing SettingsScreen as
// `05-settings`. That screen renders the signed-in address at the top of the
// account card in large legible type, and the capture signs in as the throwaway
// end-to-end account — so the frame read `subly-e2e+…@nikatru.com`, an internal
// test address on a public marketing asset. It was caught by a human opening the
// PNG; `assert-listing-assets.mjs` had passed it, because it decodes pixels and
// no guard in this tree can read TEXT in an image.
//
// The frame is gone (see "the set, in listing order" below) and every remaining
// capture goes through `captureFrame` in `store_capture_guard.dart`, which
// refuses to release the shutter while the session's own identity is anywhere in
// the widget tree. Removing the frame alone would have fixed today; the refusal
// is what stops the next frame — of a screen nobody has audited, or on a local
// run signed in as a real person — from doing it again.
//
// Run through the runner, never by hand:
//   node tooling/store/capture-play-screenshots.mjs           # live, shippable
//   node tooling/store/capture-play-screenshots.mjs --proof   # demo, throwaway

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'package:subly/core/app_config.dart';
import 'package:subly/core/e2e_keys.dart';
import 'package:subly/data/auth/auth_models.dart';
import 'package:subly/features/auth/legal_consent_fields.dart';
import 'package:subly/features/auth/reaccept_terms_screen.dart';
import 'package:subly/features/budget/budget_screen.dart';
import 'package:subly/features/calendar/calendar_screen.dart';
import 'package:subly/features/home/home_screen.dart';
import 'package:subly/features/insights/insights_screen.dart';
import 'package:subly/features/shell/app_shell.dart';
import 'package:subly/main.dart' as app;
import 'package:subly/state/providers.dart';

import 'store_capture_guard.dart';

/// Illustrative subscriptions created through the app's OWN "Add subscription"
/// sheet, so nothing on screen is a capability the shipping app does not have.
///
/// 🔴 GENERIC BY CONSTRUCTION, and that is a policy requirement rather than
/// taste. Every name here is a plain description of a service category, so the
/// listing carries no third-party trademark — the rule Google states on its
/// preview-asset page and [ADR 019] states for every generated asset. The
/// prices are round illustrative figures, not any real company's tariff.
const List<List<String>> kIllustrative = <List<String>>[
  <String>['Video streaming', '15.99'],
  <String>['Music streaming', '10.99'],
  <String>['Cloud storage', '2.99'],
  <String>['AI assistant', '20.00'],
  <String>['Fitness club', '39.00'],
  <String>['News digest', '4.50'],
];

void main() {
  final IntegrationTestWidgetsFlutterBinding binding =
      IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  const String email = String.fromEnvironment('E2E_EMAIL');
  const String password = String.fromEnvironment('E2E_PASSWORD');

  /// The mechanism-proof escape hatch. Absent (the default) a demo build is a
  /// hard failure — which is what stops a demo capture ever becoming a listing
  /// asset by accident.
  const bool allowDemo = bool.fromEnvironment('STORE_CAPTURE_ALLOW_DEMO');

  // The app animates forever in places (the scan progress ring), so
  // pumpAndSettle() hangs. Advance a fixed wall-clock slice instead — this still
  // lets real network futures resolve on the live binding.
  Future<void> pumpFor(WidgetTester tester, Duration total) async {
    final DateTime end = DateTime.now().add(total);
    while (DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  Future<bool> waitFor(
    WidgetTester tester,
    Finder f, {
    Duration timeout = const Duration(seconds: 15),
  }) async {
    final DateTime end = DateTime.now().add(timeout);
    while (DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 200));
      if (f.evaluate().isNotEmpty) return true;
    }
    return false;
  }

  /// [waitFor]'s twin, for an ABSENCE.
  ///
  /// ⚠️ Used to wait, never to conclude. A poll that returns on the first
  /// matching frame can be satisfied by a state the app is merely passing
  /// THROUGH — the shape that let the nightly E2E pass on a transiting login
  /// screen for weeks (`test/sign_out_destination_test.dart`, and the note at
  /// `settings_screen.dart:896`). Every destination assertion below is made
  /// after this returns AND after a further fixed settle, never on first sight.
  Future<bool> waitGone(
    WidgetTester tester,
    Finder f, {
    Duration timeout = const Duration(seconds: 10),
  }) async {
    final DateTime end = DateTime.now().add(timeout);
    while (DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 200));
      if (f.evaluate().isEmpty) return true;
    }
    return false;
  }

  /// WHAT IS ON SCREEN, for a failure message that would otherwise only say
  /// what is NOT.
  ///
  /// `findsNothing`-style failures name the missing widget and stop, so
  /// `Found 0 widgets with text "Welcome back"` reads identically whether the
  /// app is still in the carousel (the tap was swallowed), on an interstitial
  /// (a gate fired) or on `NotFoundScreen` (a redirect loop). Those need three
  /// different fixes, and this lane produces one data point every few weeks —
  /// so the run page has to tell them apart on its own. Copied in spirit from
  /// `app_test.dart`, which added it for the same reason.
  String onScreen(WidgetTester tester) {
    final Iterable<String> texts = tester
        .widgetList<Text>(find.byType(Text))
        .map((Text t) => t.data ?? '')
        .where((String s) => s.trim().isNotEmpty)
        .take(25);
    return texts.isEmpty ? '(no Text widgets in the tree)' : texts.join(' | ');
  }

  // 🔴 THERE IS NO `shot(name)` WRAPPER ANY MORE, AND ITS ABSENCE IS LOAD-
  // BEARING. Every frame below calls `captureFrame` directly, on the line after
  // the `find.byType(...)` that says WHICH SCREEN it is photographing. That is
  // what lets `tooling/ci/assert-listing-assets.mjs` — which runs on every push,
  // long before any capture — resolve each frame to the screen source it
  // photographs and fail the build if that screen renders the account address.
  // Behind a one-line wrapper there is exactly one call site and the static
  // association collapses to nothing, which is a scan over nothing printing ok.
  //
  // `binding.takeScreenshot` is passed as a TEAR-OFF, never called here: the
  // same guard fails on any direct `takeScreenshot(` in this file, so a second
  // unguarded shutter cannot be added by writing the obvious line.

  testWidgets('captures the Play phone screenshot set', (
    WidgetTester tester,
  ) async {
    // ── the posture gate ─────────────────────────────────────────────────────
    expect(
      AppConfig.isBackendLive || allowDemo,
      isTrue,
      reason:
          'This build is a DEMO build (isBackendLive == false) and no '
          'STORE_CAPTURE_ALLOW_DEMO was passed. A demo build paints the "Demo '
          'data - sample subscriptions, not your account" banner over every '
          'screen and seeds twelve third-party trademarks, so its screenshots '
          'cannot go on a store listing. Pass the live dart-defines, or run the '
          'runner with --proof if you only mean to exercise the mechanism.',
    );

    await app.main();
    await pumpFor(tester, const Duration(seconds: 3));

    // The DPDP analytics-consent prompt opens over the first live launch. It is
    // answered rather than waited out: an opaque scrim swallows every tap aimed
    // at the app beneath it SILENTLY, so leaving it up would make the next
    // failure blame the wrong widget (six lost nightlies, see app_test.dart).
    // "No thanks" on purpose — capturing a listing must not point a stream of
    // analytics events at production.
    //
    // 🔴 IT IS FOUND BY ITS ANSWER CONTROL, NOT BY A WIDGET TYPE — AND THIS
    // LINE COST RUN 32947223120 (2026-08-26), THE SECOND RUN THIS LANE HAS EVER
    // HAD. It polled `find.byType(Dialog)`, which was correct on 2026-08-04
    // when the prompt was `ConsentGate`, a `showDialog` ROUTE — the only day
    // this lane had ever run. Four days later #217 (P2.6a) replaced it with the
    // stamped `_ConsentPrompt` in `app.dart`: `Positioned.fill` + opaque
    // `ColoredBox` inside `MaterialApp.builder`, which is ABOVE the router's
    // Navigator, where `showDialog` has no Navigator to push onto. It is not a
    // route and it is not a `Dialog`. So this poll timed out with the prompt
    // plainly on screen, the block was SKIPPED, the scrim ate `tap('Skip')`,
    // and the suite failed eleven lines down with `Found 0 widgets with text
    // "Welcome back"` — a login-screen error for a consent-prompt problem.
    //
    // 🔬 THE THIRD TIME THIS EXACT CLASS LANDED, and the fix already existed.
    // `app_test.dart` hit it on 2026-07-27 and again on 2026-08-08, and #236
    // ("consent helpers see the inline prompt (the outage class, recurring)")
    // corrected ITS helpers on 2026-08-09 to key on the decline control. This
    // file was not touched by that fix and kept the stale detector for 18 days,
    // invisible because the lane never ran. The decline control is the right
    // thing to key on: it is the affordance this suite actually uses, it exists
    // in BOTH shapes, and it survives the prompt being restyled or re-parented.
    //
    // Reproduced without a device, and now guarded on every push, by
    // `test/first_run_destination_test.dart`.
    final Finder consentDecline = find.text('No thanks');
    if (await waitFor(
      tester,
      consentDecline,
      timeout: const Duration(seconds: 10),
    )) {
      // A second opinion, not the detector: the prompt this suite knows carries
      // both answers, equally weighted — itself the DPDP dark-pattern rule the
      // app is keeping.
      expect(
        find.text('Allow'),
        findsWidgets,
        reason:
            'Something offering "No thanks" came up on first launch but it does '
            'not also offer "Allow" — that is not the consent prompt, and this '
            'suite only knows how to answer that one.',
      );
      await tester.tap(consentDecline.first);
      await pumpFor(tester, const Duration(seconds: 2));
      expect(
        await waitGone(tester, consentDecline),
        isTrue,
        reason:
            'The consent prompt did not close after "No thanks" was tapped. It '
            'is an inline scrim over the whole app (app.dart `_ConsentPrompt`), '
            'so until it goes every tap beneath it is swallowed silently and '
            'every frame below would photograph it.',
      );
    }

    // ── onboarding → login → scan → dashboard ────────────────────────────────
    expect(
      find.text('Skip'),
      findsOneWidget,
      reason: 'App did not land on the onboarding screen',
    );
    // 🔴 PRESENCE IS NOT REACHABILITY, AND THE GAP BETWEEN THEM IS THE WHOLE
    // SILENT FAILURE. The carousel is BUILT underneath a scrim, so the check
    // above passes in exactly the state that defeats the tap below. This limb
    // asks the only question that matters — would a finger get there — and it
    // needs to know nothing about what is doing the covering, which is why it
    // is the one that survives the next time the modal changes shape. That
    // shape-independence is the lesson `app_test.dart` wrote down after this
    // class of failure got through a type-based guard twice.
    expect(
      find.text('Skip').hitTestable(),
      findsOneWidget,
      reason:
          'Something is drawn over the app: a tap aimed at "Skip" would NOT '
          'reach it and would be swallowed silently, so the next assertion '
          'would blame the login screen. On screen: ${onScreen(tester)}',
    );
    await tester.tap(find.text('Skip'));

    // ── ASSERTED AFTER A SETTLE, NEVER ON FIRST SIGHT ────────────────────────
    // `waitGone` is the WAIT (bounded, so a swallowed tap fails here rather
    // than eleven lines later); the fixed pump after it is the SETTLE; the
    // assertion comes last. A poll that returned the first time "Welcome back"
    // matched could be satisfied by a frame the app was transiting — the shape
    // that hid a real regression for weeks (sign_out_destination_test.dart).
    await waitGone(tester, find.text('Skip'));
    await pumpFor(tester, const Duration(seconds: 2));

    expect(
      find.text('Welcome back'),
      findsOneWidget,
      reason:
          'Skip did not settle on the login form. The string is not missing — '
          '`welcomeBack` renders at login_screen.dart:371 whenever LoginScreen '
          'is mounted — so the app is somewhere else. On screen: '
          '${onScreen(tester)}',
    );
    // Hoisted out of the `enterText` call because the capture guard needs the
    // SAME string: what this suite types is, by definition, the address the
    // frames below would carry.
    final String signInEmail = email.isEmpty ? 'demo@nikatru.com' : email;
    await tester.enterText(find.byKey(E2EKeys.loginEmail), signInEmail);
    await tester.enterText(
      find.byKey(E2EKeys.loginPassword),
      password.isEmpty ? 'demo-password' : password,
    );
    await pumpFor(tester, const Duration(milliseconds: 500));
    await tester.tap(find.byKey(E2EKeys.loginSubmit));
    await pumpFor(tester, const Duration(seconds: 10));

    // ── the re-acceptance interstitial, walked through, NEVER photographed ───
    //
    // 🔴 THE CAPTURE USER HAS NO CLICKWRAP RECORD. It is minted through the
    // Supabase ADMIN API (`tooling/e2e/provision_user.mjs`), which never shows
    // anybody a consent screen, so the router's gate parks it here after every
    // sign-in and nothing below this line is reachable until it is answered.
    // Without this the whole capture lane stops at a legal interstitial and the
    // failure reads as "sign-in failed", which it is not.
    //
    // ⚠️ NO `captureFrame` HERE, DELIBERATELY. This is a legal gate, not a
    // product surface: photographing it would put a terms-acceptance screen in
    // a store listing's phone set. Conditional for the same reason every other
    // step in this suite is — the browser profile can carry an acceptance from
    // an earlier run.
    if (find.byKey(ReacceptTermsScreen.acceptButton).evaluate().isNotEmpty) {
      await tester.tap(find.byKey(LegalConsentFields.termsCheckbox));
      await pumpFor(tester, const Duration(milliseconds: 300));
      await tester.tap(find.byKey(ReacceptTermsScreen.acceptButton));
      await pumpFor(tester, const Duration(seconds: 6));
      expect(
        find.byKey(ReacceptTermsScreen.acceptButton),
        findsNothing,
        reason:
            'accepting the terms did not move the capture past the '
            'interstitial, so every frame below would photograph it',
      );
    }

    expect(
      find.text('Go to dashboard'),
      findsOneWidget,
      reason:
          'Scan never finished — sign-in likely failed (bad or unconfirmed '
          'credentials, or the backend is down)',
    );
    await tester.tap(find.text('Go to dashboard'));
    await pumpFor(tester, const Duration(seconds: 4));
    expect(find.byType(AppShell), findsOneWidget);

    // ── who is on screen, asked of the app rather than of the harness ────────
    // The session is read out of the running ProviderScope, so the forbidden set
    // describes the account the APP holds — not the one this file was written
    // against. Both are added: if they ever disagree, the capture is signed in
    // as somebody it did not mean to be, and both strings are refused anyway.
    final ProviderContainer container = ProviderScope.containerOf(
      tester.element(find.byType(AppShell)),
      listen: false,
    );
    final AuthUser? session = container
        .read(authRepositoryProvider)
        .currentUser;
    final Set<String> forbidden = accountIdentityNeedles(
      signedInWith: signInEmail,
      account: session,
      // ⚠️ THE REASON THIS LINE USED TO GIVE WAS FALSE, AND THE LINE IS STILL
      // RIGHT. It said a demo build's profile name is `Alex Rivera` from
      // MockAuthRepository. It is not: this lane resolves the chassis
      // `InMemoryAuthRepository` like every other non-live posture, and that
      // identity carries NO displayName at all until `updateProfile` gives it
      // one — so there is no demo profile name on any frame, fictional or
      // otherwise. Keeping the limb off for a demo build is still correct, and
      // now for a reason that is true: with no name on the session there is
      // nothing for the profile limb to search for, and asserting over an empty
      // needle is the unfailable check this file's own `isNotEmpty` guard
      // below exists to refuse. The ADDRESS limbs stay on in both postures;
      // see store_capture_guard.dart.
      includeProfileName: AppConfig.isBackendLive,
    );
    expect(
      forbidden,
      isNotEmpty,
      reason:
          'The capture guard would have nothing to look for, so every frame '
          'below would be examined for nothing and pass.',
    );

    // ── seed the board through the app's own create flow ─────────────────────
    // 🔴 THROUGH THE UI, NOT THROUGH THE API. A screenshot showing rows that
    // were injected by a test double would be showing a state the app cannot
    // actually reach. Every row below is typed into the real "Add subscription"
    // sheet and POSTed by the real client, so the board in the picture is a
    // board a user can produce.
    //
    // Skipped on a demo build: SeedApiClient already holds twelve rows, and
    // adding to them proves nothing. A demo capture is a mechanism proof.
    if (AppConfig.isBackendLive) {
      for (final List<String> row in kIllustrative) {
        await tester.tap(find.byKey(E2EKeys.fabAdd));
        await pumpFor(tester, const Duration(seconds: 2));
        await tester.enterText(find.byKey(E2EKeys.addName), row[0]);
        await tester.enterText(find.byKey(E2EKeys.addPrice), row[1]);
        await pumpFor(tester, const Duration(milliseconds: 400));
        await tester.tap(find.byKey(E2EKeys.addSubmit));
        await pumpFor(tester, const Duration(seconds: 6));
      }
      expect(
        find.text(kIllustrative.first[0]),
        findsWidgets,
        reason:
            'The illustrative rows did not round-trip to Home, so the capture '
            'would photograph an empty board and call it the product.',
      );
    }

    // ── the set, in listing order ────────────────────────────────────────────
    // Play shows screenshots in UPLOAD ORDER and the order is part of the
    // listing, so the number is the listing's rather than the filesystem's.
    // Google: "prioritize UI in the first three screenshots as much as
    // possible" — Home, Calendar and Insights lead for that reason.
    //
    // FOUR FRAMES, NOT FIVE. `tooling/channel-register.json` sets `minCount: 2`
    // and `recommendedCount: 4`, so four satisfies both Play's publish minimum
    // and its large-format recommendation threshold — the fifth frame cost
    // nothing to stop taking. What it cost to KEEP was an internal address on a
    // public listing; see the header.
    await pumpFor(tester, const Duration(seconds: 2));
    expect(find.byType(HomeScreen), findsWidgets);
    await captureFrame(
      take: binding.takeScreenshot,
      frame: '01-home',
      forbidden: forbidden,
    );

    await tester.tap(find.text('Calendar'));
    await pumpFor(tester, const Duration(seconds: 3));
    expect(find.byType(CalendarScreen), findsWidgets);
    await captureFrame(
      take: binding.takeScreenshot,
      frame: '02-calendar',
      forbidden: forbidden,
    );

    await tester.tap(find.text('Insights'));
    await pumpFor(tester, const Duration(seconds: 3));
    expect(find.byType(InsightsScreen), findsWidgets);
    await captureFrame(
      take: binding.takeScreenshot,
      frame: '03-insights',
      forbidden: forbidden,
    );

    await tester.tap(find.text('Budget'));
    await pumpFor(tester, const Duration(seconds: 4));
    expect(find.byType(BudgetScreen), findsWidgets);
    await captureFrame(
      take: binding.takeScreenshot,
      frame: '04-budget',
      forbidden: forbidden,
    );

    // 🔴 SETTINGS IS NOT PHOTOGRAPHED, AND THIS COMMENT IS THE RECORD OF WHY.
    //
    // The capture used to end here with `tap('More')` → `05-settings`.
    // `SettingsScreen` renders `user?.email` at the top of the account card in
    // 13pt type, and this suite is signed in as the throwaway end-to-end
    // account, so the frame carried `subly-e2e+…@nikatru.com` onto a public
    // marketing asset. That frame was pulled from the published set by hand on
    // 2026-08-05, which fixed the four bytes already committed and NOTHING about
    // the next run: the address is not baked into the PNG, it is whoever signed
    // in. Re-running reproduced it exactly.
    //
    // Two candidate fixes were rejected. A "display-safe" account address still
    // puts an address on the listing and, worse, is only safe while nobody
    // changes the provisioner or runs the live lane locally with their own
    // credentials — and no assertion downstream can read the pixels to notice.
    // Masking the account row at capture time would publish a screenshot of a UI
    // state the app never shows, which is a different and worse problem than the
    // one being fixed: Google requires screenshots to "demonstrate the actual
    // in-app or in-game experience".
    //
    // So the screen is simply not photographed. Nothing about the remaining four
    // frames is staged, masked or edited — they are exactly what the app draws.
    // Re-adding a Settings frame is a build failure, not a review comment:
    // assert-listing-assets.mjs resolves every `captureFrame` above to the
    // screen its `find.byType` names and fails if that source reads `.email`.
  });
}
