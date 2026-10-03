import 'package:flutter/foundation.dart'
    show PlatformDispatcher, visibleForTesting;
import 'package:flutter/widgets.dart' show Locale, basicLocaleListResolution;
import 'package:flutter_riverpod/flutter_riverpod.dart';
// StateProvider (and its StateController) moved to legacy.dart in Riverpod 3.0.
import 'package:flutter_riverpod/legacy.dart';
import 'package:intl/intl.dart' show DateFormat;

import '../core/format/money_format.dart';
import '../core/format/sub_math.dart';
import '../data/api/api_client.dart' show ApiException;
import '../data/models/budget_info.dart';
import '../data/models/subscription.dart';
import '../l10n/app_localizations.dart';
import 'package:nikatru_notifications/nikatru_notifications.dart'
    show LinuxAutostartControl;

import '../services/notifications/notification_service.dart';
import 'analytics_funnel.dart';
import 'providers.dart';
import 'settings_controller.dart';

/// `DateFormat.MMMd` for [localeName], degrading to the compiled-in `en_US`
/// rather than throwing.
///
/// 🔴 MEASURED, NOT ASSUMED (2026-08-09). `DateFormat.MMMd('en')` throws
/// `LocaleDataException` on a bare `ProviderContainer` — and so does
/// `DateFormat.MMMd('ta')`. Only the argument-less form and `'en_US'` work
/// before something loads the symbol tables, because that one locale is
/// compiled into intl and every other is data. In the running app
/// `GlobalMaterialLocalizations.delegate` loads the whole set on its first
/// `load()` (flutter_localizations/lib/src/utils/date_localizations.dart), and
/// `MaterialApp` blocks its subtree until the delegates resolve, so any screen
/// that can read [subscriptionsControllerProvider] is already past that point.
/// This branch is for the callers that are NOT under a `MaterialApp` — the
/// container tests that drive the controller directly — where the throw would
/// land inside a fire-and-forget `_syncReminders` and surface as an unrelated
/// failure somewhere else entirely.
///
/// ⚠️ `DateFormat.localeExists` CANNOT BE THE GUARD: it throws the very
/// exception it would be checking for (measured — `intl_helpers.dart:73`).
///
/// ✅ AND THE `catch` IS NOT DEFENSIVE PADDING — deleting it turns SEVEN tests
/// red (four in activation_transition_test, three in settings_wiring_test), each
/// with that exact `LocaleDataException`. Those suites drive this controller
/// through a bare container on purpose, so the branch has a proven open path.
DateFormat monthDayFormat(String localeName) {
  try {
    return DateFormat.MMMd(localeName);
  } on Exception {
    return DateFormat.MMMd();
  }
}

/// The OS-notification copy for [chosen] — `LocaleController`'s persisted
/// language override, where null means "follow the device".
///
/// 🔴 WHY THE COPY IS BUILT HERE AND NOT PASSED IN FROM THE UI. [ReminderCopy]'s
/// doc explains why the service takes strings; this explains where they come
/// from. `_syncReminders` has four call sites and only two are user gestures:
/// `build()` (provider construction) and the `settingsControllerProvider`
/// listener both run with no widget in the loop, and `AsyncNotifier.build()`
/// takes no arguments, so there is no signature through which a screen could
/// hand copy down. Threading it from the UI would leave exactly the two paths
/// that fire at launch and on a settings change — the ones that actually
/// schedule — with nothing to render from.
///
/// 🔴 AND WHY A PLAIN FUNCTION RATHER THAN A DERIVED `Provider`. The obvious
/// shape is `Provider((ref) => …ref.watch(localeProvider)…)` read with
/// `ref.read`. IT SHIPS A STALE FIRST NOTIFICATION, measured 2026-08-09: on the
/// locale-change edge the listener below fires while the derived provider is
/// still holding the previous language's copy, so the re-render that switching
/// language is supposed to cause re-posts the OLD words — one notification per
/// switch, in the language the user just left, with nothing red anywhere. A
/// function has no cache to be stale, and `ref.read(localeProvider)` inside a
/// listener on that same provider is the new value by construction. The regressed
/// case is pinned by reminder_plan_test's 'switching language re-renders'.
///
/// The resolution mirrors `WidgetsApp`'s own, deliberately, so the words in the
/// notification are the words on the screen: a chosen locale is still passed
/// through [basicLocaleListResolution] (that is what `WidgetsApp._resolveLocales`
/// does with a non-null `locale`), and a null one falls back to the platform's
/// list exactly as `MaterialApp` does. [PlatformDispatcher.instance] is used
/// rather than `WidgetsBinding.instance.platformDispatcher` because it needs no
/// binding, so a plain `ProviderContainer` test resolves a locale instead of
/// asserting.
ReminderCopy reminderCopyFor(Locale? chosen) {
  final AppLocalizations l10n = lookupAppLocalizations(
    resolveAppLocale(chosen),
  );
  final DateFormat monthDay = monthDayFormat(l10n.localeName);
  return ReminderCopy(
    channelName: l10n.renewalChannelName,
    channelDescription: l10n.renewalChannelDescription,
    reminderTitle: l10n.renewalReminderTitle,
    reminderBody: (String name, DateTime renewal) =>
        l10n.renewalReminderBody(name, monthDay.format(renewal)),
    trialTitle: l10n.trialReminderTitle,
    trialBody: (String name, DateTime ends) =>
        l10n.trialReminderBody(name, monthDay.format(ends)),
    digestTitle: l10n.weeklyDigestTitle,
    // ST-R7 (audit C24): what renews THIS week and what it costs — a tear-off,
    // and the plural: `count` picks the arm inside the .arb.
    digestBody: l10n.weeklyDigestDueBody,
    // ST-R8: the "Cancel by" reminder, in the same month-day format.
    cancelByTitle: (DateTime d) => l10n.cancelByTitle(monthDay.format(d)),
    cancelByBody: (String name, DateTime d) =>
        l10n.cancelByBody(name, monthDay.format(d)),
    // ST-I2 (audit C14): the over-budget alert, in the same language.
    overBudgetTitle: l10n.overBudgetTitle,
    overBudgetBody: l10n.overBudgetBody,
    // NO-10 / NO-13: the buttons on a renewal reminder, and the test one.
    markPaidAction: l10n.reminderActionMarkPaid,
    snoozeAction: l10n.reminderActionSnooze,
    testTitle: l10n.testReminderTitle,
    testBody: l10n.testReminderBody,
  );
}

/// The locale the app would actually render under, given [chosen] — the
/// persisted language override, where null means "follow the device".
///
/// Factored out of [reminderCopyFor] so the MONEY in the weekly digest is
/// formatted under the same locale as the WORDS around it. Formatting an
/// amount under one locale inside a sentence built in another is the seam the
/// old `Currency` sat in: it hardcoded `en_US` grouping into a notification
/// whose copy was Tamil.
Locale resolveAppLocale(Locale? chosen) => basicLocaleListResolution(
  chosen != null ? <Locale>[chosen] : PlatformDispatcher.instance.locales,
  AppLocalizations.supportedLocales,
);

/// The name of that locale, as `AppLocalizations` spells it.
String resolvedLocaleName(Locale? chosen) =>
    lookupAppLocalizations(resolveAppLocale(chosen)).localeName;

/// What the reminder wiring should do for a given set of preferences.
///
/// Extracted so the DECISION is testable without a platform: the plugin calls
/// themselves need a real device and are correctly out of scope, but "which
/// toggle causes which action" is exactly where a wiring bug hides -- and all
/// three of these toggles were previously read nowhere at all.
class ReminderPlan {
  const ReminderPlan({required this.syncRenewals, required this.weeklyDigest});

  /// Schedule per-renewal reminders (true) or cancel them all (false).
  final bool syncRenewals;

  /// Schedule the repeating weekly digest (true) or cancel it (false).
  final bool weeklyDigest;

  /// `alerts` defaults ON, `weekly` defaults OFF -- matching SettingsState, so a
  /// missing key can never silently flip a user's notifications on.
  factory ReminderPlan.from(Map<String, bool> prefs) => ReminderPlan(
    syncRenewals: prefs['alerts'] ?? true,
    weeklyDigest: prefs['weekly'] ?? false,
  );
}

/// Owns the subscription list and keeps on-device reminders in sync with it.
class SubscriptionsController extends AsyncNotifier<List<Subscription>> {
  @override
  Future<List<Subscription>> build() async {
    // A settings change must take effect NOW, not at the next add/cancel.
    // _syncReminders reads settings with ref.read, so without this listener a
    // user who switched 'Renewal alerts' off kept every scheduled reminder
    // (they still fired), and one who switched 'Weekly digest' on got nothing
    // — until the list next happened to change. This is the trigger edge of
    // the "which toggle causes which action" wiring: registered BEFORE the
    // first await, so a settings hydration landing mid-load is never missed.
    //
    // 🔴 AND ONLY WHEN A LIST HAS BEEN OBSERVED. This was
    // `state.value ?? const []`: a settings change while the first
    // fetch was still loading, or after it had failed, called
    // `syncAll(const [])` — which cancelled every renewal reminder and
    // scheduled none, on a device that still had every subscription. "Not
    // loaded" is not "no subscriptions"; the resync waits for the list, and
    // `build()` runs it the moment the list arrives anyway.
    ref.listen<SettingsState>(settingsControllerProvider, (_, __) {
      final List<Subscription>? observed = observedList;
      if (observed != null) _syncReminders(observed);
    });

    // The same trigger edge for the LANGUAGE. Since P4 the reminder text is
    // rendered from the active locale, so a user who switches language in
    // settings has notifications already sitting in the OS queue written in the
    // language they just left — and they would stay that way until the list or
    // a preference next happened to change. Same defect shape as the line
    // above, same fix: re-render on the edge. Which toggle causes which action
    // is untouched — this changes only WHEN a re-sync runs, never what
    // [ReminderPlan] decides.
    ref.listen<Locale?>(localeProvider, (_, _) {
      final List<Subscription>? observed = observedList;
      if (observed != null) _syncReminders(observed);
    });

    // ⏱ 2026-10-02 · ruling on #1155 (E2E run 37047693623): THE LIST IS READ
    // FOR ONE ACCOUNT. This controller is kept alive, and a read made before
    // a session existed (no bearer token, so the Worker's 401) or under the
    // previous account stayed on screen after the sign-in: Home said "Your
    // session has ended" to a user who had just signed in. A DIFFERENT
    // signed-in account than the one this read was made for re-reads; a
    // sign-out does not (nothing may be read without a session).
    // `test/sign_in_loads_home_list_test.dart`.
    final String? readFor = ref.read(authRepositoryProvider).currentUser?.id;
    ref.listen(authUserProvider, (_, next) {
      final String? id = next.value?.id;
      if (id != null && id != readFor) ref.invalidateSelf();
    });

    final List<Subscription> subs = _visible(
      await ref.watch(subscriptionRepositoryProvider).fetchAll(),
    );
    await _syncReminders(subs);
    return subs;
  }

  /// The rows a screen may show: everything but a soft-deleted one.
  ///
  /// ⏱ 2026-10-01 · DE-10: FILTERED HERE AS WELL AS ON THE SERVER, and both
  /// halves now exist. The server's readers skip a row whose `deleted_at` is
  /// set; this filter stays for the two sources that are not the server — the
  /// offline cache, which may still hold a row removed on another device, and
  /// the demo store — so a removed row never comes back on a refresh.
  static List<Subscription> _visible(List<Subscription> subs) =>
      subs.where((Subscription s) => s.deletedAt == null).toList();

  /// The list this controller has actually SEEN — or null while it is still
  /// loading or after a load failed.
  ///
  /// `hasValue && !hasError`: Riverpod keeps the previous data on an
  /// AsyncError, so `valueOrNull` alone would treat a stale list behind a
  /// failed refresh as a current observation. Every reminder sync and every
  /// list-derived write keys off this, never off `valueOrNull ?? const []`.
  @visibleForTesting
  List<Subscription>? get observedList {
    final AsyncValue<List<Subscription>> s = state;
    return s.hasValue && !s.hasError ? s.requireValue : null;
  }

  /// Re-read the list from the server and keep the list on screen if that
  /// fails — ST-N6 (D23, F37): a return to the app and the pull-to-refresh
  /// gesture both land here, through `refreshOnReturn`.
  ///
  /// 🔴 NOT `invalidateSelf()`, which is what a naive refresh would be. A
  /// failed rebuild puts the provider in an ERROR state, [observedList] reads
  /// that as "not observed", and the next add would then write a list of ONE
  /// row — the rest of the user's subscriptions gone from the screen because a
  /// phone came back to the front on a flat network. A resume happens many
  /// times a day, offline more often than a first launch is.
  ///
  /// - still loading: nothing to do, the fetch in flight IS the refresh;
  /// - failed with nothing observed: this is the Retry, so rebuild;
  /// - observed: fetch, and replace the list only if nothing wrote it while
  ///   the fetch was out (an add that landed meanwhile is newer than this).
  Future<void> refresh() async {
    final List<Subscription>? before = observedList;
    if (before == null) {
      if (state.hasError) ref.invalidateSelf();
      return;
    }
    final List<Subscription> fetched;
    try {
      fetched = _visible(
        await ref.read(subscriptionRepositoryProvider).fetchAll(),
      );
    } on Object {
      return; // A flat network is not an empty account; the offline banner says so.
    }
    if (!ref.mounted || !identical(observedList, before)) return;
    state = AsyncData<List<Subscription>>(fetched);
    await _syncReminders(fetched);
  }

  /// [primeReminders] is the PRIMING step (train ST-D8): the add sheet shows
  /// the design system's `showPermissionPriming` and answers whether the user
  /// chose to proceed. It is asked ONLY on the empty→first transition below,
  /// and the OS prompt is spent only on a yes. With no primer — a caller with
  /// no screen to explain from — the OS is never asked at all: an un-primed ask
  /// is the defect, and a missed ask costs one more chance at the next gesture.
  Future<void> addSubscription(
    Subscription draft, {
    Future<bool> Function()? primeReminders,
  }) async {
    // 🔴 ABSENT IS NOT EMPTY. This was `state.value ?? const []`, which
    // reads a still-loading first fetch and a failed one as "the user has no
    // subscriptions" — so an add during either state looked like an empty→first
    // transition and fired ACTIVATION again, on an install that had already
    // activated. `activation` is a once-per-install signal and the denominator
    // of the whole funnel; a false one cannot be told apart from a real one
    // after the fact, and it silently degrades the event into an add counter.
    // A miss is recoverable arithmetic, a spurious fire is corrupted data, so
    // the hook keys off an OBSERVED prior list and nothing else.
    //
    // `hasValue && !hasError`: Riverpod keeps the previous data on an AsyncError,
    // so `valueOrNull` alone would treat a stale list behind a failed refresh as
    // a current observation.
    final List<Subscription>? before = observedList;

    final Subscription created = await ref
        .read(subscriptionRepositoryProvider)
        .add(draft);
    // Riverpod 3: the provider may be gone by the time the write lands. The
    // row is saved; there is no list left here to put it in.
    if (!ref.mounted) return;
    final List<Subscription> list = <Subscription>[...?before, created];
    state = AsyncData<List<Subscription>>(list);
    await _syncReminders(list);
    if (!ref.mounted) return; // Riverpod 3: the provider may be gone by now.

    // G-12 ACTIVATION. Subly's "aha" is the FIRST subscription added — the
    // single strongest predictor of retention and of paying. Fired only on a
    // real empty→first transition, so it stays a once-per-install signal rather
    // than a per-add counter, and only after the write succeeded.
    if (before != null && before.isEmpty) {
      ref.read(analyticsFunnelProvider).value?.onActivation();

      // 🔴 [pipeline 13]T-4 — THE OTHER IN-CONTEXT ASK, and the reason the
      // settings toggle alone is not enough: `alerts` DEFAULTS ON, so a user who
      // never touches settings never passes through the toggle and would end up
      // with renewal reminders scheduled against a permission nobody ever asked
      // for — a dead channel, which is precisely what this requirement forbids.
      //
      // Asked HERE and nowhere else on this path: the first subscription is the
      // first moment the app has anything to remind anyone about, so it is the
      // first moment the ask means something to the user. Gated on the empty→
      // first transition so it happens once per install, not once per add, and
      // reachable only from the add sheet's submit button — never from `build()`
      // or the settings listener, both of which run at first frame.
      //
      // ⏱ 2026-09-28 · train ST-D8: AND IT IS PRIMED FIRST. This used to spend
      // the one OS prompt straight off the Save tap, with nothing on screen
      // saying why. `primeReminders` explains first; "Not now" spends nothing.
      if (ReminderPlan.from(
            ref.read(settingsControllerProvider).prefs,
          ).syncRenewals &&
          primeReminders != null &&
          await primeReminders()) {
        await ref.read(renewalRemindersProvider).requestPermissions();
      }
    }
  }

  /// IM-02/IM-03/IM-04 — an import's reviewed rows, each through
  /// [addSubscription]: the add route and nothing else, so an imported row is
  /// written, cached and reminded exactly as a typed one is. No primer is
  /// passed, so an import never spends the OS notification ask.
  ///
  /// Stops at the FIRST failure rather than skipping it, so "added 3 of 5" is
  /// always the first three and a retry knows where to start. Answers how many
  /// landed and the error that stopped it, or null.
  Future<({int added, Object? error})> addAll(
    Iterable<Subscription> drafts,
  ) async {
    int added = 0;
    for (final Subscription draft in drafts) {
      try {
        await addSubscription(draft);
      } catch (e) {
        return (added: added, error: e);
      }
      added++;
    }
    return (added: added, error: null);
  }

  /// The currency a NEW row is created in — the user's own choice.
  ///
  /// Read here rather than in the add sheet because this is what WRITES rows:
  /// "what currency is this amount in" is a property of the row being created,
  /// and the sheet should not have to know which provider holds a preference.
  String get newRowCurrencyCode => ref.read(currencyCodeProvider);

  /// Write a row's reminder fields (`reminder_days`, `notice_days`) — the
  /// detail screen's rows (ST-R3, ST-R8). One write path: [updateSubscription]
  /// replaces the row with the server's answer and re-arms the reminders.
  Future<void> updateReminderFields(String id, Map<String, dynamic> changes) =>
      updateSubscription(id, changes);

  /// Apply [changes] — a PATCH body of ONLY the changed keys (see
  /// `Subscription.changesFrom`) — and put the server's answer in the list.
  ///
  /// ST-E1. `SubscriptionRepository.update` existed and nothing called it, so
  /// a row could be added and hard-deleted and never corrected. An empty
  /// [changes] sends nothing: an edit that changed nothing is not a write.
  Future<Subscription?> updateSubscription(
    String id,
    Map<String, dynamic> changes,
  ) async {
    if (changes.isEmpty) {
      return observedList?.where((Subscription s) => s.id == id).firstOrNull;
    }
    final Subscription updated = await ref
        .read(subscriptionRepositoryProvider)
        .update(id, changes);
    if (!ref.mounted) return updated; // Riverpod 3: the provider may be gone.
    final List<Subscription>? before = observedList;
    if (before == null) {
      // Same rule as [cancelSubscription]: no observed list is not an empty
      // one. The server has the write; the list is re-fetched.
      ref.invalidateSelf();
      return updated;
    }
    final bool present = before.any((Subscription s) => s.id == id);
    final List<Subscription> list = _visible(<Subscription>[
      for (final Subscription s in before) s.id == id ? updated : s,
      if (!present) updated,
    ]);
    state = AsyncData<List<Subscription>>(list);
    await _syncReminders(list);
    return updated;
  }

  /// The user cancelled it at the provider: the row STAYS, with its history,
  /// and leaves every total and reminder (ST-E3). [on] defaults to today.
  Future<void> markCancelled(String id, {DateTime? on}) =>
      updateSubscription(id, <String, dynamic>{
        'status': SubscriptionStatus.cancelled.name,
        'cancelled_on': Subscription.dateOnly(on ?? DateTime.now()),
      });

  /// NO-10: "Mark as paid" — one payment of the plan's price, dated today,
  /// from a notification button or a /notifications row.
  ///
  /// The idempotency key is DERIVED (`paid_<id>_<day>`, in the server's key
  /// alphabet), not random: a notification action the OS delivers twice, or a
  /// row pressed after the notification was, is the same payment and must be
  /// recorded once. `POST /:id/payments` does not read the key yet (lane
  /// fix-payments-idempotency); a server ignores an unknown query parameter,
  /// and the key is sent regardless. Throws on a failed write so the caller
  /// can say so; the list is not touched.
  Future<void> markPaid(String id) async {
    final List<Subscription> list = state.value ?? await future;
    final Subscription sub = list.firstWhere((Subscription s) => s.id == id);
    final DateTime now = ref.read(nowProvider)();
    await ref
        .read(apiClientProvider)
        .recordPayment(
          id,
          amount: sub.price,
          paidOn: now,
          idempotencyKey: 'paid_${id}_${Subscription.dateOnly(now)}',
        );
  }

  /// NO-10: "Snooze 1 day" — a reminder about [id] again in 24 hours (quiet
  /// hours still apply), and the shown one [notificationId] dismissed. From
  /// an in-app row there is none to dismiss. No network.
  Future<void> snoozeReminder(String id, {int? notificationId}) async {
    final List<Subscription> list = state.value ?? await future;
    final Subscription? sub = list
        .where((Subscription s) => s.id == id)
        .firstOrNull;
    if (sub == null) return;
    await ref
        .read(renewalRemindersProvider)
        .snooze(
          sub,
          copy: reminderCopyFor(ref.read(localeProvider)),
          quiet: ref.read(settingsControllerProvider).quietHours,
          dismissId: notificationId,
        );
  }

  /// Stop counting it for now; the row and its history stay (ST-E3).
  Future<void> pauseSubscription(String id) => updateSubscription(
    id,
    <String, dynamic>{'status': SubscriptionStatus.paused.name},
  );

  /// Back to charging, from paused or cancelled.
  Future<void> resumeSubscription(String id) =>
      updateSubscription(id, <String, dynamic>{
        'status': SubscriptionStatus.active.name,
        'cancelled_on': null,
      });

  /// The Undo for Pause and Mark cancelled (DE-09): [was]'s status and cancel
  /// date, put back exactly — never a guess at "active".
  Future<void> restoreStatus(Subscription was) =>
      updateSubscription(was.id, <String, dynamic>{
        'status': was.status.name,
        'cancelled_on': was.cancelledOn == null
            ? null
            : Subscription.dateOnly(was.cancelledOn!),
      });

  /// Remove [id] from the tracker — a SOFT delete (ST-E3): `deleted_at` is
  /// set, the row leaves every list, total and reminder, and
  /// [undoDelete] brings it back. Returns the row as it was, for the Undo.
  ///
  /// ⏱ 2026-09-28 · ST-T3b. This was a hard `DELETE /v1/subscriptions/:id`,
  /// which removed the row and — through the table's foreign key — its
  /// payment history, with no way back from a mis-tap.
  ///
  /// ⏱ 2026-10-01 · DE-10: ONE FALLBACK, AND IT IS ALSO UNDOABLE. A server
  /// that answers 400 to `deleted_at` on a PATCH (an API older than its
  /// soft-delete readers) is sent `DELETE /v1/subscriptions/:id` instead —
  /// and that route is now a soft delete too (`UPDATE subscriptions SET
  /// deleted_at = COALESCE(deleted_at, ?)`), which `PATCH {deleted_at: null}`
  /// reverses. So BOTH paths are undoable and [canUndoDelete] says yes after
  /// either; it used to refuse the Undo the server would have honoured.
  /// Every other failure is rethrown.
  Future<Subscription?> cancelSubscription(String id) async {
    final Subscription? was = observedList
        ?.where((Subscription s) => s.id == id)
        .firstOrNull;
    try {
      await updateSubscription(id, <String, dynamic>{
        'deleted_at': DateTime.now().toUtc().toIso8601String(),
      });
      _undoable.add(id);
    } on ApiException catch (e) {
      if (e.statusCode != 400) rethrow;
      await ref.read(subscriptionRepositoryProvider).cancel(id);
      _undoable.add(id);
      if (!ref.mounted) return was; // Riverpod 3: the provider may be gone.
      final List<Subscription>? before = observedList;
      if (before == null) {
        ref.invalidateSelf();
      } else {
        final List<Subscription> list = before
            .where((Subscription s) => s.id != id)
            .toList();
        state = AsyncData<List<Subscription>>(list);
        await _syncReminders(list);
      }
    }
    if (!ref.mounted) return was;
    // The resync above ranges over the list WITHOUT the row, so its reminders
    // are already gone; this is belt and braces for a platform whose pending
    // list cannot be read back.
    await ref.read(renewalRemindersProvider).cancelForSubscription(id);
    return was;
  }

  /// The ids [cancelSubscription] removed this session — by either path, both
  /// soft deletes — and not yet brought back.
  final Set<String> _undoable = <String>{};

  /// Whether [undoDelete] can restore [id]: true after [cancelSubscription]
  /// succeeded by EITHER path (DE-10), false once the Undo has run.
  bool canUndoDelete(String id) => _undoable.contains(id);

  /// Undo [cancelSubscription]: `deleted_at: null`, and the row is back.
  Future<void> undoDelete(String id) async {
    await updateSubscription(id, <String, dynamic>{'deleted_at': null});
    if (!ref.mounted) return;
    _undoable.remove(id);
  }

  /// Re-run the reminder sync against the list already observed — for a
  /// write that changes what a reminder says without changing the list. The
  /// budget editor's save is the one caller (ST-I2): a new budget can put the
  /// same subscriptions over it. Nothing observed yet: nothing to do, and
  /// `build()` syncs the moment the list arrives.
  Future<void> resyncReminders() async {
    final List<Subscription>? observed = observedList;
    if (observed != null) await _syncReminders(observed);
  }

  /// "Mark as paid" (DE-04): record a payment the user already made against
  /// [id] — the amount prefilled from the plan, the date today unless they
  /// changed it — and refresh that row's history. No money moves; this is a
  /// record. [idempotencyKey] is minted ONCE per tap by the caller and reused
  /// by its retry, so a replay adds no second payment.
  Future<void> recordPayment(
    String id, {
    required Money amount,
    required DateTime paidOn,
    required String idempotencyKey,
  }) async {
    await ref
        .read(subscriptionRepositoryProvider)
        .recordPayment(
          id,
          amount: amount,
          paidOn: paidOn,
          idempotencyKey: idempotencyKey,
        );
    if (!ref.mounted) return; // Riverpod 3: the provider may be gone.
    ref.invalidate(paymentHistoryProvider(id));
  }

  // ── BULK (train T20, HO-08) ────────────────────────────────────────────────
  // A selection on home, or a swipe, acts on rows through the SAME one-row
  // writes above — one PATCH per row, each re-arming the reminders — so a bulk
  // pause cannot mean anything a single pause does not. What a bulk action
  // adds is ONE Undo: each method returns the rows as they were, and its twin
  // puts every one of them back.

  /// Soft-delete every row in [ids] ([cancelSubscription] each). Returns the
  /// rows as they were, in [ids]' order — the input to [undoDeleteMany].
  Future<List<Subscription>> deleteMany(Iterable<String> ids) async {
    final List<Subscription> removed = <Subscription>[];
    for (final String id in ids.toList()) {
      final Subscription? was = await cancelSubscription(id);
      if (was != null) removed.add(was);
      if (!ref.mounted) break; // Riverpod 3: the provider may be gone.
    }
    return removed;
  }

  /// Undo [deleteMany]: every row that CAN come back ([canUndoDelete]) does.
  /// A row the hard-DELETE fallback removed has nothing left to restore.
  Future<void> undoDeleteMany(Iterable<String> ids) async {
    for (final String id in ids.toList()) {
      if (!canUndoDelete(id)) continue;
      await undoDelete(id);
      if (!ref.mounted) return;
    }
  }

  /// Pause every row in [ids]. Returns the rows as they were, for
  /// [restoreStatuses].
  Future<List<Subscription>> pauseMany(Iterable<String> ids) =>
      _statusMany(ids, SubscriptionStatus.paused, pauseSubscription);

  /// Mark every row in [ids] cancelled (today). Returns the rows as they
  /// were, for [restoreStatuses].
  Future<List<Subscription>> markCancelledMany(Iterable<String> ids) =>
      _statusMany(ids, SubscriptionStatus.cancelled, markCancelled);

  /// Undo [pauseMany] / [markCancelledMany]: each row back to the status and
  /// the cancel date it had — not to "active", which would end a trial.
  Future<void> restoreStatuses(Iterable<Subscription> before) async {
    for (final Subscription was in before.toList()) {
      final DateTime? on = was.cancelledOn;
      await updateSubscription(was.id, <String, dynamic>{
        'status': was.status.name,
        'cancelled_on': on == null ? null : Subscription.dateOnly(on),
      });
      if (!ref.mounted) return;
    }
  }

  /// [write] for every row of [ids] not already [target]; the rows as they
  /// were before it.
  Future<List<Subscription>> _statusMany(
    Iterable<String> ids,
    SubscriptionStatus target,
    Future<void> Function(String id) write,
  ) async {
    final Map<String, Subscription> byId = <String, Subscription>{
      for (final Subscription s in observedList ?? const <Subscription>[])
        s.id: s,
    };
    final List<Subscription> before = <Subscription>[];
    for (final String id in ids.toList()) {
      final Subscription? was = byId[id];
      if (was == null || was.status == target) continue;
      await write(id);
      before.add(was);
      if (!ref.mounted) break;
    }
    return before;
  }

  /// Keep the OS reminder set in step with [subs] — AWAITED, and never a
  /// throw.
  ///
  /// 🔴 THIS WAS FIRE-AND-FORGET, and on Windows and Linux the plugin threw
  /// `UnimplementedError` out of `zonedSchedule` on every list load — an
  /// uncaught async error nothing rendered. The service is now gated on the
  /// capability matrix so that throw cannot happen, and this method is
  /// awaited and guarded regardless: a platform channel failing must cost
  /// the reminder sync, never the list, and it must be VISIBLE —
  /// [reminderSyncFailureProvider] carries the last failure for the settings
  /// screen and for tests.
  Future<void> _syncReminders(List<Subscription> subs) async {
    try {
      await _syncRemindersOrThrow(subs);
      // Riverpod 3: the listeners call this unawaited, so the provider may be
      // gone by the time the OS answers, and a Ref used then throws.
      if (!ref.mounted) return;
      ref.read(reminderSyncFailureProvider.notifier).state = null;
    } on Object catch (e) {
      if (!ref.mounted) return;
      ref.read(reminderSyncFailureProvider.notifier).state = e;
    }
  }

  Future<void> _syncRemindersOrThrow(List<Subscription> subs) async {
    final SettingsState settings = ref.read(settingsControllerProvider);
    final RenewalReminders notifier = ref.read(renewalRemindersProvider);
    final ReminderPlan plan = ReminderPlan.from(settings.prefs);
    // Rendered here, once, for both scheduling branches — see reminderCopyFor
    // on why it is rebuilt each sync rather than cached in a provider.
    final Locale? chosenLocale = ref.read(localeProvider);
    final ReminderCopy copy = reminderCopyFor(chosenLocale);

    // AWAITED (see [_syncReminders]); RenewalReminders is a no-op wherever
    // the capability matrix says it cannot schedule (web; Windows unidentified).
    //
    // ORDER: renewals first, digest second. This ordering USED to be
    // load-bearing — syncAll() began with cancelAll(), which took the weekly
    // digest with it — and it is kept although syncAll() now cancels only
    // the renewal namespace, so a future widening of that namespace cannot
    // silently swallow the digest again.
    // NO-04: the Linux login entry follows the plan too — "Renewal alerts"
    // defaults ON, so an install that never touched the switch is opted in.
    final LinuxAutostartControl? autostart = ref.read(linuxAutostartProvider);
    if (autostart != null && await autostart.isEnabled() != plan.syncRenewals) {
      await (plan.syncRenewals ? autostart.enable() : autostart.disable());
    }

    if (plan.syncRenewals) {
      // ONLY CHARGING ROWS (ST-E3): a paused or cancelled row keeps its place
      // on the list and loses its reminders, because `syncAll` cancels every
      // owned id first and re-arms only what it is given.
      await notifier.syncAll(
        SubMath.charging(subs),
        copy: copy,
        rules: settings.reminderRules,
      );
    } else {
      // 🔴 OWNED IDS ONLY. `cancelAll()` here wiped the chassis daily
      // reminder (id 1) every time "Renewal alerts" went off — the two
      // services share one plugin singleton. Each cancels what it owns.
      await notifier.cancelOwnedRenewals();
    }

    if (plan.weeklyDigest) {
      // 🔴 THE SAME LOCALE AS THE COPY. There is no `BuildContext` here, so
      // the locale is resolved rather than read off a widget — and it is the
      // one the digest's own sentence was just built in, not the compiled-in
      // `en_US` the old formatter used no matter what language was on screen.
      final MoneyFormatter money = MoneyFormatter(
        resolvedLocaleName(chosenLocale),
        emptyCurrencyCode: newRowCurrencyCode,
      );
      // ST-R7: the week the digest OPENS on — counted from its own Sunday,
      // not from today, because it is read then. Today comes from
      // `nowProvider`, so a test can name the week (reminder_plan_test).
      final DateTime sunday = RenewalReminders.digestDay(
        ref.read(nowProvider)(),
      );
      final int due = SubMath.charging(subs).where((Subscription s) {
        final int d = s.daysUntil(sunday);
        return d >= 0 && d <= 7;
      }).length;
      await notifier.scheduleWeeklyDigest(
        copy: copy,
        count: due,
        formattedTotal: money.formatBag(
          SubMath.dueWithin(SubMath.charging(subs), sunday, 7),
        ),
      );
    } else {
      await notifier.cancelWeeklyDigest();
    }

    await _syncOverBudget(notifier, copy, settings, chosenLocale, subs, plan);
  }

  /// ST-I2 (audit C14) — THE OVER-BUDGET ALERT, through the same seam as the
  /// renewals. Until this, a budget could be set (ST-D3) and nothing anywhere
  /// in the app ever told anyone they had passed it outside the Insights tab.
  ///
  /// Behind `alerts` ("Renewal alerts"), the app's one switch for "may we
  /// notify you about money": a user who turned that off gets no alert from
  /// here either, and the armed one is cancelled.
  ///
  /// 🔴 AN UNREAD BUDGET IS NOT "NO BUDGET". A failed read leaves whatever is
  /// armed exactly as it is — the same rule as `observedList` for the list:
  /// cancelling on a transport failure would silence a real alert because
  /// the network blinked. The read is skipped where nothing can be scheduled
  /// (web), so the build that can never post one never pays for it.
  Future<void> _syncOverBudget(
    RenewalReminders notifier,
    ReminderCopy copy,
    SettingsState settings,
    Locale? chosenLocale,
    List<Subscription> subs,
    ReminderPlan plan,
  ) async {
    if (!notifier.capabilities.canSchedule) return;
    final String currencyCode = newRowCurrencyCode;
    final MoneyFormatter money = MoneyFormatter(
      resolvedLocaleName(chosenLocale),
      emptyCurrencyCode: currencyCode,
    );
    final MoneyBag spent = SubMath.totalMonthly(subs);
    if (!plan.syncRenewals) {
      await notifier.syncOverBudget(
        budget: null,
        spent: spent,
        copy: copy,
        rules: settings.reminderRules,
        money: money,
      );
      return;
    }
    final BudgetInfo budget;
    try {
      budget = await ref.read(subscriptionRepositoryProvider).budget();
    } on Object {
      return;
    }
    if (!ref.mounted) return; // Riverpod 3: the provider may be gone by now.
    await notifier.syncOverBudget(
      // Read in the display currency exactly as the budget card reads it
      // (`BudgetInfo.inCurrency`), so the two cannot disagree about "over".
      budget: budget.inCurrency(currencyCode),
      spent: spent,
      copy: copy,
      rules: settings.reminderRules,
      money: money,
    );
  }
}

/// The most recent failure of a reminder sync, or null after a clean one.
///
/// Exists so a failed sync is a STATE the UI can show rather than an
/// uncaught async error on the console. Written only by
/// [SubscriptionsController].
final StateProvider<Object?> reminderSyncFailureProvider =
    StateProvider<Object?>((_) => null);

final AsyncNotifierProvider<SubscriptionsController, List<Subscription>>
subscriptionsControllerProvider =
    AsyncNotifierProvider<SubscriptionsController, List<Subscription>>(
      SubscriptionsController.new,
    );
