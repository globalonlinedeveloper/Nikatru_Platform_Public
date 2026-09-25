import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/settings/settings_screen.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/width_harness.dart';

/// `SettingsView` and `EditProfileDialog`.
///
/// 🏗️ The widget halves of `property: account-deletion-works`,
/// `profile-edit-works` and `locale-actually-switches`. Every one of those
/// properties' assertions about what the app DOES — the seam call, the written
/// preference, the identity stream — is a wiring half and stays in the brick's
/// `chassis_properties_test.dart`. What is measured here is the SURFACE: that
/// the control exists, that it is gated on a session where it must be, and that
/// it reports the value it was handed rather than the last one it saw.
void main() {
  // A window wider than the page cap, so the cap can be proved to ENGAGE rather
  // than merely to equal the window. Deliberately NOT `kWide` in the harness:
  // the responsive guard harvests `const Size k…` from that file and would then
  // require this width of every chassis surface.
  const Size wideDesktop = Size(1920, 1080);

  Widget view({
    SettingsProfile? profile,
    bool hasSession = true,
    bool remindersAvailable = true,
    bool remindersEnabled = false,
    bool analyticsGranted = false,
    bool promoObjected = false,
    bool promoObjectionKnown = true,
    ThemeMode themeMode = ThemeMode.system,
    String languageCode = '',
    ValueChanged<ThemeMode>? onThemeModeChanged,
    ValueChanged<String>? onLanguageChanged,
    ValueChanged<bool>? onAnalyticsConsentChanged,
    ValueChanged<bool>? onRemindersChanged,
    VoidCallback? onDeleteAccount,
    VoidCallback? onEditProfile,
    VoidCallback? onContactSupport,
    VoidCallback? onSignOut,
    VoidCallback? onSignOutEverywhere,
    VoidCallback? onUpgrade,
    VoidCallback? onManagePlan,
    VoidCallback? onOpenPrivacyPolicy,
    VoidCallback? onOpenTerms,
  }) => SettingsView(
    profile: profile,
    onEditProfile: onEditProfile,
    themeMode: themeMode,
    onThemeModeChanged: onThemeModeChanged ?? (ThemeMode _) {},
    languageCode: languageCode,
    onLanguageChanged: onLanguageChanged ?? (String _) {},
    remindersAvailable: remindersAvailable,
    remindersEnabled: remindersEnabled,
    onRemindersChanged: onRemindersChanged ?? (bool _) {},
    analyticsGranted: analyticsGranted,
    onAnalyticsConsentChanged: onAnalyticsConsentChanged ?? (bool _) {},
    promoObjected: promoObjected,
    promoObjectionKnown: promoObjectionKnown,
    onPromoObjectionChanged: (bool _) {},
    hasSession: hasSession,
    planSectionLabel: 'Plan',
    managePlanLabel: 'Manage plan',
    onUpgrade: onUpgrade ?? () {},
    onManagePlan: onManagePlan ?? () {},
    onOpenPrivacyPolicy: onOpenPrivacyPolicy ?? () {},
    onOpenTerms: onOpenTerms ?? () {},
    onOpenRefundPolicy: () {},
    supportEmail: 'support@example.com',
    onContactSupport: onContactSupport ?? () {},
    onSignOut: onSignOut ?? () {},
    onSignOutEverywhere: onSignOutEverywhere ?? () {},
    onDeleteAccount: onDeleteAccount ?? () {},
    applicationName: 'Probe',
    applicationVersion: '1.2.3',
  );

  // ── (1) THE WIDTH DECISION, AT ALL THREE WINDOW CLASSES ───────────────────
  //
  // 🔴 THIS WAS A BARE `Scaffold` + `ListView`, i.e. NO WIDTH DECISION AT ALL.
  // A `ListTile` fills whatever it is given, so on a maximised desktop every row
  // stretched the full width of the display: the leading icon at the far left,
  // its label a hand's width away, the trailing chevron at the other edge.
  // Nothing was clipped and nothing overflowed, so no test and no reviewer had
  // anything to point at.
  group('property: settings-page-is-capped at every window class', () {
    Future<double> paneWidthAt(WidgetTester tester, Size size) async {
      await pumpChassis(tester, size, view());
      return tester.getSize(find.byType(ListView)).width;
    }

    testWidgets('kPhone — narrower than the cap, so the pane yields', (
      WidgetTester tester,
    ) async {
      expect(await paneWidthAt(tester, kPhone), kPhone.width);
    });

    testWidgets('kTablet — still under the page cap', (
      WidgetTester tester,
    ) async {
      expect(await paneWidthAt(tester, kTablet), kTablet.width);
    });

    testWidgets('kDesktop — the page cap engages', (
      WidgetTester tester,
    ) async {
      expect(
        await paneWidthAt(tester, kDesktop),
        AppBreakpoints.kMaxBodyWidth,
      );
    });

    testWidgets('and it HOLDS on a window wider than the cap — the case that '
        'tells a cap apart from a coincidence', (WidgetTester tester) async {
      expect(
        await paneWidthAt(tester, wideDesktop),
        AppBreakpoints.kMaxBodyWidth,
      );
    });
  });

  // ── (2) THE DPDP §6(3) WITHDRAWAL CONTROL ─────────────────────────────────
  //
  // Until [ADR 037 P2.7] the only caller of the consent recorder in a stamped
  // app was the first-run prompt — shown once, never again — so consent was a
  // one-way door. Withdrawal must be as easy as granting, and privacy.html
  // promises it happens on this screen.
  group('property: analytics-consent-is-withdrawable-here', () {
    testWidgets('the switch REPORTS the value it was handed, in both '
        'directions', (WidgetTester tester) async {
      await pumpChassis(tester, kPhone, view(analyticsGranted: true));
      SwitchListTile tile = tester.widget<SwitchListTile>(
        find.byKey(SettingsView.analyticsConsentSwitch),
      );
      expect(tile.value, isTrue);

      await pumpChassis(tester, kPhone, view());
      tile = tester.widget<SwitchListTile>(
        find.byKey(SettingsView.analyticsConsentSwitch),
      );
      expect(tile.value, isFalse);
    });

    testWidgets('turning it OFF reports `false`, which is the withdrawal — a '
        'control that could only ever grant is not a withdrawal path', (
      WidgetTester tester,
    ) async {
      final List<bool> answers = <bool>[];
      await pumpChassis(
        tester,
        kPhone,
        view(
          analyticsGranted: true,
          onAnalyticsConsentChanged: answers.add,
        ),
      );
      await tester.tap(find.byKey(SettingsView.analyticsConsentSwitch));
      expect(answers, <bool>[false]);
    });
  });

  // ── (3) WHAT IS GATED ON A SESSION, AND WHY ───────────────────────────────
  group('property: settings-offers-nothing-it-cannot-honour', () {
    testWidgets('signed out: no profile, no plan rows, no deletion entry', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, kDesktop, view(hasSession: false));
      expect(find.byKey(SettingsView.deleteAccountTile), findsNothing);
      expect(find.byKey(SettingsView.signOutEverywhereTile), findsNothing);
      expect(find.byKey(SettingsView.upgradeTile), findsNothing);
      expect(find.byKey(SettingsView.managePlanTile), findsNothing);
      expect(find.byType(CircleAvatar), findsNothing);
    });

    testWidgets('signed in: all three appear, and deletion is one tap', (
      WidgetTester tester,
    ) async {
      bool asked = false;
      await pumpChassis(
        tester,
        kDesktop,
        view(
          profile: const SettingsProfile(
            initial: 'R',
            displayName: 'Rajasekar',
            email: 'someone@example.com',
          ),
          onDeleteAccount: () => asked = true,
        ),
      );
      expect(find.text('Rajasekar'), findsOneWidget);
      // SCROLLED TO, not merely looked for. A `ListView` does not BUILD its
      // offscreen children, so `findsNothing` for a row further down the page
      // is indistinguishable from a row that is not in the tree at all — and
      // this case's whole job is to tell those two apart from the signed-out
      // case above.
      for (final Key k in <Key>[
        SettingsView.upgradeTile,
        SettingsView.managePlanTile,
        SettingsView.deleteAccountTile,
      ]) {
        await tester.scrollUntilVisible(find.byKey(k), 200);
        expect(find.byKey(k), findsOneWidget);
      }
      await tester.tap(find.byKey(SettingsView.deleteAccountTile));
      expect(asked, isTrue);
    });

    testWidgets('a platform that cannot SCHEDULE gets an honest sentence, not '
        'a switch that silently does nothing', (WidgetTester tester) async {
      await pumpChassis(
        tester,
        kDesktop,
        view(remindersAvailable: false),
      );
      expect(find.byIcon(Icons.notifications_off_outlined), findsOneWidget);
      expect(find.byIcon(Icons.notifications_outlined), findsNothing);
    });

    testWidgets('the support contact (E1) is present and reaches its handler', (
      WidgetTester tester,
    ) async {
      bool mailed = false;
      await pumpChassis(
        tester,
        kDesktop,
        view(onContactSupport: () => mailed = true),
      );
      await tester.scrollUntilVisible(
        find.byKey(SettingsView.contactSupportTile),
        200,
      );
      expect(find.text('support@example.com'), findsOneWidget);
      await tester.tap(find.byKey(SettingsView.contactSupportTile));
      expect(mailed, isTrue);
    });
  });

  // ── (3b) EVERY OTHER CONTROL REACHES ITS HANDLER TOO ──────────────────────
  //
  // 🔴 THIS GROUP EXISTS BECAUSE A REVIEW MEASURED WHAT MOVING THE BODY COST.
  // While these tiles lived in the brick they carried their own handlers —
  // `onTap: () => _signOut(context, ref, l10n)`, `onTap: () => context.go('/paywall')`,
  // `onTap: () => _openUrl(AppConfig.privacyUrl)` — so ONE string proved both
  // halves at once, and severing a tile (`onTap: () {}`) reddened
  // `assert-seams-wired`, `assert-screen-set`, `assert-stamp-properties` and
  // `assert-purchase-path` on `origin/main`. Here only the TILE lives; the
  // handler stays in the adapter and arrives as a callback. So severing
  // `onTap: onSignOut` in this file changed NOTHING any check could see — a
  // refactor that turned four reds into greens without changing what the app
  // does, which is the exact shape this corpus refuses.
  //
  // Two things close it, and both are here on purpose rather than one of them:
  //   · `assert-screen-set.mjs` now fails when a callback the adapter hands
  //     across the delegation is declared and never used — STATIC, general, and
  //     it covers all 41 delegated callbacks in the tree including ones nobody
  //     writes a case for;
  //   · these cases, which are BEHAVIOURAL and therefore the stronger claim: a
  //     tap that reaches the callback cannot be satisfied by a string in the
  //     right shape. They are modelled exactly on the delete-account and
  //     contact-support cases above, which already had them.
  //
  // Each one FAILS when its `onTap:` is severed in the widget — measured, not
  // assumed, with a green control before and after.
  group('property: every settings control reaches the handler it was handed', () {
    Future<void> tapReaches(
      WidgetTester tester,
      Key key,
      Widget Function(VoidCallback fire) build,
    ) async {
      bool fired = false;
      await pumpChassis(tester, kDesktop, build(() => fired = true));
      // SCROLLED TO, not merely looked for: a `ListView` does not build its
      // offscreen children, so a `findsNothing` further down the page is
      // indistinguishable from a row that is not in the tree at all.
      await tester.scrollUntilVisible(find.byKey(key), 200);
      // …and then brought FULLY on screen. `scrollUntilVisible` stops once the
      // row is built, which can leave its centre on the viewport's edge — where
      // the tap lands outside the render tree and the callback never fires.
      // Measured: the all-devices row stopped at y == 900 on a 900-high window.
      await tester.ensureVisible(find.byKey(key));
      await tester.pump();
      await tester.tap(find.byKey(key));
      expect(fired, isTrue);
    }

    testWidgets('sign out', (WidgetTester tester) async {
      await tapReaches(
        tester,
        SettingsView.signOutTile,
        (VoidCallback fire) => view(onSignOut: fire),
      );
    });

    // AUTH-LOGOUT-ALL. Its own callback, so a tile wired to `onSignOut` — the
    // local sign-out — fails here: the count below is handed ONLY to
    // `onSignOutEverywhere`. NOT `tapReaches`: parent ruling L2 (2026-09-24)
    // puts a confirm between the tile and the callback, so the tile tap alone
    // must reach NOTHING, and a tile wired straight to the callback — the
    // confirm bypassed — fails the first `expect` below.
    testWidgets('sign out of all devices: the tile asks; confirm fires once', (
      WidgetTester tester,
    ) async {
      int fired = 0;
      await pumpChassis(
        tester,
        kDesktop,
        view(onSignOutEverywhere: () => fired++),
      );
      await tester.scrollUntilVisible(
        find.byKey(SettingsView.signOutEverywhereTile),
        200,
      );
      await tester.ensureVisible(find.byKey(SettingsView.signOutEverywhereTile));
      await tester.pump();
      await tester.tap(find.byKey(SettingsView.signOutEverywhereTile));
      await tester.pumpAndSettle();

      expect(fired, 0, reason: 'one tap must not sign out everywhere');
      expect(find.byType(AlertDialog), findsOneWidget);

      await tester.tap(find.byKey(SettingsView.signOutEverywhereConfirm));
      await tester.pumpAndSettle();

      expect(fired, 1);
      expect(find.byType(AlertDialog), findsNothing);
    });

    testWidgets('sign out of all devices: Cancel fires nothing', (
      WidgetTester tester,
    ) async {
      int fired = 0;
      await pumpChassis(
        tester,
        kDesktop,
        view(onSignOutEverywhere: () => fired++),
      );
      await tester.scrollUntilVisible(
        find.byKey(SettingsView.signOutEverywhereTile),
        200,
      );
      await tester.ensureVisible(find.byKey(SettingsView.signOutEverywhereTile));
      await tester.pump();
      await tester.tap(find.byKey(SettingsView.signOutEverywhereTile));
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsOneWidget);

      await tester.tap(find.byKey(SettingsView.signOutEverywhereCancel));
      await tester.pumpAndSettle();

      expect(fired, 0, reason: 'Cancel must reach no sign-out');
      expect(find.byType(AlertDialog), findsNothing);
    });

    testWidgets('edit profile', (WidgetTester tester) async {
      await tapReaches(
        tester,
        SettingsView.editProfileTile,
        (VoidCallback fire) => view(
          profile: const SettingsProfile(
            displayName: 'Rajasekar',
            email: 'r@example.com',
            initial: 'R',
          ),
          onEditProfile: fire,
        ),
      );
    });

    testWidgets('upgrade', (WidgetTester tester) async {
      await tapReaches(
        tester,
        SettingsView.upgradeTile,
        (VoidCallback fire) => view(onUpgrade: fire),
      );
    });

    testWidgets('manage plan', (WidgetTester tester) async {
      await tapReaches(
        tester,
        SettingsView.managePlanTile,
        (VoidCallback fire) => view(onManagePlan: fire),
      );
    });

    // The two legal rows both stores require to be reachable IN-APP. A link that
    // renders and opens nothing is the store-rejection shape, and it looks
    // identical to a working one in a screenshot.
    testWidgets('privacy policy', (WidgetTester tester) async {
      await tapReaches(
        tester,
        SettingsView.privacyPolicyTile,
        (VoidCallback fire) => view(onOpenPrivacyPolicy: fire),
      );
    });

    testWidgets('terms of service', (WidgetTester tester) async {
      await tapReaches(
        tester,
        SettingsView.termsTile,
        (VoidCallback fire) => view(onOpenTerms: fire),
      );
    });
  });

  // ── (4) THE PICKERS REPORT THE STORED VALUE ───────────────────────────────
  //
  // The control and the thing it controls are in DIFFERENT files, which is why
  // the register rows for both carry their reachability proof in `app.dart`.
  // What is measured here is the half that lives on the surface: a picker that
  // renders the value it was handed rather than a default.
  group('property: settings-pickers-show-the-stored-choice', () {
    testWidgets('the theme picker selects the stored mode', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, kPhone, view(themeMode: ThemeMode.dark));
      final SegmentedButton<ThemeMode> picker = tester
          .widget<SegmentedButton<ThemeMode>>(
            find.byKey(SettingsView.themePicker),
          );
      expect(picker.selected, <ThemeMode>{ThemeMode.dark});
    });

    testWidgets('choosing a language reports the CODE, and "follow the '
        'device" reports the empty one', (WidgetTester tester) async {
      final List<String> chosen = <String>[];
      await pumpChassis(
        tester,
        kPhone,
        view(languageCode: 'ta', onLanguageChanged: chosen.add),
      );
      final RadioGroup<String> group = tester.widget<RadioGroup<String>>(
        find.byKey(SettingsView.languagePicker),
      );
      expect(group.groupValue, 'ta');
      group.onChanged(null);
      expect(chosen, <String>['']);
    });
  });

  // ── (5) THE PROFILE EDITOR ────────────────────────────────────────────────
  group('property: edit-profile-dialog', () {
    testWidgets('the save control hands back what was typed, through the '
        'controller the CALLER owns', (WidgetTester tester) async {
      final TextEditingController name = TextEditingController(text: 'Old');
      addTearDown(name.dispose);
      String? saved;
      await pumpChassis(
        tester,
        kPhone,
        EditProfileDialog(name: name, onSave: () => saved = name.text),
      );
      await tester.enterText(find.byType(TextField), 'New name');
      await tester.tap(find.byKey(EditProfileDialog.saveButton));
      expect(saved, 'New name');
    });

    testWidgets('submitting from the keyboard saves too — a dialog whose only '
        'way out is the mouse is one a keyboard user cannot finish', (
      WidgetTester tester,
    ) async {
      final TextEditingController name = TextEditingController();
      addTearDown(name.dispose);
      int saves = 0;
      await pumpChassis(
        tester,
        kDesktop,
        EditProfileDialog(name: name, onSave: () => saves++),
      );
      await tester.enterText(find.byType(TextField), 'Typed');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      expect(saves, 1);
    });

    testWidgets('and it renders at kTablet as well — the third window class '
        'this package measures every surface at', (WidgetTester tester) async {
      final TextEditingController name = TextEditingController();
      addTearDown(name.dispose);
      await pumpChassis(
        tester,
        kTablet,
        EditProfileDialog(name: name, onSave: () {}),
      );
      expect(find.byType(AlertDialog), findsOneWidget);
    });
  });
}
