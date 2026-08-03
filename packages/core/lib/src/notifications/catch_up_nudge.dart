/// WHEN to show the in-app catch-up nudge — [pipeline T-8].
///
/// 🔴 WHY A NUDGE EXISTS AT ALL, AND WHY IT IS PERMANENT. Three of the six
/// platforms this factory ships to cannot schedule a repeating local
/// notification, and **no version of the pinned plugin family changes that**:
/// its own limitations text records that Windows throws on repeating
/// notifications, Linux has no scheduler API, and browsers support neither
/// scheduled nor repeating notifications. Web is the only live platform today.
/// So the fallback is not a bridge to a future release — it is the standing
/// design for half the matrix, and it is the difference between "reminders are
/// on" and a switch that quietly does nothing.
///
/// The mechanism is deliberately the humblest one that works: when the app is
/// next opened AFTER the moment the reminder would have fired, say so once. No
/// background work, no polling, no wake-up the OS refuses to grant.
///
/// ── PURE, AND WHY THAT IS THE POINT ─────────────────────────────────────────
/// Every input is a parameter, so the interesting rows are reachable from a
/// test. A predicate that could only be evaluated against the real clock, the
/// real store and the real platform would have its "already shown" branch
/// exercised on precisely no CI run — the same argument [ReviewGate] is split
/// for, and the same one that keeps this file in `core` rather than in a widget.
///
/// ── NO INVENTED NUMBER LIVES HERE ───────────────────────────────────────────
/// There is no cooldown, no cap, no "at most N per week" constant, because
/// none of those is derivable. The ONLY clock this reads is the reminder time
/// the app is already configured with (`AppConfig.reminderHour` /
/// `reminderMinute`), and the only rule over it is that a daily reminder
/// happens once a day, so its catch-up happens at most once per occurrence.
/// The rate is therefore a consequence of the configuration, not a threshold
/// somebody chose.
library;

/// Why the nudge is, or is not, due. Returned rather than logged, because
/// "the platform already schedules" and "the user turned reminders off" and
/// "it is 8 a.m." are indistinguishable from a boolean and need completely
/// different fixes.
enum CatchUpNudgeVerdict {
  /// Show it: the reminder's moment has passed today and nothing has said so.
  show,

  /// The OS will deliver a real notification here. An in-app nudge on top of it
  /// is the same message twice, which is how a helpful feature becomes noise.
  platformSchedules,

  /// The user said no. This is an opt-out, and an in-app surface is still a
  /// notification — routing around the switch is exactly the behaviour the
  /// switch exists to prevent.
  remindersOff,

  /// Today's reminder time has not arrived. A "catch-up" before the thing it
  /// catches up on is just an interruption.
  notDueYet,

  /// Already said once for this occurrence.
  alreadyShownToday,
}

/// The rule.
///
/// Stateless and `const`: the persisted history is passed in, so the same
/// instance decides for any app and any test without carrying anything.
class CatchUpNudge {
  const CatchUpNudge();

  /// Decide.
  ///
  /// ⚠️ [now] and [lastShownAt] must both be LOCAL times, and so is the instant
  /// this builds from [reminderHour]/[reminderMinute] — the reminder is a
  /// wall-clock promise ("every evening at eight"), not an instant on a
  /// timeline. Comparing a local wall clock against a UTC stamp is the exact
  /// shape of the defect that made a 09:00 reminder fire at 14:30 IST, so the
  /// three are normalised to one another here and the caller owns nothing.
  ///
  /// [platformCanSchedule] comes from the adapter's capability matrix and is a
  /// parameter rather than a lookup so every platform row — including the web
  /// row, which `kIsWeb` makes a compile-time constant and therefore
  /// unreachable from a widget test — is reachable from here.
  CatchUpNudgeVerdict decide({
    required DateTime now,
    required DateTime? lastShownAt,
    required int reminderHour,
    required int reminderMinute,
    required bool remindersEnabled,
    required bool platformCanSchedule,
  }) {
    if (platformCanSchedule) return CatchUpNudgeVerdict.platformSchedules;
    if (!remindersEnabled) return CatchUpNudgeVerdict.remindersOff;

    final DateTime local = now.toLocal();
    final DateTime dueAt = DateTime(
      local.year,
      local.month,
      local.day,
      reminderHour,
      reminderMinute,
    );
    // Exactly-at counts as due. A reminder promised at 20:00 that a caller
    // observes at exactly 20:00 has happened.
    if (local.isBefore(dueAt)) return CatchUpNudgeVerdict.notDueYet;

    final DateTime? last = lastShownAt?.toLocal();
    // `!isBefore`, not `isAfter`: a nudge shown at the same instant the reminder
    // was due has been shown for that occurrence.
    if (last != null && !last.isBefore(dueAt)) {
      return CatchUpNudgeVerdict.alreadyShownToday;
    }
    return CatchUpNudgeVerdict.show;
  }
}
