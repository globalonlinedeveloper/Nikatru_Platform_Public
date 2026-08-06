// [pipeline K-15] · Web builds honour the Global Privacy Control signal.
//
// ACCEPTANCE: "With navigator.globalPrivacyControl === true (or Sec-GPC: 1),
// analytics consent resolves to denied and no prompt is shown."
//
// "No prompt is shown" is not directly observable in a unit test, so it is
// tested through the property the prompt is DRIVEN BY: a UI prompts while the
// status is `unknown`. If a GPC user never sees `unknown` — only `denied`,
// which is a decided state — then no prompt can be shown. That is asserted
// below on both the hydrate path and the in-memory path, because a UI may
// consult either.
import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

ConsentController _controller(InMemoryKeyValueStore store, {required bool gpc}) =>
    ConsentController(
      store: store,
      privacySignal: StaticPrivacySignal(optedOut: gpc),
    );

Future<void> _grant(ConsentController c) => c.record(
      ConsentPurpose.analytics,
      granted: true,
      policyVersion: '2026-08-01',
      anonId: 'anon-1',
      now: DateTime.utc(2026, 8, 6),
    );

void main() {
  group('[8]K-15 · GPC resolves analytics to denied, with no prompt', () {
    test('GPC on ⇒ hydrate resolves DENIED, never unknown', () async {
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final ConsentController c = _controller(store, gpc: true);
      expect(await c.hydrate(ConsentPurpose.analytics), ConsentStatus.denied);
    });

    test('GPC on ⇒ statusOf is DENIED before any decision, so nothing prompts',
        () async {
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final ConsentController c = _controller(store, gpc: true);
      // `unknown` is the state a prompt is shown for. It must not occur.
      expect(c.statusOf(ConsentPurpose.analytics), ConsentStatus.denied);
      expect(
          c.statusOf(ConsentPurpose.analytics), isNot(ConsentStatus.unknown));
    });

    test('GPC OFF ⇒ statusOf is UNKNOWN, so the ordinary prompt still happens',
        () async {
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final ConsentController c = _controller(store, gpc: false);
      expect(c.statusOf(ConsentPurpose.analytics), ConsentStatus.unknown);
      expect(await c.hydrate(ConsentPurpose.analytics), ConsentStatus.unknown);
    });

    test('GPC on OVERRIDES an existing grant, without destroying it', () async {
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      // The user granted while GPC was off.
      final ConsentController before = _controller(store, gpc: false);
      await _grant(before);
      expect(before.statusOf(ConsentPurpose.analytics), ConsentStatus.granted);

      // Same store, GPC now on: denied.
      final ConsentController after = _controller(store, gpc: true);
      expect(
          await after.hydrate(ConsentPurpose.analytics), ConsentStatus.denied);

      // 🔴 And the original artifact SURVIVES — switching GPC off restores what
      // the user actually chose. If the signal had overwritten storage this
      // would come back `unknown` or `denied`, and their decision would have
      // been silently destroyed by a device setting.
      final ConsentController restored = _controller(store, gpc: false);
      expect(await restored.hydrate(ConsentPurpose.analytics),
          ConsentStatus.granted);
    });

    test('GPC does NOT speak for sync_backup — it is a sale/sharing signal',
        () async {
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final ConsentController c = _controller(store, gpc: true);
      // A "do not sell or share" signal says nothing about whether the user
      // wants their own data on their own other devices. Treating it as blanket
      // withdrawal is the same error as a single blanket consent flag.
      expect(c.optedOutBySignal(ConsentPurpose.analytics), isTrue);
      expect(c.optedOutBySignal(ConsentPurpose.syncBackup), isFalse);
      expect(c.statusOf(ConsentPurpose.syncBackup), ConsentStatus.unknown);
    });

    test('a GPC decision is NOT written as a ConsentArtifact', () async {
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final ConsentController c = _controller(store, gpc: true);
      await c.hydrate(ConsentPurpose.analytics);
      // The device spoke; the user did not decide. Forging an artifact here
      // would fabricate a decision AND would outlive the signal.
      expect(c.artifactOf(ConsentPurpose.analytics), isNull);
      expect(await store.read('nikatru.consent.analytics'), isNull);
    });

    test(
        'the default controller has no signal, so nothing changes for the '
        'five platforms that have no GPC concept', () async {
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final ConsentController c = ConsentController(store: store);
      expect(c.optedOutBySignal(ConsentPurpose.analytics), isFalse);
      expect(c.statusOf(ConsentPurpose.analytics), ConsentStatus.unknown);
      expect(const NoPrivacySignal().optedOut, isFalse);
    });

    test('createPrivacySignal() on this platform reports no opt-out', () {
      // On the VM this resolves to the io arm. The web arm is exercised by the
      // browser build; what is asserted here is that the conditional import
      // RESOLVES and answers the non-web-correct value rather than throwing.
      expect(createPrivacySignal().optedOut, isFalse);
    });
  });
}
