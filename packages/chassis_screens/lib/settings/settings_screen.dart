import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

// One import per adapter: `assert-screen-set`'s delegation resolver follows a
// brick file to exactly ONE chassis path, so the report dialog the settings
// adapter opens is re-exported here rather than imported beside this file.
export 'report_content_dialog.dart';

/// [pipeline C-13] The display-name editor. No confirmation step and no reauth,
/// deliberately: renaming yourself is reversible in one tap, and guarding a
/// harmless action trains people to click through the guards on the dangerous
/// one two tiles below.
///
/// 🏗️ MOVED OUT OF THE BRICK BY [ADR 067] decision 2 and made PUBLIC in the
/// move. It was `_EditProfileDialog`, and a private class cannot be constructed
/// by the adapter that still owns the controller and the save call.
class EditProfileDialog extends StatelessWidget {
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
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;
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
        FilledButton(
          key: saveButton,
          onPressed: onSave,
          child: Text(l10n.save),
        ),
      ],
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
    required this.supportEmail,
    required this.onContactSupport,
    required this.onSignOut,
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
  static const Key editProfileTile = Key('settingsEditProfile');
  static const Key privacyPolicyTile = Key('settingsPrivacyPolicy');
  static const Key termsTile = Key('settingsTerms');

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

  final String supportEmail;
  final VoidCallback onContactSupport;
  final VoidCallback onSignOut;
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

    Widget heading(String label) => Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
      child: Text(label, style: text.labelLarge),
    );

    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsTitle)),
      body: ContentPane(
        child: ListView(
          children: <Widget>[
            // ── PROFILE ──────────────────────────────────────────────────────
            if (profile != null) ...<Widget>[
              heading(l10n.profile),
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
              const Divider(),
            ],
            // [pipeline C-16] The on-switch for the persisted themeMode. A stored
            // preference with no control is a dead setting — the same shape as the
            // consent recorder that had no prompt and silently discarded every
            // event. Shipped together, or not at all.
            heading(l10n.appearance),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
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
            const Divider(),

            // ── LANGUAGE ─────────────────────────────────────────────────────
            // Language names are shown in their OWN language, so a speaker can
            // find theirs without first being able to read the current one.
            heading(l10n.language),
            RadioGroup<String>(
              key: languagePicker,
              groupValue: languageCode,
              onChanged: (String? code) => onLanguageChanged(code ?? ''),
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
            heading(l10n.notifications),
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
            const Divider(),

            // ── PRIVACY ──────────────────────────────────────────────────────
            heading(l10n.privacy),
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
              // `_answer` is not: the decision applies in memory immediately and
              // the upload is best-effort, so blocking the switch on a network
              // round trip would make a withdrawal feel like a broken control.
              onChanged: onAnalyticsConsentChanged,
            ),

            // ── PROMOTIONAL OFFERS — THE GDPR Art 21 OBJECTION ───────────────
            // It reads and writes the CONSENT RAIL (`ConsentPurpose.promo`), not
            // a private flag: one append-only artifact trail, one server route,
            // one place the objection lives. `PromoGateState.suppressed` is a
            // projection of this value — see `PromoObjection`.
            heading(l10n.promotionalOffers),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
              child: Text(l10n.promoObjectionExplain, style: text.bodySmall),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 16, 8),
              child: PromoObjectionControl(
                objected: promoObjected,
                known: promoObjectionKnown,
                onChanged: onPromoObjectionChanged,
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
            if (hasSession) ...<Widget>[
              heading(planSectionLabel),
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
              const Divider(),
            ],

            // ── LEGAL. Both stores require these to be reachable IN-APP, not
            //    only from a store listing. [pipeline C-13]
            heading(l10n.legal),
            ListTile(
              key: privacyPolicyTile,
              leading: const Icon(Icons.privacy_tip_outlined),
              title: Text(l10n.privacyPolicy),
              trailing: const Icon(Icons.open_in_new, size: 18),
              onTap: onOpenPrivacyPolicy,
            ),
            ListTile(
              key: termsTile,
              leading: const Icon(Icons.description_outlined),
              title: Text(l10n.termsOfService),
              trailing: const Icon(Icons.open_in_new, size: 18),
              onTap: onOpenTerms,
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
              onTap: onOpenRefundPolicy,
            ),
            const Divider(),
            ListTile(
              key: contactSupportTile,
              leading: const Icon(Icons.mail_outline),
              title: Text(l10n.contactSupport),
              subtitle: Text(supportEmail),
              trailing: const Icon(Icons.open_in_new, size: 18),
              onTap: onContactSupport,
            ),
            if (onReportContent != null)
              ListTile(
                key: reportContentTile,
                leading: const Icon(Icons.flag_outlined),
                title: Text(l10n.reportContent),
                onTap: onReportContent,
              ),
            // Sign out sits ABOVE delete: it is the action a user wants
            // hundreds of times more often, and putting the irreversible one
            // first invites a misfire.
            if (hasSession)
              ListTile(
                key: signOutTile,
                leading: const Icon(Icons.logout),
                title: Text(l10n.signOut),
                onTap: onSignOut,
              ),
            // [pipeline C-13] Only when there is an account to delete. Both
            // stores require an in-app deletion path where accounts EXIST; an
            // entry shown to a signed-out user is an offer the app cannot honour.
            if (hasSession)
              ListTile(
                key: deleteAccountTile,
                leading: const Icon(Icons.delete_outline),
                title: Text(l10n.deleteAccount),
                subtitle: Text(l10n.deleteAccountSubtitle),
                onTap: onDeleteAccount,
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
            // renders no version line, so the dialog looked complete and told a
            // user reporting a bug nothing about WHICH BUILD they were running.
            AboutListTile(
              applicationName: applicationName,
              applicationVersion: applicationVersion,
              applicationLegalese: l10n.legalese,
              child: Text(l10n.about),
            ),
          ],
        ),
      ),
    );
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
