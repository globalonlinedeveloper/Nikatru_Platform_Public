import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_purchases/nikatru_purchases.dart';

/// An in-memory [core.SecureStore]. The cache under test is the real one.
class _MemStore implements core.SecureStore {
  final Map<String, String> _m = <String, String>{};

  @override
  Future<void> delete(String key) async => _m.remove(key);

  @override
  Future<void> deleteAll() async => _m.clear();

  @override
  Future<String?> read(String key) async => _m[key];

  @override
  Future<void> write(String key, String value) async => _m[key] = value;
}

/// Answers a scripted sequence, so "the server does not see it yet, and then it
/// does" is a thing this suite can actually stage.
class _ScriptedTransport implements core.EntitlementTransport {
  _ScriptedTransport(this.script);
  final List<core.Result<core.Entitlements>> script;
  int calls = 0;

  @override
  Future<core.Result<core.Entitlements>> fetch({
    required String appId,
    required String? accessToken,
  }) async {
    final core.Result<core.Entitlements> r =
        script[calls < script.length ? calls : script.length - 1];
    calls++;
    return r;
  }
}

core.Result<core.Entitlements> _pro({bool isPro = true}) =>
    core.Result<core.Entitlements>.ok(
      core.Entitlements(
        appId: 'probe',
        isPro: isPro,
        items: const <core.Entitlement>[],
      ),
    );

core.Result<core.Entitlements> get _notYet => _pro(isPro: false);
core.Result<core.Entitlements> get _down =>
    const core.Result<core.Entitlements>.err(core.Failure('network down'));

void main() {
  // ⚠️ EVERY TEST INJECTS `sleep`. A real `Future.delayed` here would make the
  // suite take a minute per case, and inside a widget test `tester.pump()` with
  // no duration runs NO timers at all — so a real sleep would hang or lie.
  late List<Duration> slept;
  Future<void> fakeSleep(Duration d) async => slept.add(d);
  setUp(() => slept = <Duration>[]);

  EntitlementConvergence build(
    _ScriptedTransport t, {
    core.EntitlementCache? cache,
  }) =>
      EntitlementConvergence(
        transport: t,
        cache: cache ?? core.EntitlementCache(store: _MemStore()),
        delays: const <Duration>[
          Duration(seconds: 2),
          Duration(seconds: 4),
          Duration(seconds: 8),
        ],
        sleep: fakeSleep,
      );

  group('[5]M-6(b) · convergence on a webhook that has not landed yet', () {
    test('unlocks on the FIRST read when the server already knows', () async {
      final _ScriptedTransport t =
          _ScriptedTransport(<core.Result<core.Entitlements>>[_pro()]);
      final ConvergenceResult r = await build(t).awaitUnlock(
        appId: 'probe',
        accessToken: () async => 'tok',
      );
      expect(r.outcome, ConvergenceOutcome.unlocked);
      expect(r.attempts, 1);
      // No wait at all for the common case.
      expect(slept, isEmpty);
    });

    test('waits, re-reads, and unlocks when the notification lands late',
        () async {
      final _ScriptedTransport t =
          _ScriptedTransport(<core.Result<core.Entitlements>>[
        _notYet,
        _notYet,
        _pro(),
      ]);
      final ConvergenceResult r = await build(t).awaitUnlock(
        appId: 'probe',
        accessToken: () async => 'tok',
      );
      expect(r.outcome, ConvergenceOutcome.unlocked);
      expect(r.attempts, 3);
      // BACKOFF, not a fixed interval: a webhook that lands in two seconds
      // costs one extra read and a slow one costs a handful, not fifty.
      expect(slept, <Duration>[
        const Duration(seconds: 2),
        const Duration(seconds: 4),
      ]);
    });

    test('🔒 IT STOPS. The plan is exhausted and the outcome is PENDING',
        () async {
      // The bound is a portfolio constraint: the whole factory shares one
      // 100k Worker-requests/day ceiling across ~50 apps, and an unbounded
      // "poll until it arrives" loop is a client-side denial of service against
      // every other app's config resolution.
      final _ScriptedTransport t =
          _ScriptedTransport(<core.Result<core.Entitlements>>[_notYet]);
      final EntitlementConvergence c = build(t);
      final ConvergenceResult r = await c.awaitUnlock(
        appId: 'probe',
        accessToken: () async => 'tok',
      );
      expect(r.outcome, ConvergenceOutcome.stillPending);
      expect(r.attempts, c.maxAttempts);
      expect(t.calls, c.maxAttempts);
    });

    test('NEVER ASKED SUCCESSFULLY is couldNotAsk, NOT stillPending', () async {
      // Reporting `stillPending` here would claim the server said no when
      // nothing ever answered — and "we asked and it is not there yet" and "we
      // could not ask" need different sentences and different retry advice.
      final _ScriptedTransport t =
          _ScriptedTransport(<core.Result<core.Entitlements>>[_down]);
      final ConvergenceResult r = await build(t).awaitUnlock(
        appId: 'probe',
        accessToken: () async => 'tok',
      );
      expect(r.outcome, ConvergenceOutcome.couldNotAsk);
    });

    test('a transient failure does not end the plan', () async {
      final _ScriptedTransport t =
          _ScriptedTransport(<core.Result<core.Entitlements>>[
        _down,
        _pro(),
      ]);
      final ConvergenceResult r = await build(t).awaitUnlock(
        appId: 'probe',
        accessToken: () async => 'tok',
      );
      expect(r.outcome, ConvergenceOutcome.unlocked);
      expect(r.attempts, 2);
    });
  });

  group('every server answer is written through as VERIFIED — [5]M-8', () {
    test('a NEGATIVE answer is persisted too, so the ceiling can be crossed',
        () async {
      // A cache that only ever recorded grants would keep the last grant looking
      // freshly verified forever, and M-8's bound would never be reachable.
      final _MemStore store = _MemStore();
      final core.EntitlementCache cache = core.EntitlementCache(store: store);
      final _ScriptedTransport t =
          _ScriptedTransport(<core.Result<core.Entitlements>>[_notYet]);

      await build(t, cache: cache).awaitUnlock(
        appId: 'probe',
        accessToken: () async => 'tok',
      );

      final core.Entitlements? raw = await cache.readRaw();
      expect(raw, isNotNull);
      expect(raw!.isPro, isFalse);
      expect(raw.verifiedAt, isNotNull);
    });

    test('a grant is persisted and reads back as still-verified', () async {
      final core.EntitlementCache cache =
          core.EntitlementCache(store: _MemStore());
      final _ScriptedTransport t =
          _ScriptedTransport(<core.Result<core.Entitlements>>[_pro()]);
      await build(t, cache: cache).awaitUnlock(
        appId: 'probe',
        accessToken: () async => 'tok',
      );
      expect((await cache.readValid()).isPro, isTrue);
    });
  });

  test('[5]M-10 · restore on a NEW DEVICE needs no local state at all',
      () async {
    // The entitlement is a server row keyed (user_id, app_id). A fresh install
    // has an EMPTY cache; signing in and reading is the whole restore, and there
    // is nothing device-local for a reinstall to have lost.
    final core.EntitlementCache emptyCache =
        core.EntitlementCache(store: _MemStore());
    expect(await emptyCache.readRaw(), isNull);

    final ConvergenceResult r = await build(
      _ScriptedTransport(<core.Result<core.Entitlements>>[_pro()]),
      cache: emptyCache,
    ).awaitUnlock(appId: 'probe', accessToken: () async => 'tok');

    expect(r.isUnlocked, isTrue);
    expect((await emptyCache.readValid()).isPro, isTrue);
  });
}
