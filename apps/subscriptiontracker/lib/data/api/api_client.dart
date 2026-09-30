import 'package:nikatru_core/nikatru_core.dart' show Entitlements;

import '../models/budget_info.dart';
import '../models/payment_record.dart';
import '../models/subscription.dart';

// ApiException is generic (transport-level) and lives in the shared client;
// re-export it so callers importing this seam get it too.
export 'package:nikatru_api_client/nikatru_api_client.dart' show ApiException;

/// The Subly data seam. The UI depends only on this; concrete clients talk to
/// the Cloudflare Worker (live) or serve seed data (demo). Subly-domain — lives
/// in the app, built on the shared generic `RestClient` (de-Subly-fy G-22).
abstract class ApiClient {
  Future<List<Subscription>> getSubscriptions();
  Future<Subscription> createSubscription(Subscription draft);
  Future<Subscription> getSubscription(String id);
  Future<Subscription> updateSubscription(
    String id,
    Map<String, dynamic> changes,
  );
  Future<void> deleteSubscription(String id);
  Future<List<PaymentRecord>> getPaymentHistory(String id);
  Future<BudgetInfo> getBudget();
  Future<BudgetInfo> updateBudget(BudgetInfo budget);
  Future<Entitlements> getEntitlements();
}

/// A client whose create can be REPEATED safely: every attempt of one add sends
/// the same [idempotencyKey], and the server answers a repeat with the row the
/// first attempt made (AB-O2-02). The offline outbox replays through this; a
/// client without it (the seed, a test fake) is simply sent the draft again.
abstract interface class IdempotentCreates {
  Future<Subscription> createSubscriptionOnce(
    Subscription draft, {
    required String idempotencyKey,
  });
}
