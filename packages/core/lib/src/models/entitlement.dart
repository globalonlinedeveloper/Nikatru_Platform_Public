class Entitlement {
  const Entitlement({
    required this.entitlement,
    required this.productId,
    required this.store,
    required this.isActive,
    this.expiresAt,
    this.unreadableExpiry,
    this.revocationReason,
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
  /// bug in `services/subscriptiontracker-api/src/routes/entitlements.ts`, which read an
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
  /// Why access ENDED, when the server recorded a reason: one of the
  /// entitlement contract's revocation reasons (`refund_approved`,
  /// `chargeback`, `subscription_expired`, …), verbatim. Null when nothing
  /// was recorded. refund-finish (MF-7): the plan screen says which and when.
  final String? revocationReason;

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
      revocationReason: j['revocation_reason'] is String
          ? j['revocation_reason'] as String
          : null,
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
        // Only when one was recorded, so a cache written before this field
        // reads back byte-identical.
        if (revocationReason != null) 'revocation_reason': revocationReason,
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
    this.grantedVia,
    this.bundle,
  });

  final String appId;
  final bool isPro;
  final List<Entitlement> items;

  /// WHICH BRANCH OF THE SERVER'S UNION DECIDED [isPro] — the wire's
  /// `granted_via`, verbatim: `'app' | 'bundle' | 'none'`
  /// (`services/platform/src/routes/entitlements.ts`, the per-app read).
  ///
  /// 🔴 IT WAS DROPPED AT PARSE, and the consequence was an unlock rather than
  /// a missing label. A bundle-only customer arrives as `is_pro: true` with an
  /// EMPTY `entitlements` list — the bundle grant is not a per-app row — and
  /// [isProAt] read an empty list as an undated lifetime grant. So the
  /// bundle's own `expires_at` was never consulted on the device, and the
  /// offline cache kept saying Pro past the bundle's end for as long as the
  /// staleness ceiling allowed. The branch is what tells [isProAt] that an
  /// empty list is NOT the lifetime shape.
  ///
  /// NULL means the key was ABSENT: a cache written before this field existed,
  /// or a host that predates the union read. That keeps the pre-union rule,
  /// which is all such an answer can be judged by. Any PRESENT value other
  /// than the three words is kept verbatim (so the cache round-trips it) and
  /// is treated as undecidable — see [isProAt].
  final String? grantedVia;

  /// The live bundle grant the server served this answer under, or null when
  /// there is none (the server sends the key ABSENT, never null).
  final EntitlementBundle? bundle;

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
        // 🔴 BOTH, OR THE FIX IS UNDONE ON THE ONE PATH THAT MATTERS. This is the
        // server-success path, so a copy that forgot them would persist a
        // bundle-only answer as a bare `is_pro` with no items — the lifetime shape
        // — and the cache would be back to honouring an expired bundle.
        grantedVia: grantedVia,
        bundle: bundle,
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
    final DateTime? verifiedAt =
        rawVerified is String ? DateTime.tryParse(rawVerified) : null;

    final Object? rawVia = j['granted_via'];
    final Object? rawBundle = j['bundle'];

    return Entitlements(
      appId: j['app_id'] is String ? j['app_id'] as String : '',
      isPro: j['is_pro'] == true || j['is_pro'] == 1,
      items: items,
      verifiedAt: verifiedAt,
      // A non-String `granted_via` keeps its string form, so it round-trips as
      // the same undecidable value instead of vanishing into "absent" — which
      // would re-open the pre-union lifetime rule.
      grantedVia: rawVia == null
          ? null
          : (rawVia is String ? rawVia : rawVia.toString()),
      bundle: rawBundle == null
          ? null
          : rawBundle is Map
              ? EntitlementBundle.fromJson(rawBundle.cast<String, dynamic>())
              // PRESENT BUT NOT AN OBJECT: a grant that cannot be read cannot be
              // honoured — the same rule as a non-List `entitlements`.
              : EntitlementBundle.unreadable,
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
        // Written only when known, so an answer that never carried them re-reads
        // as ABSENT (the pre-union rule) rather than as a present null.
        if (grantedVia != null) 'granted_via': grantedVia,
        if (bundle != null) 'bundle': bundle!.toJson(),
      };

  /// Whether the user should be treated as Pro at [now] offline: the server said
  /// Pro AND either there are no dated line items (a lifetime grant) or at least
  /// one item is still valid within [grace]. Lifetime grants stay Pro forever
  /// offline; expired subscriptions drop to not-Pro past the grace window (ADR 005).
  ///
  /// 🔴 THE EMPTY-LIST LIFETIME RULE NOW APPLIES ONLY WHERE IT CAN BE TRUE.
  /// - [grantedVia] ABSENT (pre-union cache or host): the rule above, unchanged.
  /// - PRESENT (`'app'`, `'bundle'`, or a value this client does not
  ///   recognise): Pro only while a line item is valid OR the [bundle] is still
  ///   inside its `expires_at` + [grace]. A customer holding both is served the
  ///   union, so either branch keeps Pro. An empty list is exactly what a
  ///   bundle-only answer looks like, so reading it as lifetime was the defect;
  ///   and under `'app'` an empty list contradicts the server's own rule (the
  ///   branch requires a granting row), so it is not a grant either.
  bool isProAt(DateTime now, {Duration grace = Duration.zero}) {
    if (!isPro) return false;
    final bool itemValid = items.any(
      (Entitlement e) => e.isValidAt(now, grace: grace),
    );
    if (grantedVia == null) return items.isEmpty || itemValid;
    final bool bundleValid = bundle?.isValidAt(now, grace: grace) ?? false;
    return itemValid || bundleValid;
  }

  static const Entitlements none = Entitlements(
    appId: '',
    isPro: false,
    items: <Entitlement>[],
  );
}

/// A live bundle grant as the per-app entitlement read serves it — the
/// `bundle` block of `GET /v1/entitlements`
/// (`services/platform/src/routes/entitlements.ts`): the PINNED feature set it
/// was sold under, its members, its expiry and the rail that sold it.
///
/// ⚠️ THE CLIENT DECIDES NOTHING FROM [products] OR [source]. The server
/// already joined this app against the pinned membership before it answered;
/// they are carried for the account page and so the offline cache keeps the
/// attribution. [expiresAt] is the one field that decides access on the
/// device, and only through [isValidAt].
class EntitlementBundle {
  const EntitlementBundle({
    required this.featureSet,
    required this.version,
    required this.products,
    required this.source,
    this.expiresAt,
    this.unreadableExpiry,
    this.isUnreadable = false,
  });

  /// A block that was present but not an object. Fails closed, and survives
  /// the cache round-trip as the same refusal.
  static const EntitlementBundle unreadable = EntitlementBundle(
    featureSet: '',
    version: 0,
    products: <String>[],
    source: '',
    isUnreadable: true,
  );

  final String featureSet;

  /// The pinned feature-set version; 0 when the wire value was not an integer.
  final int version;
  final List<String> products;
  final String source;

  /// Null with [unreadableExpiry] also null is the lifetime shape — the same
  /// convention as [Entitlement.expiresAt].
  final DateTime? expiresAt;

  /// The `expires_at` value as it arrived, kept ONLY when it could not be read,
  /// for the same two reasons [Entitlement.unreadableExpiry] exists.
  final Object? unreadableExpiry;

  /// Whether the whole block was undecidable (see [EntitlementBundle.unreadable]).
  final bool isUnreadable;

  /// Parses the wire/cache shape, failing CLOSED on an undecidable expiry.
  factory EntitlementBundle.fromJson(Map<String, dynamic> j) {
    final Object? rawExpiry = j['expires_at'];
    DateTime? expiresAt;
    bool decidable = true;
    if (rawExpiry != null) {
      expiresAt = rawExpiry is String ? DateTime.tryParse(rawExpiry) : null;
      decidable = expiresAt != null;
    }
    final Object? rawProducts = j['products'];
    final Object? rawVersion = j['version'];
    return EntitlementBundle(
      featureSet: j['feature_set'] is String ? j['feature_set'] as String : '',
      version: rawVersion is int ? rawVersion : 0,
      products: rawProducts is List
          ? rawProducts.whereType<String>().toList(growable: false)
          : const <String>[],
      source: j['source'] is String ? j['source'] as String : '',
      expiresAt: expiresAt,
      unreadableExpiry: decidable ? null : rawExpiry,
      isUnreadable: j['unreadable'] == true,
    );
  }

  /// Snake_case JSON that round-trips through [EntitlementBundle.fromJson].
  Map<String, dynamic> toJson() => <String, dynamic>{
        'feature_set': featureSet,
        'version': version,
        'products': products,
        'source': source,
        // An unreadable expiry is written back VERBATIM, never as null — null
        // would re-read as a lifetime bundle one restart later.
        'expires_at': unreadableExpiry ?? expiresAt?.toUtc().toIso8601String(),
        if (isUnreadable) 'unreadable': true,
      };

  /// Whether this bundle still grants at [now] within [grace]. An undecidable
  /// block or expiry never does.
  bool isValidAt(DateTime now, {Duration grace = Duration.zero}) {
    if (isUnreadable || unreadableExpiry != null) return false;
    final DateTime? exp = expiresAt;
    return exp == null || now.isBefore(exp.add(grace));
  }
}
