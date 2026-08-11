import 'package:flutter/material.dart';
import 'package:nikatru_notifications/nikatru_notifications.dart';
import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/app_config.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';

/// Settings — carries the chassis-mandated support contact (E1) and the
/// in-app account-deletion entry (G2).
/// This app is client-only, so deletion terminates in the SHARED `platform`
/// Worker keyed by `app_id` — there is no per-app service to wire ([ADR 020]).

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeMode mode = ref.watch(themeModeProvider);
    // WATCHED as a stream, not read off `currentUser`: the tile below shows a
    // value the user can edit from this very screen, and a snapshot read would
    // go on showing the old name after a successful save. [pipeline C-13]
    final core.AuthUser? user = ref.watch(authUserProvider).valueOrNull;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsTitle)),
      // 🔴 THIS WAS A BARE `Scaffold` + `ListView`, i.e. NO WIDTH DECISION AT
      // ALL. A `ListTile` fills whatever it is given, so on a maximised desktop
      // window every row here stretched the full width of the display: the
      // leading icon at the far left, its label a hand's width away, the
      // trailing chevron off at the other edge. Nothing was clipped and nothing
      // overflowed, so no test and no reviewer had anything to point at — the
      // defect is that the eye has to travel, and only a measurement catches it.
      //
      // The DEFAULT cap (`AppBreakpoints.kMaxBodyWidth`), not `.reading`: this
      // is a page of controls rather than prose, and 1280 is the same ceiling
      // `AppScaffold` already applies to its extra-large class — so a settings
      // screen inside the chassis shell and one pumped on its own now agree,
      // instead of agreeing only up to 1600.
      body: ContentPane(
        child: ListView(
          children: <Widget>[
            // ── PROFILE ──────────────────────────────────────────────────────
            // Only when there is an account. Offering "edit your name" to a
            // signed-out user is an offer the app cannot honour — the same reason
            // the deletion entry is gated further down.
            if (user != null) ...<Widget>[
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                child: Text(
                  l10n.profile,
                  style: Theme.of(context).textTheme.labelLarge,
                ),
              ),
              ListTile(
                leading: CircleAvatar(child: Text(user.initial)),
                title: Text(
                  (user.displayName == null || user.displayName!.isEmpty)
                      ? l10n.displayNameNotSet
                      : user.displayName!,
                ),
                subtitle: Text(user.email),
                trailing: const Icon(Icons.edit_outlined),
                onTap: () => _editProfile(context, ref, l10n, user),
              ),
              const Divider(),
            ],
            // [pipeline C-16] The on-switch for the persisted themeMode. A stored
            // preference with no control is a dead setting — the same shape as the
            // consent recorder that had no prompt and silently discarded every
            // event. Shipped together, or not at all.
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
              child: Text(
                l10n.appearance,
                style: Theme.of(context).textTheme.labelLarge,
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: SegmentedButton<ThemeMode>(
                segments: <ButtonSegment<ThemeMode>>[
                  ButtonSegment<ThemeMode>(
                    value: ThemeMode.system,
                    label: Text(l10n.themeSystem),
                  ),
                  ButtonSegment<ThemeMode>(
                    value: ThemeMode.light,
                    label: Text(l10n.themeLight),
                  ),
                  ButtonSegment<ThemeMode>(
                    value: ThemeMode.dark,
                    label: Text(l10n.themeDark),
                  ),
                ],
                selected: <ThemeMode>{mode},
                onSelectionChanged: (Set<ThemeMode> s) =>
                    ref.read(themeModeProvider.notifier).set(s.first),
              ),
            ),
            const Divider(),

            // ── LANGUAGE ─────────────────────────────────────────────────────
            // Language names are shown in their OWN language, so a speaker can
            // find theirs without first being able to read the current one.
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              child: Text(
                l10n.language,
                style: Theme.of(context).textTheme.labelLarge,
              ),
            ),
            RadioGroup<String>(
              groupValue: ref.watch(localeProvider)?.languageCode ?? '',
              onChanged: (String? code) => ref
                  .read(localeProvider.notifier)
                  .set((code == null || code.isEmpty) ? null : Locale(code)),
              child: Column(
                children: <Widget>[
                  RadioListTile<String>(
                    value: '',
                    title: Text(l10n.languageSystem),
                  ),
                  RadioListTile<String>(
                    value: 'en',
                    title: Text(l10n.languageEnglish),
                  ),
                  RadioListTile<String>(
                    value: 'ta',
                    title: Text(l10n.languageTamil),
                  ),
                ],
              ),
            ),
            const Divider(),

            // ── NOTIFICATIONS ────────────────────────────────────────────────
            // [pipeline C-7 earning its keep in real UI] The platform matrix is
            // consulted BEFORE a control is offered. On Linux the plugin shows but
            // cannot schedule; on Windows (pinned 17.x) it does neither. A toggle
            // that silently does nothing on those platforms is worse than an
            // honest sentence, because the user believes reminders are on.
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              child: Text(
                l10n.notifications,
                style: Theme.of(context).textTheme.labelLarge,
              ),
            ),
            Builder(
              builder: (BuildContext context) {
                final NotificationCapabilities caps =
                    NotificationCapabilities.forPlatform(
                      defaultTargetPlatform,
                      isWeb: kIsWeb,
                    );
                if (!caps.canSchedule) {
                  return ListTile(
                    leading: const Icon(Icons.notifications_off_outlined),
                    title: Text(l10n.remindersUnavailable),
                    enabled: false,
                  );
                }
                return SwitchListTile(
                  secondary: const Icon(Icons.notifications_outlined),
                  title: Text(l10n.remindersEnabled),
                  value: ref.watch(remindersEnabledProvider),
                  onChanged: (bool on) =>
                      _setReminders(context, ref, l10n, on: on),
                );
              },
            ),
            const Divider(),

            // ── PRIVACY ──────────────────────────────────────────────────────
            // 🔴 THE DPDP §6(3) WITHDRAWAL PATH, AND THE CHASSIS SHIPPED WITHOUT
            // IT. Until [ADR 037 P2.7] the only caller of `recordAnalyticsConsent`
            // in a stamped app was the FIRST-RUN PROMPT in app.dart — shown once,
            // never again — so consent was a one-way door in every app the factory
            // stamps. assert-seams-wired.mjs stayed green throughout: it asks
            // whether the seam is DEAD, not whether it is REVERSIBLE, and the
            // prompt answers that question. Withdrawal must be as easy as
            // granting, and privacy.html promises it happens here.
            //
            // The value is WATCHED, not read: this row is the one place the state
            // changes, and a snapshot read leaves the switch showing the old
            // answer after the user has just flipped it — the same defect the
            // profile tile's comment above records.
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              child: Text(
                l10n.privacy,
                style: Theme.of(context).textTheme.labelLarge,
              ),
            ),
            SwitchListTile(
              secondary: const Icon(Icons.insights_outlined),
              title: Text(l10n.usageStatistics),
              subtitle: Text(
                ref.watch(analyticsConsentProvider) ==
                        core.ConsentStatus.granted
                    ? l10n.usageStatisticsOn
                    : l10n.usageStatisticsOff,
              ),
              value:
                  ref.watch(analyticsConsentProvider) ==
                  core.ConsentStatus.granted,
              // Not awaited, for the same reason app.dart's `_answer` is not: the
              // decision applies in memory immediately and the upload is
              // best-effort, so blocking the switch on a network round trip would
              // make a withdrawal feel like a broken control.
              onChanged: (bool on) => recordAnalyticsConsent(ref, granted: on),
            ),

            // ── PROMOTIONAL OFFERS — THE GDPR Art 21 OBJECTION ───────────────
            // [research/44 rung 4] NOT a consent gate, and the difference is
            // the whole design. In-app promotion of our own apps runs on
            // LEGITIMATE INTEREST (Recital 47), so asking permission first
            // would be friction that also implies the processing becomes
            // unlawful when refused. What Art 21(2)/(3) makes absolute is the
            // OBJECTION: "the data subject shall have the right to object at
            // any time", after which "the personal data shall no longer be
            // processed for such purposes."
            //
            // 🔴 THIS ROW IS THE SECOND HOME, NOT THE ONLY ONE. Art 21(4)
            // wants the right presented "clearly and separately" at the LATEST
            // at the time of the first communication, so the same control is
            // built into `PromoSurface` and renders on the card itself. A
            // person meeting their first offer has no reason to open Settings.
            //
            // It reads and writes the CONSENT RAIL (`ConsentPurpose.promo`),
            // not a private flag: one append-only artifact trail, one server
            // route, one place the objection lives. `PromoGateState.suppressed`
            // is a projection of this value — see `PromoObjection`.
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              child: Text(
                l10n.promotionalOffers,
                style: Theme.of(context).textTheme.labelLarge,
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
              child: Text(
                l10n.promoObjectionExplain,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 16, 8),
              // WATCHED, not read, for the same reason the analytics row above
              // is: this is one of the two places the value changes, and a
              // snapshot read leaves the control offering "Stop" after the
              // person has already stopped it.
              //
              // 🔴 AND IT READS THE THIRD STATE TOO. `promoObjected` is
              // fail-closed — it answers "objected" while the rail is still
              // loading, which is right for a CARD and a lie in a CONTROL: it
              // would tell someone who never objected "Offers are off" on every
              // launch, and a tap in that window uploads a `granted: true`
              // artifact recording a decision they never made. `known` is what
              // keeps the row blank and untappable until the rail has spoken.
              child: PromoObjectionControl(
                objected: ref.watch(promoObjectedProvider),
                known: ref.watch(promoObjectionKnownProvider),
                onChanged: (bool objected) =>
                    recordPromoObjection(ref, objected: objected),
                stopLabel: l10n.promoStopOffers,
                resumeLabel: l10n.promoResumeOffers,
                objectedNotice: l10n.promoOffersOff,
              ),
            ),
            const Divider(),

            // ── SUBSCRIPTION ([pipeline 5]M-6 · M-9) ──────────────────────────
            //
            // 🔴 THE TWO ENTRY POINTS SIT SIDE BY SIDE ON PURPOSE. ROSCA's rule
            // is that cancelling must be no harder than subscribing, and the
            // cheapest way to be sure of that is to reach both from the same
            // place, one tap each. A cancel path buried a level deeper than the
            // upgrade path is the specific pattern the rule exists to stop.
            //
            // Gated on a session because both terminate in a call keyed to an
            // account: offering "manage your subscription" to a signed-out user
            // is an offer the app cannot honour, the same reason the profile and
            // deletion entries are gated.
            if (ref.watch(authRepositoryProvider).currentUser !=
                null) ...<Widget>[
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                child: Text(
                  l10n.plan,
                  style: Theme.of(context).textTheme.labelLarge,
                ),
              ),
              ListTile(
                leading: const Icon(Icons.workspace_premium_outlined),
                title: Text(l10n.paywallUpgrade),
                onTap: () => context.go('/paywall'),
              ),
              ListTile(
                leading: const Icon(Icons.receipt_long_outlined),
                title: Text(l10n.managePlanTitle),
                onTap: () => context.go('/manage-plan'),
              ),
              const Divider(),
            ],

            // ── LEGAL. Both stores require these to be reachable IN-APP, not
            //    only from a store listing. [pipeline C-13]
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              child: Text(
                l10n.legal,
                style: Theme.of(context).textTheme.labelLarge,
              ),
            ),
            ListTile(
              leading: const Icon(Icons.privacy_tip_outlined),
              title: Text(l10n.privacyPolicy),
              trailing: const Icon(Icons.open_in_new, size: 18),
              onTap: () => _openUrl(AppConfig.privacyUrl),
            ),
            ListTile(
              leading: const Icon(Icons.description_outlined),
              title: Text(l10n.termsOfService),
              trailing: const Icon(Icons.open_in_new, size: 18),
              onTap: () => _openUrl(AppConfig.termsUrl),
            ),
            // [pipeline 8]K-6. The third published legal page, and the one that
            // was missing: the site publishes privacy, terms AND refund, the
            // brick linked the first two, and nothing compared the sets. A refund
            // policy a buyer cannot reach from inside the app they bought in is
            // the page a store reviewer looks for first when a charge is
            // disputed.
            ListTile(
              leading: const Icon(Icons.currency_exchange_outlined),
              title: Text(l10n.refundPolicy),
              trailing: const Icon(Icons.open_in_new, size: 18),
              onTap: () => _openUrl(AppConfig.refundUrl),
            ),
            const Divider(),
            ListTile(
              leading: const Icon(Icons.mail_outline),
              title: Text(l10n.contactSupport),
              subtitle: const Text(AppConfig.supportEmail),
              trailing: const Icon(Icons.open_in_new, size: 18),
              onTap: _contactSupport,
            ),
            // Sign out sits ABOVE delete: it is the action a user wants
            // hundreds of times more often, and putting the irreversible one
            // first invites a misfire.
            if (ref.watch(authRepositoryProvider).currentUser != null)
              ListTile(
                leading: const Icon(Icons.logout),
                title: Text(l10n.signOut),
                onTap: () => _signOut(context, ref, l10n),
              ),

            // [pipeline C-13] Only when there is an account to delete. Both
            // stores require an in-app deletion path where accounts EXIST; an
            // entry shown to a signed-out user is an offer the app cannot honour.
            if (ref.watch(authRepositoryProvider).currentUser != null)
              ListTile(
                leading: const Icon(Icons.delete_outline),
                title: Text(l10n.deleteAccount),
                subtitle: Text(l10n.deleteAccountSubtitle),
                onTap: () => _confirmDelete(context, ref, l10n),
              ),
            // 🔴 [pipeline C-13] `applicationVersion` WAS MISSING, and the
            // register row for this screen has always promised "version and
            // legalese". Flutter does not complain: `showAboutDialog` simply
            // renders no version line, so the dialog looked complete and told a
            // user reporting a bug nothing about WHICH BUILD they were running —
            // which is the one fact a support mail is worthless without, and the
            // reason both stores expect a version to be visible in-app.
            //
            // The RUNNING version, not the compiled-in constant: `AppConfig
            // .appVersion` is a `String.fromEnvironment` default that a build
            // which forgot `--dart-define` would report as the truth. The
            // provider reads what is actually installed and falls back to the
            // constant only while the plugin resolves (and on platforms where it
            // cannot), exactly as the force-update gate does with the same value.
            AboutListTile(
              applicationName: AppConfig.appName,
              applicationVersion:
                  ref.watch(packageVersionProvider).valueOrNull ??
                  AppConfig.appVersion,
              applicationLegalese: l10n.legalese,
              child: Text(l10n.about),
            ),
          ],
        ),
      ),
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
    AppLocalizations l10n, {
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
  Future<void> _signOut(
    BuildContext context,
    WidgetRef ref,
    AppLocalizations l10n,
  ) async {
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    try {
      await signOutAndForgetUser(ref);
    } catch (_) {
      messenger.showSnackBar(SnackBar(content: Text(l10n.signOutFailed)));
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
  /// Split into its own dialog widget for the same reason the delete dialog is —
  /// a confirm action only reachable through a tap on a tile is one nobody
  /// writes a test for, which is how a dead button survives.
  void _editProfile(
    BuildContext context,
    WidgetRef ref,
    AppLocalizations l10n,
    core.AuthUser user,
  ) {
    final TextEditingController name = TextEditingController(
      text: user.displayName ?? '',
    );
    showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => _EditProfileDialog(
        l10n: l10n,
        name: name,
        onSave: () => _saveProfile(dialogContext, ref, l10n, name.text),
      ),
    );
  }

  Future<void> _saveProfile(
    BuildContext dialogContext,
    WidgetRef ref,
    AppLocalizations l10n,
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
    AppLocalizations l10n,
  ) {
    final TextEditingController password = TextEditingController();
    showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => _DeleteAccountDialog(
        l10n: l10n,
        password: password,
        onConfirm: () =>
            _deleteAccount(dialogContext, ref, l10n, password.text),
      ),
    );
  }

  Future<void> _deleteAccount(
    BuildContext dialogContext,
    WidgetRef ref,
    AppLocalizations l10n,
    String password,
  ) async {
    final NavigatorState nav = Navigator.of(dialogContext);
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(
      dialogContext,
    );
    final core.AuthRepository auth = ref.read(authRepositoryProvider);
    final String? email = auth.currentUser?.email;
    // 🔴 RESOLVED HERE, BEFORE THE FIRST AWAIT, for the reason [userStateDrops]
    // records: `deleteAccount()` signs out, the router tears this shell down,
    // and a `ref.read` on the far side of that await throws `StateError` — into
    // the deliberately empty `catch` below, where nothing can ever observe it.
    // The forget would have silently done nothing on the one path where the
    // account it belongs to no longer exists.
    final List<UserStateDrop> drops = userStateDrops(ref);
    try {
      if (email == null) throw core.AuthFailure('Not signed in');
      // Re-authenticate through the SAME seam sign-in uses.
      await auth.signInWithEmail(email: email, password: password);
      try {
        await auth.deleteAccount();
      } finally {
        // BOTH BRANCHES, because `deleteAccount` signs out whether or not the
        // server deleted anything — so the session is gone either way and the
        // state scoped to it must go too. It matters MORE on the failing branch:
        // those reminders belong to an account whose rows may already be
        // destroyed. Placed after the reauth on purpose — a wrong password
        // deletes nothing and leaves the user signed in, so there is nothing to
        // forget.
        try {
          await forgetSignedInUser(drops);
        } catch (_) {
          // 🔴 A FAILED LOCAL CLEAR MUST NOT BECOME THE DELETION'S VERDICT.
          // Letting it out of this `finally` would replace a 502 —
          // `signInSurvives`, the one outcome a user can never discover for
          // themselves — with a generic "we cannot tell", and would report a
          // deletion that really happened as one that may not have. What the
          // server did to the account outranks what this device managed to
          // tidy up.
        }
      }
      nav.pop();
    } catch (e) {
      // Deliberately NOT "deleted" on failure. AuthRepository.deleteAccount
      // signs out regardless and then throws, so the user may be signed out
      // WITHOUT being deleted — saying otherwise would be the one lie they can
      // never detect and never recover from.
      //
      // 🔴 AND NOT ONE MESSAGE FOR EVERY FAILURE EITHER. This used to be
      // `catch (_)` printing `l10n.deleteAccountFailed` — "Your account has NOT
      // been deleted" — for every refusal the route can give. That sentence is
      // FALSE on a 502, where the rows are gone and only the identity survived:
      // the user is told nothing happened while their data is already destroyed
      // and their login still works. [ADR 027].
      nav.pop();
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            deleteAccountFailureMessage(l10n, core.accountDeletionOutcomeOf(e)),
          ),
        ),
      );
    }
  }
}

/// The sentence for each way a deletion can fail.
///
/// TOP-LEVEL AND PUBLIC so `test/chassis_properties_test.dart` can assert on it
/// directly: a mapping only reachable through a dialog is one nobody tests, and
/// the whole defect this replaces was invisible for exactly that reason.
///
/// ⚠️ NO TURNAROUND TIME, RETENTION PERIOD OR LEGAL STATEMENT appears in any of
/// these strings, because `sites/nikatru/delete-account.html` publishes none —
/// an app promising one would be committing the business to it.
String deleteAccountFailureMessage(
  AppLocalizations l10n,
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

/// [pipeline C-13] The display-name editor. No confirmation step and no reauth,
/// deliberately: renaming yourself is reversible in one tap, and guarding a
/// harmless action trains people to click through the guards on the dangerous
/// one two tiles below.
class _EditProfileDialog extends StatelessWidget {
  const _EditProfileDialog({
    required this.l10n,
    required this.name,
    required this.onSave,
  });

  final AppLocalizations l10n;
  final TextEditingController name;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(l10n.editProfile),
      content: TextField(
        controller: name,
        autofocus: true,
        textCapitalization: TextCapitalization.words,
        decoration: InputDecoration(labelText: l10n.displayName),
        onSubmitted: (_) => onSave(),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(l10n.cancel),
        ),
        FilledButton(onPressed: onSave, child: Text(l10n.save)),
      ],
    );
  }
}

/// Split out so the confirm action can be driven directly in a test — a dialog
/// only reachable through a tap on a tile is one nobody writes a test for, which
/// is how the dead button survived in the first place.
class _DeleteAccountDialog extends StatelessWidget {
  const _DeleteAccountDialog({
    required this.l10n,
    required this.password,
    required this.onConfirm,
  });

  final AppLocalizations l10n;
  final TextEditingController password;
  final VoidCallback onConfirm;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(l10n.deleteAccountConfirmTitle),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(l10n.deleteAccountConfirmBody),
          const SizedBox(height: 16),
          Text(l10n.deleteAccountReauthHint),
          const SizedBox(height: 8),
          TextField(
            controller: password,
            obscureText: true,
            decoration: InputDecoration(labelText: l10n.deleteAccountPassword),
          ),
        ],
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(l10n.cancel),
        ),
        FilledButton(onPressed: onConfirm, child: Text(l10n.delete)),
      ],
    );
  }
}
