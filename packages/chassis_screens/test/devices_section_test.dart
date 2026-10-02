// DevicesSection (SE-03) — the account's signed-in devices, and signing ONE
// other device out.
//
// ⏱ 2026-10-01 · train ST-SETTINGS. 🔴 RED CONTROL: "revoking one leaves the
// current session alive" — the revoke names exactly the OTHER session, the
// current one is never offered a sign-out, and its row stays.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
// The DECLARING file, so assert-responsive-coverage keys this suite to it.
import 'package:nikatru_chassis_screens/settings/devices_section.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/width_harness.dart';

const String _current = 'current-session';
const String _phone = 'phone-session';

final List<core.DeviceSession> _two = <core.DeviceSession>[
  // The host's order is not "this device first"; the section's is.
  core.DeviceSession(
    id: _phone,
    current: false,
    device: 'Safari on iPhone',
    lastActiveAt: DateTime.utc(2026, 9, 30, 12),
  ),
  const core.DeviceSession(
    id: _current,
    current: true,
    device: 'Chrome on Windows',
  ),
];

class _Calls {
  final List<String> revoked = <String>[];
  int loads = 0;
  bool failRevoke = false;
  bool failLoad = false;
}

/// Pumps the section in a list; [open] taps "See where you are signed in",
/// which is the only thing that reads the list. [tail] puts a tall block
/// after it, so the section can be scrolled out of the list's cache.
Future<_Calls> _pump(
  WidgetTester tester, {
  _Calls? calls,
  bool open = true,
  bool tail = false,
}) async {
  final _Calls c = calls ?? _Calls();
  await tester.pumpWidget(
    MaterialApp(
      localizationsDelegates: ChassisLocalizations.localizationsDelegates,
      supportedLocales: ChassisLocalizations.supportedLocales,
      home: Scaffold(
        body: ListView(
          key: const Key('list'),
          children: <Widget>[
            DevicesSection(
              load: () async {
                c.loads++;
                return c.failLoad
                    ? const core.Result<List<core.DeviceSession>>.err(
                        core.Failure('down'),
                      )
                    : core.Result<List<core.DeviceSession>>.ok(_two);
              },
              revoke: (String id) async {
                c.revoked.add(id);
                return c.failRevoke
                    ? const core.Result<void>.err(core.Failure('down'))
                    : const core.Result<void>.ok(null);
              },
            ),
            if (tail) const SizedBox(height: 5000),
          ],
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  if (open) {
    await tester.tap(find.byKey(DevicesSection.show));
    await tester.pumpAndSettle();
  }
  return c;
}

void main() {
  // ⏱ 2026-10-01 · review of #1129, finding 4: the host's sessions limiter
  // (5 a minute per account) is shared by this read and the revoke beside
  // it, so a read on every mount could spend the revoke's budget.
  testWidgets('🔴 nothing is read until the person asks', (
    WidgetTester tester,
  ) async {
    final _Calls c = await _pump(tester, open: false);
    expect(c.loads, 0, reason: 'the list was read on mount');
    expect(find.byKey(DevicesSection.show), findsOneWidget);
    await tester.tap(find.byKey(DevicesSection.show));
    await tester.pumpAndSettle();
    expect(c.loads, 1);
    expect(find.byKey(DevicesSection.row(_phone)), findsOneWidget);
  });

  testWidgets('🔴 scrolled away and back, the list is NOT read again', (
    WidgetTester tester,
  ) async {
    final _Calls c = await _pump(tester, tail: true);
    expect(c.loads, 1);
    await tester.drag(find.byKey(const Key('list')), const Offset(0, -4000));
    await tester.pumpAndSettle();
    await tester.drag(find.byKey(const Key('list')), const Offset(0, 4000));
    await tester.pumpAndSettle();
    expect(c.loads, 1, reason: 'remounting the section read the list again');
    expect(find.byKey(DevicesSection.row(_phone)), findsOneWidget);
  });

  testWidgets('lists every device, this one first and marked', (
    WidgetTester tester,
  ) async {
    final _Calls c = await _pump(tester);
    expect(c.loads, 1);
    expect(find.text('Your devices'), findsOneWidget);
    expect(find.byKey(DevicesSection.row(_current)), findsOneWidget);
    expect(find.byKey(DevicesSection.row(_phone)), findsOneWidget);
    expect(
      tester.getTopLeft(find.byKey(DevicesSection.row(_current))).dy,
      lessThan(tester.getTopLeft(find.byKey(DevicesSection.row(_phone))).dy),
    );
    expect(find.text('This device'), findsOneWidget);
    expect(find.textContaining('Last active'), findsOneWidget);
  });

  testWidgets('🔴 revoking ONE leaves the current session alive', (
    WidgetTester tester,
  ) async {
    final _Calls c = await _pump(tester);
    expect(
      find.byKey(DevicesSection.signOutButton(_current)),
      findsNothing,
      reason: 'this device was offered a by-id revoke — that is "Log out"',
    );
    await tester.tap(find.byKey(DevicesSection.signOutButton(_phone)));
    await tester.pumpAndSettle();
    expect(c.revoked, <String>[_phone]);
    expect(find.byKey(DevicesSection.row(_phone)), findsNothing);
    expect(find.byKey(DevicesSection.row(_current)), findsOneWidget);
  });

  testWidgets('a failed revoke keeps the row and SAYS so', (
    WidgetTester tester,
  ) async {
    final _Calls c = await _pump(tester, calls: _Calls()..failRevoke = true);
    await tester.tap(find.byKey(DevicesSection.signOutButton(_phone)));
    await tester.pumpAndSettle();
    expect(c.revoked, <String>[_phone]);
    expect(find.byKey(DevicesSection.row(_phone)), findsOneWidget);
    expect(
      find.text('That device could not be signed out. Try again.'),
      findsOneWidget,
    );
  });

  testWidgets('a failed read is said, never an empty list', (
    WidgetTester tester,
  ) async {
    final _Calls c = await _pump(tester, calls: _Calls()..failLoad = true);
    expect(find.byKey(DevicesSection.unavailable), findsOneWidget);
    expect(find.byType(TextButton), findsNothing);
    // ...and it can be tried again from the row that says so.
    c.failLoad = false;
    await tester.tap(find.byKey(DevicesSection.unavailable));
    await tester.pumpAndSettle();
    expect(c.loads, 2);
    expect(find.byKey(DevicesSection.row(_phone)), findsOneWidget);
  });

  // ── WIDTH (assert-responsive-coverage) ───────────────────────────────────
  // One body, three NAMED window classes: the guard reads the sizes a case
  // pumps statically, and a loop variable is not a size it can see. The
  // section sits in a `ContentPane` exactly as a settings page puts it, so the
  // width decision measured is the one a person meets: the rows stop at the
  // pane's cap instead of stretching a phone row across a desktop.
  Future<void> widthCase(
    WidgetTester tester,
    Size size, {
    double scale = 1,
  }) async {
    await pumpChassis(
      tester,
      size,
      MediaQuery(
        data: MediaQueryData(size: size, textScaler: TextScaler.linear(scale)),
        child: Scaffold(
          body: ContentPane(
            child: ListView(
              children: <Widget>[
                DevicesSection(
                  load: () async =>
                      core.Result<List<core.DeviceSession>>.ok(_two),
                  revoke: (String id) async => const core.Result<void>.ok(null),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.byKey(DevicesSection.show));
    await tester.pumpAndSettle();
  }

  void expectContained(WidgetTester tester, Size size) {
    expect(tester.takeException(), isNull);
    final Rect row = tester.getRect(find.byKey(DevicesSection.row(_phone)));
    expect(row.width, lessThanOrEqualTo(AppBreakpoints.kMaxBodyWidth));
    expect(row.right, lessThanOrEqualTo(size.width));
    expect(find.byKey(DevicesSection.signOutButton(_phone)), findsOneWidget);
  }

  testWidgets('width: kPhone', (WidgetTester tester) async {
    await widthCase(tester, kPhone);
    expectContained(tester, kPhone);
  });

  testWidgets('width: kTablet', (WidgetTester tester) async {
    await widthCase(tester, kTablet);
    expectContained(tester, kTablet);
  });

  testWidgets('width: kDesktop', (WidgetTester tester) async {
    await widthCase(tester, kDesktop);
    expectContained(tester, kDesktop);
  });

  testWidgets('200 % text at kPhone: nothing overflows', (
    WidgetTester tester,
  ) async {
    await widthCase(tester, kPhone, scale: 2);
    expectContained(tester, kPhone);
  });
}
