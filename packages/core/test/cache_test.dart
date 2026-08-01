import 'dart:convert';

import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// A [SecureStore] whose READ throws — the real failure mode of an OS keystore:
/// a device not unlocked since boot, a Keychain item whose accessibility class
/// is not yet satisfied, a Keystore key invalidated by a biometric enrolment, a
/// plugin `PlatformException`. Not an exotic case; it is the normal one on a
/// cold start behind a lock screen.
class _ThrowingSecureStore implements SecureStore {
  int reads = 0;
  @override
  Future<String?> read(String key) async {
    reads++;
    throw StateError('keystore unavailable');
  }

  @override
  Future<void> write(String key, String value) async {}
  @override
  Future<void> delete(String key) async {}
  @override
  Future<void> deleteAll() async {}
}

/// A [KeyValueStore] whose READ throws — same class of failure for prefs.
class _ThrowingKeyValueStore implements KeyValueStore {
  int reads = 0;
  @override
  Future<String?> read(String key) async {
    reads++;
    throw StateError('prefs unavailable');
  }

  @override
  Future<void> write(String key, String value) async {}
  @override
  Future<void> remove(String key) async {}
  @override
  Future<bool> containsKey(String key) async => false;
}

/// A neutral fixture config. [pipeline C-10] These tests used to reach into
/// core's own `kDefaultConfigs` for a real app's bundled default. That map is now
/// empty by design, so the fixture is declared locally — which is also the honest
/// shape for a test: it should not depend on which apps happen to exist.
const AppConfig _fixture = AppConfig(
  appId: 'fixture',
  apiBaseUrl: 'https://api.nikatru.com/v1',
  features: <String, bool>{},
  paywall: PaywallConfig(enabled: false),
  contentPack: null,
  copy: <String, String>{},
  minSupportedVersion: '1.0.0',
);

void main() {
  group('ConfigCache persistence (KeyValueStore-backed last-good)', () {
    test('put writes through and a fresh cache hydrates the last-good value',
        () async {
      final KeyValueStore kv = InMemoryKeyValueStore();
      final AppConfig canary =
          _fixture.copyWith(apiBaseUrl: 'https://api-canary.nikatru.com/v1');

      final ConfigCache writer = ConfigCache(
          store: kv, seed: <String, AppConfig>{'fixture': _fixture});
      writer.put(canary);

      // A brand-new cache over the same store first sees only the bundled
      // default, then the persisted last-good after hydrate().
      final ConfigCache fresh = ConfigCache(
          store: kv, seed: <String, AppConfig>{'fixture': _fixture});
      expect(fresh.get('fixture')!.apiBaseUrl, 'https://api.nikatru.com/v1');
      await fresh.hydrate(<String>['fixture']);
      expect(fresh.get('fixture')!.apiBaseUrl,
          'https://api-canary.nikatru.com/v1');
    });

    test('hydrate skips a corrupt persisted entry (bundled default survives)',
        () async {
      final KeyValueStore kv = InMemoryKeyValueStore(<String, String>{
        'nikatru.cfg.fixture': 'not-json{',
        'nikatru.cfg.fixture2': '{"foo":1}', // valid JSON, invalid AppConfig
      });
      final ConfigCache cache = ConfigCache(
          store: kv, seed: <String, AppConfig>{'fixture': _fixture});
      await cache.hydrate(<String>['fixture']);
      expect(cache.get('fixture')!.apiBaseUrl, 'https://api.nikatru.com/v1');
    });

    test('hydrate tolerates a wrong-typed content_pack (coerced, not a crash)',
        () async {
      // Regression: content_pack as a non-string used to throw a TypeError that
      // escaped hydrate's on-FormatException catch and could crash startup.
      final KeyValueStore kv = InMemoryKeyValueStore(<String, String>{
        'nikatru.cfg.fixture': '{"app_id":"fixture",'
            '"api_base_url":"https://persisted.nikatru.com/v1",'
            '"min_supported_version":"1.0.0","content_pack":123}',
      });
      final ConfigCache cache = ConfigCache(
          store: kv, seed: <String, AppConfig>{'fixture': _fixture});
      await cache.hydrate(<String>['fixture']); // must not throw
      final AppConfig? c = cache.get('fixture');
      expect(c!.apiBaseUrl, 'https://persisted.nikatru.com/v1'); // loaded
      expect(c.contentPack, isNull); // wrong-typed value coerced away
    });

    test('without a store, put stays in-memory and hydrate is a no-op',
        () async {
      final ConfigCache cache = ConfigCache(
        seed: <String, AppConfig>{'fixture': _fixture},
      );
      final AppConfig canary =
          _fixture.copyWith(apiBaseUrl: 'https://x.example/v1');
      cache.put(canary);
      expect(cache.get('fixture')!.apiBaseUrl, 'https://x.example/v1');
      await cache.hydrate(<String>['fixture']); // no throw
    });

    // The read used to sit OUTSIDE hydrate's try, so the "a corrupt persisted
    // entry is skipped" contract only covered a corrupt VALUE. hydrate is called
    // at STARTUP, before the first peek/load, so a throwing store surfaced as a
    // launch crash on exactly the devices whose storage was already unhappy.
    test('a THROWING store is skipped; the bundled default survives startup',
        () async {
      final _ThrowingKeyValueStore kv = _ThrowingKeyValueStore();
      final ConfigCache cache = ConfigCache(
          store: kv, seed: <String, AppConfig>{'fixture': _fixture});
      await cache.hydrate(<String>['fixture']); // must not throw
      expect(kv.reads, 1, reason: 'the read must actually have been attempted');
      expect(cache.get('fixture')!.apiBaseUrl, 'https://api.nikatru.com/v1');
    });

    test('a throwing store does not abort the WHOLE hydrate loop', () async {
      // One bad key must not cost every other app its last-good config: the
      // guard has to be inside the per-app iteration, not around it.
      final _ThrowingKeyValueStore kv = _ThrowingKeyValueStore();
      final ConfigCache cache = ConfigCache(
          store: kv, seed: <String, AppConfig>{'fixture': _fixture});
      await cache.hydrate(<String>['a', 'b', 'c']);
      expect(kv.reads, 3, reason: 'every app id must still be attempted');
    });
  });

  group('EntitlementCache (offline entitlement, ADR 005 grace window)', () {
    Entitlements lifetime() => const Entitlements(
          appId: 'fixture',
          isPro: true,
          items: <Entitlement>[
            Entitlement(
              entitlement: 'pro',
              productId: 'subly_pro',
              store: 'paddle',
              isActive: true, // no expiresAt => lifetime
            ),
          ],
        );

    Entitlements subscriptionExpiring(DateTime at) => Entitlements(
          appId: 'loop',
          isPro: true,
          items: <Entitlement>[
            Entitlement(
              entitlement: 'pro',
              productId: 'loop_annual',
              store: 'paddle',
              isActive: true,
              expiresAt: at,
            ),
          ],
        );

    test('save then readRaw round-trips', () async {
      final EntitlementCache cache =
          EntitlementCache(store: InMemorySecureStore());
      await cache.save(lifetime());
      final Entitlements? back = await cache.readRaw();
      expect(back, isNotNull);
      expect(back!.appId, 'fixture');
      expect(back.isPro, isTrue);
      expect(back.items.single.productId, 'subly_pro');
    });

    test('lifetime entitlement stays Pro offline indefinitely', () async {
      final EntitlementCache cache =
          EntitlementCache(store: InMemorySecureStore());
      // ⚠️ `saveVerified`, and OFFLINE. [pipeline 5]M-8 gave this cache a
      // staleness ceiling, so "indefinitely" is now conditional on the client
      // being unable to re-verify — which is exactly what an OFFLINE user is.
      // The same call with connectivity available re-locks after the ceiling,
      // and that is asserted in the M-8 group below.
      await cache.saveVerified(lifetime(), now: DateTime.utc(2026, 8, 1));
      final Entitlements v = await cache.readValid(
        now: DateTime.utc(2099, 1, 1),
        connectivityAvailable: false,
      );
      expect(v.isPro, isTrue);
    });

    test('subscription within the grace window stays Pro', () async {
      final DateTime now = DateTime.utc(2026, 8, 1);
      final EntitlementCache cache = EntitlementCache(
        store: InMemorySecureStore(),
        grace: const Duration(days: 3),
      );
      // Expired yesterday, but inside the 3-day grace — and verified today, so
      // the M-8 staleness ceiling is not what this test is measuring.
      await cache.saveVerified(
        subscriptionExpiring(now.subtract(const Duration(days: 1))),
        now: now,
      );
      final Entitlements v = await cache.readValid(now: now);
      expect(v.isPro, isTrue);
    });

    test('subscription past expiry + grace drops to not-Pro (appId kept)',
        () async {
      final DateTime now = DateTime.utc(2026, 8, 1);
      final EntitlementCache cache = EntitlementCache(
        store: InMemorySecureStore(),
        grace: const Duration(days: 3),
      );
      await cache
          .save(subscriptionExpiring(now.subtract(const Duration(days: 10))));
      final Entitlements v = await cache.readValid(now: now);
      expect(v.isPro, isFalse);
      expect(v.appId, 'loop'); // still identifies the app for a re-check
    });

    test('clear removes the cache; readValid then reports none', () async {
      final EntitlementCache cache =
          EntitlementCache(store: InMemorySecureStore());
      await cache.save(lifetime());
      await cache.clear();
      expect(await cache.readRaw(), isNull);
      final Entitlements v = await cache.readValid(now: DateTime.utc(2026));
      expect(v.isPro, isFalse);
      expect(v.items, isEmpty);
    });

    test('corrupt secure-store value is treated as absent', () async {
      final SecureStore s = InMemorySecureStore(
          <String, String>{'nikatru.entitlements': 'garbage{'});
      final EntitlementCache cache = EntitlementCache(store: s);
      expect(await cache.readRaw(), isNull);
    });

    // ── the store READ itself failing, not just its value ────────────────────
    // The read used to sit OUTSIDE the try, so the documented "corrupt cache is
    // treated as absent" path only ever covered a corrupt VALUE. A throwing
    // SecureStore — the one seam here that genuinely throws — escaped as an
    // unhandled error out of a method whose contract is to return null.
    test('a THROWING secure store is treated as absent, not as a crash',
        () async {
      final _ThrowingSecureStore s = _ThrowingSecureStore();
      final EntitlementCache cache = EntitlementCache(store: s);
      expect(await cache.readRaw(), isNull);
      expect(s.reads, 1, reason: 'the read must actually have been attempted');
    });

    test('readValid over a throwing store fails CLOSED to none', () async {
      final EntitlementCache cache =
          EntitlementCache(store: _ThrowingSecureStore());
      final Entitlements v = await cache.readValid(now: DateTime.utc(2026));
      expect(v.isPro, isFalse);
      expect(v.items, isEmpty);
      expect(v.appId, '');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // THE MONEY BOUNDARY, CLIENT END.
  //
  // `expiresAt: DateTime.tryParse(...)` returns NULL for a string it cannot
  // read, and null expiry in this class means LIFETIME. So an unreadable
  // `expires_at` silently granted a permanent entitlement — offline, forever,
  // with nothing logged. The server had the mirror-image bug in
  // services/subly-api/src/routes/entitlements.ts (`Number.isNaN(exp) ? true`),
  // which is why both ends are fixed and pinned together.
  // ───────────────────────────────────────────────────────────────────────────
  group('Entitlement.fromJson fails CLOSED on an undecidable expiry', () {
    Map<String, dynamic> row(Object? expiresAt) => <String, dynamic>{
          'entitlement': 'pro',
          'product_id': 'subly_pro_monthly',
          'store': 'APP_STORE',
          'is_active': true,
          'expires_at': expiresAt,
        };

    for (final Object badExpiry in <Object>[
      'not-a-date',
      '',
      '   ',
      '01/09/2026',
      1800000000000, // epoch-ms as a NUMBER — used to throw on `as String`
      <String, Object?>{'seconds': 1},
      <Object?>[1],
      true,
    ]) {
      test(
          '${badExpiry.runtimeType} "$badExpiry" does NOT become a lifetime grant',
          () {
        final Entitlement e = Entitlement.fromJson(row(badExpiry));
        expect(e.isActive, isFalse,
            reason: 'an expiry nobody can read cannot be honoured');
        expect(e.isValidAt(DateTime.utc(2026, 8, 1)), isFalse);
        // The far-future check is the one that matters: "lifetime" is exactly
        // the reading that a null expiresAt would have given here.
        expect(e.isValidAt(DateTime.utc(2099)), isFalse);
      });
    }

    test(
        'Dart ROLLS OVER an out-of-range date instead of rejecting it — '
        'bounded, and NOT the lifetime case', () {
      // Recorded because it is surprising and because it is a genuine
      // divergence: `DateTime.tryParse('2026-13-45T00:00:00Z')` succeeds and
      // rolls the components over, while the server end of this same wire uses
      // JS `Date.parse`, which returns NaN and denies (see
      // services/subly-api/test/entitlements.test.ts).
      //
      // It is left alone deliberately. The defect being fixed is "undecidable ⇒
      // FOREVER"; a rolled-over date is decidable and still EXPIRES, so the
      // exposure is bounded by a real instant rather than unbounded. Tightening
      // it means re-validating calendar components by hand — and a half-strict
      // parser (date checked, time not; UTC checked, offsets not) would be worse
      // than the honest lenient one. If this ever needs to change, change it
      // knowingly; do not assume the strings agree.
      final DateTime? rolled = DateTime.tryParse('2026-13-45T00:00:00Z');
      expect(rolled, isNotNull);
      expect(rolled!.year, 2027, reason: 'month 13 rolled into the next year');

      final Entitlement e = Entitlement.fromJson(row('2026-13-45T00:00:00Z'));
      expect(e.isActive, isTrue);
      expect(e.expiresAt, rolled);
      expect(e.isValidAt(DateTime.utc(2099)), isFalse,
          reason: 'it must still expire — this is not a lifetime grant');
    });

    test('a MISSING expires_at key is still a lifetime grant', () {
      // Without this, a factory that denied everything would pass every test
      // above. Absent means "no end date", which is a real RevenueCat shape
      // (NON_RENEWING_PURCHASE) the webhook writes deliberately.
      final Entitlement e = Entitlement.fromJson(<String, dynamic>{
        'entitlement': 'pro',
        'is_active': true,
      });
      expect(e.expiresAt, isNull);
      expect(e.isActive, isTrue);
      expect(e.isValidAt(DateTime.utc(2099)), isTrue);
    });

    test('an explicit null expires_at is a lifetime grant', () {
      final Entitlement e = Entitlement.fromJson(row(null));
      expect(e.isActive, isTrue);
      expect(e.isValidAt(DateTime.utc(2099)), isTrue);
    });

    test('a readable date still parses and still expires', () {
      final Entitlement e = Entitlement.fromJson(row('2026-08-01T00:00:00Z'));
      expect(e.isActive, isTrue);
      expect(e.expiresAt, DateTime.utc(2026, 8, 1));
      expect(e.isValidAt(DateTime.utc(2026, 7, 31)), isTrue);
      expect(e.isValidAt(DateTime.utc(2026, 8, 2)), isFalse);
    });

    test('non-String identifiers coerce instead of throwing', () {
      final Entitlement e = Entitlement.fromJson(<String, dynamic>{
        'entitlement': 7,
        'product_id': <Object?>[],
        'store': null,
        'is_active': 1,
      });
      expect(e.entitlement, '');
      expect(e.productId, '');
      expect(e.store, '');
      expect(e.isActive, isTrue);
    });
  });

  group('Entitlements fails CLOSED end to end', () {
    test('is_pro:true with only an unreadable line item is NOT Pro', () {
      final Entitlements ents = Entitlements.fromJson(<String, dynamic>{
        'app_id': 'subly',
        'is_pro': true,
        'entitlements': <dynamic>[
          <String, dynamic>{
            'entitlement': 'pro',
            'is_active': true,
            'expires_at': 'garbage',
          },
        ],
      });
      expect(ents.isProAt(DateTime.utc(2026, 8, 1)), isFalse);
      expect(ents.isProAt(DateTime.utc(2099)), isFalse);
    });

    test('a present-but-not-a-List `entitlements` does NOT grant Pro', () {
      // Found in review of this very change. The rewrite replaced the old
      // `(j['entitlements'] as List<dynamic>?)` — which THREW, and whose callers
      // turned that into not-Pro — with a silent `is List` test, leaving `items`
      // empty for any other type. isProAt reads an empty items list as an undated
      // lifetime grant, so a truncated cache blob or a server that switched to an
      // object envelope would have unlocked Pro permanently: the same fail-open
      // this file exists to close, reintroduced one level up while closing it.
      for (final Object bad in <Object>[
        <String, Object?>{},
        'pro',
        7,
        true,
      ]) {
        final Entitlements ents = Entitlements.fromJson(<String, dynamic>{
          'app_id': 'subly',
          'is_pro': true,
          'entitlements': bad,
        });
        expect(ents.items, hasLength(1), reason: '$bad');
        expect(ents.isProAt(DateTime.utc(2099)), isFalse, reason: '$bad');
      }
    });

    test('an EMPTY list is still the undated lifetime shape', () {
      // The counterweight: `entitlements: []` with is_pro true is the server
      // saying "Pro, no dated line items". Denying that would revoke a real
      // lifetime grant, so the guard above must not have swallowed it.
      final Entitlements ents = Entitlements.fromJson(<String, dynamic>{
        'app_id': 'subly',
        'is_pro': true,
        'entitlements': <dynamic>[],
      });
      expect(ents.items, isEmpty);
      expect(ents.isProAt(DateTime.utc(2099)), isTrue);
    });

    test('a malformed line item is KEPT as inactive, never dropped', () {
      // Dropping it would empty `items`, and isProAt reads an empty items list
      // as an undated lifetime grant — so discarding the only (broken) item
      // would have unlocked Pro. Fail-open one level up from the one just fixed.
      final Entitlements ents = Entitlements.fromJson(<String, dynamic>{
        'app_id': 'subly',
        'is_pro': true,
        'entitlements': <dynamic>['not-an-object'],
      });
      expect(ents.items, hasLength(1));
      expect(ents.items.single.isActive, isFalse);
      expect(ents.isProAt(DateTime.utc(2099)), isFalse);
    });

    test('one broken item does not sink a second, valid one', () {
      final Entitlements ents = Entitlements.fromJson(<String, dynamic>{
        'app_id': 'subly',
        'is_pro': true,
        'entitlements': <dynamic>[
          <String, dynamic>{
            'entitlement': 'pro',
            'is_active': true,
            'expires_at': 'x'
          },
          <String, dynamic>{'entitlement': 'cloud', 'is_active': true},
        ],
      });
      expect(ents.isProAt(DateTime.utc(2099)), isTrue);
    });

    test('a cache poisoned with an unreadable expiry does not unlock Pro',
        () async {
      // The end-to-end statement: this is exactly what an on-disk cache holds.
      final SecureStore s = InMemorySecureStore(<String, String>{
        'nikatru.entitlements': jsonEncode(<String, dynamic>{
          'app_id': 'subly',
          'is_pro': true,
          'entitlements': <dynamic>[
            <String, dynamic>{
              'entitlement': 'pro',
              'product_id': 'subly_pro',
              'store': 'APP_STORE',
              'is_active': true,
              'expires_at': 'not-a-date',
            },
          ],
        }),
      });
      final EntitlementCache cache = EntitlementCache(store: s);
      final Entitlements v = await cache.readValid(now: DateTime.utc(2099));
      expect(v.isPro, isFalse);
    });

    test('a denied entitlement stays denied through a save/read round-trip',
        () async {
      // toJson has to carry the decision, not just the fields: a value that
      // re-reads as Pro after one persist cycle would reopen the hole through
      // the cache instead of through the wire.
      final Entitlements poisoned = Entitlements.fromJson(<String, dynamic>{
        'app_id': 'subly',
        'is_pro': true,
        'entitlements': <dynamic>[
          <String, dynamic>{
            'entitlement': 'pro',
            'is_active': true,
            'expires_at': 'x'
          },
        ],
      });
      final EntitlementCache cache =
          EntitlementCache(store: InMemorySecureStore());
      await cache.save(poisoned);
      final Entitlements back = (await cache.readRaw())!;
      expect(back.items.single.isActive, isFalse);
      expect(back.isProAt(DateTime.utc(2099)), isFalse);
      expect((await cache.readValid(now: DateTime.utc(2099))).isPro, isFalse);

      // The offending value is written back VERBATIM. Emitting null for it would
      // spell "lifetime" on the way back in, so a second round-trip would launder
      // the refusal into a permanent grant.
      expect(back.items.single.unreadableExpiry, 'x');
      expect(back.toJson()['entitlements'], <dynamic>[
        <String, dynamic>{
          'entitlement': 'pro',
          'product_id': '',
          'store': '',
          'is_active': false,
          'expires_at': 'x',
        },
      ]);

      // And it survives a SECOND cycle — one round-trip proving nothing is
      // exactly how a laundering bug hides.
      await cache.save(back);
      expect((await cache.readValid(now: DateTime.utc(2099))).isPro, isFalse);
      expect((await cache.readRaw())!.items.single.unreadableExpiry, 'x');
    });

    test('a READABLE expiry keeps its normalized ISO form in toJson', () {
      // unreadableExpiry must stay null on the happy path, or every cached row
      // would start echoing raw input instead of the UTC-normalized instant.
      final Entitlement e = Entitlement.fromJson(<String, dynamic>{
        'entitlement': 'pro',
        'is_active': true,
        'expires_at': '2026-08-01T05:30:00+05:30',
      });
      expect(e.unreadableExpiry, isNull);
      expect(e.toJson()['expires_at'], '2026-08-01T00:00:00.000Z');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // [pipeline 5]M-8 — THE REVOCATION BOUND
  //
  // A refund revokes on the SERVER. This client learns of it only by asking. So
  // "revoked within N" is not a property of the server at all — it is a property
  // of how long this client keeps honouring an answer it has not re-checked.
  //
  // 🔴 BOTH DIRECTIONS ARE TESTED, and the second one is the load-bearing half.
  // Without a test that the gate is STILL UNLOCKED just inside the bound, a
  // client that always locks passes every assertion here — and always-locking is
  // the fail-closed-and-dead shape this whole stage exists to stop.
  // ═══════════════════════════════════════════════════════════════════════
  group('[5]M-8 · the staleness ceiling', () {
    final DateTime verified = DateTime.utc(2026, 8, 1, 12);
    const Duration ceiling = Duration(days: 7);

    Future<EntitlementCache> cacheWithVerifiedPro({DateTime? at}) async {
      final EntitlementCache c = EntitlementCache(
        store: InMemorySecureStore(),
        stalenessCeiling: ceiling,
      );
      await c.saveVerified(
        const Entitlements(
          appId: 'probe',
          isPro: true,
          items: <Entitlement>[],
        ),
        now: at ?? verified,
      );
      return c;
    }

    test('the constant is the shipped default, not something a test invented',
        () {
      // If the default drifted, every assertion below would be about a number
      // no app uses. `assert-purchase-path.mjs` compares this same constant
      // against the trial length and the shortest billing period.
      expect(kEntitlementStalenessCeiling, const Duration(days: 7));
      expect(
        EntitlementCache(store: InMemorySecureStore()).stalenessCeiling,
        kEntitlementStalenessCeiling,
      );
    });

    test('bound − 1s, online ⇒ STILL UNLOCKED', () async {
      final EntitlementCache c = await cacheWithVerifiedPro();
      final Entitlements e = await c.readValid(
        now: verified.add(ceiling - const Duration(seconds: 1)),
      );
      expect(e.isPro, isTrue);
    });

    test('bound + 1s, online ⇒ RE-LOCKS', () async {
      final EntitlementCache c = await cacheWithVerifiedPro();
      final Entitlements e = await c.readValid(
        now: verified.add(ceiling + const Duration(seconds: 1)),
      );
      expect(e.isPro, isFalse);
      // The appId survives the downgrade so the caller still knows which app it
      // is talking about.
      expect(e.appId, 'probe');
    });

    test('bound + a YEAR, OFFLINE ⇒ still unlocked — the loss taken on purpose',
        () async {
      // WRITTEN DOWN RATHER THAN DISCOVERED: a user who is refunded and then
      // never reconnects keeps access indefinitely. Locking a paying user out
      // because their train went into a tunnel is the larger harm, and it is the
      // one that happens thousands of times more often.
      final EntitlementCache c = await cacheWithVerifiedPro();
      final Entitlements e = await c.readValid(
        now: verified.add(const Duration(days: 372)),
        connectivityAvailable: false,
      );
      expect(e.isPro, isTrue);
    });

    test(
        'the DEFAULT is the locking side — a caller who has not thought about it fails closed',
        () async {
      final EntitlementCache c = await cacheWithVerifiedPro();
      expect(
        (await c.readValid(now: verified.add(const Duration(days: 30)))).isPro,
        isFalse,
      );
    });

    test('an ABSENT verified_at is infinitely stale, never freshly verified',
        () async {
      // The shape of a cache written before the field existed, and the shape of
      // a corrupt one. Defaulting it to "now" would make every read look freshly
      // verified, so the ceiling could never be crossed and M-8 would be a
      // constant nothing consults.
      final EntitlementCache c = EntitlementCache(
        store: InMemorySecureStore(),
        stalenessCeiling: ceiling,
      );
      await c.save(
        const Entitlements(appId: 'probe', isPro: true, items: <Entitlement>[]),
      );
      expect((await c.readRaw())!.verifiedAt, isNull);
      expect((await c.readValid(now: verified)).isPro, isFalse);
    });

    test('an UNREADABLE verified_at is also infinitely stale', () async {
      final SecureStore s = InMemorySecureStore(<String, String>{
        'nikatru.entitlements': jsonEncode(<String, Object?>{
          'app_id': 'probe',
          'is_pro': true,
          'entitlements': <Object?>[],
          'verified_at': 'not a date',
        }),
      });
      final EntitlementCache c = EntitlementCache(
        store: s,
        stalenessCeiling: ceiling,
      );
      expect((await c.readRaw())!.verifiedAt, isNull);
      expect((await c.readValid(now: verified)).isPro, isFalse);
    });

    test('verified_at ROUND-TRIPS through the cache as UTC', () async {
      final EntitlementCache c = await cacheWithVerifiedPro();
      final Entitlements? back = await c.readRaw();
      expect(back!.verifiedAt, verified);
      expect(back.verifiedAt!.isUtc, isTrue);
    });

    test(
        'a LOCAL-time verified_at normalizes, so a timezone change cannot age the answer',
        () async {
      final DateTime local = DateTime.utc(2026, 8, 1, 12).toLocal();
      final EntitlementCache c = await cacheWithVerifiedPro(at: local);
      expect((await c.readRaw())!.verifiedAt, DateTime.utc(2026, 8, 1, 12));
    });

    test(
        '🔒 `save` CANNOT refresh the verification age — only `saveVerified` can',
        () async {
      // If a plain write could stamp itself fresh, any cache-writing code path
      // would reset the clock and the ceiling would be unreachable.
      final EntitlementCache c = await cacheWithVerifiedPro();
      final Entitlements stale = (await c.readRaw())!;
      await c.save(stale);
      expect((await c.readRaw())!.verifiedAt, verified);
    });

    test(
        'isStaleAt is exposed, so the decision is inspectable rather than implied',
        () async {
      final EntitlementCache c = await cacheWithVerifiedPro();
      final Entitlements e = (await c.readRaw())!;
      expect(c.isStaleAt(e, verified.add(const Duration(days: 6))), isFalse);
      expect(c.isStaleAt(e, verified.add(const Duration(days: 8))), isTrue);
    });
  });
}
