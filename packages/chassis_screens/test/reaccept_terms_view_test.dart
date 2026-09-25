import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/auth/legal_consent_fields.dart';
import 'package:nikatru_chassis_screens/auth/reaccept_terms_screen.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/raw_vendor_error.dart';
import 'support/width_harness.dart';

/// `ReacceptTermsView` — the interstitial every signed-in user meets when
/// `kTermsVersion` moves.
///
/// 🏗️ The widget half of `property: legal-reacceptance-gated`. The ROUTER half
/// — that a user with a stale stamp is put here and cannot leave — stays in the
/// brick's `chassis_properties_test.dart`.
void main() {
  Widget view({
    Future<void> Function()? onAccept,
    Future<void> Function()? onSignOut,
    VoidCallback? onOpenTerms,
    VoidCallback? onOpenPrivacy,
  }) =>
      ReacceptTermsView(
        onAccept: onAccept ?? () async {},
        onSignOut: onSignOut ?? () async {},
        // The real adapter hands the view the BRICK's `LegalConsentFields`; this
        // suite hands it the package view directly, which is the same tree minus
        // the URL launcher the package may not declare.
        consentFields: ({
          required bool termsAccepted,
          required bool marketingAccepted,
          required bool enabled,
          required ValueChanged<bool> onTermsChanged,
          required ValueChanged<bool> onMarketingChanged,
        }) =>
            LegalConsentFieldsView(
          termsAccepted: termsAccepted,
          marketingAccepted: marketingAccepted,
          enabled: enabled,
          showMarketing: false,
          onTermsChanged: onTermsChanged,
          onMarketingChanged: onMarketingChanged,
          onOpenTerms: onOpenTerms ?? () {},
          onOpenPrivacy: onOpenPrivacy ?? () {},
        ),
      );

  // ── (1) THE WIDTH DECISION, AT ALL THREE WINDOW CLASSES ───────────────────
  group('property: reaccept-terms-fills-the-form-pane at every window class',
      () {
    Future<double> paneWidthAt(WidgetTester tester, Size size) async {
      await pumpChassis(tester, size, view());
      return tester.getSize(find.byKey(ReacceptTermsView.acceptButton)).width;
    }

    testWidgets('kPhone — narrower than the cap, so the pane yields',
        (WidgetTester tester) async {
      expect(await paneWidthAt(tester, kPhone), lessThan(kPhone.width));
    });

    testWidgets('kTablet — the cap holds', (WidgetTester tester) async {
      expect(await paneWidthAt(tester, kTablet), AppBreakpoints.form);
    });

    testWidgets('kDesktop — the cap still holds', (WidgetTester tester) async {
      expect(await paneWidthAt(tester, kDesktop), AppBreakpoints.form);
    });
  });

  // ── (2) THE TICK ARRIVES UNTICKED AND IT IS WHAT OPENS THE BUTTON ─────────
  //
  // 🔴 A BUTTON THAT WORKS WITHOUT THE TICK MAKES THE BOX DECORATIVE, which is
  // the difference between a clickwrap and a notice. Carrying the previous
  // acceptance forward as a pre-ticked box would make this "acceptance" a
  // re-render of a decision taken against a document that no longer exists.
  group('property: reaccept-terms-is-blocked-until-ticked', () {
    testWidgets('accept is disabled on arrival', (WidgetTester tester) async {
      await pumpChassis(tester, kPhone, view());
      expect(
        tester
            .widget<FilledButton>(find.byKey(ReacceptTermsView.acceptButton))
            .onPressed,
        isNull,
      );
      expect(
        tester
            .widget<Checkbox>(find.byKey(LegalConsentFieldsView.termsCheckbox))
            .value,
        isFalse,
      );
    });

    testWidgets('ticking the box opens it, and accepting calls the recorder',
        (WidgetTester tester) async {
      int accepted = 0;
      await pumpChassis(tester, kPhone, view(onAccept: () async => accepted++));
      await tester.tap(find.byKey(LegalConsentFieldsView.termsCheckbox));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<FilledButton>(find.byKey(ReacceptTermsView.acceptButton))
            .onPressed,
        isNotNull,
      );
      await tester.tap(find.byKey(ReacceptTermsView.acceptButton));
      await tester.pumpAndSettle();
      expect(accepted, 1);
    });
  });

  // ── (3) THERE IS NO MARKETING BOX HERE ────────────────────────────────────
  testWidgets('property: reaccept-terms-asks-for-nothing-optional',
      (WidgetTester tester) async {
    await pumpChassis(tester, kPhone, view());
    expect(find.byKey(LegalConsentFieldsView.marketingCheckbox), findsNothing);
  });

  // ── (4) DECLINE IS POSSIBLE, AWAITED, AND SHOWS ITS OWN FAILURE ───────────
  //
  // 🔴 IT WAS `onPressed: () => auth.signOut()` AND NONE OF THE THREE. On a
  // screen whose entire premise is that there is no other way out, a sign-out
  // that throws became an unhandled async error and the user was left looking
  // at a button that had visibly done nothing.
  group('property: reaccept-terms-can-be-declined', () {
    testWidgets('decline calls the sign-out', (WidgetTester tester) async {
      int out = 0;
      await pumpChassis(tester, kPhone, view(onSignOut: () async => out++));
      await tester.tap(find.byKey(ReacceptTermsView.signOutButton));
      await tester.pumpAndSettle();
      expect(out, 1);
    });

    // ⏱ 2026-09-24 — SHOWN, and MAPPED: this asserted the exception's own text
    // appeared, which is the defect the shared mapper removes.
    testWidgets('a sign-out that throws is SHOWN, not swallowed',
        (WidgetTester tester) async {
      await pumpChassis(
        tester,
        kPhone,
        view(onSignOut: () async => throw StateError('the network is gone')),
      );
      await tester.tap(find.byKey(ReacceptTermsView.signOutButton));
      await tester.pumpAndSettle();
      expect(
        tester.widget<Text>(find.byKey(ReacceptTermsView.statusLine)).data,
        _en.authNetworkError,
      );
      expect(find.textContaining('StateError'), findsNothing);
    });

    // 🔴 THE `'$e'` ARM.
    testWidgets('a NON-AuthFailure is mapped, never printed',
        (WidgetTester tester) async {
      await pumpChassis(
        tester,
        kPhone,
        view(onSignOut: () async => throw const RawVendorError()),
      );
      await tester.tap(find.byKey(ReacceptTermsView.signOutButton));
      await tester.pumpAndSettle();
      expect(find.textContaining(rawVendorFragment), findsNothing);
      expect(
        tester.widget<Text>(find.byKey(ReacceptTermsView.statusLine)).data,
        _en.authCaptchaFailed,
      );
    });
  });
}

/// ⏱ 2026-09-24 — the sentences the shared `authErrorText` answers with.
final ChassisLocalizations _en = lookupChassisLocalizations(const Locale('en'));
