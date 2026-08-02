import 'dart:async';

import '../analytics/analytics.dart';
import 'flag_resolver.dart';

/// The event name every rollout measurement joins on.
///
/// A rollout you cannot measure is a coin toss with extra steps: without an
/// exposure event there is no denominator, so "did variant B convert better"
/// has no answer that is not a guess about who saw B at all.
const String kVariantExposedEvent = 'variant_exposed';

/// A [FeatureFlags] that RECORDS the decision it just made.
///
/// 🔴 WHY THIS TYPE EXISTS. `resolveFlag` has been in the tree since CFG G-14
/// and `grep -rn variant_exposed` matched NOTHING, in any language. Every
/// percentage rollout the chassis can express was therefore unmeasurable by
/// construction: the client decided on/off locally and told nobody, so the only
/// way to learn who was in the treatment group was to re-derive it later from a
/// bucketing id and a rollout percentage that had since moved. Rollout percents
/// are not versioned; once ramped, the past is unrecoverable.
///
/// ⚠️ THE BUCKET ON THE EVENT IS THE SAME FUNCTION THE DECISION USED —
/// [flagBucket], not a re-implementation and not a second hash. Two independent
/// bucketing ids is the exact failure `migrations/0002_analytics.sql` warns
/// about for `anon_id`: the analysis would attribute sessions to the wrong arm
/// and nothing would ever look wrong.
///
/// ONE EXPOSURE PER FLAG PER SESSION. A screen that reads a flag in `build()`
/// reads it on every frame; unbounded emission would flood a 100k-writes/day
/// budget from one widget rebuilding. The dedupe key is the FLAG ALONE, not
/// flag+variant: if a config refresh flips a flag mid-session, the session is
/// still attributed to the arm it was FIRST shown, which is the conservative
/// reading — the user experienced the first variant.
///
/// CONSENT IS NOT BYPASSED, and cannot be. Emission goes through the [Analytics]
/// facade, so an undecided or withdrawn consent state means the recorder
/// discards it exactly as it discards every other event. There is no second path
/// to the wire here.
class ObservedFeatureFlags implements FeatureFlags {
  ObservedFeatureFlags(
      {required FeatureFlags flags, required Analytics analytics})
      : _flags = flags,
        _analytics = analytics;

  final FeatureFlags _flags;
  final Analytics _analytics;
  final Set<String> _exposed = <String>{};

  @override
  Map<String, int> get rollouts => _flags.rollouts;

  @override
  String get stableId => _flags.stableId;

  /// Whether [flag] is rolled out to this device, and — the first time this
  /// session — an exposure event saying so.
  @override
  bool isOn(String flag) {
    final bool value = _flags.isOn(flag);
    if (_exposed.add(flag)) {
      unawaited(_record(flag, value));
    }
    return value;
  }

  /// Start a new measurement session: the next read of each flag emits again.
  ///
  /// Exposed rather than inferred from a clock because this object does not own
  /// the session — [AnalyticsRecorder] does, and reaching into it from here
  /// would be two places deciding when a session ended.
  void resetSession() => _exposed.clear();

  /// The flags this instance has already reported this session. Present so a
  /// test can assert the dedupe rather than infer it from a call count.
  Set<String> get exposedFlags => Set<String>.unmodifiable(_exposed);

  Future<void> _record(String flag, bool value) async {
    try {
      await _analytics.log(
        kVariantExposedEvent,
        params: <String, Object?>{
          'flag': flag,
          // 'on'/'off' rather than a bool: the params column is enumerable
          // values only, and an arm named in words survives a schema that later
          // carries three arms instead of two.
          'variant': value ? 'on' : 'off',
          // THE JOIN KEY. Same function, same inputs as the decision above.
          'bucket': flagBucket(flag: flag, stableId: _flags.stableId),
        },
      );
    } catch (_) {
      // Best effort by contract: measuring a flag must never be able to break
      // the feature the flag guards.
    }
  }
}
