import 'package:nikatru_core/nikatru_core.dart' show Entitlements, Money;

import '../models/budget_info.dart';
import '../models/category.dart';
import '../models/payment_record.dart';
import '../models/price_change.dart';
import '../models/spend_history.dart';
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

  /// Record that [id] was paid [amount] on [paidOn] — "Mark as paid" (ST-R5,
  /// NO-10): `POST /v1/subscriptions/:id/payments`. [idempotencyKey] makes a
  /// retried press (a notification action can be delivered twice) one
  /// payment; a host that does not read it yet ignores the query parameter.
  Future<void> recordPayment(
    String id, {
    required Money amount,
    required DateTime paidOn,
    required String idempotencyKey,
  });

  /// Every charge and price edit across the user's plans over the last year —
  /// `GET /v1/insights` (ST-P6 trend, ST-I4 price-rise alert).
  Future<SpendHistory> getSpendHistory();
  Future<BudgetInfo> getBudget();
  Future<BudgetInfo> updateBudget(BudgetInfo budget);
  Future<Entitlements> getEntitlements();
}

/// The price timeline (DE-05): `price_history` on `GET /v1/subscriptions/:id`,
/// which the API served and no client read. "Mark as paid" (DE-04) is
/// [ApiClient.recordPayment], which every client carries (#1119, NO-10).
///
/// A SEPARATE interface, like [IdempotentCreates], so a client that predates
/// it (a test fake) still compiles; [SubscriptionRepository] asks for it and
/// says plainly when a client cannot record a payment.
abstract interface class PaymentWrites {
  /// Every price edit on [id], newest first.
  Future<List<PriceChange>> getPriceHistory(String id);
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

/// A client that serves `/v1/categories` (ST-T9, AD-05). A separate seam, as
/// [IdempotentCreates] is, so a client without it — an old test fake, a
/// decorator over one — still compiles and the app falls back to the
/// built-ins rather than failing.
abstract interface class CategoriesApi {
  /// The built-ins plus this user's own (`GET /v1/categories`).
  Future<List<SubscriptionCategory>> getCategories();

  /// `POST /v1/categories` — one of the user's own.
  Future<SubscriptionCategory> createCategory(String name);

  /// `PATCH /v1/categories/:id` — the server rewrites the name on every row
  /// and on the budget cap in the same batch.
  Future<SubscriptionCategory> renameCategory(String id, String name);

  /// `DELETE /v1/categories/:id` — its rows become uncategorised.
  Future<void> deleteCategory(String id);
}
