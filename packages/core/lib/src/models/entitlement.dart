class Entitlement {
  const Entitlement({
    required this.entitlement,
    required this.productId,
    required this.store,
    required this.isActive,
    this.expiresAt,
    this.unreadableExpiry,
  });

  final String entitlement;
  final String productId;
  final String store;
  final bool isActive;
  final DateTime? expiresAt;

  /// The `expires_at` value as it arrived, kept ONLY when it could not be read.
  ///
  /// Two jobs. It survives the cache round-trip (see [toJson]) so re-reading a
  /// poisoned cache re-derives the same refusal rather than seeing a bare null
  /// and calling it a lifetime grant — and it leaves the offending value visible
  /// to whoever has to explain why a paying user lost access. Null whenever the
  /// expiry WAS readable, so `expiresAt == null && unreadableExpiry == null` is
  /// unambiguously the lifetime shape.
  final Object? unreadableExpiry;

  /// Parses the wire/cache shape, FAILING CLOSED on anything undecidable.
  ///
  /// ## The money boundary, client end
  /// This used to read `DateTime.tryParse(j['expires_at'] as String)` — and
  /// `tryParse` returns **null** on a string it cannot read, which this class
  /// spells "no expiry", i.e. **LIFETIME**. So an `expires_at` nobody could
  /// parse silently upgraded a subscriber to a permanent grant, offline and
  /// forever, with no error anywhere. That is the opposite direction from every
  /// other parse in this package (`AnalyticsEvent.tryFromJson` returns null,
  /// `ConfigCache.hydrate` skips the entry) and the mirror image of the server
  /// bug in `services/subly-api/src/routes/entitlements.ts`, which read an
  /// unparseable expiry as `is_pro: true`. Fixing one end alone just moves where
  /// the fail-open lives, so both are fixed together.
  ///
  /// The rule now: `expires_at` **absent or SQL null** is the lifetime grant —
  /// there is no end date because there is no end. `expires_at` **present but
  /// unreadable** (bad string, wrong type, empty) is UNDECIDABLE, and an
  /// entitlement whose expiry cannot be decided cannot be honoured. It is
  /// materialised as `isActive: false` so that every downstream reader —
  /// [isValidAt], [Entitlements.isProAt], the persisted cache round-trip — fails
  /// closed the same way, instead of each having to remember a special case. The
  /// server reconciles the real state on the next successful fetch.
  factory Entitlement.fromJson(Map<String, dynamic> j) {
    final Object? rawExpiry = j['expires_at'];
    final bool active = j['is_active'] == true || j['is_active'] == 1;

    DateTime? expiresAt;
    bool decidable = true;
    if (rawExpiry != null) {
      // A non-String here (an epoch-ms number, say) used to throw on the
      // `as String` cast and escape fromJson entirely.
      expiresAt = rawExpiry is String ? DateTime.tryParse(rawExpiry) : null;
      decidable = expiresAt != null;
    }

    return Entitlement(
      entitlement: _str(j['entitlement']),
      productId: _str(j['product_id']),
      store: _str(j['store']),
      isActive: active && decidable,
      expiresAt: expiresAt,
      unreadableExpiry: decidable ? null : rawExpiry,
    );
  }

  /// Non-String identifiers coerce to '' instead of throwing a TypeError out of
  /// a factory the network and the cache both call.
  static String _str(Object? v) => v is String ? v : '';

  /// Snake_case JSON that round-trips through [Entitlement.fromJson] — used to
  /// persist the entitlement cache (so a paid user stays unlocked offline).
  Map<String, dynamic> toJson() => <String, dynamic>{
    'entitlement': entitlement,
    'product_id': productId,
    'store': store,
    'is_active': isActive,
    // Normalize to UTC so a local DateTime round-trips to the same instant
    // regardless of any device-timezone change between write and read.
    //
    // An UNREADABLE expiry is written back VERBATIM. Emitting null for it
    // would spell "lifetime" on the way back in, so the cache would launder
    // a refusal into a permanent grant one restart later — the very
    // fail-open this class was fixed for, taking the long way round.
    'expires_at': unreadableExpiry ?? expiresAt?.toUtc().toIso8601String(),
  };

  /// Whether this entitlement should still be honoured offline at [now], given a
  /// [grace] window after expiry. A lifetime entitlement (no [expiresAt]) never
  /// expires; a subscription is honoured until expiry + [grace], after which the
  /// server must reconcile on reconnect (ADR 005).
  bool isValidAt(DateTime now, {Duration grace = Duration.zero}) {
    if (!isActive) return false;
    final DateTime? exp = expiresAt;
    return exp == null || now.isBefore(exp.add(grace));
  }
}

/// The current user's entitlements for THIS app (from the shared platform DB).
class Entitlements {
  const Entitlements({
    required this.appId,
    required this.isPro,
    required this.items,
    this.verifiedAt,
  });

  final String appId;
  final bool isPro;
  final List<Entitlement> items;

  /// When the SERVER last confirmed this answer — [pipeline 5]M-8.
  ///
  /// ## Why a revocation bound has to be a relationship, not a number
  /// A refund, a chargeback or a failed final payment revokes access on the
  /// server. The client only finds out when it asks. So "revoked within N" is
  /// not a property of the server at all — it is a property of how long this
  /// client is willing to keep honouring an answer it has not re-checked.
  ///
  /// Null means UNVERIFIED: a cache written before this field existed, or a
  /// value that could not be read. That is undecidable, and an undecidable
  /// verification age is treated as infinitely old — see
  /// [EntitlementCache.readValid]. It cannot fail open, because the one thing
  /// this field exists to bound is exactly the case where we have stopped
  /// hearing from the server.
  final DateTime? verifiedAt;

  /// The same answer, stamped as verified at [at]. Called on the success path of
  /// a server read and nowhere else — a cache write must never be able to
  /// refresh its own verification age, which would make the ceiling unreachable.
  Entitlements verifiedAtNow(DateTime at) => Entitlements(
    appId: appId,
    isPro: isPro,
    items: items,
    verifiedAt: at.toUtc(),
  );

  /// An entitlement that exists but grants nothing — the placeholder for a line
  /// item, or a whole list, that could not be read.
  ///
  /// It has to be an ITEM rather than an omission: [isProAt] reads an EMPTY
  /// `items` as an undated lifetime grant, so quietly dropping what we cannot
  /// parse would unlock Pro. Refusing has to leave a mark, or it reads as
  /// "nothing was wrong".
  static const Entitlement unreadable = Entitlement(
    entitlement: '',
    productId: '',
    store: '',
    isActive: false,
  );

  factory Entitlements.fromJson(Map<String, dynamic> j) {
    final Object? raw = j['entitlements'];
    final List<Entitlement> items = <Entitlement>[];
    if (raw is List) {
      for (final Object? e in raw) {
        items.add(
          e is Map
              ? Entitlement.fromJson(e.cast<String, dynamic>())
              : unreadable,
        );
      }
    } else if (raw != null) {
      // PRESENT BUT NOT A LIST. The first version of this rewrite left `items`
      // empty here, which [isProAt] reads as a lifetime grant — so a truncated
      // cache blob or a server that switched to an object envelope would have
      // unlocked Pro permanently. (The pre-rewrite `as List<dynamic>?` cast
      // threw, and the callers' catches turned that into not-Pro; replacing a
      // throw with a silent `is` test moved the failure to the wrong side.)
      // One unreadable item keeps the list non-empty, so the answer is no.
      items.add(unreadable);
    }
    // 🔴 UNREADABLE ⇒ NULL, NEVER "now". The tempting shortcut — default a
    // missing/corrupt `verified_at` to the current time — makes every cache read
    // look freshly verified, so the staleness ceiling can never be crossed and
    // [pipeline 5]M-8 becomes a constant that nothing consults. Null is the
    // undecidable state and [EntitlementCache.readValid] treats it as
    // infinitely stale.
    final Object? rawVerified = j['verified_at'];
    final DateTime? verifiedAt = rawVerified is String
        ? DateTime.tryParse(rawVerified)
        : null;

    return Entitlements(
      appId: j['app_id'] is String ? j['app_id'] as String : '',
      isPro: j['is_pro'] == true || j['is_pro'] == 1,
      items: items,
      verifiedAt: verifiedAt,
    );
  }

  /// Snake_case JSON that round-trips through [Entitlements.fromJson] — the
  /// serialized shape the entitlement cache persists to a [SecureStore].
  Map<String, dynamic> toJson() => <String, dynamic>{
    'app_id': appId,
    'is_pro': isPro,
    'entitlements': items.map((Entitlement e) => e.toJson()).toList(),
    // Normalized to UTC for the same reason `expires_at` is: a device that
    // changes timezone between write and read must not change how old the
    // answer looks.
    'verified_at': verifiedAt?.toUtc().toIso8601String(),
  };

  /// Whether the user should be treated as Pro at [now] offline: the server said
  /// Pro AND either there are no dated line items (a lifetime grant) or at least
  /// one item is still valid within [grace]. Lifetime grants stay Pro forever
  /// offline; expired subscriptions drop to not-Pro past the grace window (ADR 005).
  bool isProAt(DateTime now, {Duration grace = Duration.zero}) =>
      isPro &&
      (items.isEmpty ||
          items.any((Entitlement e) => e.isValidAt(now, grace: grace)));

  static const Entitlements none = Entitlements(
    appId: '',
    isPro: false,
    items: <Entitlement>[],
  );
}
