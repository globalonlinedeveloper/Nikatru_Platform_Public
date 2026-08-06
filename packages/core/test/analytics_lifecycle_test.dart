import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// Records what the rail was asked to log, with no consent gate and no
/// transport. The gate is the CALLER's job (see [AnalyticsLifecycle]), so a fake
/// that refuses would be testing the wrong object.
class _RecordingAnalytics implements Analytics {
  final List<String> names = <String>[];
  final List<Map<String, Object?>?> params = <Map<String, Object?>?>[];

  @override
  Future<void> log(String event, {Map<String, Object?>? params}) async {
    names.add(event);
    this.params.add(params);
  }

  @override
  Future<void> flush() async {}

  @override
  Future<void> purge() async {}
}

/// A store whose reads throw — analytics must never be the reason a launch
/// fails, so the trio has to swallow this rather than propagate it.
class _BrokenStore implements KeyValueStore {
  @override
  Future<bool> containsKey(String key) async => throw StateError('disk');
  @override
  Future<String?> read(String key) async => throw StateError('disk');
  @override
  Future<void> remove(String key) async => throw StateError('disk');
  @override
  Future<void> write(String key, String value) async =>
      throw StateError('disk');
}

void main() {
  group('AnalyticsLifecycle — the launch trio ([pipeline 11]E-5)', () {
    test('a fresh install emits first_launch AND app_open, not return_visit',
        () async {
      final _RecordingAnalytics a = _RecordingAnalytics();
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();

      await AnalyticsLifecycle(analytics: a, store: store).onLaunch();

      expect(a.names, <String>['first_launch', 'app_open']);
    });

    // 🔴 THE ASSERTION A SINGLE RUN CANNOT MAKE. A flag that fires every launch
    // and a flag that fires once are indistinguishable from one launch, and
    // firing every time turns the new-user denominator into a launch count.
    test(
        'the SECOND launch emits app_open and return_visit, never a second '
        'first_launch', () async {
      final _RecordingAnalytics a = _RecordingAnalytics();
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final DateTime day1 = DateTime.utc(2026, 8, 1, 9);

      await AnalyticsLifecycle(analytics: a, store: store, clock: () => day1)
          .onLaunch();
      a.names.clear();
      a.params.clear();

      await AnalyticsLifecycle(
        analytics: a,
        store: store,
        clock: () => day1.add(const Duration(days: 3)),
      ).onLaunch();

      expect(a.names, <String>['app_open', 'return_visit']);
      expect(a.params.last, <String, Object?>{'days_since_last': '2_7'});
    });

    test('a third launch still never re-emits first_launch', () async {
      final _RecordingAnalytics a = _RecordingAnalytics();
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      for (int i = 0; i < 3; i++) {
        await AnalyticsLifecycle(
          analytics: a,
          store: store,
          clock: () => DateTime.utc(2026, 8, 1 + i),
        ).onLaunch();
      }
      expect(a.names.where((String e) => e == 'first_launch').length, 1);
      expect(a.names.where((String e) => e == 'app_open').length, 3);
      expect(a.names.where((String e) => e == 'return_visit').length, 2);
    });

    // The marker means "first_launch was EMITTED", not "the app has run". A
    // user who declined on run 1 collected nothing; spending their one
    // first_launch on that run would lose it forever.
    test('the marker is only written once the event has been logged', () async {
      final _RecordingAnalytics a = _RecordingAnalytics();
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      expect(await store.read(kFirstLaunchEmittedKey), isNull);

      await AnalyticsLifecycle(analytics: a, store: store).onLaunch();

      expect(await store.read(kFirstLaunchEmittedKey), '1');
      expect(await store.read(kLastOpenKey), isNotNull);
    });

    test('same-day return is still a return', () async {
      final _RecordingAnalytics a = _RecordingAnalytics();
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final DateTime t = DateTime.utc(2026, 8, 1, 9);
      await AnalyticsLifecycle(analytics: a, store: store, clock: () => t)
          .onLaunch();
      await AnalyticsLifecycle(
        analytics: a,
        store: store,
        clock: () => t.add(const Duration(hours: 4)),
      ).onLaunch();
      expect(a.names, contains('return_visit'));
      expect(a.params.last, <String, Object?>{'days_since_last': 'same_day'});
    });

    test('days_since_last is bucketed, never a raw count', () {
      expect(AnalyticsLifecycle.bucketDaysSinceLast(-1), 'same_day');
      expect(AnalyticsLifecycle.bucketDaysSinceLast(0), 'same_day');
      expect(AnalyticsLifecycle.bucketDaysSinceLast(1), '1');
      expect(AnalyticsLifecycle.bucketDaysSinceLast(2), '2_7');
      expect(AnalyticsLifecycle.bucketDaysSinceLast(7), '2_7');
      expect(AnalyticsLifecycle.bucketDaysSinceLast(8), '8_30');
      expect(AnalyticsLifecycle.bucketDaysSinceLast(30), '8_30');
      expect(AnalyticsLifecycle.bucketDaysSinceLast(31), '30_plus');
    });

    // Bucketing is not cosmetic: the value has to survive the envelope's
    // sanitiser, which drops anything that is not an enumerable scalar.
    test('the emitted param survives sanitizeParams unchanged', () {
      final Map<String, Object?> p = sanitizeParams(<String, Object?>{
        'days_since_last': AnalyticsLifecycle.bucketDaysSinceLast(3),
      });
      expect(p, <String, Object?>{'days_since_last': '2_7'});
    });

    test('a broken store never breaks the launch', () async {
      final _RecordingAnalytics a = _RecordingAnalytics();
      await expectLater(
        AnalyticsLifecycle(analytics: a, store: _BrokenStore()).onLaunch(),
        completes,
      );
    });

    // An unparseable stored timestamp must not invent a return.
    test('a corrupt last_open is ignored rather than guessed at', () async {
      final _RecordingAnalytics a = _RecordingAnalytics();
      final InMemoryKeyValueStore store = InMemoryKeyValueStore(
        <String, String>{
          kFirstLaunchEmittedKey: '1',
          kLastOpenKey: 'not-a-date',
        },
      );
      await AnalyticsLifecycle(analytics: a, store: store).onLaunch();
      expect(a.names, <String>['app_open']);
    });
  });
}
