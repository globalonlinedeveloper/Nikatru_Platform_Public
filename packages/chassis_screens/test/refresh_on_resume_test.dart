import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/shell/app_shell.dart';

/// ST-N6 — the platform's "back to the front" edge reaches the app's re-read.
void main() {
  testWidgets(
    'paused -> resumed re-reads; a resume inside the floor does not',
    (WidgetTester tester) async {
      DateTime now = DateTime.utc(2026, 9, 30, 12);
      int runs = 0;
      await tester.pumpWidget(
        RefreshOnResume(
          onRefresh: () async => runs++,
          clock: () => now,
          child: const SizedBox.shrink(),
        ),
      );

      now = now.add(const Duration(minutes: 5));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(runs, 1);

      // A focus flick straight back (desktop/web): inactive -> resumed.
      now = now.add(const Duration(seconds: 2));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(runs, 1);
    },
  );

  testWidgets('unmounted, it stops listening', (WidgetTester tester) async {
    DateTime now = DateTime.utc(2026, 9, 30, 12);
    int runs = 0;
    await tester.pumpWidget(
      RefreshOnResume(
        onRefresh: () async => runs++,
        clock: () => now,
        child: const SizedBox.shrink(),
      ),
    );
    await tester.pumpWidget(const SizedBox.shrink());
    now = now.add(const Duration(minutes: 5));
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(runs, 0);
  });
}
