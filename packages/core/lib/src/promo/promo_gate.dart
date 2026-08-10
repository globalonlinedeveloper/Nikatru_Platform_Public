/// WHEN an in-app promotional card may be shown — [ADR 040 · research/44 §4.3].
///
/// Modelled on `ReviewGate`, and PURE for the same reason: every input is a
/// parameter, so every refusal is reachable from a test. A governor that could
/// only be evaluated against the real clock, the real config document and the
/// real campaign payload would have its "shown too recently" branch exercised on
/// precisely no CI run — and that branch is the entire feature. Its absence is
/// what India's CCPA Dark Patterns Guidelines 2023 call **Nagging** and what
/// Play calls **Made for Ads**; research/44 V5 lists *"repeated promotional
/// prompts with no governor"* as forbidden in all configurations.
///
/// ── THREE JOBS, ONE PRIMITIVE ───────────────────────────────────────────────
/// 1. the frequency governor  — [PromoGate.minDaysBetweenShows] / [PromoGate.maxShowsEver]
/// 2. the dismissal latch     — [PromoGateState.dismissed]
/// 3. the GDPR Art 21 objection — [PromoGateState.suppressed]
///
/// (3) is the one that makes the whole surface lawful. research/44 V4: in-app
/// first-party promotion runs on LEGITIMATE INTEREST (GDPR Recital 47), not on
/// consent — and Art 21(2)/(3) makes the objection **absolute**: *"the data
/// subject shall have the right to object at any time"*, after which *"the
/// personal data shall no longer be processed for such purposes."* So the latch
/// is not a preference the chassis may weigh against a counter. It is the thing
/// the legal basis is bought with.
///
/// ── WHAT THIS FILE DELIBERATELY IS NOT ──────────────────────────────────────
/// No UI, no I/O, no config read, and **no clock** — the caller passes `now`.
/// The widget lives in `packages/design_system` and takes its decision from its
/// caller, exactly as `PaywallGate(locked: …)` does, so design_system gains no
/// domain dependency (research/44 §4.3).
///
/// ⚠️ ONE OBJECTION, NOT TWO — FOR WHOEVER BUILDS research/44 RUNG 4. That rung
/// adds a `promo` purpose to the existing `ConsentPurpose` rail so the
/// append-only artifact trail, the server verification and the withdrawal
/// surface all apply unchanged. When it lands, the objection must have exactly
/// ONE home: either the rail becomes the source of truth and this latch is set
/// from it, or the reverse. Two stores for one legal obligation is how a person
/// objects on the rail, the card keeps rendering off a stale latch, and both
/// halves report healthy. Wiring — not this file — is where that is decided.
///
/// ⚠️ IT IS ALSO NOT THE NOTIFICATION CAP, AND MUST NEVER READ IT. `AppConfig`
/// types a weekly promotional-notification cap on both sides of the config
/// contract, shipping as `0`, and `assert-adapter-capabilities.mjs` [13]T-6
/// FAILS THE BUILD if any Dart file other than `app_config.dart` reads that key
/// — because *"a promotional touch and the cap that bounds it must arrive
/// TOGETHER, and a promotional touch may not share the reminders channel."* An
/// in-app card is a different touch on a different channel, so it carries its
/// own thresholds and reads nothing. Naming that key here in code would arm a
/// tripwire pointed at a subsystem this file is not.
library;

/// The persisted history one promotion is decided from.
///
/// 🔴 SCOPE, AND THE ONE THING THIS PRIMITIVE CANNOT ENFORCE. One record governs
/// ONE promotion; a caller that keys the record per campaign gets a latched
/// dismissal that ends that campaign rather than the surface forever. Nothing
/// here can stop a caller from rotating the key to escape a dismissal — that
/// would be Nagging wearing a fresh id, and it is a doctrine the storage layer
/// owns. Said out loud rather than implied, because an unstated invariant is one
/// nobody knows they broke.
class PromoGateState {
  const PromoGateState({
    this.shownCount = 0,
    this.lastShownAt,
    this.dismissed = false,
    this.suppressed = false,
  });

  /// How many times this promotion has been put on screen.
  final int shownCount;

  /// When it was last put on screen, or null if never.
  final DateTime? lastShownAt;

  /// The user closed the card. research/44 §6 requires the close control and
  /// requires the dismissal **latched** — *"never re-cleared by a counter
  /// roll-over"*. Dismissing is not "not now"; it is an answer.
  final bool dismissed;

  /// The user objected to promotional processing (GDPR Art 21). Ends every
  /// promotion, not just this one — so a caller that keys records per campaign
  /// must still carry ONE objection across all of them.
  ///
  /// Never cleared by the chassis. The only route back is
  /// [withdrawObjection], which exists because Art 21 gives a person the right
  /// to object, not a duty to stay objected — but it is a name a human has to
  /// type on purpose, reachable from no counter, no rollover and no [copyWith].
  final bool suppressed;

  /// Counters only — **the latches are unreachable from here, by construction.**
  ///
  /// `ReviewGateState.copyWith` takes `suppressed`, so `copyWith(suppressed:
  /// false)` clears it and the "never cleared" rule is held by a comment. That
  /// is fine for a rating prompt, where the latch is a courtesy. It is not fine
  /// here, where the latch IS the legal basis: a `copyWith` that can clear it is
  /// one careless keystroke away from processing someone's data for a purpose
  /// they exercised an absolute right to stop. So this one carries the latches
  /// through unconditionally and offers no parameter for them.
  PromoGateState copyWith({int? shownCount, DateTime? lastShownAt}) =>
      PromoGateState(
        shownCount: shownCount ?? this.shownCount,
        lastShownAt: lastShownAt ?? this.lastShownAt,
        dismissed: dismissed,
        suppressed: suppressed,
      );

  /// The close control was used. One-way.
  PromoGateState dismiss() => PromoGateState(
        shownCount: shownCount,
        lastShownAt: lastShownAt,
        dismissed: true,
        suppressed: suppressed,
      );

  /// The Art 21 objection was raised. One-way except through
  /// [withdrawObjection].
  PromoGateState objectToPromotion() => PromoGateState(
        shownCount: shownCount,
        lastShownAt: lastShownAt,
        dismissed: dismissed,
        suppressed: true,
      );

  /// The user turned promotion back on themselves.
  ///
  /// ⚠️ USER-INITIATED ONLY. research/44 V4 requires a toggle, and a toggle that
  /// only travels one way is a trap, not a control. What must never happen is
  /// the CHASSIS travelling this direction — which is why it is a named method
  /// with a sentence for a name and not a settable field. It does not clear
  /// [dismissed]: withdrawing an objection re-enables the surface; it does not
  /// un-answer a card the person already closed.
  PromoGateState withdrawObjection() => PromoGateState(
        shownCount: shownCount,
        lastShownAt: lastShownAt,
        dismissed: dismissed,
        suppressed: false,
      );

  Map<String, Object?> toJson() => <String, Object?>{
        'shown_count': shownCount,
        if (lastShownAt != null)
          'last_shown_at': lastShownAt!.toUtc().toIso8601String(),
        'dismissed': dismissed,
        'suppressed': suppressed,
      };

  /// Read a persisted record — **and fall the safe way on every unreadable
  /// field**, which is a different direction for each one.
  ///
  /// A corrupt record is not a fresh install. `ReviewGateState.fromJson` may
  /// treat one as a fresh install because the cost of being wrong there is one
  /// un-asked rating prompt. Here the two costs are wildly asymmetric: reading a
  /// corrupt record as "never shown, never dismissed, never objected" restarts a
  /// campaign against someone who may have objected to it, which is the one
  /// outcome Art 21(3) forbids outright. So:
  ///
  /// * a latch key that is **absent** reads false (nothing was ever set — a
  ///   genuinely fresh install, the only case that may show);
  /// * a latch key that is **present and anything other than `false`** reads
  ///   TRUE. `'suppressed': 'yes'` is corruption, and corruption in a field
  ///   whose whole job is to say "stop" is read as "stop";
  /// * an unreadable or negative `shown_count` reads as
  ///   [_shownAtUnknownTime] rather than 0, which lands it in
  ///   [PromoGateVerdict.shownTooRecently] via the null-date branch below —
  ///   "shown, at a time we can no longer prove" is the honest reading, and it
  ///   holds instead of showing.
  factory PromoGateState.fromJson(Map<String, Object?> j) {
    final Object? rawCount = j['shown_count'];
    final int count = rawCount is int && rawCount >= 0
        ? rawCount
        : (j.containsKey('shown_count') ? _shownAtUnknownTime : 0);
    return PromoGateState(
      shownCount: count,
      lastShownAt: j['last_shown_at'] is String
          ? DateTime.tryParse(j['last_shown_at']! as String)
          : null,
      dismissed: _latch(j, 'dismissed'),
      suppressed: _latch(j, 'suppressed'),
    );
  }

  /// A present-but-unreadable count means we have shown this at least once and
  /// can no longer say how often. One is the smallest number that says so.
  static const int _shownAtUnknownTime = 1;

  static bool _latch(Map<String, Object?> j, String key) =>
      j.containsKey(key) && j[key] != false;
}

/// Why the gate said no. Returned rather than logged, because "the campaign is
/// switched off", "there is nothing to promote" and "this person objected" are
/// indistinguishable from a boolean and need completely different fixes — and
/// exactly one of them is a legal obligation.
enum PromoGateVerdict {
  /// Show it, once, and persist [PromoGateDecision.state].
  show,

  /// `features.promo_card_enabled` is off or absent. research/44 §4.5:
  /// **absent ⇒ render nothing**, so an app that has never reached the network
  /// shows no promo. Checked first, mirroring `ReviewGate`'s
  /// `platformCannotAsk`: it is the operator's emergency stop, and nothing past
  /// it is worth computing.
  featureOff,

  /// GDPR Art 21 objection. Absolute — no counter, no campaign and no config
  /// flag outranks it.
  suppressedByUser,

  /// The user closed this card. Latched.
  dismissedByUser,

  /// The campaign is on and eligible, and there is nothing to put in it.
  ///
  /// 🔴 THE [pipeline C-6] SHAPE, NAMED SO IT CANNOT HIDE. research/44's
  /// DO-NOT-BUILD list opens with an empty-list portfolio directory: *"with one
  /// live app it renders nothing, no test goes red, and the result is a
  /// capability that is wired, guarded, green and useless."* A gate that
  /// answered `show` with nothing to show would report healthy forever, so the
  /// caller must state whether it has a real payload and the empty case gets its
  /// own verdict rather than a silent `show` the widget then swallows.
  nothingToShow,

  /// The lifetime cap for this promotion is spent.
  shownEnoughTimes,

  /// Inside the cooldown — or the history says it was shown at a time we cannot
  /// read, which is treated the same way.
  shownTooRecently,
}

/// The answer: show or hold, **plus the state to persist**.
///
/// The state is bundled with the verdict so the two cannot drift apart. A gate
/// that returned only a verdict would leave "and now increment the counter" to
/// every caller, and the caller that forgets is a card that shows on every
/// rebuild forever — the Nagging defect, produced by an omission rather than a
/// decision.
class PromoGateDecision {
  const PromoGateDecision._(this.verdict, this.state);

  final PromoGateVerdict verdict;

  /// The record to write back.
  ///
  /// On any hold this is **identical** to the state passed in, so a caller may
  /// skip the write entirely (`identical(d.state, before)`), which matters on a
  /// home body that rebuilds constantly.
  ///
  /// ⚠️ On [PromoGateVerdict.show] it carries the incremented counter, and it
  /// must be persisted **when, and only when, the card is really put on screen**.
  /// [PromoGate.decide] is pure and idempotent — deciding twice from the same
  /// stored state says `show` twice — so the moment of truth is the write, not
  /// the call. Persist on render, hold the decision for the life of that
  /// presentation, and the card cannot vanish mid-session under its own
  /// cooldown.
  final PromoGateState state;

  /// Convenience for the common call site.
  bool get show => verdict == PromoGateVerdict.show;
}

/// The rule.
///
/// Both thresholds are JUDGEMENTS. research/44 fixes no number for an in-app
/// card — it fixes only that a governor must exist (V5) — so each one says what
/// it protects and where its shape came from, rather than sitting as a bare
/// constant somebody will later "tune".
class PromoGate {
  const PromoGate({
    this.minDaysBetweenShows = 7,
    this.maxShowsEver = 3,
  });

  /// The cooldown.
  ///
  /// A WEEK because a week is already this repo's unit for "how often may we
  /// promote": the only promotional-frequency cap the corpus has ever written
  /// down is a weekly one, typed on both sides of the config contract. That key
  /// governs notifications and is deliberately not read here (see the library
  /// doc), but reusing its **unit** costs nothing and stops two governors from
  /// disagreeing about what a week is. The number is a judgement; the unit is
  /// inherited.
  final int minDaysBetweenShows;

  /// The lifetime cap for one promotion.
  ///
  /// Three, on `ReviewGate`'s reasoning rather than its cause: there the cap
  /// exists because iOS silently discards a fourth ask, here because a person
  /// shown the same card three times and acting on none of them has answered,
  /// and asking a fourth time is the definition of nagging. Together with
  /// [minDaysBetweenShows] a user's entire exposure to one campaign is bounded
  /// at three impressions spread over at least a fortnight.
  final int maxShowsEver;

  /// Decide.
  ///
  /// [featureEnabled] and [hasContent] are parameters rather than lookups for
  /// the reason `ReviewGate` takes `platformCanAsk`: a kill switch that this
  /// file read for itself would make the off row unreachable from a test, and a
  /// payload it fetched for itself would make this impure. The caller reads
  /// `features.promo_card_enabled` (absent ⇒ false) and resolves the creative;
  /// this file only judges.
  PromoGateDecision decide(
    PromoGateState state, {
    required DateTime now,
    required bool featureEnabled,
    required bool hasContent,
  }) {
    final PromoGateVerdict verdict = _verdict(
      state,
      now: now,
      featureEnabled: featureEnabled,
      hasContent: hasContent,
    );
    if (verdict != PromoGateVerdict.show) {
      // The same instance, not a copy: `identical` is the caller's signal that
      // there is nothing to write.
      return PromoGateDecision._(verdict, state);
    }
    return PromoGateDecision._(
      verdict,
      state.copyWith(
        shownCount: state.shownCount + 1,
        // UTC, unlike `CatchUpNudge`'s local wall clock: a cooldown is an
        // elapsed duration, not a promise about a time of day, so a user who
        // flies across three time zones must not get a fresh campaign.
        lastShownAt: now.toUtc(),
      ),
    );
  }

  PromoGateVerdict _verdict(
    PromoGateState state, {
    required DateTime now,
    required bool featureEnabled,
    required bool hasContent,
  }) {
    if (!featureEnabled) return PromoGateVerdict.featureOff;
    if (state.suppressed) return PromoGateVerdict.suppressedByUser;
    if (state.dismissed) return PromoGateVerdict.dismissedByUser;
    // Before the counters on purpose: counting impressions of nothing is how a
    // dead campaign burns a real user's quota.
    if (!hasContent) return PromoGateVerdict.nothingToShow;
    if (state.shownCount >= maxShowsEver) {
      return PromoGateVerdict.shownEnoughTimes;
    }

    final DateTime? last = state.lastShownAt;
    if (last == null) {
      // Never shown ⇒ no cooldown to serve. Shown-but-undated ⇒ hold: an
      // unreadable date must read as "just now", never as "long ago". Failing
      // open here restarts the campaign for exactly the users whose record we
      // damaged, and it would do so on one launch each — never reproducible.
      return state.shownCount > 0
          ? PromoGateVerdict.shownTooRecently
          : PromoGateVerdict.show;
    }
    // Negative when the device clock has moved backwards, which is `< min` and
    // therefore holds. A clock a user can set must not be a way to reset a
    // frequency cap.
    if (now.toUtc().difference(last.toUtc()).inDays < minDaysBetweenShows) {
      return PromoGateVerdict.shownTooRecently;
    }
    return PromoGateVerdict.show;
  }
}
