import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/settings/connected_accounts_view.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/width_harness.dart';

/// ⏱ 2026-10-01 · SE-04 — `ConnectedAccountsView`, the linked sign-in methods
/// sheet behind Settings' "Connected accounts" row.
///
/// RED CONTROLS: draw the Remove button whatever `core.mayUnlinkMethod` says
/// (the only-method case goes red); drop the `onUnlink` answer from `_user`
/// (the row does not move); show `'$e'` instead of `authErrorText` (the
/// refusal case prints the server's English).
void main() {
  final ChassisLocalizations l10n = lookupChassisLocalizations(
    const Locale('en'),
  );

  core.AuthUser user({
    bool password = true,
    List<String> oauth = const <String>[],
    bool verified = true,
  }) => core.AuthUser(
    id: 'u',
    email: 'a@example.com',
    emailVerified: verified,
    hasPasswordIdentity: password,
    oauthProviders: oauth,
  );

  Widget view(
    core.AuthUser? u, {
    Set<core.SignInMethod> available = const <core.SignInMethod>{
      core.SignInMethod.apple,
      core.SignInMethod.google,
    },
    Future<void> Function(core.SignInMethod)? onLink,
    Future<core.AuthUser> Function(core.SignInMethod)? onUnlink,
  }) => Scaffold(
    body: ConnectedAccountsView(
      user: u,
      available: available,
      onLink: onLink ?? (_) async {},
      onUnlink: onUnlink ?? (_) async => u!,
    ),
  );

  Finder statusOf(core.SignInMethod m, String text) => find.descendant(
    of: find.byKey(ConnectedAccountsView.row(m)),
    matching: find.text(text),
  );

  // ── THE WIDTH DECISION, AT ALL THREE WINDOW CLASSES ───────────────────────
  group(
    'property: connected-accounts-holds-the-form-cap at every window class',
    () {
      Future<double> rowWidthAt(WidgetTester tester, Size size) async {
        await pumpChassis(tester, size, view(user(oauth: <String>['apple'])));
        return tester
            .getSize(
              find.byKey(ConnectedAccountsView.row(core.SignInMethod.apple)),
            )
            .width;
      }

      testWidgets('kPhone — narrower than the cap, so the list yields', (
        WidgetTester tester,
      ) async {
        expect(await rowWidthAt(tester, kPhone), lessThan(kPhone.width));
      });

      testWidgets('kTablet — the cap holds', (WidgetTester tester) async {
        expect(await rowWidthAt(tester, kTablet), AppBreakpoints.form);
      });

      testWidgets('kDesktop — the cap still holds', (
        WidgetTester tester,
      ) async {
        expect(await rowWidthAt(tester, kDesktop), AppBreakpoints.form);
      });
    },
  );

  testWidgets('🔴 the ONLY method has no Remove button, and says why', (
    WidgetTester tester,
  ) async {
    final List<core.SignInMethod> unlinked = <core.SignInMethod>[];
    await pumpChassis(
      tester,
      kPhone,
      view(
        user(password: false, oauth: <String>['apple']),
        onUnlink: (core.SignInMethod m) async {
          unlinked.add(m);
          return user(password: false);
        },
      ),
    );
    expect(
      find.byKey(ConnectedAccountsView.unlinkButton(core.SignInMethod.apple)),
      findsNothing,
    );
    expect(
      statusOf(core.SignInMethod.apple, l10n.connectedAccountsOnlyMethod),
      findsOneWidget,
    );
    // No password identity → no password row; Google can still be added.
    expect(
      find.byKey(ConnectedAccountsView.row(core.SignInMethod.password)),
      findsNothing,
    );
    expect(
      find.byKey(ConnectedAccountsView.linkButton(core.SignInMethod.google)),
      findsOneWidget,
    );
    expect(unlinked, isEmpty);
  });

  testWidgets('lists password, Apple and Google; links one, unlinks one', (
    WidgetTester tester,
  ) async {
    final List<core.SignInMethod> linked = <core.SignInMethod>[];
    await pumpChassis(
      tester,
      kPhone,
      view(
        user(oauth: <String>['apple']),
        onLink: (core.SignInMethod m) async => linked.add(m),
        onUnlink: (core.SignInMethod m) async => user(),
      ),
    );
    for (final core.SignInMethod m in core.SignInMethod.values) {
      expect(find.byKey(ConnectedAccountsView.row(m)), findsOneWidget);
    }
    expect(
      statusOf(core.SignInMethod.password, l10n.connectedAccountsConnected),
      findsOneWidget,
    );
    // The password is never offered for removal from here.
    expect(
      find.byKey(
        ConnectedAccountsView.unlinkButton(core.SignInMethod.password),
      ),
      findsNothing,
    );

    await tester.tap(
      find.byKey(ConnectedAccountsView.linkButton(core.SignInMethod.google)),
    );
    await tester.pumpAndSettle();
    expect(linked, <core.SignInMethod>[core.SignInMethod.google]);

    await tester.tap(
      find.byKey(ConnectedAccountsView.unlinkButton(core.SignInMethod.apple)),
    );
    await tester.pumpAndSettle();
    // The row moved on the seam's answer: Apple is now one to connect.
    expect(
      statusOf(core.SignInMethod.apple, l10n.connectedAccountsNotConnected),
      findsOneWidget,
    );
    expect(
      find.byKey(ConnectedAccountsView.linkButton(core.SignInMethod.apple)),
      findsOneWidget,
    );
  });

  testWidgets('an unconfirmed address cannot link — the takeover rule', (
    WidgetTester tester,
  ) async {
    await pumpChassis(tester, kPhone, view(user(verified: false)));
    expect(
      find.byKey(ConnectedAccountsView.linkButton(core.SignInMethod.apple)),
      findsNothing,
    );
    expect(
      statusOf(core.SignInMethod.apple, l10n.connectedAccountsVerifyFirst),
      findsOneWidget,
    );
  });

  testWidgets('a method this build cannot link is not offered', (
    WidgetTester tester,
  ) async {
    await pumpChassis(
      tester,
      kPhone,
      view(user(), available: const <core.SignInMethod>{}),
    );
    expect(
      find.byKey(ConnectedAccountsView.row(core.SignInMethod.google)),
      findsNothing,
    );
  });

  testWidgets('a refusal reads as a sentence, never the server English', (
    WidgetTester tester,
  ) async {
    await pumpChassis(
      tester,
      kPhone,
      view(
        user(oauth: <String>['apple']),
        onUnlink: (_) async => throw core.AuthFailure(
          'User must have at least 1 identity after unlinking',
          code: core.AuthFailure.lastSignInMethod,
        ),
      ),
    );
    await tester.tap(
      find.byKey(ConnectedAccountsView.unlinkButton(core.SignInMethod.apple)),
    );
    await tester.pumpAndSettle();
    expect(
      tester.widget<Text>(find.byKey(ConnectedAccountsView.statusLine)).data,
      l10n.authLastSignInMethod,
    );
  });
}
