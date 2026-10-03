// ⏱ 2026-10-01 · O-APPS-GOV-IN-VAPT-CHECKLIST — the chassis half of device
// integrity: the modified-copy screen (goldens + its one way out), the
// once-per-session rooted notice, the boot step, and the re-auth gate in front
// of a sensitive action.
import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
// The screen is imported from its own file so the width guard sees which file
// declares it; the gate re-exports it too.
import 'package:nikatru_chassis_screens/integrity/device_integrity_gate.dart'
    hide TamperedBuildApp, TamperedBuildScreen;
import 'package:nikatru_chassis_screens/integrity/tampered_build_screen.dart';
import 'package:nikatru_chassis_screens/auth/turnstile_gate.dart';
import 'package:nikatru_chassis_screens/shell/app_shell.dart'
    show RootedDeviceNoticeHost;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/width_harness.dart';

const core.DeviceIntegrity _rooted = core.DeviceIntegrity(
  root: core.RootReport(core.RootStatus.rooted, <core.RootSignal>{
    core.RootSignal.suBinary,
  }),
  signer: core.SignerVerdict.verified,
);
const core.DeviceIntegrity _clean = core.DeviceIntegrity(
  root: core.RootReport(core.RootStatus.clean),
  signer: core.SignerVerdict.verified,
);

/// The one user the re-auth gate re-checks; `signInWithEmail` succeeds for
/// [password] only.
final class _Auth extends Fake implements core.AuthRepository {
  _Auth({this.user});

  static const String password = 'right';
  final core.AuthUser? user;
  final List<String> attempts = <String>[];

  @override
  core.AuthUser? get currentUser => user;

  @override
  Future<core.AuthUser> signInWithEmail({
    required String email,
    required String password,
    String? captchaToken,
  }) async {
    attempts.add(password);
    if (password != _Auth.password) throw core.AuthFailure('wrong password');
    return user!;
  }
}

const core.AuthUser _someone = core.AuthUser(id: 'u1', email: 'a@example.test');

/// A native build's captcha posture ([ADR 084]): no challenge renders, and a
/// gated call may go at once with no token.
CaptchaTokenController _nativeCaptcha() =>
    CaptchaTokenController(posture: CaptchaPosture.notOnThisChannel);

Widget _noChallenge(BuildContext context, TurnstileChallenge challenge) =>
    const SizedBox.shrink();

ReauthDialog _dialog() =>
    ReauthDialog(captcha: _nativeCaptcha(), renderTurnstile: _noChallenge);

void main() {
  late core.IntegritySession before;
  setUp(() => before = DeviceIntegrityScope.session);
  tearDown(() => DeviceIntegrityScope.session = before);

  group('golden — the modified-copy screen', () {
    const Map<String, Size> classes = <String, Size>{
      'compact': Size(390, 844),
      'expanded': Size(1024, 900),
    };
    for (final MapEntry<String, Size> c in classes.entries) {
      for (final Brightness b in Brightness.values) {
        testWidgets('tampered build · ${c.key} · ${b.name}', (
          WidgetTester tester,
        ) async {
          tester.view.physicalSize = c.value * 0.5;
          tester.view.devicePixelRatio = 0.5;
          addTearDown(tester.view.reset);
          await tester.pumpWidget(
            MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: buildAppTheme(
                seed: const Color(0xFF5F6368),
                brightness: b,
              ),
              localizationsDelegates:
                  ChassisLocalizations.localizationsDelegates,
              supportedLocales: ChassisLocalizations.supportedLocales,
              home: TamperedBuildScreen(onExit: () async {}),
            ),
          );
          await tester.pumpAndSettle();
          await expectLater(
            find.byType(MaterialApp),
            matchesGoldenFile('goldens/tampered_build_${c.key}_${b.name}.png'),
          );
        }, skip: !Platform.isLinux);
      }
    }
  });

  // ── WIDTH: every window class, one case per surface ──────────────────────
  //
  // Each new surface is pumped at the phone, tablet and desktop widths the
  // chassis suite measures, and must lay out without an overflow at each.
  group('width — every window class', () {
    testWidgets('TamperedBuildScreen at phone, tablet and desktop', (
      WidgetTester tester,
    ) async {
      await pumpChassis(
        tester,
        kPhone,
        TamperedBuildScreen(onExit: () async {}),
      );
      expect(tester.takeException(), isNull);
      await pumpChassis(
        tester,
        kTablet,
        TamperedBuildScreen(onExit: () async {}),
      );
      expect(tester.takeException(), isNull);
      await pumpChassis(
        tester,
        kDesktop,
        TamperedBuildScreen(onExit: () async {}),
      );
      expect(tester.takeException(), isNull);
      expect(find.byKey(TamperedBuildScreen.exitButton), findsOneWidget);
    });

    testWidgets('TamperedBuildApp at phone, tablet and desktop', (
      WidgetTester tester,
    ) async {
      for (final Size size in <Size>[kPhone, kTablet, kDesktop]) {
        await tester.binding.setSurfaceSize(size);
        await tester.pumpWidget(const TamperedBuildApp());
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull, reason: '$size');
        expect(find.byKey(TamperedBuildScreen.exitButton), findsOneWidget);
      }
      await tester.binding.setSurfaceSize(null);
    });

    testWidgets('ReauthDialog at phone, tablet and desktop', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, kPhone, _dialog());
      expect(tester.takeException(), isNull);
      await pumpChassis(tester, kTablet, _dialog());
      expect(tester.takeException(), isNull);
      await pumpChassis(tester, kDesktop, _dialog());
      expect(tester.takeException(), isNull);
      expect(find.byKey(ReauthDialog.passwordField), findsOneWidget);
    });

    testWidgets('RootedDeviceNoticeHost at phone, tablet and desktop', (
      WidgetTester tester,
    ) async {
      Widget host() => RootedDeviceNoticeHost(
        session: core.IntegritySession(_rooted),
        child: const Text('the app'),
      );
      await pumpChassis(tester, kPhone, host());
      expect(tester.takeException(), isNull);
      await pumpChassis(tester, kTablet, host());
      expect(tester.takeException(), isNull);
      await pumpChassis(tester, kDesktop, host());
      expect(tester.takeException(), isNull);
      expect(find.byKey(RootedDeviceNoticeHost.notice), findsOneWidget);
    });
  });

  group('the modified-copy screen', () {
    testWidgets('says what happened and what to do, and only offers an exit', (
      WidgetTester tester,
    ) async {
      int exits = 0;
      await pumpChassis(
        tester,
        kPhone,
        TamperedBuildScreen(onExit: () async => exits++),
      );
      expect(find.text('This copy of the app was modified'), findsOneWidget);
      expect(
        find.textContaining('Install the app from the official store'),
        findsOneWidget,
      );
      expect(find.byType(FilledButton), findsOneWidget);
      expect(find.byType(TextButton), findsNothing);
      await tester.tap(find.byKey(TamperedBuildScreen.exitButton));
      expect(exits, 1);
    });

    testWidgets('is non-dismissable: back does not pop it', (
      WidgetTester tester,
    ) async {
      // Pushed ABOVE another route, so a pop would have somewhere to go.
      await pumpChassis(tester, kPhone, const Text('beneath'));
      final NavigatorState nav = tester.state(find.byType(Navigator));
      nav.push(
        MaterialPageRoute<void>(
          builder: (_) => TamperedBuildScreen(onExit: () async {}),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.byWidgetPredicate((Widget w) => w is PopScope && !w.canPop),
        findsOneWidget,
      );
      await nav.maybePop();
      await tester.pumpAndSettle();
      expect(find.byType(TamperedBuildScreen), findsOneWidget);
      expect(find.text('beneath'), findsNothing);
    });

    testWidgets('TamperedBuildApp is self-contained: localised, themed', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(const TamperedBuildApp());
      await tester.pumpAndSettle();
      expect(find.text('This copy of the app was modified'), findsOneWidget);
    });

    testWidgets('reads in Tamil', (WidgetTester tester) async {
      await pumpChassis(
        tester,
        kPhone,
        TamperedBuildScreen(onExit: () async {}),
        locale: const Locale('ta'),
      );
      expect(find.text('இந்த ஆப் நகல் மாற்றப்பட்டுள்ளது'), findsOneWidget);
    });
  });

  group('the rooted notice', () {
    Widget host(core.IntegritySession s) =>
        RootedDeviceNoticeHost(session: s, child: const Text('the app'));

    testWidgets('shows once on a rooted device, never blocks the app', (
      WidgetTester tester,
    ) async {
      final core.IntegritySession s = core.IntegritySession(_rooted);
      await pumpChassis(tester, kPhone, host(s));
      expect(find.byKey(RootedDeviceNoticeHost.notice), findsOneWidget);
      expect(find.text('the app'), findsOneWidget);
      await tester.tap(find.text('Got it'));
      await tester.pumpAndSettle();
      expect(find.byKey(RootedDeviceNoticeHost.notice), findsNothing);
      expect(find.text('the app'), findsOneWidget);

      // A second host in the same session — a new route, a rebuild of the
      // shell — does not show it again.
      await pumpChassis(
        tester,
        kPhone,
        Column(children: <Widget>[Expanded(child: host(s))]),
      );
      expect(find.byKey(RootedDeviceNoticeHost.notice), findsNothing);
    });

    testWidgets('a clean device never sees it', (WidgetTester tester) async {
      await pumpChassis(tester, kPhone, host(core.IntegritySession(_clean)));
      expect(find.byKey(RootedDeviceNoticeHost.notice), findsNothing);
      expect(find.text('the app'), findsOneWidget);
    });

    testWidgets('reads the boot step\'s session by default', (
      WidgetTester tester,
    ) async {
      DeviceIntegrityScope.session = core.IntegritySession(_rooted);
      await pumpChassis(
        tester,
        kPhone,
        const RootedDeviceNoticeHost(child: Text('the app')),
      );
      expect(find.byKey(RootedDeviceNoticeHost.notice), findsOneWidget);
    });
  });

  group('checkDeviceIntegrity — the boot step', () {
    test('a rooted device is recorded and becomes the session', () async {
      final List<core.DeviceIntegrity> recorded = <core.DeviceIntegrity>[];
      final core.IntegritySession s = await checkDeviceIntegrity(
        appId: 'subscriptiontracker',
        releaseChannel: 'android-play',
        integrityProbe: core.FixedDeviceIntegrityProbe(
          signals: const <core.RootSignal>{core.RootSignal.magiskPath},
          certificates: core.SigningCertificates(
            sha256: core
                .signerPinsFor('android-play', appId: 'subscriptiontracker')!
                .digests,
          ),
        ),
        record: recorded.add,
        isDebugBuild: false,
        platform: TargetPlatform.android,
        isWeb: false,
      );
      expect(s.integrity.rooted, isTrue);
      expect(s.integrity.signer, core.SignerVerdict.verified);
      expect(s.integrity.blocksDataAccess, isFalse);
      expect(identical(DeviceIntegrityScope.session, s), isTrue);
      expect(recorded.single.record, contains('root=rooted(magisk_path)'));
    });

    test('a debug build is exempt from the signer, on android', () async {
      final core.IntegritySession s = await checkDeviceIntegrity(
        appId: 'subscriptiontracker',
        releaseChannel: 'android-play',
        integrityProbe: core.FixedDeviceIntegrityProbe(
          certificates: core.SigningCertificates(sha256: <String>['AB' * 32]),
        ),
        isDebugBuild: true,
        platform: TargetPlatform.android,
        isWeb: false,
      );
      expect(s.integrity.signer, core.SignerVerdict.exemptDebug);
    });

    test('ios checks root only; no probe checks nothing', () async {
      final core.IntegritySession ios = await checkDeviceIntegrity(
        appId: 'subscriptiontracker',
        releaseChannel: 'ios-appstore',
        integrityProbe: const core.FixedDeviceIntegrityProbe(
          signals: <core.RootSignal>{core.RootSignal.jailbreakArtifact},
        ),
        isDebugBuild: false,
        platform: TargetPlatform.iOS,
        isWeb: false,
      );
      expect(ios.integrity.rooted, isTrue);
      expect(ios.integrity.signer, core.SignerVerdict.notChecked);

      final core.IntegritySession none = await checkDeviceIntegrity(
        appId: 'subscriptiontracker',
        releaseChannel: 'web',
        integrityProbe: null,
        isDebugBuild: false,
      );
      expect(none.integrity.rooted, isFalse);
      expect(none.integrity.signer, core.SignerVerdict.notChecked);
    });

    test('modifiedCopyBlocked answers false for an incomplete set', () async {
      // An incomplete set reports a foreign signer and the app runs: the
      // caller must NOT return. ⏱ 2026-10-03: subscriptiontracker's real
      // android-play set is complete now, so the incomplete one is passed
      // through the seam.
      expect(
        await modifiedCopyBlocked(
          appId: 'subscriptiontracker',
          releaseChannel: 'android-play',
          integrityProbe: core.FixedDeviceIntegrityProbe(
            certificates: core.SigningCertificates(sha256: <String>['AB' * 32]),
          ),
          isDebugBuild: false,
          platform: TargetPlatform.android,
          isWeb: false,
          pinsFor: (_) => core.SignerPins(
            digests: core
                .signerPinsFor('android-play', appId: 'subscriptiontracker')!
                .digests,
            complete: false,
          ),
        ),
        isFalse,
      );
      expect(
        DeviceIntegrityScope.session.integrity.signer,
        core.SignerVerdict.mismatchReported,
      );
    });

    // THE BLOCKING BRANCH. No channel's real pin set is complete yet, so a
    // complete set is passed through the test seam: a foreign signer then runs
    // the modified-copy app and answers true, and the caller returns.
    // ⏱ 2026-10-03: subscriptiontracker's real android-play set is complete;
    // the case after this one blocks through the REAL generated table.
    testWidgets(
      'a foreign signer on a COMPLETE set runs the modified-copy app',
      (WidgetTester tester) async {
        final List<core.DeviceIntegrity> recorded = <core.DeviceIntegrity>[];
        final bool blocked = await modifiedCopyBlocked(
          appId: 'subscriptiontracker',
          releaseChannel: 'apps-gov-in',
          integrityProbe: core.FixedDeviceIntegrityProbe(
            certificates: core.SigningCertificates(sha256: <String>['AB' * 32]),
          ),
          record: recorded.add,
          isDebugBuild: false,
          platform: TargetPlatform.android,
          isWeb: false,
          pinsFor: (_) =>
              core.SignerPins(digests: <String>['CD' * 32], complete: true),
        );
        expect(blocked, isTrue);
        expect(recorded.single.signer, core.SignerVerdict.mismatch);
        await tester.pumpAndSettle();
        expect(find.byType(TamperedBuildApp), findsOneWidget);
        expect(find.text('This copy of the app was modified'), findsOneWidget);
      },
    );

    testWidgets(
      "a foreign signer on this app's REAL set runs the modified-copy app",
      (WidgetTester tester) async {
        final bool blocked = await modifiedCopyBlocked(
          appId: 'subscriptiontracker',
          releaseChannel: 'android-play',
          integrityProbe: core.FixedDeviceIntegrityProbe(
            certificates: core.SigningCertificates(sha256: <String>['AB' * 32]),
          ),
          isDebugBuild: false,
          platform: TargetPlatform.android,
          isWeb: false,
        );
        expect(blocked, isTrue);
        expect(
          DeviceIntegrityScope.session.integrity.signer,
          core.SignerVerdict.mismatch,
        );
        await tester.pumpAndSettle();
        expect(find.byType(TamperedBuildApp), findsOneWidget);
      },
    );

    testWidgets('our signer on a COMPLETE set runs nothing and answers false', (
      WidgetTester tester,
    ) async {
      final bool blocked = await modifiedCopyBlocked(
        appId: 'subscriptiontracker',
        releaseChannel: 'apps-gov-in',
        integrityProbe: core.FixedDeviceIntegrityProbe(
          certificates: core.SigningCertificates(sha256: <String>['CD' * 32]),
        ),
        isDebugBuild: false,
        platform: TargetPlatform.android,
        isWeb: false,
        pinsFor: (_) =>
            core.SignerPins(digests: <String>['CD' * 32], complete: true),
      );
      expect(blocked, isFalse);
      await tester.pump();
      expect(find.byType(TamperedBuildApp), findsNothing);
    });

    test('a recorder that throws does not cost the user the app', () async {
      final core.IntegritySession s = await checkDeviceIntegrity(
        appId: 'subscriptiontracker',
        releaseChannel: 'android-play',
        integrityProbe: const core.FixedDeviceIntegrityProbe(),
        record: (_) => throw StateError('sink down'),
        isDebugBuild: true,
        platform: TargetPlatform.android,
        isWeb: false,
      );
      expect(s.integrity.blocksDataAccess, isFalse);
    });

    test('the recorder sends an event for a signer problem only', () async {
      final List<String> crumbs = <String>[];
      final List<String> events = <String>[];
      final List<String?> categories = <String?>[];
      final DeviceIntegrityRecorder r = integrityRecorder((
        String m, {
        String? category,
      }) {
        crumbs.add(m);
        categories.add(category);
      }, (String m) async => events.add(m));
      r(_rooted);
      r(
        const core.DeviceIntegrity(
          root: core.RootReport(core.RootStatus.clean),
          signer: core.SignerVerdict.mismatchReported,
        ),
      );
      expect(crumbs, hasLength(2));
      expect(categories, <String?>['integrity', 'integrity']);
      expect(events, <String>['integrity root=clean signer=mismatchReported']);
    });
  });

  group('the re-auth gate in front of a sensitive action', () {
    Future<bool> run(
      WidgetTester tester,
      core.DeviceIntegrity integrity,
      _Auth auth, {
      String? typed,
      bool cancel = false,
    }) async {
      late BuildContext ctx;
      await pumpChassis(
        tester,
        kPhone,
        Builder(
          builder: (BuildContext c) {
            ctx = c;
            return const SizedBox.shrink();
          },
        ),
      );
      final CaptchaTokenController captcha = _nativeCaptcha();
      addTearDown(captcha.dispose);
      final Future<bool> result = confirmSensitiveAction(
        ctx,
        action: core.SensitiveAction.exportData,
        auth: auth,
        captcha: captcha,
        renderTurnstile: _noChallenge,
        session: core.IntegritySession(integrity),
      );
      await tester.pumpAndSettle();
      if (find.byKey(ReauthDialog.passwordField).evaluate().isNotEmpty) {
        if (cancel) {
          await tester.tap(find.text('Cancel'));
        } else {
          await tester.enterText(
            find.byKey(ReauthDialog.passwordField),
            typed!,
          );
          await tester.tap(find.byKey(ReauthDialog.confirmButton));
        }
        await tester.pumpAndSettle();
      }
      return result;
    }

    testWidgets('a clean device is never asked', (WidgetTester tester) async {
      final _Auth auth = _Auth(user: _someone);
      expect(await run(tester, _clean, auth), isTrue);
      expect(auth.attempts, isEmpty);
    });

    testWidgets('a rooted device proceeds on the right password', (
      WidgetTester tester,
    ) async {
      final _Auth auth = _Auth(user: _someone);
      expect(await run(tester, _rooted, auth, typed: 'right'), isTrue);
      expect(auth.attempts, <String>['right']);
    });

    testWidgets('a rooted device is refused on a wrong password', (
      WidgetTester tester,
    ) async {
      final _Auth auth = _Auth(user: _someone);
      expect(await run(tester, _rooted, auth, typed: 'wrong'), isFalse);
    });

    testWidgets('a rooted device is refused on cancel, with no attempt', (
      WidgetTester tester,
    ) async {
      final _Auth auth = _Auth(user: _someone);
      expect(await run(tester, _rooted, auth, cancel: true), isFalse);
      expect(auth.attempts, isEmpty);
    });

    testWidgets('nobody signed in: nothing to re-check, the data is local', (
      WidgetTester tester,
    ) async {
      final _Auth auth = _Auth();
      expect(await run(tester, _rooted, auth), isTrue);
    });
  });
}
