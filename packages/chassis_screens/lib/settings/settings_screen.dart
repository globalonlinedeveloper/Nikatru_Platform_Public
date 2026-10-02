import 'dart:async';

import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

// One import per adapter: `assert-screen-set`'s delegation resolver follows a
// brick file to exactly ONE chassis path, so the report dialog the settings
// adapter opens is re-exported here rather than imported beside this file.
export 'report_content_dialog.dart';
// SE-03: the devices list, re-exported for the same one-import reason.
export 'devices_section.dart';

/// [pipeline C-13] The display-name editor. No confirmation step and no reauth,
/// deliberately: renaming yourself is reversible in one tap, and guarding a
/// harmless action trains people to click through the guards on the dangerous
/// one two tiles below.
///
/// 🏗️ MOVED OUT OF THE BRICK BY [ADR 067] decision 2 and made PUBLIC in the
/// move. It was `_EditProfileDialog`, and a private class cannot be constructed
/// by the adapter that still owns the controller and the save call.
class EditProfileDialog extends StatefulWidget {
  const EditProfileDialog({
    required this.name,
    required this.onSave,
    super.key,
  });

  static const Key saveButton = Key('editProfileSave');

  /// Owned by the CALLER — see the note on the caller in the brick adapter for
  /// why: `assert-stamp-properties.mjs:1077` pins the save wiring as the literal
  /// zero-argument closure `onSave: () => _saveProfile(`, whose only way to see
  /// the typed name is a controller the caller holds.
  final TextEditingController name;

  /// ⏱ 2026-10-01 · train ST-SETTINGS (SE-05): AWAITED. The dialog holds Save
  /// disabled until the future completes, so a second tap while the first
  /// write is in flight cannot send a second `updateProfile`. A callback that
  /// returns nothing (a test's synchronous one) is simply complete at once.
  final FutureOr<void> Function() onSave;

  @override
  State<EditProfileDialog> createState() => _EditProfileDialogState();
}

/// 🔴 CALM BY CONSTRUCTION (SE-05). Two refusals, both decided here so no app
/// can wire past them: an EMPTY name is not a name (a blank save erased the
/// display name and the tile then read "not set"), and a save already in
/// flight is not started again — the guard is in [_save] itself, not only on
/// the button, because two taps inside one frame both reach the old closure.
class _EditProfileDialogState extends State<EditProfileDialog> {
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    widget.name.addListener(_changed);
  }

  @override
  void dispose() {
    widget.name.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  bool get _canSave => !_saving && widget.name.text.trim().isNotEmpty;

  Future<void> _save() async {
    if (!_canSave) return;
    setState(() => _saving = true);
    try {
      await widget.onSave();
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;
    return PopScope(
      canPop: !_saving,
      child: AlertDialog(
        title: Text(l10n.editProfile),
        content: TextField(
          controller: widget.name,
          autofocus: true,
          enabled: !_saving,
          textCapitalization: TextCapitalization.words,
          autofillHints: const <String>[AutofillHints.name],
          decoration: InputDecoration(labelText: l10n.displayName),
          onSubmitted: (_) => _save(),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: _saving ? null : () => Navigator.pop(context),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            key: EditProfileDialog.saveButton,
            onPressed: _canSave ? _save : null,
            child: _saving
                ? const SizedBox.square(
                    dimension: AppSpacing.lg,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(l10n.save),
          ),
        ],
      ),
    );
  }
}

/// Settings — the chassis page every stamped app inherits.
///
/// 🏗️ THE BODY OF `SettingsScreen`, MOVED HERE BY [ADR 067] decision 2. It
/// carries the chassis-mandated support contact (E1), the in-app
/// account-deletion entry (G2), the DPDP §6(3) withdrawal control and the
/// GDPR Art 21 objection.
///
/// 🔴 EVERY SEAM CALL IS A CALLBACK AND EVERY PROVIDER READ IS A VALUE, and that
/// is not a style. The DPDP withdrawal call `recordAnalyticsConsent(ref, …)`, the
/// GDPR objection `recordPromoObjection(ref, …)`, the notification capability
/// matrix, `url_launcher`, `AuthRepository.deleteAccount()` and every navigation
/// need a `WidgetRef`, a plugin or a `GoRouter`. This package declares none of
/// the three — see its pubspec for the measurement behind that rule — so all of
/// them stay in the brick ADAPTER and arrive here already resolved.
///
/// ⚠️ WHICH MEANS `assert-consent-withdrawal-surface.mjs` STILL READS THE
/// ADAPTER FOR ITS FOUR ANCHORS, not this file. That guard's own delegation note
/// (`:264`) anticipated the call moving here with the body; it cannot, because
/// the call takes a `WidgetRef`. The guard is unharmed — its scan reads the
/// adapter UNIONED with this file, and the four things it looks for
/// (`recordAnalyticsConsent(`, a non-constant `granted:`, `analyticsConsentProvider`,
/// and the promo trio) are all still in `lib/features/settings/`. Recorded here
/// because a reader who assumes the guard now watches THIS file would be wrong.
///
/// 🔴 THE WIDTH DECISION IS MADE ONCE, HERE. This was a bare `Scaffold` +
/// `ListView` in the brick, i.e. NO WIDTH DECISION AT ALL. A `ListTile` fills
/// whatever it is given, so on a maximised desktop window every row stretched
/// the full width of the display: the leading icon at the far left, its label a
/// hand's width away, the trailing chevron off at the other edge. Nothing was
/// clipped and nothing overflowed, so no test and no reviewer had anything to
/// point at — the defect is that the eye has to travel, and only a measurement
/// catches it.
///
/// The DEFAULT cap (`AppBreakpoints.kMaxBodyWidth`), not `.reading`: this is a
/// page of controls rather than prose, and 1280 is the same ceiling
/// `AppScaffold` already applies to its extra-large class.
class SettingsView extends StatelessWidget {
  const SettingsView({
    required this.themeMode,
    required this.onThemeModeChanged,
    required this.languageCode,
    required this.onLanguageChanged,
    required this.remindersAvailable,
    required this.remindersEnabled,
    required this.onRemindersChanged,
    this.offersDailyReminder = true,
    required this.analyticsGranted,
    required this.onAnalyticsConsentChanged,
    required this.promoObjected,
    required this.promoObjectionKnown,
    required this.onPromoObjectionChanged,
    required this.hasSession,
    required this.planSectionLabel,
    required this.managePlanLabel,
    required this.onUpgrade,
    required this.onManagePlan,
    required this.onOpenPrivacyPolicy,
    required this.onOpenTerms,
    required this.onOpenRefundPolicy,
    this.onOpenPrivacyNotice,
    required this.supportEmail,
    required this.onContactSupport,
    required this.onSignOut,
    required this.onSignOutEverywhere,
    required this.onDeleteAccount,
    required this.applicationName,
    required this.applicationVersion,
    this.profile,
    this.onEditProfile,
    this.onReportContent,
    super.key,
  });

  static const Key themePicker = Key('settingsThemePicker');
  static const Key languagePicker = Key('settingsLanguagePicker');
  static const Key analyticsConsentSwitch = Key('settingsAnalyticsConsent');
  static const Key upgradeTile = Key('settingsUpgrade');
  static const Key managePlanTile = Key('settingsManagePlan');
  static const Key deleteAccountTile = Key('settingsDeleteAccount');
  static const Key contactSupportTile = Key('settingsContactSupport');
  static const Key reportContentTile = Key('settingsReportContent');
  // 🔴 THESE FOUR KEYS WERE ADDED 2026-09-06 SO THE CONTROLS COULD BE TAPPED IN
  // A TEST, and that is not tidying — it is the second half of a defect a review
  // measured on this branch. Before the settings body moved here, each of these
  // tiles carried its own handler in the brick, so ONE string
  // (`onTap: () => _signOut(context, ref, l10n)`) proved both that the handler
  // existed and that a control reached it, and deleting the tile reddened
  // `assert-seams-wired` and `assert-screen-set`. After the move the handler
  // stays in the adapter and only the TILE is here, so severing `onTap: onSignOut`
  // changed nothing any check could see. `assert-screen-set.mjs` now closes that
  // statically for every delegated callback; these keys close it BEHAVIOURALLY
  // for the six controls the review named, which is the stronger of the two
  // claims — a tap that reaches the callback cannot be satisfied by a string.
  static const Key signOutTile = Key('settingsSignOut');
  static const Key signOutEverywhereTile = Key('settingsSignOutEverywhere');
  static const Key signOutEverywhereConfirm = Key(
    'settingsSignOutEverywhereConfirm',
  );
  static const Key signOutEverywhereCancel = Key(
    'settingsSignOutEverywhereCancel',
  );
  static const Key editProfileTile = Key('settingsEditProfile');
  static const Key privacyPolicyTile = Key('settingsPrivacyPolicy');
  static const Key termsTile = Key('settingsTerms');
  static const Key privacyNoticeTile = Key('settingsPrivacyNotice');

  /// The signed-in identity, or null when there is none. Offering "edit your
  /// name" to a signed-out user is an offer the app cannot honour — the same
  /// reason the deletion entry is gated further down.
  final SettingsProfile? profile;
  final VoidCallback? onEditProfile;

  /// O-PLAY-AI-CONTENT-REPORTING. Null in an app that generates no AI content,
  /// and then there is no tile. The adapter passes it when the app's
  /// `AppConfig.generatesAiContent` is true; Google Play requires an in-app
  /// report control in every app that generates content with AI.
  final VoidCallback? onReportContent;

  final ThemeMode themeMode;
  final ValueChanged<ThemeMode> onThemeModeChanged;

  /// `''` means "follow the system", which is why it is a code and not a
  /// `Locale?`: the radio group needs a value for the system row too.
  final String languageCode;
  final ValueChanged<String> onLanguageChanged;

  /// [pipeline C-7 earning its keep in real UI] The platform matrix is consulted
  /// BEFORE a control is offered. On Linux the plugin shows but cannot schedule;
  /// on Windows (pinned 17.x) it does neither. A toggle that silently does
  /// nothing on those platforms is worse than an honest sentence, because the
  /// user believes reminders are on. The matrix itself is read in the adapter —
  /// `NotificationCapabilities` is the notifications SEAM.
  final bool remindersAvailable;
  final bool remindersEnabled;
  final ValueChanged<bool> onRemindersChanged;

  /// ST-U1 (audit C22/D4): whether THIS app offers the chassis daily reminder
  /// ("Time for today" — a habit app's nudge). An app with no daily habit
  /// declares false and the section is not drawn: a daily "keeps your streak
  /// going" beside a tracker's own reminders was a second, meaningless control.
  final bool offersDailyReminder;

  /// 🔴 THE DPDP §6(3) WITHDRAWAL PATH, AND THE CHASSIS SHIPPED WITHOUT IT.
  /// Until [ADR 037 P2.7] the only caller of `recordAnalyticsConsent` in a
  /// stamped app was the FIRST-RUN PROMPT in app.dart — shown once, never again
  /// — so consent was a one-way door in every app the factory stamps.
  /// `assert-seams-wired.mjs` stayed green throughout: it asks whether the seam
  /// is DEAD, not whether it is REVERSIBLE, and the prompt answers that
  /// question. Withdrawal must be as easy as granting, and privacy.html promises
  /// it happens here.
  ///
  /// The value is a PARAMETER the adapter WATCHES, not one it read once: this
  /// row is the one place the state changes, and a snapshot read leaves the
  /// switch showing the old answer after the user has just flipped it.
  final bool analyticsGranted;
  final ValueChanged<bool> onAnalyticsConsentChanged;

  /// 🔴 NOT A CONSENT GATE — THE GDPR Art 21 OBJECTION. [research/44 rung 4]
  /// In-app promotion of our own apps runs on LEGITIMATE INTEREST (Recital 47),
  /// so asking permission first would be friction that also implies the
  /// processing becomes unlawful when refused. What Art 21(2)/(3) makes absolute
  /// is the OBJECTION: "the data subject shall have the right to object at any
  /// time", after which "the personal data shall no longer be processed for such
  /// purposes."
  ///
  /// 🔴 THIS ROW IS THE SECOND HOME, NOT THE ONLY ONE. Art 21(4) wants the right
  /// presented "clearly and separately" at the LATEST at the time of the first
  /// communication, so the same control is built into `PromoSurface` and renders
  /// on the card itself. A person meeting their first offer has no reason to
  /// open Settings.
  final bool promoObjected;

  /// 🔴 THE THIRD STATE, AND IT IS NOT A REFINEMENT. `promoObjected` is
  /// fail-closed — it answers "objected" while the rail is still loading, which
  /// is right for a CARD and a lie in a CONTROL: it would tell someone who never
  /// objected "Offers are off" on every launch, and a tap in that window uploads
  /// a `granted: true` artifact recording a decision they never made. `known` is
  /// what keeps the row blank and untappable until the rail has spoken.
  final bool promoObjectionKnown;
  final ValueChanged<bool> onPromoObjectionChanged;

  /// Whether there is an account at all. The subscription and deletion entries
  /// are gated on it because both terminate in a call keyed to one.
  final bool hasSession;

  /// App-owned copy: `plan` and `managePlanTitle` live in the app's `.arb`, not
  /// in the chassis catalogue.
  final String planSectionLabel;
  final String managePlanLabel;

  final VoidCallback onUpgrade;
  final VoidCallback onManagePlan;

  final VoidCallback onOpenPrivacyPolicy;
  final VoidCallback onOpenTerms;
  final VoidCallback onOpenRefundPolicy;

  /// ⏱ 2026-09-28 · train ST-D4. Opens THIS app's own privacy notice — the
  /// page `tooling/app-yaml/render-privacy.mjs` generates from the app's
  /// `privacy.yaml` (what it collects, why, for how long, who else touches
  /// it) — as opposed to [onOpenPrivacyPolicy], the portfolio-wide policy.
  ///
  /// OPTIONAL, and null draws no row: until an app's declaration is
  /// published its notice page says "not yet published", and a Settings row
  /// that opens a page saying there is nothing to read is a dead end dressed
  /// as a disclosure. The adapter passes it once the app's notice is live.
  final VoidCallback? onOpenPrivacyNotice;

  final String supportEmail;
  final VoidCallback onContactSupport;
  final VoidCallback onSignOut;

  /// "Sign out of all devices" — every session the account holds, this one
  /// included. REQUIRED rather than optional so that no stamped app can ship
  /// Settings without it: the owner's rule is that a user stays signed in until
  /// they reset their password or sign out everywhere (2026-09-24), and the
  /// second half of that rule is this control. The adapter routes it through
  /// the same awaited sign-out-and-forget as [onSignOut], with the global scope.
  ///
  /// Fired only after the user CONFIRMS — see [_confirmSignOutEverywhere].
  final VoidCallback onSignOutEverywhere;
  final VoidCallback onDeleteAccount;

  /// The RUNNING version, not the compiled-in constant — resolved in the adapter
  /// from `packageVersionProvider`, which reads what is actually installed. Both
  /// the licences row and the About row below are handed the same value, so the
  /// two can never report different builds.
  final String applicationName;
  final String applicationVersion;

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;
    final TextTheme text = Theme.of(context).textTheme;

    // ⏱ 2026-09-28 · train ST-D4: every group is a [SettingsSection] — a
    // heading and ONE [AppCard] holding its rows — instead of a heading, bare
    // tiles and a full-bleed `Divider`. The rows themselves are unchanged
    // Material tiles (the card is their `Material` ancestor), so every key,
    // callback and gate below is the one that was here; what moved is the
    // grouping, and the gutters now come from `AppSpacing` rather than from
    // each tile's own inset.
    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsTitle)),
      body: ContentPane(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.gutterCompact,
            0,
            AppSpacing.gutterCompact,
            AppSpacing.xl,
          ),
          children: <Widget>[
            // ── PROFILE ──────────────────────────────────────────────────────
            if (profile != null)
              SettingsSection(
                title: l10n.profile,
                children: <Widget>[
                  ListTile(
                    key: editProfileTile,
                    leading: CircleAvatar(child: Text(profile!.initial)),
                    title: Text(
                      profile!.displayName.isEmpty
                          ? l10n.displayNameNotSet
                          : profile!.displayName,
                    ),
                    subtitle: Text(profile!.email),
                    trailing: const Icon(Icons.edit_outlined),
                    onTap: onEditProfile,
                  ),
                ],
              ),
            // [pipeline C-16] The on-switch for the persisted themeMode. A stored
            // preference with no control is a dead setting — the same shape as the
            // consent recorder that had no prompt and silently discarded every
            // event. Shipped together, or not at all.
            SettingsSection(
              title: l10n.appearance,
              children: <Widget>[
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.md,
                    vertical: AppSpacing.sm,
                  ),
                  child: SegmentedButton<ThemeMode>(
                    key: themePicker,
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
                    selected: <ThemeMode>{themeMode},
                    onSelectionChanged: (Set<ThemeMode> s) =>
                        onThemeModeChanged(s.first),
                  ),
                ),
              ],
            ),

            // ── LANGUAGE ─────────────────────────────────────────────────────
            // Language names are shown in their OWN language, so a speaker can
            // find theirs without first being able to read the current one.
            SettingsSection(
              title: l10n.language,
              children: <Widget>[
                RadioGroup<String>(
                  key: languagePicker,
                  groupValue: languageCode,
                  onChanged: (String? code) => onLanguageChanged(code ?? ''),
                  child: Column(
                    children: <Widget>[
                      // One tile per supported row of tooling/i18n/locales.json.
                      for (final (String code, String name)
                          in <(String, String)>[
                            ('', l10n.languageSystem),
                            for (final RegisteredLocale r in kSupportedLocales)
                              (r.code, r.nativeName),
                          ])
                        RadioListTile<String>(value: code, title: Text(name)),
                    ],
                  ),
                ),
              ],
            ),

            // ── NOTIFICATIONS ────────────────────────────────────────────────
            if (offersDailyReminder)
              SettingsSection(
                title: l10n.notifications,
                children: <Widget>[
                  if (!remindersAvailable)
                    ListTile(
                      leading: const Icon(Icons.notifications_off_outlined),
                      title: Text(l10n.remindersUnavailable),
                      enabled: false,
                    )
                  else
                    SwitchListTile(
                      secondary: const Icon(Icons.notifications_outlined),
                      title: Text(l10n.remindersEnabled),
                      value: remindersEnabled,
                      onChanged: onRemindersChanged,
                    ),
                ],
              ),

            // ── PRIVACY ──────────────────────────────────────────────────────
            SettingsSection(
              title: l10n.privacy,
              children: <Widget>[
                // ⏱ 2026-09-28 · train ST-D4: THE APP'S OWN PRIVACY NOTICE, and
                // it sits HERE rather than in Legal on purpose. The switch
                // below asks for a decision; the notice is what that decision
                // is about (what is collected, why, for how long). A consent
                // control whose explanation is one section away, filed under
                // "Legal" beside the portfolio-wide policy, is a choice asked
                // for without its facts. Null in an app whose notice is not
                // published yet — then there is no row, rather than a link to
                // a "not yet published" page.
                if (onOpenPrivacyNotice != null)
                  ListTile(
                    key: privacyNoticeTile,
                    leading: const Icon(Icons.policy_outlined),
                    title: Text(l10n.privacyNotice),
                    subtitle: Text(l10n.privacyNoticeSubtitle),
                    trailing: const Icon(Icons.open_in_new),
                    onTap: onOpenPrivacyNotice,
                  ),
                SwitchListTile(
                  key: analyticsConsentSwitch,
                  secondary: const Icon(Icons.insights_outlined),
                  title: Text(l10n.usageStatistics),
                  subtitle: Text(
                    analyticsGranted
                        ? l10n.usageStatisticsOn
                        : l10n.usageStatisticsOff,
                  ),
                  value: analyticsGranted,
                  // Not awaited by the adapter, for the same reason app.dart's
                  // `_answer` is not: the decision applies in memory immediately
                  // and the upload is best-effort, so blocking the switch on a
                  // network round trip would make a withdrawal feel like a
                  // broken control.
                  onChanged: onAnalyticsConsentChanged,
                ),
              ],
            ),

            // ── PROMOTIONAL OFFERS — THE GDPR Art 21 OBJECTION ───────────────
            // It reads and writes the CONSENT RAIL (`ConsentPurpose.promo`), not
            // a private flag: one append-only artifact trail, one server route,
            // one place the objection lives. `PromoGateState.suppressed` is a
            // projection of this value — see `PromoObjection`.
            SettingsSection(
              title: l10n.promotionalOffers,
              children: <Widget>[
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.lg,
                    AppSpacing.md,
                    AppSpacing.lg,
                    AppSpacing.xs,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(l10n.promoObjectionExplain, style: text.bodySmall),
                      PromoObjectionControl(
                        objected: promoObjected,
                        known: promoObjectionKnown,
                        onChanged: onPromoObjectionChanged,
                        stopLabel: l10n.promoStopOffers,
                        resumeLabel: l10n.promoResumeOffers,
                        objectedNotice: l10n.promoOffersOff,
                      ),
                    ],
                  ),
                ),
              ],
            ),

            // ── SUBSCRIPTION ([pipeline 5]M-6 · M-9) ──────────────────────────
            //
            // 🔴 THE TWO ENTRY POINTS SIT SIDE BY SIDE ON PURPOSE. ROSCA's rule
            // is that cancelling must be no harder than subscribing, and the
            // cheapest way to be sure of that is to reach both from the same
            // place, one tap each. A cancel path buried a level deeper than the
            // upgrade path is the specific pattern the rule exists to stop.
            if (hasSession)
              SettingsSection(
                title: planSectionLabel,
                children: <Widget>[
                  ListTile(
                    key: upgradeTile,
                    leading: const Icon(Icons.workspace_premium_outlined),
                    title: Text(l10n.paywallUpgrade),
                    onTap: onUpgrade,
                  ),
                  ListTile(
                    key: managePlanTile,
                    leading: const Icon(Icons.receipt_long_outlined),
                    title: Text(managePlanLabel),
                    onTap: onManagePlan,
                  ),
                ],
              ),

            // ── LEGAL. Both stores require these to be reachable IN-APP, not
            //    only from a store listing. [pipeline C-13]
            SettingsSection(
              title: l10n.legal,
              children: <Widget>[
                ListTile(
                  key: privacyPolicyTile,
                  leading: const Icon(Icons.privacy_tip_outlined),
                  title: Text(l10n.privacyPolicy),
                  trailing: const Icon(Icons.open_in_new),
                  onTap: onOpenPrivacyPolicy,
                ),
                ListTile(
                  key: termsTile,
                  leading: const Icon(Icons.description_outlined),
                  title: Text(l10n.termsOfService),
                  trailing: const Icon(Icons.open_in_new),
                  onTap: onOpenTerms,
                ),
                // [pipeline 8]K-6. The third published legal page, and the one
                // that was missing: the site publishes privacy, terms AND refund,
                // the brick linked the first two, and nothing compared the sets.
                // A refund policy a buyer cannot reach from inside the app they
                // bought in is the page a store reviewer looks for first when a
                // charge is disputed.
                ListTile(
                  leading: const Icon(Icons.currency_exchange_outlined),
                  title: Text(l10n.refundPolicy),
                  trailing: const Icon(Icons.open_in_new),
                  onTap: onOpenRefundPolicy,
                ),
                ListTile(
                  key: contactSupportTile,
                  leading: const Icon(Icons.mail_outline),
                  title: Text(l10n.contactSupport),
                  subtitle: Text(supportEmail),
                  trailing: const Icon(Icons.open_in_new),
                  onTap: onContactSupport,
                ),
                if (onReportContent != null)
                  ListTile(
                    key: reportContentTile,
                    leading: const Icon(Icons.flag_outlined),
                    title: Text(l10n.reportContent),
                    onTap: onReportContent,
                  ),
              ],
            ),

            // ── ACCOUNT ──────────────────────────────────────────────────────
            // Sign out sits ABOVE delete: it is the action a user wants
            // hundreds of times more often, and putting the irreversible one
            // first invites a misfire.
            if (hasSession)
              SettingsSection(
                children: <Widget>[
                  ListTile(
                    key: signOutTile,
                    leading: const Icon(Icons.logout),
                    title: Text(l10n.signOut),
                    onTap: onSignOut,
                  ),
                  // Below the ordinary sign-out and above delete, for the same
                  // reason that order exists: the commoner, narrower action
                  // first. Gated on a session because with none there is
                  // nothing to revoke anywhere — the server call is keyed to the
                  // session in hand.
                  ListTile(
                    key: signOutEverywhereTile,
                    leading: const Icon(Icons.devices_outlined),
                    title: Text(l10n.signOutEverywhere),
                    subtitle: Text(l10n.signOutEverywhereSubtitle),
                    onTap: () => _confirmSignOutEverywhere(context),
                  ),
                  // [pipeline C-13] Only when there is an account to delete.
                  // Both stores require an in-app deletion path where accounts
                  // EXIST; an entry shown to a signed-out user is an offer the
                  // app cannot honour.
                  ListTile(
                    key: deleteAccountTile,
                    leading: const Icon(Icons.delete_outline),
                    title: Text(l10n.deleteAccount),
                    subtitle: Text(l10n.deleteAccountSubtitle),
                    onTap: onDeleteAccount,
                  ),
                ],
              ),
            // ── OPEN-SOURCE LICENCES ([pipeline 8]K-11) ─────────────────────
            //
            // 🔴 THE ONE SHIPPING APP HAD A ONE-TAP LICENCES ROW AND THE BRICK
            // DID NOT, so every app this factory stamps offered the notices
            // only via the About dialog's "View licenses" button — two taps,
            // behind a dialog. Several packages a stamped app ships, and the
            // MaterialIcons font that `uses-material-design: true` bundles,
            // carry attribution obligations discharged by DISPLAYING the
            // notice, and both stores may ask for evidence of rights on
            // demand. The answer has to be a screen the reviewer can reach,
            // not a search.
            //
            // TWO tiles, and they are NOT redundant. The About tile below is
            // the chassis one and carries the RUNNING VERSION — the single
            // fact a support mail is worthless without — and reaches the
            // licences only through the framework's own button. This row is
            // the one tap K-11 asks for.
            //
            // `LicensePage` reads `LicenseRegistry`, which every package
            // registers into automatically and which `main.dart` tops up with
            // the vendored font entries Flutter's collector never sees — so
            // this list stays correct as dependencies change, instead of being
            // a list somebody must remember to update.
            SettingsSection(
              children: <Widget>[
                ListTile(
                  leading: const Icon(Icons.copyright_outlined),
                  title: Text(l10n.openSourceLicences),
                  onTap: () => showLicensePage(
                    context: context,
                    applicationName: applicationName,
                    applicationVersion: applicationVersion,
                    applicationLegalese: l10n.legalese,
                  ),
                ),
                // 🔴 [pipeline C-13] `applicationVersion` WAS MISSING, and the
                // register row for this screen has always promised "version and
                // legalese". Flutter does not complain: `showAboutDialog` simply
                // renders no version line, so the dialog looked complete and
                // told a user reporting a bug nothing about WHICH BUILD they
                // were running.
                AboutListTile(
                  applicationName: applicationName,
                  applicationVersion: applicationVersion,
                  applicationLegalese: l10n.legalese,
                  child: Text(l10n.about),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// 🔴 ONE TAP MUST NOT SIGN THE ACCOUNT OUT EVERYWHERE, the device in the
  /// user's hand included — so the tile asks first (AUTH-LOGOUT-ALL, parent
  /// ruling L2, 2026-09-24). The confirm lives HERE rather than in each
  /// adapter so that no stamped app can wire the tile past it:
  /// [onSignOutEverywhere] fires exactly once on the confirm button and never
  /// on Cancel, a barrier tap or a back gesture (all three answer `false` or
  /// `null`).
  Future<void> _confirmSignOutEverywhere(BuildContext context) async {
    final ChassisLocalizations l10n = context.chassisL10n;
    final bool confirmed =
        await showDialog<bool>(
          context: context,
          builder: (BuildContext c) => AlertDialog(
            title: Text(l10n.signOutEverywhereConfirmTitle),
            content: Text(l10n.signOutEverywhereConfirmBody),
            actions: <Widget>[
              TextButton(
                key: signOutEverywhereCancel,
                onPressed: () => Navigator.pop(c, false),
                child: Text(l10n.cancel),
              ),
              FilledButton(
                key: signOutEverywhereConfirm,
                onPressed: () => Navigator.pop(c, true),
                child: Text(l10n.signOutEverywhereConfirmAction),
              ),
            ],
          ),
        ) ??
        false;
    if (confirmed) onSignOutEverywhere();
  }
}

/// The identity the profile tile paints, as plain values.
///
/// `AuthUser` itself stays in the adapter: `nikatru_core` is on this package's
/// path, but the tile needs three strings and passing the domain object would
/// put the identity model in a widget's constructor for no gain.
@immutable
class SettingsProfile {
  const SettingsProfile({
    required this.initial,
    required this.displayName,
    required this.email,
  });

  final String initial;

  /// Empty when the user has never set one — rendered as `displayNameNotSet`.
  final String displayName;
  final String email;
}

/// A settings row's trailing chevron, drawn ONLY when the row goes somewhere —
/// ST-U5 (D6, D2). An inert row that draws the one glyph that says "tap me"
/// sends a user tapping at nothing.
class RowChevron extends StatelessWidget {
  const RowChevron({required this.actionable, this.color, super.key});

  final bool actionable;
  final Color? color;

  @override
  Widget build(BuildContext context) => actionable
      ? Icon(Icons.chevron_right, color: color, size: 18)
      : const SizedBox.shrink();
}

/// A titled group of settings rows on ONE [AppCard] (train ST-D4).
///
/// ```
/// TITLE
/// ╭──────────────────────────────╮
/// │ row                          │
/// ├──────────────────────────────┤
/// │ row                          │
/// ╰──────────────────────────────╯
/// footer
/// ```
///
/// 🏗️ CHASSIS, NOT APP. Every settings page this factory stamps is a list of
/// groups, and the group is where the design decisions live — the heading's
/// role and tone, the card, the seam between rows. Written once here, a
/// stamped app ADOPTS it and holds only its own rows; the shipping app's
/// hand-rolled `_sectionLabel` + `cardDecoration` pair was exactly the copy
/// this replaces.
///
/// ## What it decides, and from which token
///  * **The heading is a `header` node** in `labelLarge`, painted
///    `onSurfaceVariant` — a real heading a screen reader can jump between,
///    not styled text. The case is the translator's: nothing here upper-cases
///    a string, because Tamil has no case and an English-only transform is a
///    locale decision made in a widget.
///  * **The card is [AppCard] with no padding**, so each row's own inset
///    rules and a `ListTile`, `SwitchListTile` or [AppListRow] finds the
///    `Material` ancestor it asserts on.
///  * **The seam between rows is the theme's divider** (`outlineVariant`),
///    one logical pixel, and there is none after the last row — the card's
///    own edge closes the group.
///  * **Rhythm from [AppSpacing]**: [AppSpacing.lg] above a heading (the
///    inset the bare headings had, so a page of sections is no taller than
///    the page of headings and full-bleed dividers it replaces),
///    [AppSpacing.xs] between it and the card it names — closer to its own
///    card than to the one above, which is what makes it read as that card's.
///
/// A null [title] draws the card alone — for a group whose rows name
/// themselves (the account actions, the About pair).
class SettingsSection extends StatelessWidget {
  const SettingsSection({
    required this.children,
    this.title,
    this.footer,
    super.key,
  });

  /// The group's heading, already localised.
  final String? title;

  /// The rows, top to bottom. Empty draws nothing at all.
  final List<Widget> children;

  /// One line under the card, e.g. what a choice applies to.
  final String? footer;

  @override
  Widget build(BuildContext context) {
    if (children.isEmpty) return const SizedBox.shrink();
    final ThemeData theme = Theme.of(context);
    final TextTheme text = theme.textTheme;
    final Color quiet = theme.colorScheme.onSurfaceVariant;
    return Padding(
      padding: EdgeInsets.only(
        top: title == null ? AppSpacing.sm : AppSpacing.lg,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (title != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.xs,
                0,
                AppSpacing.xs,
                AppSpacing.xs,
              ),
              // `container: true` HERE AND ON THE CARD BELOW, AS A PAIR. With
              // neither, a bare `header:` is an annotation that bubbles up to
              // the nearest node — inside one ListView item, the whole
              // section — and the reader heard "Profile, S, Someone,
              // someone@…" as ONE stop (measured 2026-09-28). The CARD's is
              // the one `settings_design_test.dart` reds without (the row is
              // then read BEFORE its heading); this one keeps the heading its
              // own node whatever a caller puts in the card.
              child: Semantics(
                container: true,
                header: true,
                child: Text(
                  title!,
                  style: text.labelLarge?.copyWith(color: quiet),
                ),
              ),
            ),
          // A container too, for the heading's reason in reverse: without it
          // a row's text bubbles up into the SECTION's node, which the
          // heading is a child of — and a reader then heard the first row
          // BEFORE the heading that names it.
          Semantics(
            container: true,
            child: AppCard(
              padding: EdgeInsets.zero,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  for (int i = 0; i < children.length; i++) ...<Widget>[
                    if (i > 0) const Divider(height: 1, thickness: 1),
                    children[i],
                  ],
                ],
              ),
            ),
          ),
          if (footer != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.xs,
                AppSpacing.sm,
                AppSpacing.xs,
                0,
              ),
              child: Text(
                footer!,
                style: text.bodySmall?.copyWith(color: quiet),
              ),
            ),
        ],
      ),
    );
  }
}
