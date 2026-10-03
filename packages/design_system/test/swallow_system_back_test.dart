import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// A router config with nothing to route: only its back-button dispatcher is
/// read by [SwallowSystemBack].
RouterConfig<Object?> _config(BackButtonDispatcher dispatcher) =>
    RouterConfig<Object?>(
      routerDelegate: _NoDelegate(),
      backButtonDispatcher: dispatcher,
    );

class _NoDelegate extends RouterDelegate<Object?> with ChangeNotifier {
  @override
  Widget build(BuildContext context) => const SizedBox.shrink();

  @override
  Future<bool> popRoute() async => false;

  @override
  Future<void> setNewRoutePath(Object? configuration) async {}
}

void main() {
  // ⏱ 2026-10-01 · EN-11 — MUTATION PROOF: make `_handled` answer false, or
  // drop `takePriority()`, and the mounted case reads "not handled".
  testWidgets('the system back is handled while mounted, and not after', (
    WidgetTester tester,
  ) async {
    final RootBackButtonDispatcher root = RootBackButtonDispatcher();
    bool routerSawIt = false;
    root.addCallback(() async {
      routerSawIt = true;
      return false;
    });

    await tester.pumpWidget(SwallowSystemBack(of: _config(root)));
    expect(await root.invokeCallback(Future<bool>.value(false)), isTrue);
    expect(routerSawIt, isFalse, reason: 'the page under the scrim popped');

    await tester.pumpWidget(const SizedBox.shrink());
    expect(await root.invokeCallback(Future<bool>.value(false)), isFalse);
    expect(routerSawIt, isTrue, reason: 'the claim outlived the scrim');
  });

  testWidgets('a router with no dispatcher is left alone', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      SwallowSystemBack(
        of: RouterConfig<Object?>(routerDelegate: _NoDelegate()),
      ),
    );
    expect(tester.takeException(), isNull);
  });

  // ⏱ 2026-10-01 · EN-09 — the page label must never change WHICH locale the
  // app resolves: the callback replaces Flutter's default, so it has to be it.
  test('resolveAndLabelPage resolves exactly as Flutter does', () {
    // locale-list: a fixture for Flutter's resolution rule, not the app's set.
    const List<Locale> supported = <Locale>[Locale('en'), Locale('ta')];
    for (final List<Locale>? preferred in <List<Locale>?>[
      null,
      <Locale>[const Locale('ta', 'IN')],
      <Locale>[const Locale('fr'), const Locale('ta')],
      <Locale>[const Locale('de')],
    ]) {
      expect(
        resolveAndLabelPage(preferred, supported),
        basicLocaleListResolution(preferred, supported),
        reason: '$preferred',
      );
    }
  });
}
