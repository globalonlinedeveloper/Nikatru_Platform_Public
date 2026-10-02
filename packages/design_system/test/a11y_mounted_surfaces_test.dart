// ─────────────────────────────────────────────────────────────────────────────
// a11y_mounted_surfaces_test.dart — the accessibility sweep for the sixteen
// design-system widgets the app or its chassis screens MOUNT and that carried
// no sweep (SYN-X1 C-11, train P39).
//
// Measured at the base of this change: `assert-a11y-coverage.mjs` printed 17
// of 43 reachable design-system surfaces as unswept, and
// `grep -rlw <widget> apps/subscriptiontracker/lib packages/chassis_screens/lib`
// found every one of them mounted except `NavShell` (0 files). Fourteen of
// those sixteen are swept here and the two-pane pair in a11y_two_pane_test.dart
// — the paywall gate, the force-update gate, the delete-account
// dialog, the two-pane layout, the promo surface and the system screens are
// all on a path a real user reaches.
//
// Each case pumps ONE surface in BOTH schemes and runs flutter_test's own
// tap-target, labelled-tap-target and text-contrast guidelines. The family is
// written out in every body on purpose: `assert-a11y-coverage.mjs` credits a
// sweep to a surface only when the surface is CONSTRUCTED and the guideline
// CALLED in one `testWidgets` body, so a shared helper that hid the calls
// would read as no sweep at all.
//
// ⚠️ `naked-controls` is NOT one of the families here and that is the same
// limit the chassis_screens floor records: `expectNothingNaked` lives in an
// APP's test directory, which a package cannot import. The NAME half of that
// walk is `labeledTapTargetGuideline`.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

const Color _seed = Color(0xFF6459F5);

/// Pumps [child] as the body of a themed [Scaffold]. The pump is shared; the
/// sweep is not (see the header).
///
/// ⚠️ NO SURFACE SIZE IS PINNED, ON PURPOSE. These are contrast and tap-target
/// sweeps, not width measurements, and `assert-responsive-coverage.mjs`
/// credits a package test file that pins a size as measuring the WIDTH of
/// every surface it constructs. Pinning one here would have reported all
/// sixteen as width-measured by a file that asserts nothing about width. The
/// one case whose subject IS width-dependent (TwoPane's second column exists
/// only from 840 up) lives in a11y_two_pane_test.dart.
Future<void> _pump(
  WidgetTester tester,
  Brightness b,
  Widget child, {
  bool scroll = true,
}) async {
  await tester.pumpWidget(
    DefaultAssetBundle(
      bundle: _HostBundle(),
      child: MaterialApp(
        theme: buildAppTheme(seed: _seed, brightness: b),
        home: Scaffold(
          body: scroll
              ? ListView(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  children: <Widget>[child],
                )
              : child,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  for (final Brightness b in Brightness.values) {
    group('${b.name} ·', () {
      testWidgets('ContentPane, every cap', (WidgetTester tester) async {
        final SemanticsHandle handle = tester.ensureSemantics();
        await _pump(
          tester,
          b,
          Column(
            children: <Widget>[
              ContentPane(
                child: TextButton(onPressed: () {}, child: const Text('Body')),
              ),
              ContentPane.form(
                child: TextButton(onPressed: () {}, child: const Text('Form')),
              ),
              ContentPane.pane(
                child: TextButton(onPressed: () {}, child: const Text('Pane')),
              ),
              ContentPane.reading(
                child: TextButton(onPressed: () {}, child: const Text('Read')),
              ),
            ],
          ),
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        handle.dispose();
      });

      testWidgets('DestructiveConfirmDialog, the secret step', (
        WidgetTester tester,
      ) async {
        final SemanticsHandle handle = tester.ensureSemantics();
        final TextEditingController secret = TextEditingController();
        addTearDown(secret.dispose);
        await _pump(
          tester,
          b,
          DestructiveConfirmDialog(
            title: 'Delete account?',
            body: 'This cannot be undone.',
            secretHint: 'Confirm your password to continue.',
            secretLabel: 'Password',
            secret: secret,
            cancelLabel: 'Cancel',
            confirmLabel: 'Delete',
            acknowledgeLabel: 'OK',
            onConfirm: () async => const DestructiveActionReport(
              message: 'Deleted',
              succeeded: true,
            ),
          ),
          scroll: false,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        handle.dispose();
      });

      testWidgets('DestructiveOutcomeNotice, success and failure', (
        WidgetTester tester,
      ) async {
        final SemanticsHandle handle = tester.ensureSemantics();
        await _pump(
          tester,
          b,
          Column(
            children: <Widget>[
              DestructiveOutcomeNotice(
                report: const DestructiveActionReport(
                  title: 'Account deleted',
                  message: 'Your data is gone.',
                  succeeded: true,
                  footnote: 'Backups expire in 30 days.',
                ),
                dismissLabel: 'Done',
                onDismiss: () {},
                detail: 'Signed out on every device.',
              ),
              DestructiveOutcomeNotice(
                report: const DestructiveActionReport(
                  message: 'Nothing was deleted.',
                  succeeded: false,
                ),
                dismissLabel: 'Close',
                onDismiss: () {},
              ),
            ],
          ),
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        handle.dispose();
      });

      testWidgets('FocusableTap, every role', (WidgetTester tester) async {
        final SemanticsHandle handle = tester.ensureSemantics();
        await _pump(
          tester,
          b,
          Column(
            children: <Widget>[
              for (final TapRole role in TapRole.values)
                FocusableTap(
                  onTap: () {},
                  role: role,
                  label: 'Open ${role.name}',
                  child: const SizedBox(
                    height: 48,
                    width: double.infinity,
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Text('Row'),
                    ),
                  ),
                ),
            ],
          ),
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        handle.dispose();
      });

      testWidgets('ForceUpdateGate, the wall', (WidgetTester tester) async {
        final SemanticsHandle handle = tester.ensureSemantics();
        await _pump(
          tester,
          b,
          ForceUpdateGate(
            mustUpdate: true,
            title: 'Update required',
            message: 'This version is no longer supported.',
            buttonLabel: 'Update',
            onUpdate: () {},
            child: const Text('the app'),
          ),
          scroll: false,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        handle.dispose();
      });

      testWidgets('PaywallGate, the page arm and the card arm, locked', (
        WidgetTester tester,
      ) async {
        final SemanticsHandle handle = tester.ensureSemantics();
        await _pump(
          tester,
          b,
          Column(
            children: <Widget>[
              PaywallGate(
                locked: true,
                title: 'Pro feature',
                message: 'Upgrade to see every renewal.',
                upgradeLabel: 'Upgrade',
                onUpgrade: () {},
                child: const Text('hidden'),
              ),
              PaywallGate.card(
                locked: true,
                title: 'Forecast',
                message: 'Twelve months ahead, with Pro.',
                upgradeLabel: 'See Pro',
                badgeLabel: 'Pro',
                onUpgrade: () {},
                preview: const Text('₹ 12,000'),
                child: const Text('hidden'),
              ),
            ],
          ),
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        handle.dispose();
      });

      testWidgets('PromoSurface, PromoCard and PromoObjectionControl', (
        WidgetTester tester,
      ) async {
        final SemanticsHandle handle = tester.ensureSemantics();
        await _pump(
          tester,
          b,
          Column(
            children: <Widget>[
              PromoSurface(
                show: true,
                objected: false,
                onObjectionChanged: (_) {},
                promotionalLabel: 'Promotion',
                stopLabel: 'Stop offers',
                resumeLabel: 'Resume offers',
                objectedNotice: 'You will not see offers.',
                child: PromoCard(
                  show: true,
                  label: 'Offer',
                  title: 'Annual plan',
                  message: 'Two months free.',
                  priceLabel: '₹ 999 a year',
                  primaryActionLabel: 'See plan',
                  onPrimaryAction: () {},
                  manageLabel: 'Manage offers',
                  onManageAction: () {},
                  dismissLabel: 'Not now',
                  onDismiss: () {},
                  dismissSemanticLabel: 'Dismiss offer',
                ),
              ),
              PromoObjectionControl(
                objected: true,
                onChanged: (_) {},
                stopLabel: 'Stop offers',
                resumeLabel: 'Resume offers',
                objectedNotice: 'You will not see offers.',
              ),
            ],
          ),
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        handle.dispose();
      });

      testWidgets('AppErrorScreen, retry and details', (
        WidgetTester tester,
      ) async {
        final SemanticsHandle handle = tester.ensureSemantics();
        await _pump(
          tester,
          b,
          AppErrorScreen(
            title: 'Something went wrong',
            message: 'We could not load this page.',
            onRetry: () {},
            retryLabel: 'Try again',
            details: 'StateError: boom',
          ),
          scroll: false,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        handle.dispose();
      });

      testWidgets('NotFoundScreen, with the attempted location', (
        WidgetTester tester,
      ) async {
        final SemanticsHandle handle = tester.ensureSemantics();
        await _pump(
          tester,
          b,
          NotFoundScreen(
            title: 'Page not found',
            message: 'That link does not go anywhere.',
            goHomeLabel: 'Go home',
            onGoHome: () {},
            attemptedLocation: '/nowhere',
          ),
          scroll: false,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        handle.dispose();
      });

      testWidgets('OfflineNotice, with retry', (WidgetTester tester) async {
        final SemanticsHandle handle = tester.ensureSemantics();
        await _pump(
          tester,
          b,
          OfflineNotice(
            message: 'You are offline.',
            onRetry: () {},
            retryLabel: 'Retry',
          ),
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        handle.dispose();
      });

      testWidgets('BrandFooter and BrandWordmark, with links', (
        WidgetTester tester,
      ) async {
        final SemanticsHandle handle = tester.ensureSemantics();
        await _pump(
          tester,
          b,
          Column(
            children: <Widget>[
              const BrandWordmark(semanticLabel: 'Nikatru'),
              BrandFooter(
                wordmarkSemanticLabel: 'Nikatru',
                poweredByLine: 'Powered by Nikatru',
                links: <BrandFooterLink>[
                  BrandFooterLink(label: 'Privacy', onTap: () {}),
                  BrandFooterLink(label: 'Terms', onTap: () {}),
                ],
              ),
            ],
          ),
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        handle.dispose();
      });
    });
  }
}

/// Stands in for the HOST APP's asset bundle, which is where [BrandWordmark]
/// resolves `assets/brand/…` (no `package:` argument). Same stub as
/// brand_lockup_test.dart: one 1x1 PNG for every key, and an EMPTY manifest,
/// because `AssetImage` reads `AssetManifest.bin` first.
class _HostBundle extends CachingAssetBundle {
  static final Uint8List _png = base64Decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8'
    'z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  );

  @override
  Future<ByteData> load(String key) async {
    if (key == 'AssetManifest.bin') {
      return const StandardMessageCodec().encodeMessage(<String, Object?>{})!;
    }
    return ByteData.sublistView(_png);
  }
}
