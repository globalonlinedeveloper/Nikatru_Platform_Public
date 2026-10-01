import 'package:nikatru_core/nikatru_core.dart' show Entitlements, Money;

import '../models/budget_info.dart';
import '../models/category.dart';
import '../models/payment_record.dart';
import '../models/price_change.dart';
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

/// "Mark as paid" and the price timeline (DE-04, DE-05): the two server
/// features `services/subscriptiontracker-api` already served —
/// `POST /v1/subscriptions/:id/payments` and `price_history` on
/// `GET /v1/subscriptions/:id` — that no client called.
///
/// A SEPARATE interface, like [IdempotentCreates], so a client that predates
/// it (a test fake) still compiles; [SubscriptionRepository] asks for it and
/// says plainly when a client cannot record a payment.
abstract interface class PaymentWrites {
  /// Record a payment the user already made. Every attempt of ONE tap sends
  /// the same [idempotencyKey], so a replay after a lost answer adds nothing
  /// where the server honours the key (lane fix-payments-idempotency).
  Future<PaymentRecord> recordPayment(
    String id, {
    required Money amount,
    required DateTime paidOn,
    required String idempotencyKey,
  });

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
