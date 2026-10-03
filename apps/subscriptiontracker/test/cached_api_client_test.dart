// 🔴 THE PROOF THAT PERSISTENCE IS ON THE PRODUCTION PATH.
//
// Every real build has the API configured, and until this change that branch
// used a bare `DioApiClient` with no local copy: the list was fetched on every
// launch and kept nowhere. `CachedApiClient` mirrors what the server last said
// into the device store and serves it — only when the server cannot be asked.
//
// The shape of every "survives" case is two CLIENTS over one store: the first
// sees the network, the second is built fresh (a restart) with the network
// dead. That is the only thing a unit test can do that a relaunch also does.
import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_core/nikatru_core.dart' show OutboxEntry;
import 'package:subscriptiontracker/data/api/api_client.dart';
import 'package:subscriptiontracker/data/api/cached_api_client.dart';
import 'package:subscriptiontracker/data/local/subscription_store.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/payment_record.dart';
import 'package:subscriptiontracker/data/models/spend_history.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';

class _MemStore implements core.KeyValueStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> remove(String key) async => data.remove(key);
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

class _BrokenStore implements core.KeyValueStore {
  @override
  Future<bool> containsKey(String key) async => throw StateError('disk full');
  @override
  Future<String?> read(String key) async => null;
  @override
  Future<void> remove(String key) async => throw StateError('disk full');
  @override
  Future<void> write(String key, String value) async =>
      throw StateError('disk full');
}

/// The Worker, as far as this client can tell: a list, a budget, and a switch
/// that turns every call into the failure a dead network produces.
class _FakeNetwork implements ApiClient {
  _FakeNetwork(this.subs, this.budget);

  List<Subscription> subs;
  BudgetInfo budget;

  /// Null = reachable. Otherwise every call throws this.
  ApiException? failure;
  int calls = 0;

  void _gate() {
    calls += 1;
    final ApiException? f = failure;
    if (f != null) throw f;
  }

  @override
  Future<List<Subscription>> getSubscriptions() async {
    _gate();
    return List<Subscription>.unmodifiable(subs);
  }

  @override
  Future<Subscription> createSubscription(Subscription draft) async {
    _gate();
    final Subscription created = Subscription(
      id: 'srv-${subs.length + 1}',
      name: draft.name,
      category: draft.category,
      price: draft.price,
      cycle: draft.cycle,
      nextRenewal: draft.nextRenewal,
    );
    subs = <Subscription>[...subs, created];
    return created;
  }

  @override
  Future<Subscription> getSubscription(String id) async {
    _gate();
    return subs.firstWhere((Subscription s) => s.id == id);
  }

  @override
  Future<Subscription> updateSubscription(
    String id,
    Map<String, dynamic> changes,
  ) async {
    _gate();
    final int i = subs.indexWhere((Subscription s) => s.id == id);
    final Subscription updated = subs[i].copyWith(
      name: changes['name'] as String?,
    );
    subs = <Subscription>[...subs]..[i] = updated;
    return updated;
  }

  @override
  Future<void> deleteSubscription(String id) async {
    _gate();
    subs = subs.where((Subscription s) => s.id != id).toList();
  }

  /// The row ids "Mark as paid" reached the network with (NO-10).
  final List<String> payments = <String>[];

  @override
  Future<void> recordPayment(
    String id, {
    required Money amount,
    required DateTime paidOn,
    required String idempotencyKey,
  }) async {
    _gate();
    payments.add(id);
  }

  @override
  Future<List<PaymentRecord>> getPaymentHistory(String id) async {
    _gate();
    return const <PaymentRecord>[];
  }

  @override
  Future<SpendHistory> getSpendHistory() async {
    _gate();
    return SpendHistory.empty;
  }

  @override
  Future<BudgetInfo> getBudget() async {
    _gate();
    return budget;
  }

  @override
  Future<BudgetInfo> updateBudget(BudgetInfo b) async {
    _gate();
    return budget = b;
  }

  @override
  Future<core.Entitlements> getEntitlements() async {
    _gate();
    return core.Entitlements.none;
  }
}

/// A network that honours `Idempotency-Key` the way the Worker now does: a
/// repeat of a key is answered with the row the first attempt made.
class _IdempotentNetwork extends _FakeNetwork implements IdempotentCreates {
  _IdempotentNetwork(super.subs, super.budget);

  final List<String> keys = <String>[];
  final Map<String, Subscription> _byKey = <String, Subscription>{};
  final Map<String, String> _bodyByKey = <String, String>{};

  /// Commit the next create, then fail as if the response was lost.
  bool loseNextResponse = false;

  /// When set, every create throws this (the list read still works).
  ApiException? createFailure;

  @override
  Future<Subscription> createSubscriptionOnce(
    Subscription draft, {
    required String idempotencyKey,
  }) async {
    keys.add(idempotencyKey);
    final ApiException? refused = createFailure;
    if (refused != null) throw refused;
    final String body = jsonEncode(draft.toJson());
    final String? seen = _bodyByKey[idempotencyKey];
    if (seen != null && seen != body) {
      throw ApiException(422, 'idempotency_key_reused');
    }
    _bodyByKey[idempotencyKey] = body;
    final Subscription row = _byKey[idempotencyKey] ??= await super
        .createSubscription(draft);
    if (loseNextResponse) {
      loseNextResponse = false;
      throw ApiException(0, 'receive timeout');
    }
    return row;
  }
}

/// A network whose first live create waits on [release], so a test can act
/// while a replay is in flight.
class _GatedNetwork extends _IdempotentNetwork {
  _GatedNetwork(super.subs, super.budget);

  final Completer<void> firstSendStarted = Completer<void>();
  final Completer<void> release = Completer<void>();

  @override
  Future<Subscription> createSubscriptionOnce(
    Subscription draft, {
    required String idempotencyKey,
  }) async {
    if (failure == null && !firstSendStarted.isCompleted) {
      firstSendStarted.complete();
      await release.future;
    }
    return super.createSubscriptionOnce(draft, idempotencyKey: idempotencyKey);
  }
}

Subscription _sub(String id, String name) => Subscription(
  id: id,
  name: name,
  category: 'Streaming',
  price: const Money(1549, 'USD'),
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime(2030, 7, 22),
);

const BudgetInfo _budget = BudgetInfo(
  monthlyBudget: Money(500000, 'INR'),
  categories: <BudgetCap>[],
);

final ApiException _offline = ApiException(0, 'Network error');

void main() {
  late _MemStore kv;
  LocalSubscriptionStore store() =>
      LocalSubscriptionStore(Future<core.KeyValueStore>.value(kv));

  setUp(() => kv = _MemStore());

  group('🔴 KILL THE NETWORK — the list survives a restart', () {
    test(
      'a list the server returned once is served when the server is gone',
      () async {
        final _FakeNetwork net = _FakeNetwork(<Subscription>[
          _sub('a', 'Netflix'),
          _sub('b', 'Spotify'),
        ], _budget);
        // Launch 1: online.
        final CachedApiClient first = CachedApiClient(net, store());
        expect((await first.getSubscriptions()).length, 2);
        expect(first.lastReadWasFromCache, isFalse);

        // Launch 2: a NEW client over the SAME bytes, network dead.
        net.failure = _offline;
        final CachedApiClient second = CachedApiClient(net, store());
        final List<Subscription> offline = await second.getSubscriptions();
        expect(offline.map((Subscription s) => s.name), <String>[
          'Netflix',
          'Spotify',
        ]);
        expect(second.lastReadWasFromCache, isTrue);
      },
    );

    test('the budget survives the same way', () async {
      final _FakeNetwork net = _FakeNetwork(<Subscription>[], _budget);
      await CachedApiClient(net, store()).getBudget();
      net.failure = _offline;
      final BudgetInfo b = await CachedApiClient(net, store()).getBudget();
      expect(b.monthlyBudget, const Money(500000, 'INR'));
    });

    test('a row ADDED online is in the offline copy', () async {
      final _FakeNetwork net = _FakeNetwork(<Subscription>[
        _sub('a', 'A'),
      ], _budget);
      final CachedApiClient first = CachedApiClient(net, store());
      await first.getSubscriptions();
      await first.createSubscription(_sub('', 'Claude Pro'));
      net.failure = _offline;
      final List<Subscription> offline = await CachedApiClient(
        net,
        store(),
      ).getSubscriptions();
      expect(offline.map((Subscription s) => s.name), contains('Claude Pro'));
    });

    test('a row DELETED online is gone from the offline copy', () async {
      final _FakeNetwork net = _FakeNetwork(<Subscription>[
        _sub('a', 'A'),
        _sub('b', 'B'),
      ], _budget);
      final CachedApiClient first = CachedApiClient(net, store());
      await first.getSubscriptions();
      await first.deleteSubscription('a');
      net.failure = _offline;
      final List<Subscription> offline = await CachedApiClient(
        net,
        store(),
      ).getSubscriptions();
      expect(offline.map((Subscription s) => s.id), <String>['b']);
    });

    test('an EDIT made online is in the offline copy', () async {
      final _FakeNetwork net = _FakeNetwork(<Subscription>[
        _sub('a', 'A'),
      ], _budget);
      final CachedApiClient first = CachedApiClient(net, store());
      await first.getSubscriptions();
      await first.updateSubscription('a', <String, dynamic>{'name': 'A+'});
      net.failure = _offline;
      final List<Subscription> offline = await CachedApiClient(
        net,
        store(),
      ).getSubscriptions();
      expect(offline.single.name, 'A+');
    });

    test('a single row is answered from the copy too', () async {
      final _FakeNetwork net = _FakeNetwork(<Subscription>[
        _sub('a', 'A'),
      ], _budget);
      await CachedApiClient(net, store()).getSubscriptions();
      net.failure = _offline;
      final Subscription s = await CachedApiClient(
        net,
        store(),
      ).getSubscription('a');
      expect(s.name, 'A');
    });

    test('a 5xx is "the server is gone" as much as no network is', () async {
      final _FakeNetwork net = _FakeNetwork(<Subscription>[
        _sub('a', 'A'),
      ], _budget);
      await CachedApiClient(net, store()).getSubscriptions();
      net.failure = ApiException(503, 'Service Unavailable');
      expect(
        await CachedApiClient(net, store()).getSubscriptions(),
        hasLength(1),
      );
    });
  });

  group('the cache never invents an answer', () {
    test('nothing cached + no network ⇒ the failure travels', () async {
      final _FakeNetwork net = _FakeNetwork(<Subscription>[], _budget)
        ..failure = _offline;
      await expectLater(
        CachedApiClient(net, store()).getSubscriptions(),
        throwsA(isA<ApiException>()),
      );
    });

    test(
      '🔴 a 401 is NOT offline — another account\'s copy is never served',
      () async {
        final _FakeNetwork net = _FakeNetwork(<Subscription>[
          _sub('a', 'A'),
        ], _budget);
        await CachedApiClient(net, store()).getSubscriptions();
        net.failure = ApiException(401, 'Unauthorized');
        await expectLater(
          CachedApiClient(net, store()).getSubscriptions(),
          throwsA(
            isA<ApiException>().having(
              (ApiException e) => e.statusCode,
              'status',
              401,
            ),
          ),
        );
      },
    );

    test('a 404 travels unchanged', () async {
      final _FakeNetwork net = _FakeNetwork(<Subscription>[
        _sub('a', 'A'),
      ], _budget);
      await CachedApiClient(net, store()).getSubscriptions();
      net.failure = ApiException(404, 'Not Found');
      await expectLater(
        CachedApiClient(net, store()).getSubscription('a'),
        throwsA(isA<ApiException>()),
      );
    });

    // ⏱ 2026-09-30 · this case read "an offline write fails honestly". An
    // offline ADD is now queued (audit D22, the group below); a write the server
    // ANSWERED with a failure is still refused honestly and touches nothing.
    test(
      'writes go to the server FIRST and a refused write fails honestly',
      () async {
        final _FakeNetwork net = _FakeNetwork(<Subscription>[
          _sub('a', 'A'),
        ], _budget);
        final CachedApiClient c = CachedApiClient(net, store());
        await c.getSubscriptions();
        net.failure = ApiException(503, 'unavailable');
        await expectLater(
          c.createSubscription(_sub('', 'Nope')),
          throwsA(isA<ApiException>()),
        );
        // And the copy was not touched: it still says what the server last said.
        expect(await store().readSubscriptions(), hasLength(1));
        expect(await c.pendingWrites(), isEmpty);
      },
    );

    test('entitlements are NEVER served from this cache', () async {
      final _FakeNetwork net = _FakeNetwork(<Subscription>[], _budget);
      await CachedApiClient(net, store()).getEntitlements();
      net.failure = _offline;
      await expectLater(
        CachedApiClient(net, store()).getEntitlements(),
        throwsA(isA<ApiException>()),
      );
      expect(kv.data.keys, isNot(contains(contains('entitle'))));
    });
  });

  // 🔴 AUDIT D22 / F48 — the red control. On the base an offline add threw and
  // the user retyped it; now it is queued and replayed ONCE, keyed by its
  // client id, and a replay of an add whose response was lost is not a second
  // row.
  // 🔴 AUDIT D22 / F48 and REVIEW #1075 findings 1 4 8 9: the red controls.
  // The queue is packages/core's DurableOutbox; these drive it through the
  // app's own adapter, as production does.
  group('an add made offline is kept, owned and replayed once', () {
    String? session = 'user-a';
    CachedApiClient client(ApiClient net) =>
        CachedApiClient(net, store(), currentUser: () => session);
    setUp(() => session = 'user-a');

    test('queued offline, shown at once, replayed once on reconnect', () async {
      final _IdempotentNetwork net = _IdempotentNetwork(<Subscription>[
        _sub('a', 'A'),
      ], _budget);
      final CachedApiClient c = client(net);
      await c.getSubscriptions();

      net.failure = _offline;
      final Subscription shown = await c.createSubscription(_sub('', 'Gym'));
      expect(shown.name, 'Gym');
      expect(await c.pendingWrites(), hasLength(1));

      // A restart while offline keeps it, and the offline list shows it.
      final CachedApiClient restarted = client(net);
      expect(
        (await restarted.getSubscriptions()).map((Subscription s) => s.name),
        <String>['A', 'Gym'],
      );

      net.failure = null;
      final CachedApiClient online = client(net);
      final List<Subscription> live = await online.getSubscriptions();
      expect(live.map((Subscription s) => s.name), <String>['A', 'Gym']);
      expect(net.keys.toSet(), <String>{shown.id}, reason: 'one client id');
      expect(await online.pendingWrites(), isEmpty);
      await client(net).getSubscriptions();
      expect(net.subs, hasLength(2), reason: 'replayed ONCE, never again');
    });

    test('an add whose response was lost is not inserted twice', () async {
      final _IdempotentNetwork net = _IdempotentNetwork(
        <Subscription>[],
        _budget,
      );
      final CachedApiClient c = client(net);
      net.loseNextResponse = true; // the server commits; the reply never lands
      await c.createSubscription(_sub('', 'Gym'));
      expect(net.subs, hasLength(1));
      expect(await c.pendingWrites(), hasLength(1));

      await client(net).getSubscriptions(); // reconnect: the SAME key
      expect(net.subs, hasLength(1), reason: 'the key made the replay a no-op');
      expect(net.keys.toSet(), hasLength(1));
    });

    // Finding 1, path A: the first user's session died (a forced 401 keeps
    // the queue), and a second user signs in on the same device.
    test(
      'the first user\'s queued add is never posted under the next user',
      () async {
        final _IdempotentNetwork net = _IdempotentNetwork(
          <Subscription>[],
          _budget,
        );
        net.failure = _offline;
        await client(net).createSubscription(_sub('', 'Gym of A'));
        net.failure = null;
        session = 'user-b';
        await client(net).getSubscriptions();
        expect(net.subs, isEmpty, reason: 'the second session sent nothing');
        expect(
          await client(net).pendingWrites(),
          isEmpty,
          reason: 'the second user does not see the first user\'s queued rows',
        );
        session = 'user-a';
        await client(net).getSubscriptions();
        expect(net.subs.single.name, 'Gym of A', reason: 'kept for its owner');
      },
    );

    // Finding 1, path B: Settings, Log out, while a replay is sending.
    test('a sign-out during a replay stops it', () async {
      final _GatedNetwork net = _GatedNetwork(<Subscription>[], _budget);
      net.failure = _offline;
      final CachedApiClient c = client(net);
      await c.createSubscription(_sub('', 'X'));
      await c.createSubscription(_sub('', 'Y'));
      net.failure = null;
      final Future<void> replay = client(net).replayPending();
      await net.firstSendStarted.future;
      session = null;
      await c.discardPendingOf('user-a');
      net.release.complete();
      await replay;
      expect(net.subs.map((Subscription s) => s.name), <String>[
        'X',
      ], reason: 'Y is never sent');
      session = 'user-a';
      expect(await c.pendingWrites(), isEmpty);
    });

    // Finding 4: a row that exists only on the device.
    test(
      'deleting a row that never left the device never reaches the server',
      () async {
        final _IdempotentNetwork net = _IdempotentNetwork(
          <Subscription>[],
          _budget,
        );
        net.failure = _offline;
        final CachedApiClient c = client(net);
        // A failed read proves the device offline: the add is then queued
        // without a request, so it is known never to have left.
        await expectLater(c.getSubscriptions(), throwsA(isA<ApiException>()));
        final Subscription row = await c.createSubscription(_sub('', 'Gym'));
        final int callsBefore = net.calls;
        await c.deleteSubscription(row.id);
        net.failure = null;
        final List<Subscription> live = await client(net).getSubscriptions();
        expect(live, isEmpty);
        expect(
          net.calls - callsBefore,
          1,
          reason: 'one GET; no POST, no DELETE',
        );
        expect(await c.pendingWrites(), isEmpty);
      },
    );

    test(
      'editing a row that never left the device edits the queued create',
      () async {
        final _IdempotentNetwork net = _IdempotentNetwork(
          <Subscription>[],
          _budget,
        );
        net.failure = _offline;
        final CachedApiClient c = client(net);
        await expectLater(c.getSubscriptions(), throwsA(isA<ApiException>()));
        final Subscription row = await c.createSubscription(_sub('', 'Gym'));
        final Subscription edited = await c.updateSubscription(
          row.id,
          <String, dynamic>{'name': 'Gym (annual)'},
        );
        expect(edited.name, 'Gym (annual)');
        net.failure = null;
        await client(net).getSubscriptions();
        expect(
          net.subs.single.name,
          'Gym (annual)',
          reason: 'one POST, edited',
        );
      },
    );

    test('once synced, the client id reaches the server row', () async {
      final _IdempotentNetwork net = _IdempotentNetwork(
        <Subscription>[],
        _budget,
      );
      net.loseNextResponse = true;
      final CachedApiClient c = client(net);
      final Subscription row = await c.createSubscription(_sub('', 'Gym'));
      await client(net).getSubscriptions(); // the replay resolves the id
      await c.deleteSubscription(
        row.id,
      ); // the screen still holds the client id
      expect(net.subs, isEmpty, reason: 'the DELETE went to the server row');
    });

    // NO-10: "Mark as paid" on a row the screen still knows by its client id
    // (an add whose response was lost) — the payment goes to the server row,
    // as every read and write on that row does.
    test('once synced, a payment reaches the server row too', () async {
      final _IdempotentNetwork net = _IdempotentNetwork(
        <Subscription>[],
        _budget,
      );
      net.loseNextResponse = true;
      final CachedApiClient c = client(net);
      final Subscription row = await c.createSubscription(_sub('', 'Gym'));
      await client(net).getSubscriptions(); // the replay resolves the id
      await c.recordPayment(
        row.id,
        amount: const Money(1549, 'USD'),
        paidOn: DateTime(2030, 7, 22),
        idempotencyKey: 'paid_x_2030-07-22',
      );
      expect(net.payments, <String>[net.subs.single.id]);
      expect(net.payments.single, isNot(row.id));
    });

    // 🔴 REVIEW ROUND 2, MAJOR 1 — a lost response costs no attempt, so
    // "attempts == 0" said "never reached" of a row the server HAD.
    test(
      'a lost add response, then a delete: the server row is gone',
      () async {
        final _IdempotentNetwork net = _IdempotentNetwork(
          <Subscription>[],
          _budget,
        );
        final CachedApiClient c = client(net);
        net.loseNextResponse = true; // committed; the reply never lands
        final Subscription row = await c.createSubscription(_sub('', 'Gym'));
        expect(net.subs, hasLength(1));
        await c.deleteSubscription(row.id);
        await client(net).getSubscriptions(); // reconnect
        expect(net.subs, isEmpty, reason: 'the delete reached the server row');
        expect(await c.syncProblems(), isEmpty);
      },
    );

    test('a lost add response, then an edit: no 422, and the server holds the '
        'edit', () async {
      final _IdempotentNetwork net = _IdempotentNetwork(
        <Subscription>[],
        _budget,
      );
      final CachedApiClient c = client(net);
      net.loseNextResponse = true;
      final Subscription row = await c.createSubscription(_sub('', 'Gym'));
      await c.updateSubscription(row.id, <String, dynamic>{
        'name': 'Gym (annual)',
      });
      await client(net).getSubscriptions(); // reconnect
      expect(await c.syncProblems(), isEmpty, reason: 'no 422 dead letter');
      expect(net.subs.single.name, 'Gym (annual)');
    });

    // Finding 8: a live read while the queue is still waiting.
    test(
      'queued rows stay visible after a live read until they sync',
      () async {
        final _IdempotentNetwork net = _IdempotentNetwork(<Subscription>[
          _sub('a', 'A'),
        ], _budget);
        net.failure = _offline;
        await client(net).createSubscription(_sub('', 'Gym'));
        net.failure = null;
        net.createFailure = ApiException(503, 'unavailable');
        final List<Subscription> live = await client(net).getSubscriptions();
        expect(live.map((Subscription s) => s.name), <String>['A', 'Gym']);
      },
    );

    // Finding 9: a refused add is SHOWN, never silently dropped.
    test(
      'a refused add is a sync problem the user can retry or discard',
      () async {
        final _IdempotentNetwork net = _IdempotentNetwork(
          <Subscription>[],
          _budget,
        );
        net.failure = _offline;
        await client(net).createSubscription(_sub('', 'Gym'));
        net.failure = null;
        net.createFailure = ApiException(400, 'invalid_body');
        final CachedApiClient c = client(net);
        final List<Subscription> live = await c.getSubscriptions();
        expect(live.single.name, 'Gym', reason: 'still on screen');
        final List<OutboxEntry> problems = await c.syncProblems();
        expect(problems, hasLength(1));
        await c.discardSync(problems.single.id);
        expect(await c.getSubscriptions(), isEmpty);
      },
    );
  });

  group('a cache write failure is never silent', () {
    test(
      'the operation succeeds (the server has it) AND the failure is reported',
      () async {
        final List<Object> reported = <Object>[];
        final _FakeNetwork net = _FakeNetwork(<Subscription>[
          _sub('a', 'A'),
        ], _budget);
        final CachedApiClient c = CachedApiClient(
          net,
          LocalSubscriptionStore(
            Future<core.KeyValueStore>.value(_BrokenStore()),
          ),
          onCacheWriteFailed: reported.add,
        );
        expect(await c.getSubscriptions(), hasLength(1));
        expect(c.cacheWriteFailures, 1);
        expect(c.lastCacheWriteError, isA<LocalStoreWriteFailure>());
        expect(reported, hasLength(1));
        expect('${reported.single}', contains('disk full'));
      },
    );
  });
}
