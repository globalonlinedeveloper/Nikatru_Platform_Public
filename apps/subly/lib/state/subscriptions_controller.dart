import 'package:flutter/foundation.dart' show PlatformDispatcher;
import 'package:flutter/widgets.dart' show Locale, basicLocaleListResolution;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart' show DateFormat;

import '../core/format/currency.dart';
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
  final Locale resolved = basicLocaleListResolution(
    chosen != null ? <Locale>[chosen] : PlatformDispatcher.instance.locales,
    AppLocalizations.supportedLocales,
  );
  final AppLocalizations l10n = lookupAppLocalizations(resolved);
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
    ref.listen<SettingsState>(settingsControllerProvider, (_, __) {
      _syncReminders(state.valueOrNull ?? const <Subscription>[]);
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
      _syncReminders(state.valueOrNull ?? const <Subscription>[]);
    });

    final List<Subscription> subs = await ref
        .watch(subscriptionRepositoryProvider)
        .fetchAll();
    _syncReminders(subs);
    return subs;
  }

  Future<void> addSubscription(Subscription draft) async {
    // 🔴 ABSENT IS NOT EMPTY. This was `state.valueOrNull ?? const []`, which
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
    final AsyncValue<List<Subscription>> prior = state;
    final List<Subscription>? before = prior.hasValue && !prior.hasError
        ? prior.requireValue
        : null;

    final Subscription created = await ref
        .read(subscriptionRepositoryProvider)
        .add(draft);
    final List<Subscription> list = <Subscription>[...?before, created];
    state = AsyncData<List<Subscription>>(list);
    _syncReminders(list);

    // G-12 ACTIVATION. Subly's "aha" is the FIRST subscription added — the
    // single strongest predictor of retention and of paying. Fired only on a
    // real empty→first transition, so it stays a once-per-install signal rather
    // than a per-add counter, and only after the write succeeded.
    if (before != null && before.isEmpty) {
      ref.read(analyticsFunnelProvider).valueOrNull?.onActivation();

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
        await ref.read(sublyNotificationServiceProvider).requestPermissions();
      }
    }
  }

  Future<void> cancelSubscription(String id) async {
    await ref.read(subscriptionRepositoryProvider).cancel(id);
    final List<Subscription> list =
        (state.valueOrNull ?? const <Subscription>[])
            .where((Subscription s) => s.id != id)
            .toList();
    state = AsyncData<List<Subscription>>(list);
    _syncReminders(list);
  }

  void _syncReminders(List<Subscription> subs) {
    final SettingsState settings = ref.read(settingsControllerProvider);
    final NotificationService notifier = ref.read(
      sublyNotificationServiceProvider,
    );
    final ReminderPlan plan = ReminderPlan.from(settings.prefs);
    // Rendered here, once, for both scheduling branches — see reminderCopyFor
    // on why it is rebuilt each sync rather than cached in a provider.
    final ReminderCopy copy = reminderCopyFor(ref.read(localeProvider));

    // Fire-and-forget; NotificationService is a no-op on web.
    //
    // ORDER MATTERS: syncAll() begins with cancelAll(), which would take the
    // weekly digest with it. The digest is therefore (re)scheduled AFTER, never
    // before. Getting this backwards would leave the toggle on while the
    // notification silently never fired -- the exact shape of bug this wiring
    // exists to remove.
    if (plan.syncRenewals) {
      notifier.syncAll(subs, copy: copy);
    } else {
      notifier.cancelAll();
    }

    if (plan.weeklyDigest) {
      final Currency currency = ref.read(currencyProvider);
      notifier.scheduleWeeklyDigest(
        copy: copy,
        count: subs.length,
        formattedTotal: currency.fmt(SubMath.totalMonthly(subs)),
      );
    } else {
      notifier.cancelWeeklyDigest();
    }
  }
}

final AsyncNotifierProvider<SubscriptionsController, List<Subscription>>
subscriptionsControllerProvider =
    AsyncNotifierProvider<SubscriptionsController, List<Subscription>>(
      SubscriptionsController.new,
    );
