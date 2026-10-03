/// THE SHARED FAKES for the client money seams, and their conformance suite —
/// tooling/ports/README.md §3 "Dart ports": each seam package exports
/// `lib/testing.dart`, the fake plus `run<Seam>Conformance`.
///
/// Built from the behaviours the hand fakes in this repo's tests encoded (18
/// test files at Public 630dcce4: nine `PurchaseRail`, six `IapBridge`, three
/// `CheckoutLauncher`), so a test that only needs "a rail that sells this" or
/// "a store that answers that" stops restating the seam, and a new behaviour of
/// the seam lands in ONE fake instead of eighteen. Every fake here passes the
/// same conformance suite the production rails and bridges pass
/// (`test/conformance/fakes_conformance_test.dart`), so a fake cannot quietly
/// promise something no real rail does — a cancel that unlocks, a lifetime plan
/// on a store sheet.
///
/// 🔴 TESTS ONLY. Nothing under `lib/src` imports this library, and an app's
/// `lib/` must not either: it depends on `flutter_test`.
library;

import 'dart:async';

import 'package:flutter/foundation.dart' show ChangeNotifier, Listenable;

import 'nikatru_purchases.dart';

export 'testing/conformance.dart';

/// A [CheckoutLauncher] that records every URL it was asked to open and
/// answers [answer]. The seam exists FOR this: a test cannot observe a real
/// browser opening.
class FakeCheckoutLauncher implements CheckoutLauncher {
  FakeCheckoutLauncher({this.answer = true});

  /// Every URL handed to [open], in order.
  final List<Uri> opened = <Uri>[];

  /// Whether the platform "opened" the page. False is a real outcome (a popup
  /// blocker, no handler), not an exception.
  bool answer;

  @override
  Future<bool> open(Uri url) async {
    opened.add(url);
    return answer;
  }
}

/// A scriptable [IapBridge]: a store that answers what the test says, and
/// records what it was asked.
///
/// Defaults are a reachable store that configures, identifies, completes every
/// sheet and every restore, and sells NOTHING until [plans] says it does — the
/// store's catalogue is the one answer every test states for itself.
class FakeIapBridge implements IapBridge {
  FakeIapBridge({
    this.configureAnswer = true,
    this.identifyAnswer = true,
    List<StorePlan> plans = const <StorePlan>[],
    this.purchaseAnswer = const IapPurchaseResult(IapPurchaseOutcome.submitted),
    this.restoreAnswer = const IapPurchaseResult(IapPurchaseOutcome.submitted),
    this.state = IapCustomerState.unknown,
    this.onCall,
  }) : plans = List<StorePlan>.of(plans);

  /// What [configure] answers.
  bool configureAnswer;

  /// What [identify] and [logOut] answer.
  bool identifyAnswer;

  /// What the store sells here, to this buyer. Read on every [storePlans].
  List<StorePlan> plans;

  /// When set, [storePlans] throws — a bridge that breaks the seam's "must not
  /// throw", which the rail must survive.
  bool plansThrow = false;

  /// What the purchase sheet answers.
  IapPurchaseResult purchaseAnswer;

  /// When set, [purchase] waits on it: a sheet the test holds open.
  Completer<IapPurchaseResult>? heldPurchase;

  /// What a restore answers.
  IapPurchaseResult restoreAnswer;

  /// The store's belief about this customer.
  IapCustomerState state;

  /// Called with the method name (`configure`, `identify`, `logOut`,
  /// `storePlans`, `purchase`, `restore`, `currentCustomerState`) on every
  /// call — for a test that orders calls across seams.
  void Function(String method)? onCall;

  int configureCalls = 0;
  int storePlanCalls = 0;
  int restoreCalls = 0;
  int stateCalls = 0;

  /// The last configuration [configure] was handed.
  IapBridgeConfig? lastConfig;

  /// Every identity the bridge was told, in order: `configure:<id>`,
  /// `identify:<id>`, `logOut`. [ADR 085] B's subject is exactly this list.
  final List<String> identities = <String>[];

  /// The product id of every purchase sheet opened, in order.
  final List<String> purchased = <String>[];

  final StreamController<IapCustomerState> _states =
      StreamController<IapCustomerState>.broadcast();

  /// Publish [next] as the store's new belief, to [customerState] listeners.
  void emit(IapCustomerState next) {
    state = next;
    _states.add(next);
  }

  @override
  Future<bool> configure(IapBridgeConfig config) async {
    onCall?.call('configure');
    configureCalls++;
    lastConfig = config;
    identities.add('configure:${config.appUserId}');
    return configureAnswer;
  }

  @override
  Future<bool> identify(String appUserId) async {
    onCall?.call('identify');
    identities.add('identify:$appUserId');
    return identifyAnswer;
  }

  @override
  Future<bool> logOut() async {
    onCall?.call('logOut');
    identities.add('logOut');
    return identifyAnswer;
  }

  @override
  Future<List<StorePlan>> storePlans() async {
    onCall?.call('storePlans');
    storePlanCalls++;
    if (plansThrow) throw StateError('store unreachable');
    return List<StorePlan>.unmodifiable(plans);
  }

  @override
  Future<IapPurchaseResult> purchase(Offering offering) {
    onCall?.call('purchase');
    purchased.add(offering.productId);
    return heldPurchase?.future ??
        Future<IapPurchaseResult>.value(purchaseAnswer);
  }

  @override
  Future<bool> presentCodeRedemptionSheet() async {
    onCall?.call('presentCodeRedemptionSheet');
    return codeSheetAnswer;
  }

  /// What [presentCodeRedemptionSheet] answers.
  bool codeSheetAnswer = true;

  @override
  Future<IapPurchaseResult> restore() async {
    onCall?.call('restore');
    restoreCalls++;
    return restoreAnswer;
  }

  @override
  Future<IapCustomerState> currentCustomerState() async {
    onCall?.call('currentCustomerState');
    stateCalls++;
    return state;
  }

  @override
  Stream<IapCustomerState> get customerState => _states.stream;
}

/// A scriptable [PurchaseRail]: a rail of [railKind] that sells [offerings]
/// and answers every checkout the way that kind of rail does.
///
/// - A hosted rail ([PurchaseRailKind.hosted]) hands the page over —
///   [CheckoutOpened] on `https://checkout.invalid/<productId>`; a store rail
///   runs its sheet — [CheckoutSubmitted]. Neither unlocks anything: the
///   unlock is the server's read, as on every real rail.
/// - [refusal] makes every checkout a [CheckoutRefused] with that reason and
///   [refusalDetail], AFTER it is counted — the runtime refusal, independent
///   of [canStartCheckout], which is the configuration answer a paywall asks
///   before it draws a button.
/// - A store rail never offers, and never sells, a lifetime plan
///   ([OfferingTerm.oneTime], [ADR 093] §11.2) — the rule `IapRail` keeps.
///
/// It is a [LoadsOfferings] (whose list changes only through [setOfferings])
/// and a [RestoresPurchases] (a store rail asks its store; any other answers
/// [RestoreOutcome.serverOnly], the answer a rail with no store gets from
/// [restorePurchasesOf] anyway). It is NOT an `IdentifiesBuyer`: a hosted rail
/// is not one, and a test about the store SDK's identity drives `IapRail` with
/// a [FakeIapBridge] instead.
class FakePurchaseRail
    implements PurchaseRail, LoadsOfferings, RestoresPurchases {
  FakePurchaseRail({
    this.railKind = PurchaseRailKind.hosted,
    List<Offering> offerings = const <Offering>[],
    bool? canStartCheckout,
    this.refusal,
    this.refusalDetail = '',
    this.cancellation = CancellationOutcome.noActivePlan,
    RestoreOutcome? restoreAnswer,
  }) : _offerings = List<Offering>.of(offerings),
       _canStartCheckout = canStartCheckout,
       _restoreAnswer = restoreAnswer;

  @override
  final PurchaseRailKind railKind;

  List<Offering> _offerings;
  final bool? _canStartCheckout;
  final RestoreOutcome? _restoreAnswer;
  final _Changes _changed = _Changes();

  /// When non-null, every checkout is refused with it.
  CheckoutRefusal? refusal;

  /// The engineering detail a refusal carries — never rendered.
  String refusalDetail;

  /// What [requestCancellation] answers.
  CancellationOutcome cancellation;

  int startCalls = 0;
  int cancelCalls = 0;
  int refreshCalls = 0;
  int restoreCalls = 0;

  /// Every offering a checkout was started for, in order.
  final List<Offering> started = <Offering>[];

  /// Replace what the rail sells and tell [offeringsChanged] listeners — a
  /// store's answer landing.
  void setOfferings(List<Offering> next) {
    _offerings = List<Offering>.of(next);
    _changed.fire();
  }

  @override
  List<Offering> get offerings => List<Offering>.unmodifiable(
    railKind.isStoreBilling
        ? _offerings.where((Offering o) => o.term != OfferingTerm.oneTime)
        : _offerings,
  );

  /// True by default exactly when there is something to sell on a rail that
  /// sells; a test that needs the configuration answer to differ says so.
  @override
  bool get canStartCheckout =>
      _canStartCheckout ??
      (railKind != PurchaseRailKind.none && offerings.isNotEmpty);

  @override
  Listenable get offeringsChanged => _changed;

  @override
  Future<void> refreshOfferings() async {
    refreshCalls++;
  }

  @override
  Future<CheckoutStart> startCheckout(Offering offering) async {
    startCalls++;
    started.add(offering);
    final CheckoutRefusal? r = refusal;
    if (r != null) return CheckoutRefused(r, detail: refusalDetail);
    if (railKind == PurchaseRailKind.none) {
      return const CheckoutRefused(
        CheckoutRefusal.channelNotPermitted,
        detail: 'This channel sells nothing.',
      );
    }
    if (railKind.isStoreBilling) {
      if (!offerings.any((Offering o) => o.productId == offering.productId)) {
        return CheckoutRefused(
          CheckoutRefusal.railNotConfigured,
          detail: 'The store does not offer ${offering.productId} here.',
        );
      }
      return CheckoutSubmitted(offering: offering);
    }
    return CheckoutOpened(
      offering: offering,
      url: Uri.parse('https://checkout.invalid/${offering.productId}'),
    );
  }

  @override
  Future<CancellationOutcome> requestCancellation() async {
    cancelCalls++;
    return cancellation;
  }

  @override
  Future<RestoreOutcome> restorePurchases() async {
    restoreCalls++;
    return _restoreAnswer ??
        (railKind.isStoreBilling
            ? RestoreOutcome.askedStore
            : RestoreOutcome.serverOnly);
  }
}

class _Changes extends ChangeNotifier {
  void fire() => notifyListeners();
}
