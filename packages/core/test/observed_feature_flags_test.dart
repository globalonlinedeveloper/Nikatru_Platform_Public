import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// Records what was logged, in order. Deliberately NOT a mock framework: the
/// assertions below are about the exact params on the wire.
class _RecordingAnalytics implements Analytics {
  final List<(String, Map<String, Object?>)> logged =
      <(String, Map<String, Object?>)>[];
  bool flushed = false;
  bool purged = false;

  @override
  Future<void> log(String event, {Map<String, Object?>? params}) async {
    logged.add((event, params ?? const <String, Object?>{}));
  }

  @override
  Future<void> flush() async => flushed = true;

  @override
  Future<void> purge() async => purged = true;
}

/// An [Analytics] that always throws — measuring a flag must never be able to
/// break the feature the flag guards.
class _ExplodingAnalytics implements Analytics {
  @override
  Future<void> log(String event, {Map<String, Object?>? params}) async =>
      throw StateError('sink down');

  @override
  Future<void> flush() async => throw StateError('sink down');

  @override
  Future<void> purge() async => throw StateError('sink down');
}

void main() {
  // ───────────────────────────────────────────────────────────────────────────
  // [pipeline 11]E-12 — a rollout is MEASURABLE.
  //
  // 🔴 `grep -rn variant_exposed` matched NOTHING in this repository, in any
  // language, while `resolveFlag` had been shipping since CFG G-14. Every
  // percentage rollout the chassis can express was unmeasurable by
  // construction: the client decided locally and told nobody, and rollout
  // percents are not versioned, so once one is ramped the treatment group
  // cannot be reconstructed.
  // ───────────────────────────────────────────────────────────────────────────

  ObservedFeatureFlags build(
    Analytics analytics, {
    Map<String, int> rollouts = const <String, int>{'newHome': 100, 'off': 0},
    String stableId = 'install-1',
  }) =>
      ObservedFeatureFlags(
        flags: FeatureFlags(rollouts: rollouts, stableId: stableId),
        analytics: analytics,
      );

  test('a flag read emits exactly one exposure per session', () async {
    final _RecordingAnalytics a = _RecordingAnalytics();
    final ObservedFeatureFlags flags = build(a);

    expect(flags.isOn('newHome'), isTrue);
    // A flag read inside build() runs on every frame; unbounded emission is one
    // widget emptying a shared write budget.
    flags.isOn('newHome');
    flags.isOn('newHome');
    await Future<void>.delayed(Duration.zero);

    expect(a.logged, hasLength(1));
    expect(a.logged.single.$1, 'variant_exposed');
  });

  test('the exposure carries flag, variant and THE DECISION\'S bucket',
      () async {
    final _RecordingAnalytics a = _RecordingAnalytics();
    // 40% rollout: on or off depends on the bucket, which is exactly the point.
    final ObservedFeatureFlags flags = build(
      a,
      rollouts: <String, int>{'ramp': 40},
      stableId: 'install-42',
    );
    final bool value = flags.isOn('ramp');
    await Future<void>.delayed(Duration.zero);

    final Map<String, Object?> params = a.logged.single.$2;
    expect(params['flag'], 'ramp');
    expect(params['variant'], value ? 'on' : 'off');
    // 🔒 THE JOIN. The bucket on the event must be the SAME function, with the
    // same inputs, that the decision used — a second hash would attribute
    // sessions to the wrong arm and nothing would ever look wrong.
    expect(params['bucket'], flagBucket(flag: 'ramp', stableId: 'install-42'));
    // …and it must genuinely agree with the decision, not merely be present.
    expect(value, (params['bucket']! as int) < 40);
  });

  test('an off variant is recorded, not silently skipped', () async {
    final _RecordingAnalytics a = _RecordingAnalytics();
    final ObservedFeatureFlags flags = build(a);
    expect(flags.isOn('off'), isFalse);
    await Future<void>.delayed(Duration.zero);
    // Recording only the treatment arm leaves an experiment with a numerator
    // and no denominator.
    expect(a.logged.single.$2['variant'], 'off');
  });

  test('two different flags each get one exposure', () async {
    final _RecordingAnalytics a = _RecordingAnalytics();
    final ObservedFeatureFlags flags = build(a);
    flags.isOn('newHome');
    flags.isOn('off');
    flags.isOn('newHome');
    await Future<void>.delayed(Duration.zero);
    expect(a.logged.map((r) => r.$2['flag']), <String>['newHome', 'off']);
  });

  test('resetSession lets the next read emit again', () async {
    final _RecordingAnalytics a = _RecordingAnalytics();
    final ObservedFeatureFlags flags = build(a);
    flags.isOn('newHome');
    flags.resetSession();
    expect(flags.exposedFlags, isEmpty);
    flags.isOn('newHome');
    await Future<void>.delayed(Duration.zero);
    expect(a.logged, hasLength(2));
  });

  test('the decision itself is untouched — same answers as the raw reader', () {
    final _RecordingAnalytics a = _RecordingAnalytics();
    const FeatureFlags raw = FeatureFlags(
      rollouts: <String, int>{'newHome': 100, 'off': 0},
      stableId: 'install-1',
    );
    final ObservedFeatureFlags flags = build(a);
    for (final String f in <String>['newHome', 'off', 'absent']) {
      expect(flags.isOn(f), raw.isOn(f), reason: f);
    }
    expect(flags.rollouts, raw.rollouts);
    expect(flags.stableId, raw.stableId);
  });

  test('a broken sink cannot break the feature the flag guards', () async {
    final ObservedFeatureFlags flags = build(_ExplodingAnalytics());
    // Not `expect(..., returnsNormally)` alone: the emission is fire-and-forget,
    // so the throw has to be swallowed inside the future too or it surfaces as
    // an unhandled async error and fails this test.
    expect(flags.isOn('newHome'), isTrue);
    await Future<void>.delayed(Duration.zero);
    expect(flags.isOn('newHome'), isTrue);
  });

  test('exposedFlags is a snapshot callers cannot mutate', () {
    final ObservedFeatureFlags flags = build(_RecordingAnalytics());
    flags.isOn('newHome');
    expect(() => flags.exposedFlags.add('injected'), throwsUnsupportedError);
  });
}
