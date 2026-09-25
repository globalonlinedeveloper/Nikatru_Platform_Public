import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_chassis_screens/settings/settings_screen.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_notifications/nikatru_notifications.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/app_config.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';

/// Settings — the ADAPTER half. Carries the chassis-mandated support contact
/// (E1) and the in-app account-deletion entry (G2). This app is client-only, so
/// deletion terminates in the SHARED `platform` Worker keyed by `app_id` — there
/// is no per-app service to wire ([ADR 020]).
///
/// 🏗️ THE PAGE IS IN `package:nikatru_chassis_screens` ([ADR 067] decision 2),
/// and what stayed here is every call the package cannot make. It declares no
/// `flutter_riverpod`, no `go_router`, no `url_launcher` and no
/// `nikatru_notifications` — see its pubspec for the measurement behind that
/// rule — so all of these stayed, and each answers a named guard as well:
///
/// ⛔ `recordAnalyticsConsent(ref, granted: on)` AND `ref.watch(analyticsConsentProvider)`.
/// `assert-consent-withdrawal-surface.mjs` requires a CALL in
/// `lib/features/settings/` whose `granted:` is not a constant, plus a read of
/// the state so the control can render its own value. It reads this file unioned
/// with the chassis file, but the call could not move even if it were allowed
/// to: it takes a `WidgetRef`. Same for `recordPromoObjection` (GDPR Art 21).
///
/// ⛔ `NotificationCapabilities.forPlatform(` and `applyReminderChoice(`
/// (`assert-stamp-properties.mjs:1123`, `:1131`).
///
/// ⛔ `ref.watch(authUserProvider)` (`:1081`), `onSave: () => _saveProfile(`
/// (`:1077`), `.updateProfile(displayName:` (`:1078`),
/// `onConfirm: () => _deleteAccount(` (`:1043`), `await auth.deleteAccount()`
/// (`:1044`), `await auth.signInWithEmail(` (`:1045`) and
/// `core.accountDeletionOutcomeOf(` (`:1061`).
///
/// ⛔ `_openUrl(AppConfig.<name>)` for every URL `app_config.dart` declares —
/// `assert-stamp-properties.mjs:459` asks this file, and only this file, to OPEN
/// each one, because a constant nobody links leaves the page as unreachable as
/// not declaring it at all.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations appL10n = AppLocalizations.of(context);
    final ThemeMode mode = ref.watch(themeModeProvider);
    // WATCHED as a stream, not read off `currentUser`: the profile tile shows a
    // value the user can edit from this very screen, and a snapshot read would
    // go on showing the old name after a successful save. [pipeline C-13]
    final core.AuthUser? user = ref.watch(authUserProvider).valueOrNull;
    // The RUNNING version, not the compiled-in constant: `AppConfig.appVersion`
    // is a `String.fromEnvironment` default that a build which forgot
    // `--dart-define` would report as the truth. `packageVersionProvider` reads
    // what is actually installed and falls back to the constant only while the
    // plugin resolves (and on platforms where it cannot), exactly as the
    // force-update gate does with the same value.
    final String runningVersion =
        ref.watch(packageVersionProvider).valueOrNull ?? AppConfig.appVersion;
    // [pipeline C-7 earning its keep in real UI] The platform matrix is
    // consulted BEFORE a control is offered. On Linux the plugin shows but
    // cannot schedule; on Windows (pinned 17.x) it does neither. A toggle that
    // silently does nothing on those platforms is worse than an honest sentence,
    // because the user believes reminders are on.
    final NotificationCapabilities caps = NotificationCapabilities.forPlatform(
      defaultTargetPlatform,
      isWeb: kIsWeb,
    );
    final bool hasSession =
        ref.watch(authRepositoryProvider).currentUser != null;

    return SettingsView(
      profile: user == null
          ? null
          : SettingsProfile(
              initial: user.initial,
              displayName: user.displayName ?? '',
              email: user.email,
            ),
      onEditProfile: user == null
          ? null
          : () => _editProfile(context, ref, context.chassisL10n, user),
      themeMode: mode,
      onThemeModeChanged: (ThemeMode m) =>
          ref.read(themeModeProvider.notifier).set(m),
      languageCode: ref.watch(localeProvider)?.languageCode ?? '',
      onLanguageChanged: (String code) => ref
          .read(localeProvider.notifier)
          .set(code.isEmpty ? null : Locale(code)),
      remindersAvailable: caps.canSchedule,
      remindersEnabled: ref.watch(remindersEnabledProvider),
      onRemindersChanged: (bool on) =>
          _setReminders(context, ref, context.chassisL10n, on: on),
      analyticsGranted:
          ref.watch(analyticsConsentProvider) == core.ConsentStatus.granted,
      // Not awaited, for the same reason app.dart's `_answer` is not: the
      // decision applies in memory immediately and the upload is best-effort, so
      // blocking the switch on a network round trip would make a withdrawal feel
      // like a broken control.
      onAnalyticsConsentChanged: (bool on) =>
          recordAnalyticsConsent(ref, granted: on),
      promoObjected: ref.watch(promoObjectedProvider),
      promoObjectionKnown: ref.watch(promoObjectionKnownProvider),
      onPromoObjectionChanged: (bool objected) =>
          recordPromoObjection(ref, objected: objected),
      hasSession: hasSession,
      planSectionLabel: appL10n.plan,
      managePlanLabel: appL10n.managePlanTitle,
      onUpgrade: () => context.go('/paywall'),
      onManagePlan: () => context.go('/manage-plan'),
      onOpenPrivacyPolicy: () => _openUrl(AppConfig.privacyUrl),
      onOpenTerms: () => _openUrl(AppConfig.termsUrl),
      onOpenRefundPolicy: () => _openUrl(AppConfig.refundUrl),
      supportEmail: AppConfig.supportEmail,
      onContactSupport: _contactSupport,
      // O-PLAY-AI-CONTENT-REPORTING: only in an app that generates AI content.
      onReportContent: AppConfig.generatesAiContent
          ? () => showReportContentDialog(context, ref)
          : null,
      onSignOut: () => _signOut(context, ref, context.chassisL10n),
      onSignOutEverywhere: () => _signOut(
        context,
        ref,
        context.chassisL10n,
        scope: core.SignOutScope.global,
      ),
      onDeleteAccount: () => _confirmDelete(context, ref, context.chassisL10n),
      applicationName: AppConfig.appName,
      applicationVersion: runningVersion,
    );
  }

  /// PERMISSION PRIMING — explain, THEN ask the OS.
  ///
  /// 🔴 The OS prompt can be shown ONCE on most platforms. A user who declines
  /// it has effectively declined permanently, and the only route back is the
  /// system settings app. So the cost of asking at a bad moment is not a
  /// dismissed dialog — it is the feature, forever. Priming first means the one
  /// prompt is spent on someone who has already said yes in principle.
  ///
  /// 🔴 AND THEN IT MUST ACTUALLY SCHEDULE. This used to end at
  /// `requestPermission()` — the prompt was spent, the switch read ON, and no
  /// notification was ever scheduled in any app this factory stamps. The
  /// scheduling lives in [RemindersEnabledController.applyReminderChoice] so it
  /// is reachable from a property test without a widget, and so the intent and
  /// the OS state can never be written apart.
  Future<void> _setReminders(
    BuildContext context,
    WidgetRef ref,
    ChassisLocalizations l10n, {
    required bool on,
  }) async {
    if (!on) {
      await ref
          .read(remindersEnabledProvider.notifier)
          .applyReminderChoice(
            on: false,
            title: l10n.reminderTitle,
            body: l10n.reminderBody,
          );
      return;
    }
    final bool proceed =
        await showDialog<bool>(
          context: context,
          builder: (BuildContext c) => AlertDialog(
            title: Text(l10n.permissionPrimingTitle),
            content: Text(l10n.permissionPrimingBody),
            actions: <Widget>[
              TextButton(
                onPressed: () => Navigator.pop(c, false),
                child: Text(l10n.notNow),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(c, true),
                child: Text(l10n.continueLabel),
              ),
            ],
          ),
        ) ??
        false;
    // Declining the PRIMING must not spend the OS prompt — that is the whole
    // point of asking twice.
    if (!proceed) return;
    await ref
        .read(remindersEnabledProvider.notifier)
        .applyReminderChoice(
          on: true,
          title: l10n.reminderTitle,
          body: l10n.reminderBody,
        );
  }

  Future<void> _openUrl(String url) async {
    try {
      await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    } catch (_) {
      // Best-effort — never crash settings.
    }
  }

  /// 🔴 AWAITED, AND ITS FAILURE IS SAID OUT LOUD. This was
  /// `onTap: () => ref.read(authRepositoryProvider).signOut()` — not awaited and
  /// not caught — while `SecureSessionStorage.removePersistedSession` throws ON
  /// PURPOSE when it can neither delete the persisted session nor tombstone it
  /// (a Linux box with no unlocked libsecret collection is the ordinary case).
  /// The one caller of that deliberate answer threw it away, so the app said
  /// nothing and the next launch came back signed in.
  ///
  /// The message is a SnackBar rather than an inline notice because the app-level
  /// `ScaffoldMessenger` outlives this route: on a successful sign-out the router
  /// replaces the page immediately, and on a failed one it does not, so the same
  /// call has to survive both. The messenger is captured BEFORE the await for the
  /// same reason.
  ///
  /// [scope] is global for "Sign out of all devices" only. Its failure gets its
  /// own sentence, and it names no cause: the step that failed may be the
  /// server revoke, this device's stored session or the per-user forget, and
  /// "this device" is not the whole of what did not finish.
  Future<void> _signOut(
    BuildContext context,
    WidgetRef ref,
    ChassisLocalizations l10n, {
    core.SignOutScope scope = core.SignOutScope.local,
  }) async {
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    try {
      await signOutAndForgetUser(ref, scope: scope);
    } catch (_) {
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            scope == core.SignOutScope.global
                ? l10n.signOutEverywhereFailed
                : l10n.signOutFailed,
          ),
        ),
      );
    }
  }

  Future<void> _contactSupport() async {
    final Uri uri = Uri.parse(
      'mailto:${AppConfig.supportEmail}'
      '?subject=${Uri.encodeComponent('${AppConfig.appName} support')}',
    );
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      // No mail client / launch failed — best-effort; never crash settings.
    }
  }

  /// [pipeline C-13] EDIT DISPLAY NAME.
  ///
  /// This screen was refused on the grounds that "there is no profile data
  /// model". There is: every identity provider worth using stores user
  /// metadata, and Supabase's gotrue exposes `updateUser` for exactly this. The
  /// original reason described a field nothing wrote and concluded from that
  /// that it could never be written.
  ///
  /// The dialog itself is [EditProfileDialog] in the chassis package — a confirm
  /// action only reachable through a tap on a tile is one nobody writes a test
  /// for, which is how a dead button survives, and in the package it is pumped
  /// directly. The CONTROLLER is still created here: `assert-stamp-properties`
  /// pins the save wiring as the literal zero-argument closure
  /// `onSave: () => _saveProfile(`, whose only way to see the typed name is a
  /// controller the caller holds.
  void _editProfile(
    BuildContext context,
    WidgetRef ref,
    ChassisLocalizations l10n,
    core.AuthUser user,
  ) {
    final TextEditingController name = TextEditingController(
      text: user.displayName ?? '',
    );
    showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => EditProfileDialog(
        name: name,
        onSave: () => _saveProfile(dialogContext, ref, l10n, name.text),
      ),
    );
  }

  Future<void> _saveProfile(
    BuildContext dialogContext,
    WidgetRef ref,
    ChassisLocalizations l10n,
    String displayName,
  ) async {
    final NavigatorState nav = Navigator.of(dialogContext);
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(
      dialogContext,
    );
    try {
      await ref
          .read(authRepositoryProvider)
          .updateProfile(displayName: displayName.trim());
      nav.pop();
    } catch (_) {
      // Says plainly that nothing changed. "Saved" on a failed write is the
      // kind of lie the user only discovers on their next launch.
      nav.pop();
      messenger.showSnackBar(SnackBar(content: Text(l10n.profileUpdateFailed)));
    }
  }

  /// 🔴 [pipeline C-13] THIS BUTTON USED TO DO NOTHING. Its confirm action was
  /// `Navigator.pop(dialogContext)` and no more — no API call, no reauth. Both
  /// stores require a working in-app deletion path where accounts exist, so that
  /// was a store-compliance defect rather than a missing nicety. It was also
  /// unbuildable until [pipeline C-15] gave the chassis an AuthRepository with a
  /// real `deleteAccount()`.
  ///
  /// REAUTH FIRST, deliberately. Deletion is irreversible, so a borrowed or
  /// unattended device must not be enough to destroy an account — the password
  /// is proof that the person at the keyboard is the account holder. The reauth
  /// runs through the same seam as sign-in, so it works against whatever
  /// identity provider is wired.
  void _confirmDelete(
    BuildContext context,
    WidgetRef ref,
    ChassisLocalizations l10n,
  ) {
    // 🔴 OWNED HERE, NOT BY THE DIALOG, and disposed by [_DeleteAccountDialog]
    // as the last reader. `tooling/ci/assert-stamp-properties.mjs:1043` pins the
    // confirm wiring as the literal zero-argument closure
    // `onConfirm: () => _deleteAccount(`, so the typed password has to be
    // readable from OUT HERE for that closure to have anything to pass — a
    // controller created inside the dialog could not be.
    final TextEditingController password = TextEditingController();
    // ⏱ 2026-09-15 · O-OAUTH-DELETE-REAUTH — read once, before the dialog: which
    // kind of proof this account can give.
    final core.AuthUser? current = ref.read(authRepositoryProvider).currentUser;
    final bool passwordless = current != null && !current.hasPasswordIdentity;
    showDialog<void>(
      context: context,
      // 🔴 WAS THE DEFAULT, WHICH IS `true`. A tap on the barrier closed the
      // most destructive dialog in the app — and, once the request was in
      // flight, closed it while the deletion carried on, which to the person
      // doing it is indistinguishable from having cancelled it. The dialog also
      // carries a `PopScope` for the routes a barrier flag cannot reach (a back
      // gesture, an Escape key); neither covers the other.
      barrierDismissible: false,
      // 🔴 NO `dialogContext` IS CAPTURED ANY MORE, and that is the point rather
      // than tidiness: this closure used to hand the dialog's context to
      // `_deleteAccount` so it could `Navigator.pop` and post a `SnackBar` on
      // the way out — on a route the sign-out was already removing.
      builder: (BuildContext _) => _DeleteAccountDialog(
        l10n: l10n,
        passwordless: passwordless,
        password: password,
        onConfirm: () => _deleteAccount(ref, password.text),
      ),
    );
  }

  /// Runs the real path and returns WHAT ACTUALLY HAPPENED.
  ///
  /// 🔴 IT RETURNS AN OUTCOME RATHER THAN POPPING AND POSTING A MESSAGE, AND
  /// THAT IS THE WHOLE CHANGE. Until 2026-09-04 this method ended in
  /// `nav.pop()` + `messenger.showSnackBar(...)`, and three separate falsehoods
  /// came out of that shape:
  ///
  ///   1. A REFUSED RE-AUTHENTICATION READ AS A HALF-FINISHED DELETION. The
  ///      single `catch (e)` fed every throw — including the one
  ///      `signInWithEmail` raises for a wrong password, BEFORE any request is
  ///      formed — to `accountDeletionOutcomeOf`, which resolves anything that
  ///      is not an [core.AccountDeletionFailure] to `unknown`. `unknown`'s
  ///      sentence is "we cannot tell how much of it was removed". A mistyped
  ///      password produced it, and nothing had been sent at all.
  ///      `core.AccountDeletionOutcome.reauthFailed` already existed and said
  ///      exactly the true thing; NO CODE PATH REACHED IT. It does now — the
  ///      `on core.AuthFailure` arm below is the whole of the fix, and it must
  ///      stay ABOVE the general `catch`.
  ///   2. SUCCESS SAID NOTHING AT ALL. The success branch was a bare `nav.pop()`,
  ///      so the most irreversible action in the app confirmed itself by closing
  ///      a dialog.
  ///   3. THE MESSAGE WAS POSTED TO A MESSENGER BEING TORN DOWN. `deleteAccount`
  ///      signs out whichever way the request went, the router replaces the page
  ///      stack, and a `SnackBar` on the outgoing page's `ScaffoldMessenger`
  ///      goes with it. See [lastAccountDeletionOutcomeProvider] for the
  ///      measurement.
  ///
  /// So the outcome is PARKED above the screen for the surface the redirect
  /// lands on, and RETURNED to the dialog for the outcomes where nothing
  /// navigates. The two halves cover disjoint cases and neither replaces the
  /// other. [ADR 027]
  ///
  /// ⚠️ IT DOES NOT THROW. An error escaping here would leave the dialog stuck
  /// busy, which `PopScope` then refuses to close — a screen the user cannot
  /// leave, over an account they cannot see the state of.
  Future<core.AccountDeletionOutcome> _deleteAccount(
    WidgetRef ref,
    String password,
  ) async {
    final core.AuthRepository auth = ref.read(authRepositoryProvider);
    final core.AuthUser? user = auth.currentUser;
    // 🔴 ALL THREE RESOLVED HERE, BEFORE THE FIRST AWAIT, for the reason
    // [userStateDrops] records: `deleteAccount()` signs out, the router tears
    // this shell down, and a `ref.read` on the far side of that await throws
    // `StateError`. The drops read sits INSIDE the try, where that throw dies in
    // the empty `catch` below and the forget silently does nothing on the one
    // path where the account it belongs to no longer exists. The two sinks are
    // read BEFORE it for a sharper reason: a `StateError` from THEM would escape
    // past `return outcome`, and the dialog — which does not catch — would stay
    // busy for ever while the sign-in surface was handed no outcome at all.
    // `apps/subscriptiontracker/lib/features/settings/settings_screen.dart:1214-1223` records
    // that exact shape as a live E2E flake.
    final StateController<core.AccountDeletionOutcome?> outcomeSink = ref.read(
      lastAccountDeletionOutcomeProvider.notifier,
    );
    final StateController<String?> detailSink = ref.read(
      lastAccountDeletionDetailProvider.notifier,
    );
    final List<UserStateDrop> drops = userStateDrops(ref);
    core.AccountDeletionOutcome outcome;
    String? detail;
    try {
      if (user == null) throw core.AuthFailure('Not signed in');
      // Re-authenticate through the SAME seam sign-in uses, so it works against
      // whatever identity provider is wired.
      // ⏱ 2026-09-15 · O-OAUTH-DELETE-REAUTH (owner ruling on OWNER_QUEUE A-10). A
      // PASSWORD-LESS account (Sign in with Apple) has nothing to type here, so
      // it confirms by signing in with its provider AGAIN — unless it has just
      // done so (on web Apple's redirect reloads the app, and the user taps
      // Delete a second time). `DELETE /v1/account` re-checks the token's own
      // authentication time and refuses a stale one with `reauth_required`.
      if (user.hasPasswordIdentity) {
        await auth.signInWithEmail(email: user.email, password: password);
      } else {
        await core.confirmIdentityWithProvider(auth: auth, user: user);
      }
      try {
        await auth.deleteAccount();
        outcome = core.AccountDeletionOutcome.deleted;
      } catch (e) {
        // Deliberately NOT one message for every failure. `deleteAccount` signs
        // out regardless and then throws, so the user may be signed out WITHOUT
        // being deleted — and 501 (nothing was touched) and 502 (the rows are
        // gone and the login still works) mean opposite things to the person who
        // asked. `accountDeletionOutcomeOf` resolves an unrecognised error to
        // `unknown` rather than to a refusal shape this screen invented, because
        // an error nobody modelled is exactly the case where how far the
        // deletion got is unknown. [ADR 027]
        outcome = core.accountDeletionOutcomeOf(e);
        // ⏱ 2026-09-15 · O-OAUTH-DELETE-REAUTH. The server's `reauth_required`:
        // nothing was touched and the seam did NOT sign out, so there is nothing
        // to forget and nothing to park for the sign-in screen.
        if (outcome == core.AccountDeletionOutcome.reauthFailed) return outcome;
        // 🔴 KEEP THE ERROR ITSELF. `unknown` is a bucket, and a bucket with no
        // label costs a session every time something lands in it. Parked, never
        // rendered in release: see [lastAccountDeletionDetailProvider].
        detail = '$e';
      }
      // BOTH BRANCHES ABOVE, because `deleteAccount` signs out whether or not
      // the server deleted anything — so the session is gone either way and the
      // state scoped to it must go too. It matters MORE on the failing branch:
      // those reminders belong to an account whose rows may already be
      // destroyed. Below the reauth on purpose — a wrong password deletes
      // nothing and leaves the user signed in, so there is nothing to forget.
      try {
        await forgetSignedInUser(drops);
      } catch (_) {
        // 🔴 A FAILED LOCAL CLEAR MUST NOT BECOME THE DELETION'S VERDICT. Let
        // out, it would reach the outer `catch` below and return `couldNotReach`
        // over a `deleted` — or over `signInSurvives`, the one outcome a user
        // can never discover for themselves. What the server did to the account
        // outranks what this device managed to tidy up.
      }
    } on core.AuthFailure {
      // 🔴 THE DEAD TABLE ENTRY, NOW REACHABLE. The provider REFUSED the
      // credentials, so nothing was sent and nothing was deleted — and, unlike
      // every server-side refusal, the session is untouched. That is why this is
      // not `nothingDeleted`, whose sentence says the user has been signed out.
      //
      // NOT PARKED IN THE SINKS EITHER, and that is deliberate: no sign-out
      // happened, so no redirect is coming and the dialog itself is still on
      // screen to say it. Parking it would leave a stale notice waiting to
      // ambush the next unrelated sign-out.
      return core.AccountDeletionOutcome.reauthFailed;
    } catch (_) {
      // 🔴 NOT reauthFailed. Anything that is not the provider saying no — no
      // network, a rate-limit, a plugin error — is NOT a wrong password, and
      // telling somebody on a train that their password did not match sends them
      // round a loop retyping a correct one.
      return core.AccountDeletionOutcome.couldNotReach;
    }
    // 🔴 PARK IT ABOVE THE SCREEN. The deletion signed the user out, so the
    // router is already replacing this page — taking the dialog with it. The
    // surface the redirect lands on renders whatever is left here.
    outcomeSink.state = outcome;
    detailSink.state = detail;
    return outcome;
  }
}

/// The sentence for each way a deletion can fail.
///
/// TOP-LEVEL AND PUBLIC so `test/chassis_properties_test.dart` can assert on it
/// directly: a mapping only reachable through a dialog is one nobody tests, and
/// the whole defect this replaces was invisible for exactly that reason. It
/// stays in the BRICK for the same reason — `chassis_properties_test.dart:2100`
/// calls it by name, and that suite is the stamped app's own.
///
/// 🔴 THE DIALOG NO LONGER RENDERS THIS, AND SAYING SO HERE IS THE POINT — the
/// next person to read this file would otherwise "tidy" one of the two away.
/// `_DeleteAccountDialogState._report` renders
/// `core.AccountDeletionOutcome.plainMessage` instead, because THIS TABLE CANNOT
/// SAY TWO OF THE THINGS THAT HAVE TO BE SAID: there is no `.arb` key for a
/// SUCCESS (the `deleted` arm below returns "Could not delete your account",
/// which is a lie if it is ever reached), and `reauthFailed` shares
/// `deleteAccountFailed` with `nothingDeleted` — a sentence that omits the two
/// facts that matter after a refused password, that nothing was sent and that
/// the user is still signed in.
///
/// It stays because it is the localised half and the tested half. Collapsing the
/// two is one `.arb` change and no code change: add `deleteAccountDeleted` and
/// `deleteAccountReauthFailed` with values byte-identical to `plainMessage`,
/// give them their own arms below, and `_report` calls this instead. Until then
/// the result sentence is honest and English, which is the right way round —
/// `apps/subscriptiontracker` made the same trade on the same surface, and records it at
/// `apps/subscriptiontracker/lib/features/settings/settings_screen.dart:1465-1475`.
///
/// ⚠️ NO TURNAROUND TIME, RETENTION PERIOD OR LEGAL STATEMENT appears in any of
/// these strings, because `sites/nikatru/delete-account.html` publishes none —
/// an app promising one would be committing the business to it.
String deleteAccountFailureMessage(
  ChassisLocalizations l10n,
  core.AccountDeletionOutcome outcome,
) {
  switch (outcome) {
    // Cannot happen on this path — `_deleteAccount` only calls this from its
    // catch — but stated rather than defaulted, so adding an outcome to the
    // chassis is a compile error here instead of a silently wrong sentence.
    case core.AccountDeletionOutcome.deleted:
      return l10n.deleteAccountFailed;
    // 501 — the route refused BEFORE touching anything, because it cannot
    // remove the identity record (`SUPABASE_SERVICE_ROLE_KEY` is an owner
    // action). Nothing was deleted, and that is safe to say.
    // ⏱ 2026-09-15 · 202 erasure_pending ([ADR 081]): accepted and still
    // finishing. Not a failure and not "deleted" — its own sentence.
    case core.AccountDeletionOutcome.pending:
      return l10n.deleteAccountPending;
    case core.AccountDeletionOutcome.notConfigured:
      return l10n.deleteAccountNotConfigured;
    // 502 — the rows went and the identity did not. THE OPPOSITE of "nothing
    // happened", and the state a user cannot discover for themselves.
    case core.AccountDeletionOutcome.signInSurvives:
      return l10n.deleteAccountSignInSurvives;
    case core.AccountDeletionOutcome.nothingDeleted:
    case core.AccountDeletionOutcome.reauthFailed:
      return l10n.deleteAccountFailed;
    // No status, or one this contract does not model: how far the deletion got
    // is genuinely unknown, and claiming either way would be a guess.
    case core.AccountDeletionOutcome.couldNotReach:
    case core.AccountDeletionOutcome.unknown:
      return l10n.deleteAccountUnknown;
  }
}

/// Split out so the confirm action can be driven directly in a test — a dialog
/// only reachable through a tap on a tile is one nobody writes a test for, which
/// is how the dead button survived in the first place.
///
/// 🔴 IT IS A `StatefulWidget` FOR ONE REASON: SOMETHING HAS TO DISPOSE THE
/// CONTROLLER. As a `StatelessWidget` it could not, and nothing else did — the
/// `TextEditingController` built in `_confirmDelete` was leaked on every open of
/// the dialog, in every app the factory stamps. It cannot be created inside the
/// dialog instead: `assert-stamp-properties.mjs:1043` pins the confirm wiring as
/// the literal zero-argument closure `onConfirm: () => _deleteAccount(`, whose
/// only way to see the typed password is a controller the CALLER holds. So the
/// caller creates it, this widget is the last reader, and this widget disposes
/// it.
///
/// 🏗️ THE FORM, THE BUSY LOCK, THE `PopScope` AND THE RESULT PHASE ALL LIVE IN
/// [DestructiveConfirmDialog] ([ADR 065], chassis step 2). None of it is
/// app-specific — it is "an irreversible action, behind a secret, that says what
/// it did". This wrapper stays in the BRICK, unlike [EditProfileDialog], because
/// `onConfirm` reaches `_deleteAccount(ref, …)` and `ref` is Riverpod.
class _DeleteAccountDialog extends StatefulWidget {
  const _DeleteAccountDialog({
    required this.l10n,
    required this.passwordless,
    required this.password,
    required this.onConfirm,
  });

  final ChassisLocalizations l10n;

  /// ⏱ 2026-09-15 · O-OAUTH-DELETE-REAUTH. No password field for a password-less
  /// account: the provider's own sheet is the confirmation.
  final bool passwordless;

  /// Owned by the caller so [onConfirm] can be the zero-argument closure the
  /// stamp-properties anchor names; disposed here, the last reader.
  final TextEditingController password;

  /// Runs the real deletion and reports what happened.
  final Future<core.AccountDeletionOutcome> Function() onConfirm;

  @override
  State<_DeleteAccountDialog> createState() => _DeleteAccountDialogState();
}

class _DeleteAccountDialogState extends State<_DeleteAccountDialog> {
  @override
  void dispose() {
    widget.password.dispose();
    super.dispose();
  }

  /// The outcome, in words the person who asked can act on.
  ///
  /// 🔴 THE SENTENCE COMES FROM `packages/core`, NOT FROM THE `.arb`, and the
  /// reason is that the `.arb` cannot say two of the things that have to be
  /// said. It has no key for a SUCCESS at all — [deleteAccountFailureMessage]
  /// maps `deleted` to "Could not delete your account", which is only ever
  /// reached when the mapping is asked something it was not built for — and its
  /// `reauthFailed` arm shares `deleteAccountFailed` with `nothingDeleted`,
  /// whose sentence does not say the two facts that matter after a refused
  /// password: nothing was sent, and you are still signed in.
  /// `core.AccountDeletionOutcome.plainMessage` says both, for every value, and
  /// no app can invent a kinder one. `apps/subscriptiontracker` renders the same source on the
  /// same surface for the same reason.
  ///
  /// ⚠️ THE COST IS STATED RATHER THAN HIDDEN: `plainMessage` is English only,
  /// so this dialog's result sentence is not translated today while the form
  /// above it is. Closing that is one `.arb` change and no code change — add
  /// `deleteAccountDeleted` and `deleteAccountReauthFailed` with values
  /// byte-identical to `plainMessage`, extend [deleteAccountFailureMessage] to
  /// cover them, and call it from here instead.
  DestructiveActionReport _report(core.AccountDeletionOutcome outcome) =>
      DestructiveActionReport(
        message: outcome.plainMessage,
        succeeded: outcome.accountIsGone,
        // No heading and no support route: both would need `.arb` keys that do
        // not exist, and an English literal here would ship untranslated in
        // every stamped app. Null renders neither rather than inventing one.
      );

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = widget.l10n;
    return DestructiveConfirmDialog(
      title: l10n.deleteAccountConfirmTitle,
      body: widget.passwordless
          ? l10n.deleteAccountConfirmBodyApple
          : l10n.deleteAccountConfirmBody,
      secretHint: widget.passwordless
          ? l10n.deleteAccountReauthHintApple
          : l10n.deleteAccountReauthHint,
      secretRequired: !widget.passwordless,
      secretLabel: l10n.deleteAccountPassword,
      secret: widget.password,
      cancelLabel: l10n.cancel,
      confirmLabel: l10n.delete,
      // ⚠️ BORROWED KEY, NAMED SO IT IS NOT MISTAKEN FOR A CHOICE. "Got it" is
      // the right word for acknowledging a result, but the key belongs to the
      // catch-up notification and its `@description` says so. There is no
      // `close` key in this brick's catalogue; adding one is the fix.
      acknowledgeLabel: l10n.catchUpDismiss,
      onConfirm: () async => _report(await widget.onConfirm()),
    );
  }
}

/// Opens the in-app AI content report — O-PLAY-AI-CONTENT-REPORTING.
///
/// Settings calls it with nothing attached; a screen that shows a generated
/// item should call it with that item's [contentRef] (and may pass the text as
/// [excerpt]), so the person can flag the thing in front of them without
/// leaving it. The dialog is [ReportContentDialog] in the chassis package; the
/// send stays here, because it needs the provider and the session.
Future<void> showReportContentDialog(
  BuildContext context,
  WidgetRef ref, {
  String? contentRef,
  String? excerpt,
}) {
  return showDialog<void>(
    context: context,
    // Dismissal mid-send is refused by the dialog itself; the barrier is kept
    // off so a stray tap cannot read as a cancelled report either.
    barrierDismissible: false,
    builder: (BuildContext _) => ReportContentDialog(
      contentRef: contentRef,
      initialExcerpt: excerpt,
      onSubmit: (core.ContentReport report) async => ref
          .read(contentReportTransportProvider)
          .submit(
            appId: AppConfig.appId,
            accessToken: await ref
                .read(authRepositoryProvider)
                .currentAccessToken(),
            report: report,
          ),
    ),
  );
}
