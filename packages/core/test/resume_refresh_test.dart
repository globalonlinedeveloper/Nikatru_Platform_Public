import 'dart:async';

import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// ST-N6 — a return to the app re-reads the server, but window switching is
/// not traffic.
void main() {
  late DateTime now;
  late int runs;
  late ResumeRefresh resume;

  setUp(() {
    now = DateTime.utc(2026, 9, 30, 12);
    runs = 0;
    resume = ResumeRefresh(
      refresh: () async => runs++,
      elapsed: () => now.difference(DateTime.utc(2026)),
    );
  });

  test(
    'a resume inside the floor of the launch read re-reads nothing',
    () async {
      now = now.add(const Duration(seconds: 5));
      expect(await resume.onResumed(), isFalse);
      expect(runs, 0);
    },
  );

  test('a resume past the floor re-reads, once', () async {
    now = now.add(ResumeRefresh.defaultMinInterval);
    expect(await resume.onResumed(), isTrue);
    expect(runs, 1);
    // Alt-tab straight back: the floor restarts from the read just made.
    now = now.add(const Duration(seconds: 1));
    expect(await resume.onResumed(), isFalse);
    expect(runs, 1);
  });

  test('pull-to-refresh ignores the floor', () async {
    await resume.refreshNow();
    await resume.refreshNow();
    expect(runs, 2);
  });

  test('calls during one re-read share it', () async {
    final Completer<void> gate = Completer<void>();
    int started = 0;
    final ResumeRefresh slow = ResumeRefresh(
      refresh: () {
        started++;
        return gate.future;
      },
      elapsed: () => now.difference(DateTime.utc(2026)),
    );
    final Future<void> a = slow.refreshNow();
    final Future<void> b = slow.refreshNow();
    expect(started, 1);
    gate.complete();
    await Future.wait(<Future<void>>[a, b]);
    await slow.refreshNow();
    expect(started, 2);
  });

  test('a failing re-read never throws, and the next one still runs', () async {
    int attempts = 0;
    final ResumeRefresh failing = ResumeRefresh(
      // Throws BEFORE any await: the case that once left a finished future
      // marked in flight forever.
      refresh: () {
        attempts++;
        throw StateError('offline');
      },
      elapsed: () => now.difference(DateTime.utc(2026)),
    );
    await failing.refreshNow();
    await Future<void>.delayed(Duration.zero);
    await failing.refreshNow();
    expect(attempts, 2);
  });
}
