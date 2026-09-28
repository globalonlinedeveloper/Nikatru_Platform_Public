import 'package:flutter/foundation.dart'
    show PlatformDispatcher, visibleForTesting;
import 'package:flutter/widgets.dart' show Locale, basicLocaleListResolution;
import 'package:flutter_riverpod/flutter_riverpod.dart';
// StateProvider (and its StateController) moved to legacy.dart in Riverpod 3.0.
import 'package:flutter_riverpod/legacy.dart';
import 'package:intl/intl.dart' show DateFormat;

import '../core/format/money_format.dart';
import '../core/format/sub_math.dart';
import '../data/models/subscription.dart';
import '../l10n/app_localizations.dart';
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
DateFormat _monthDay(String localeName) {
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
  final DateFormat monthDay = _monthDay(l10n.localeName);
  return ReminderCopy(
    channelName: l10n.renewalChannelName,
    reminderTitle: l10n.renewalReminderTitle,
    reminderBody: (String name, DateTime renewal) =>
        l10n.renewalReminderBody(name, monthDay.format(renewal)),
    digestTitle: l10n.weeklyDigestTitle,
    // A tear-off, not a wrapper: `weeklyDigestBody` IS `(int, String) → String`,
    // and it is the plural — `count` picks the arm inside the .arb.
    digestBody: l10n.weeklyDigestBody,
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

    final List<Subscription> subs = await ref
        .watch(subscriptionRepositoryProvider)
        .fetchAll();
    await _syncReminders(subs);
    return subs;
  }

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

  Future<void> addSubscription(Subscription draft) async {
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
      if (ReminderPlan.from(
        ref.read(settingsControllerProvider).prefs,
      ).syncRenewals) {
        await ref
            .read(subscriptiontrackerNotificationServiceProvider)
            .requestPermissions();
      }
    }
  }

  /// Writes an EDIT of an existing row (train ST-D6) — the fields the edit
  /// sheet owns, and nothing else.
  ///
  /// The patch names only name, category, amount, cycle and renewal date: a
  /// PATCH is a partial update on the API (`routes/subscriptions.ts`), so a
  /// field the sheet does not show — the plan, the usage figures — is never
  /// overwritten by a stale copy the sheet happened to hold. The amount goes
  /// as major units because that is the column the API stores; its currency
  /// is the row's own and is not re-stated.
  ///
  /// The row is replaced in the OBSERVED list only. With no observed list
  /// (loading, or a failed fetch) the server has the edit and the list is
  /// re-fetched rather than invented — the rule [cancelSubscription] states.
  Future<void> updateSubscription(Subscription edited) async {
    final Subscription saved = await ref
        .read(subscriptionRepositoryProvider)
        .update(edited.id, <String, dynamic>{
          'name': edited.name,
          'category': edited.category,
          'price': edited.price.toMajorUnits(),
          'cycle': edited.cycle.name,
          'next_renewal': Subscription.dateOnly(edited.nextRenewal),
        });
    final List<Subscription>? before = observedList;
    if (before == null) {
      ref.invalidateSelf();
      return;
    }
    final List<Subscription> list = before
        .map((Subscription s) => s.id == saved.id ? saved : s)
        .toList();
    state = AsyncData<List<Subscription>>(list);
    await _syncReminders(list);
  }

  /// The currency a NEW row is created in — the user's own choice.
  ///
  /// Read here rather than in the add sheet because this is what WRITES rows:
  /// "what currency is this amount in" is a property of the row being created,
  /// and the sheet should not have to know which provider holds a preference.
  String get newRowCurrencyCode => ref.read(currencyCodeProvider);

  Future<void> cancelSubscription(String id) async {
    await ref.read(subscriptionRepositoryProvider).cancel(id);
    if (!ref.mounted) return; // Riverpod 3: the provider may be gone by now.
    // 🔴 SAME RULE AS THE LISTENERS: a cancel with no observed list is not
    // "the list is now empty". The server has the cancel; the list is
    // re-fetched rather than invented, and the resync runs from `build()`.
    final List<Subscription>? before = observedList;
    if (before == null) {
      ref.invalidateSelf();
      return;
    }
    final List<Subscription> list = before
        .where((Subscription s) => s.id != id)
        .toList();
    state = AsyncData<List<Subscription>>(list);
    await _syncReminders(list);
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
    final NotificationService notifier = ref.read(
      subscriptiontrackerNotificationServiceProvider,
    );
    final ReminderPlan plan = ReminderPlan.from(settings.prefs);
    // Rendered here, once, for both scheduling branches — see reminderCopyFor
    // on why it is rebuilt each sync rather than cached in a provider.
    final Locale? chosenLocale = ref.read(localeProvider);
    final ReminderCopy copy = reminderCopyFor(chosenLocale);

    // AWAITED (see [_syncReminders]); NotificationService is a no-op wherever
    // the capability matrix says it cannot schedule (web, Windows, Linux).
    //
    // ORDER: renewals first, digest second. This ordering USED to be
    // load-bearing — syncAll() began with cancelAll(), which took the weekly
    // digest with it — and it is kept although syncAll() now cancels only
    // the renewal namespace, so a future widening of that namespace cannot
    // silently swallow the digest again.
    if (plan.syncRenewals) {
      await notifier.syncAll(subs, copy: copy);
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
      await notifier.scheduleWeeklyDigest(
        copy: copy,
        count: subs.length,
        formattedTotal: money.formatBag(SubMath.totalMonthly(subs)),
      );
    } else {
      await notifier.cancelWeeklyDigest();
    }
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
