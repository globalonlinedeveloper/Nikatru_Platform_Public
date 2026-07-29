/// WHEN to ask for a store review — [pipeline C-13].
///
/// Split from [ReviewPrompter] and made PURE on purpose. The original refusal to
/// build this screen was "there are no users to ask", which is an argument about
/// timing, not about whether the mechanism can be built and proven. Timing is
/// exactly what this file is, and it is decidable today with no users at all: it
/// is arithmetic over four persisted numbers.
///
/// Pure also means the interesting cases are reachable from a test. A gate that
/// could only be evaluated against the real clock and real storage would have
/// its "asked too recently" branch exercised on precisely no CI run.
library;

/// The persisted history the decision is made from.
class ReviewGateState {
  const ReviewGateState({
    this.launches = 0,
    this.firstLaunch,
    this.lastAskedAt,
    this.timesAsked = 0,
    this.suppressed = false,
  });

  /// How many times the app has been opened.
  final int launches;

  /// When this install was first seen. Null until the first launch is recorded.
  final DateTime? firstLaunch;

  /// When the prompt was last requested, or null if never.
  final DateTime? lastAskedAt;

  /// How many times we have ever asked, across the life of the install.
  final int timesAsked;

  /// Set when the user has told us not to ask again. Never cleared by the
  /// chassis: a person who declined once should not be asked again because a
  /// counter rolled over.
  final bool suppressed;

  ReviewGateState copyWith({
    int? launches,
    DateTime? firstLaunch,
    DateTime? lastAskedAt,
    int? timesAsked,
    bool? suppressed,
  }) =>
      ReviewGateState(
        launches: launches ?? this.launches,
        firstLaunch: firstLaunch ?? this.firstLaunch,
        lastAskedAt: lastAskedAt ?? this.lastAskedAt,
        timesAsked: timesAsked ?? this.timesAsked,
        suppressed: suppressed ?? this.suppressed,
      );

  Map<String, Object?> toJson() => <String, Object?>{
        'launches': launches,
        if (firstLaunch != null)
          'first_launch': firstLaunch!.toUtc().toIso8601String(),
        if (lastAskedAt != null)
          'last_asked_at': lastAskedAt!.toUtc().toIso8601String(),
        'times_asked': timesAsked,
        'suppressed': suppressed,
      };

  factory ReviewGateState.fromJson(Map<String, Object?> j) => ReviewGateState(
        launches: j['launches'] is int ? j['launches']! as int : 0,
        firstLaunch: j['first_launch'] is String
            ? DateTime.tryParse(j['first_launch']! as String)
            : null,
        lastAskedAt: j['last_asked_at'] is String
            ? DateTime.tryParse(j['last_asked_at']! as String)
            : null,
        timesAsked: j['times_asked'] is int ? j['times_asked']! as int : 0,
        suppressed: j['suppressed'] == true,
      );
}

/// Why the gate said no. Returned rather than logged, so a caller (and a test)
/// can tell "too early" from "already asked" — which look identical from a
/// boolean and need completely different fixes.
enum ReviewGateVerdict {
  ask,
  tooFewLaunches,
  tooSoonAfterInstall,
  askedTooRecently,
  askedEnoughTimes,
  suppressedByUser,
  platformCannotAsk,
}

/// The rule. Every threshold here is a JUDGEMENT, so each one says what it is
/// protecting rather than sitting as a bare number.
class ReviewGate {
  const ReviewGate({
    this.minLaunches = 5,
    this.minDaysSinceInstall = 3,
    this.minDaysBetweenAsks = 120,
    this.maxAsksEver = 3,
  });

  /// Enough use that the person has an opinion. Asking on first launch asks
  /// someone who has not seen the app yet.
  final int minLaunches;

  /// Someone who opened it five times in one evening is still evaluating it.
  final int minDaysSinceInstall;

  /// 🔴 iOS ignores requests beyond roughly three a year and does not say so —
  /// the call returns normally and nothing appears. Asking more often therefore
  /// does not annoy the user; it silently burns the app's remaining requests
  /// against a dialog nobody sees. 120 days keeps three asks inside a year.
  final int minDaysBetweenAsks;

  /// The same cap, expressed as a total. Beyond this the platform is almost
  /// certainly discarding the request anyway.
  final int maxAsksEver;

  /// Decide. [platformCanAsk] comes from the adapter's capability matrix, and is
  /// a parameter rather than a lookup so all six platform rows are reachable
  /// from a test.
  ReviewGateVerdict decide(
    ReviewGateState state, {
    required DateTime now,
    required bool platformCanAsk,
  }) {
    if (!platformCanAsk) return ReviewGateVerdict.platformCannotAsk;
    if (state.suppressed) return ReviewGateVerdict.suppressedByUser;
    if (state.timesAsked >= maxAsksEver) {
      return ReviewGateVerdict.askedEnoughTimes;
    }
    if (state.launches < minLaunches) return ReviewGateVerdict.tooFewLaunches;

    final DateTime? first = state.firstLaunch;
    // An unknown install date is treated as TOO SOON, not as long ago. Failing
    // open here would ask on the first launch after an upgrade that introduced
    // this feature, which is the worst possible moment.
    if (first == null) return ReviewGateVerdict.tooSoonAfterInstall;
    if (now.toUtc().difference(first.toUtc()).inDays < minDaysSinceInstall) {
      return ReviewGateVerdict.tooSoonAfterInstall;
    }

    final DateTime? last = state.lastAskedAt;
    if (last != null &&
        now.toUtc().difference(last.toUtc()).inDays < minDaysBetweenAsks) {
      return ReviewGateVerdict.askedTooRecently;
    }
    return ReviewGateVerdict.ask;
  }
}
