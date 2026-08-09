// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS — the P2.6b MERGE of the stamped chassis screen and Subly's live one.
//
// DRAFT for the main session. Not applied anywhere; produced read-only against
// the live tree (`feat/subly-p24b-money-rail`) and the fully-stamped clone
// (`/tmp/claude/nk-p21r`). Contract: `restamp-artifacts/overrides.md` §10-11 (R2).
//
// 🔴 WHY A MERGE AND NOT AN APPLY. A wholesale apply of the stamped file is
// GREEN on every guard and still destroys product surfaces:
//   · the consent-WITHDRAWAL row (DPDP §6(3)) — guard-invisible, because
//     `assert-seams-wired:171` only needs *a* caller of `recordAnalyticsConsent(`
//     and `consent_prompt.dart:70` still supplies one; and test-invisible,
//     because `consent_withdrawal_test.dart:59` pumps its own harness widget;
//   · Export data (CSV) — zero test references tree-wide, and its deletion
//     silently falsifies `data-safety.json`'s export declaration;
//   · the dedicated "Open-source licences" tile ([pipeline 8]K-11).
// The one surface an apply DOES redden is the hardened delete dialog:
// `delete_account_test.dart:144` pumps the real screen and drives four Keys the
// stamped dialog does not have. One red out of four losses is exactly why this
// file is merged by hand.
//
// 🔴 AND WHY THE STAMPED CHASSIS MUST SURVIVE TOO. Keeping the live body and
// dropping `ContentPane` re-creates the no-width-decision defect PR #210 fixed;
// `test/responsive_width_test.dart` (an apply-clean file) measures it at 1920.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_notifications/nikatru_notifications.dart';
import 'package:url_launcher/url_launcher.dart';

// ⚠️ THE STAMP'S PATH, NOT THE LIVE ONE. P2.5 keeps `lib/core/app_config.dart`
// (the chassis convention `assert-stamp-text-fidelity.mjs:328` iterates) and
// deletes `lib/core/config/app_config.dart` after re-pointing its 12 importers.
// This draft is written against the survivor. If P2.5 has not landed when this
// file does, change this one line back to `../../core/config/app_config.dart`.
//
// 🔴 AND P2.5 MUST CARRY `contactUrl` ACROSS. The stamped AppConfig has no
// `contactUrl` member (measured: live `:109` has it, stamp has privacy/terms/
// refund only), and the Help & support row below needs it.
import '../../core/app_config.dart';
// The delete-account dialog's widget keys live in E2EKeys — one declaration the
// live integration suite and `test/delete_account_test.dart` both resolve
// against. The VALUES are unchanged from the literals that were here.
import '../../core/e2e_keys.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
// `auth_repository.dart` is the F0-4 re-export shim: `AuthRepository`,
// `AuthUser`, `AuthSession` and `AuthFailure` all come from `packages/core`
// through it, so `AuthUser` and `core.AuthUser` are the same type.
import '../../data/auth/auth_repository.dart';
import '../../l10n/app_localizations.dart';
import '../../state/analytics_providers.dart';
import '../../state/providers.dart';
import '../../state/settings_controller.dart';
import '../shared/widgets.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  /// The three product preferences, as `[key, l10nLabel, l10nDescription]`
  /// resolved at build time — a `const` list cannot hold `l10n` lookups, so the
  /// tuple is built inside [build] instead of here.
  ///
  /// 🔴 `unused` IS READ BY ANOTHER SCREEN. `home_screen.dart:27-28` gates its
  /// unused-subscriptions card on `prefs['unused']`, which is why overrides.md
  /// §10-11 requires home and settings to merge AS A PAIR: dropping this toggle
  /// severs a coupling nothing else reports.
  ///
  /// 'priceHike' / 'Price-hike alerts' was REMOVED 2026-07-27, not wired. It was
  /// declared in `settings_controller.dart` and read nowhere, so the switch did
  /// nothing. Unlike the three below it cannot simply be wired: detecting a price
  /// rise needs the PROVIDER's price to change, which needs an external data
  /// source the app does not have. Comparing against a figure the user just
  /// typed themselves is not detection. A switch that promises a feature and
  /// delivers none is the same defect class as copy that claims one, so it is
  /// gone rather than left looking live. The pref key stays in `SettingsState`
  /// so any persisted value round-trips harmlessly.
  static const List<String> _toggleKeys = <String>[
    'alerts',
    'unused',
    'weekly',
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final SettingsState settings = ref.watch(settingsControllerProvider);
    final SettingsController controller = ref.read(
      settingsControllerProvider.notifier,
    );
    final ThemeMode mode = ref.watch(themeModeProvider);
    // WATCHED as a stream, not read off `currentUser`: the profile row shows a
    // value the user can edit from this very screen, and a snapshot read would
    // go on showing the old name after a successful save. [pipeline C-13], and
    // the anchor `assert-stamp-properties.mjs:766` names this exact expression.
    final core.AuthUser? user = ref.watch(authUserProvider).valueOrNull;
    final String runningVersion =
        ref.watch(packageVersionProvider).valueOrNull ?? AppConfig.appVersion;

    final List<List<String>> toggles = <List<String>>[
      <String>['alerts', l10n.prefRenewalAlerts, l10n.prefRenewalAlertsDesc],
      <String>['unused', l10n.prefUnusedPlans, l10n.prefUnusedPlansDesc],
      <String>['weekly', l10n.prefWeeklyDigest, l10n.prefWeeklyDigestDesc],
    ];
    assert(
      toggles.map((List<String> t) => t[0]).toList().toString() ==
          _toggleKeys.toString(),
      'the rendered toggles must be exactly the declared pref keys — home reads '
      "prefs['unused'] and a silently dropped row severs that coupling",
    );

    // 🔴 A `Scaffold`, BUT TRANSPARENT AND WITHOUT AN `AppBar`, and both halves
    // of that are deliberate.
    //
    // The Scaffold is REQUIRED: `test/responsive_width_test.dart` pumps this
    // screen as `MaterialApp.home` with nothing around it, and every `ListTile`,
    // `SwitchListTile`, `RadioListTile`, `SegmentedButton` and `AboutListTile`
    // below asserts on a `Material` ancestor. The stamped file got one for free
    // from its own Scaffold; the live file was a bare `ListView` that only ever
    // rendered inside `AppShell`'s Scaffold.
    //
    // The AppBar is DROPPED and the background made transparent because this
    // screen is a BRANCH of `AppShell`, which paints `AppColors.bg` and floats
    // its own nav bar over the content. An opaque nested Scaffold would repaint
    // the shell's background and an AppBar would land on top of the demo-data
    // banner. The stamp's `l10n.settingsTitle` is not lost — it is the in-list
    // heading below, which is where Subly has always drawn it.
    return Scaffold(
      backgroundColor: Colors.transparent,
      // 🔴 NO `padding:` ON THE PANE. `responsive_width_test` asserts the
      // ListView is OFFERED exactly 375 at phone width and exactly
      // `AppBreakpoints.kMaxBodyWidth` at 1920; a pane inset would subtract from
      // both. The gutters stay where they always were — inside the ListView.
      body: ContentPane(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(18, 58, 18, 108),
          children: <Widget>[
            Text(
              l10n.settingsTitle,
              style: AppText.title.copyWith(fontSize: 26),
            ),
            const SizedBox(height: 16),

            // ── PROFILE ──────────────────────────────────────────────────────
            // Only when there is an account. Offering "edit your name" to a
            // signed-out user is an offer the app cannot honour — the same
            // reason the deletion entry is gated further down.
            //
            // The live avatar card, now TAPPABLE: the chevron on the right has
            // pointed at nothing since the screen was written.
            if (user != null)
              // Merged + `button:` and NO `label:`. The card already contains
              // the display name and the email as text, which is exactly what a
              // reader should hear; what it lacked was the ROLE — a bare
              // `GestureDetector` announces nothing about being activatable, so
              // the pencil glyph on the right was the only hint the row does
              // anything, and a glyph is not a channel a screen reader has.
              // Merging is what turns "Rajasekar" / "raj@…" / (silent icon)
              // from three stops into one.
              MergeSemantics(
                child: Semantics(
                  button: true,
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () => _editProfile(context, ref, l10n, user),
                    child: Container(
                      padding: const EdgeInsets.all(16),
                      decoration: cardDecoration(context),
                      child: Row(
                        children: <Widget>[
                          // The initial again — decorative for the reason
                          // `home_screen.dart`'s avatar records, and here it is
                          // even plainer: the display name is the very next
                          // widget.
                          ExcludeSemantics(
                            child: Container(
                              width: 52,
                              height: 52,
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                gradient: AppColors.brandGradient,
                                borderRadius: BorderRadius.circular(16),
                              ),
                              child: Text(
                                user.initial,
                                style: const TextStyle(
                                  fontFamily: 'Manrope',
                                  fontWeight: FontWeight.w800,
                                  fontSize: 20,
                                  color: Colors.white,
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: <Widget>[
                                // No tier is shown, deliberately. This read
                                // '· Pro plan' as a HARDCODED string — not
                                // derived from `isPro`, so every user saw it
                                // regardless of entitlement, for a tier that is
                                // not sold and gates nothing (`PaywallGate` has
                                // no consumers). A paid-tier claim is the
                                // category Apple's accurate-metadata rule and
                                // Google's deceptive-behaviour policy scrutinise
                                // hardest, and Paddle reviews the site against
                                // the product. Restore a tier line only when a
                                // real entitlement backs it.
                                Text(
                                  (user.displayName == null ||
                                          user.displayName!.isEmpty)
                                      ? l10n.displayNameNotSet
                                      : user.displayName!,
                                  style: AppText.body.copyWith(
                                    fontWeight: FontWeight.w800,
                                    fontSize: 16,
                                  ),
                                ),
                                Text(
                                  user.email,
                                  style: AppText.muted.copyWith(fontSize: 13),
                                ),
                              ],
                            ),
                          ),
                          const Icon(
                            Icons.edit_outlined,
                            color: AppColors.muted,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),

            // ── APPEARANCE ───────────────────────────────────────────────────
            // [pipeline C-16] The on-switch for the persisted themeMode. A stored
            // preference with no control is a dead setting — the same shape as
            // the consent recorder that had no prompt and silently discarded
            // every event. Shipped together, or not at all.
            _sectionLabel(l10n.appearance),
            SegmentedButton<ThemeMode>(
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

            // ── LANGUAGE ─────────────────────────────────────────────────────
            // Language names are shown in their OWN language, so a speaker can
            // find theirs without first being able to read the current one.
            _sectionLabel(l10n.language),
            Container(
              decoration: cardDecoration(context),
              clipBehavior: Clip.antiAlias,
              child: Material(
                color: Colors.transparent,
                child: RadioGroup<String>(
                  groupValue: ref.watch(localeProvider)?.languageCode ?? '',
                  onChanged: (String? code) => ref
                      .read(localeProvider.notifier)
                      .set(
                        (code == null || code.isEmpty) ? null : Locale(code),
                      ),
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
              ),
            ),

            // ── CURRENCY (live-only) ─────────────────────────────────────────
            _sectionLabel(l10n.currency),
            Row(
              children: <String>['\$', '€', '£', '₹'].map((String sym) {
                final bool sel = settings.currencySymbol == sym;
                return Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(right: 8),
                    // ⚠️ FOUR CHIPS OF WHICH EXACTLY ONE IS ON, AND THE ONLY
                    // THING THAT SAID SO WAS THE GRADIENT. `selected:` is the
                    // load-bearing half here — without it a reader hears four
                    // identical currency symbols and cannot tell which one the
                    // app is using, which is the same defect as the nav pill's
                    // and has the same fix.
                    //
                    // No `label:`: the symbol IS the datum, and it is already
                    // the chip's own `Text`.
                    child: MergeSemantics(
                      child: Semantics(
                        button: true,
                        selected: sel,
                        child: GestureDetector(
                          onTap: () => controller.setCurrency(sym),
                          child: Container(
                            padding: const EdgeInsets.symmetric(vertical: 13),
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              gradient: sel ? AppColors.brandGradient : null,
                              color: sel ? null : AppColors.surface,
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(
                                color: sel
                                    ? Colors.transparent
                                    : AppColors.line,
                              ),
                            ),
                            child: Text(
                              sym,
                              style: AppText.fig.copyWith(
                                fontSize: 16,
                                color: sel ? Colors.white : AppColors.ink,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),

            // ── PREFERENCES (live-only) ──────────────────────────────────────
            _sectionLabel(l10n.preferences),
            Container(
              decoration: cardDecoration(context),
              clipBehavior: Clip.antiAlias,
              child: Column(
                children: <Widget>[
                  for (int i = 0; i < toggles.length; i++)
                    Container(
                      decoration: BoxDecoration(
                        border: Border(
                          bottom: BorderSide(
                            color: i == toggles.length - 1
                                ? Colors.transparent
                                : AppColors.line,
                          ),
                        ),
                      ),
                      child: _prefRow(
                        toggles[i][1],
                        toggles[i][2],
                        settings.prefs[toggles[i][0]] ?? false,
                        () => controller.toggle(toggles[i][0]),
                      ),
                    ),
                ],
              ),
            ),

            // ── NOTIFICATIONS (chassis) ──────────────────────────────────────
            // [pipeline C-7 earning its keep in real UI] The platform matrix is
            // consulted BEFORE a control is offered. On Linux the plugin shows
            // but cannot schedule; on Windows (pinned 17.x) it does neither. A
            // toggle that silently does nothing on those platforms is worse than
            // an honest sentence, because the user believes reminders are on.
            //
            // ⚠️ THIS IS THE OS-LEVEL REMINDER SWITCH AND IT IS NOT THE SAME
            // THING AS "Renewal alerts" ABOVE. The pref above says WHETHER Subly
            // wants to remind you about a renewal; this says whether this
            // platform can deliver a scheduled notification at all. Merging them
            // would be the toggle-with-no-feature shape on every platform where
            // `canSchedule` is false.
            _sectionLabel(l10n.notifications),
            Container(
              decoration: cardDecoration(context),
              clipBehavior: Clip.antiAlias,
              child: Material(
                color: Colors.transparent,
                child: Builder(
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
              ),
            ),

            // ── PRIVACY — THE DPDP §6(3) WITHDRAWAL PATH (live-only) ─────────
            //
            // 🔴 THE ROW A WHOLESALE APPLY DELETES WITH NOTHING GOING RED.
            // `privacy.html` promises the user can turn this off in Settings
            // without contacting us, so this row is what makes that promise
            // true — and it is the same `record()` call the first-run prompt
            // makes, with `granted` flipped. Withdrawal is a NEW append-only
            // artifact, never an edit of the old one.
            //
            // `assert-seams-wired.mjs:171` stays green without it because
            // `consent_prompt.dart:70` is also a caller, and
            // `consent_withdrawal_test.dart:59` pumps its own harness rather
            // than this screen. P2.7 owes a guard that names THIS file.
            _sectionLabel(l10n.privacy),
            Container(
              decoration: cardDecoration(context),
              clipBehavior: Clip.antiAlias,
              child: _prefRow(
                l10n.usageStatistics,
                ref.watch(analyticsConsentProvider) ==
                        core.ConsentStatus.granted
                    ? l10n.usageStatisticsOn
                    : l10n.usageStatisticsOff,
                ref.watch(analyticsConsentProvider) ==
                    core.ConsentStatus.granted,
                () => recordAnalyticsConsent(
                  ref,
                  granted:
                      ref.read(analyticsConsentProvider) !=
                      core.ConsentStatus.granted,
                ),
              ),
            ),

            // ── SUBSCRIPTION ([pipeline 5]M-6 · M-9) ─────────────────────────
            //
            // 🔴 THE TWO ENTRY POINTS SIT SIDE BY SIDE ON PURPOSE. ROSCA's rule
            // is that cancelling must be no harder than subscribing, and the
            // cheapest way to be sure of that is to reach both from the same
            // place, one tap each. A cancel path buried a level deeper than the
            // upgrade path is the specific pattern the rule exists to stop.
            // `assert-purchase-path.mjs:458` reads this file for both
            // `context.go` calls — today only against the brick, but Phase 5
            // drops the `apps/subly` exemption.
            //
            // Gated on a session because both terminate in a call keyed to an
            // account.
            if (ref.watch(authRepositoryProvider).currentUser !=
                null) ...<Widget>[
              _sectionLabel(l10n.plan),
              Container(
                decoration: cardDecoration(context),
                clipBehavior: Clip.antiAlias,
                child: Column(
                  children: <Widget>[
                    _LinkRow(
                      icon: '★',
                      label: l10n.paywallUpgrade,
                      last: false,
                      onTap: () => context.go('/paywall'),
                    ),
                    _LinkRow(
                      icon: '≡',
                      label: l10n.managePlanTitle,
                      last: true,
                      onTap: () => context.go('/manage-plan'),
                    ),
                  ],
                ),
              ),
            ],

            // ── ACCOUNT & DATA (live-only rows) ──────────────────────────────
            const SizedBox(height: 22),
            Container(
              decoration: cardDecoration(context),
              clipBehavior: Clip.antiAlias,
              child: Column(
                children: <Widget>[
                  // Not yet wired — see the OPEN QUESTION in MANIFEST.md. Kept
                  // because deleting it is a product decision, not a merge one.
                  _LinkRow(
                    icon: '⇄',
                    label: l10n.connectedAccounts,
                    last: false,
                  ),
                  // 🔴 DO NOT DELETE THIS ROW IN A MERGE. `data-safety.json`
                  // declares that a user can export their data; removing the
                  // only surface that says so turns a store declaration into a
                  // false one, and no test anywhere references this row.
                  _LinkRow(icon: '⇩', label: l10n.exportDataCsv, last: false),
                  // The published contact PAGE — a form, reachable without a
                  // mail client, which is the route most web users take. The
                  // chassis-mandated mailto (E1) is the separate row in the
                  // legal card below; both exist because they fail in different
                  // conditions.
                  _LinkRow(
                    icon: '?',
                    label: l10n.helpAndSupport,
                    last: true,
                    onTap: () => openExternalUrl(AppConfig.contactUrl),
                  ),
                ],
              ),
            ),

            // ── LEGAL (chassis). Both stores require these to be reachable
            //    IN-APP, not only from a store listing. [pipeline C-13]
            const SizedBox(height: 12),
            Container(
              decoration: cardDecoration(context),
              clipBehavior: Clip.antiAlias,
              child: Column(
                children: <Widget>[
                  _LinkRow(
                    icon: '§',
                    label: l10n.privacyPolicy,
                    last: false,
                    onTap: () => openExternalUrl(AppConfig.privacyUrl),
                  ),
                  _LinkRow(
                    icon: '¶',
                    label: l10n.termsOfService,
                    last: false,
                    onTap: () => openExternalUrl(AppConfig.termsUrl),
                  ),
                  // [pipeline 8]K-6. The third published legal page, and the one
                  // that was missing: the site publishes privacy, terms AND
                  // refund, the brick linked the first two, and nothing compared
                  // the sets. A refund policy a buyer cannot reach from inside
                  // the app they bought in is the page a store reviewer looks
                  // for first when a charge is disputed.
                  _LinkRow(
                    icon: '₹',
                    label: l10n.refundPolicy,
                    last: false,
                    onTap: () => openExternalUrl(AppConfig.refundUrl),
                  ),
                  // The chassis support route (E1). A `mailto:` with the subject
                  // pre-filled, so a bug report arrives already labelled.
                  _LinkRow(
                    icon: '✉',
                    label: l10n.contactSupport,
                    subtitle: AppConfig.supportEmail,
                    last: true,
                    onTap: _contactSupport,
                  ),
                ],
              ),
            ),

            // ── OPEN-SOURCE LICENCES ([pipeline 8]K-11) ──────────────────────
            //
            // 🔴 THE BRICK HAD A LICENCES SURFACE AND THE ONE SHIPPING APP DID
            // NOT. Several packages this app ships (and the MaterialIcons font
            // that `uses-material-design: true` bundles) carry attribution
            // obligations discharged by DISPLAYING the notice, and both stores
            // may ask for evidence of rights on demand. The answer has to be a
            // screen, not a search.
            //
            // TWO tiles, and they are not redundant. The About tile is the
            // chassis one and carries the RUNNING VERSION — the single fact a
            // support mail is worthless without — and reaches the licences via
            // the framework's own "View licenses" button, i.e. two taps. The
            // dedicated tile below is one tap, which is what K-11 asks for.
            // `LicensePage` reads `LicenseRegistry`, which every package
            // registers into automatically, so both stay correct as dependencies
            // change instead of being a list somebody must remember to update.
            const SizedBox(height: 12),
            Container(
              decoration: cardDecoration(context),
              clipBehavior: Clip.antiAlias,
              // The Material is REQUIRED, not decoration. `ListTile` paints its
              // background and ink splashes on the nearest Material ancestor,
              // and `cardDecoration()` puts a DecoratedBox in between — Flutter
              // asserts on exactly that, which turned four delete-account tests
              // red.
              child: Material(
                color: Colors.transparent,
                child: Column(
                  children: <Widget>[
                    ListTile(
                      leading: const Icon(Icons.copyright_outlined),
                      title: Text(l10n.openSourceLicences),
                      onTap: () => showLicensePage(
                        context: context,
                        applicationName: AppConfig.appName,
                        applicationVersion: runningVersion,
                        applicationLegalese: l10n.legalese,
                      ),
                    ),
                    // 🔴 [pipeline C-13] `applicationVersion` WAS MISSING from
                    // the brick, and the register row for this screen has always
                    // promised "version and legalese". Flutter does not complain:
                    // `showAboutDialog` simply renders no version line, so the
                    // dialog looked complete and told a user reporting a bug
                    // nothing about WHICH BUILD they were running.
                    //
                    // The RUNNING version, not the compiled-in constant:
                    // `AppConfig.appVersion` is a `String.fromEnvironment`
                    // default that a build which forgot `--dart-define` would
                    // report as the truth. `packageVersionProvider` reads what is
                    // actually installed and falls back to the constant only
                    // while the plugin resolves (and on platforms where it
                    // cannot), exactly as the force-update gate does.
                    AboutListTile(
                      icon: const Icon(Icons.info_outline),
                      applicationName: AppConfig.appName,
                      applicationVersion: runningVersion,
                      applicationLegalese: l10n.legalese,
                      child: Text(l10n.about),
                    ),
                  ],
                ),
              ),
            ),

            const SizedBox(height: 14),
            // 🔴 SIGN OUT AND NAVIGATE NOWHERE. The router owns this, and it is
            // the only thing that can own it correctly.
            //
            // This used to `await signOut()` and then `context.go('/onboarding')`,
            // which raced the router's own redirect. gotrue notifies its
            // subscribers of `signedOut` BEFORE awaiting `POST /logout`, so the
            // auth stream fires first and the router sends /settings → /login;
            // the awaited continuation then resumed and pushed /onboarding on
            // top. And because `/onboarding` sits inside the router's `authFlow`
            // allowlist, the redirect does NOT correct it — so a user who tapped
            // Log out was left in the first-run marketing carousel and had to tap
            // Skip to reach the login form.
            //
            // ⚠️ The nightly E2E polled for 'Welcome back' and returned on the
            // first match, so it could pass on the /login frame the app was
            // merely passing THROUGH. `test/sign_out_destination_test.dart`
            // asserts after a settle instead, at two different logout latencies —
            // and it taps `find.text('Log out')`, which is why the label is
            // `l10n.logOut` ("Log out") and not the chassis `l10n.signOut`
            // ("Sign out").
            SoftButton(
              label: l10n.logOut,
              color: AppColors.danger,
              onPressed: () => ref.read(authRepositoryProvider).signOut(),
            ),

            // ── DELETE ACCOUNT ───────────────────────────────────────────────
            //
            // 🔴 [ADR 027] BOTH STORES REQUIRE AN IN-APP DELETION PATH WHEREVER
            // AN ACCOUNT CAN BE CREATED.
            //
            // BELOW "Log out", deliberately, and the order is the point: logging
            // out is the action a user wants hundreds of times more often, and
            // putting the irreversible one first invites a misfire. It is gated
            // on a session for the same reason the profile block is — offering
            // "delete your account" to a signed-out user is an offer the app
            // cannot honour.
            //
            // ⚠️ GATED ON `authRepositoryProvider.currentUser`, NOT ON `user`
            // ABOVE. `delete_account_test.dart` overrides the repository with a
            // fake whose `currentUser` flips synchronously; `authUserProvider` is
            // a StreamProvider whose first frame is `loading`, so gating on it
            // would hide this control on the frame the test taps.
            if (ref.watch(authRepositoryProvider).currentUser !=
                null) ...<Widget>[
              const SizedBox(height: 10),
              SoftButton(
                // 🔑 KEYED, and not for tidiness. This button's label IS
                // `l10n.deleteAccount`, and so is the destructive button inside
                // the dialog it opens — so `find.text('Delete account')` matches
                // one widget before the tap and TWO after it. The live E2E has
                // to tell them apart at exactly that moment, and a finder that
                // silently resolves to `.first` would tap whichever the tree
                // happened to order first. [pipeline N-6 leg 6]
                key: E2EKeys.settingsDeleteAccount,
                label: l10n.deleteAccount,
                color: AppColors.danger,
                onPressed: () => _confirmDelete(context, ref, l10n),
              ),
            ],

            const SizedBox(height: 22),
            const Center(child: PoweredByNikatru()),
            const SizedBox(height: 12),
            Center(
              child: Text(
                // The RUNNING version here too. This line used to read a
                // hardcoded 'v1.0' while the pubspec said 1.0.0+1 — a version
                // string that is wrong the first time anybody ships a patch.
                l10n.versionFooter(
                  AppConfig.appName,
                  runningVersion,
                  AppConfig.companyName,
                ),
                style: AppText.muted.copyWith(fontSize: 11),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// The uppercase section heading Subly draws above each card.
  static Widget _sectionLabel(String text) => Padding(
    padding: const EdgeInsets.fromLTRB(2, 22, 2, 8),
    child: Text(text.toUpperCase(), style: AppText.label),
  );

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
  /// scheduling lives in `RemindersEnabledController.applyReminderChoice` so it
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
  /// model". There is: every identity provider worth using stores user metadata,
  /// and Supabase's gotrue exposes `updateUser` for exactly this. The original
  /// reason described a field nothing wrote and concluded from that that it
  /// could never be written.
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
      // Says plainly that nothing changed. "Saved" on a failed write is the kind
      // of lie the user only discovers on their next launch.
      nav.pop();
      messenger.showSnackBar(SnackBar(content: Text(l10n.profileUpdateFailed)));
    }
  }

  /// The confirmation step. Split into its own widget for the reason the brick
  /// records: a confirm action only reachable through a tap on a tile is one
  /// nobody writes a test for, which is how a dead delete button survives.
  ///
  /// IT CANNOT BE TRIGGERED ACCIDENTALLY. Two independent things must happen —
  /// the destructive button is DISABLED until a password has been typed, and the
  /// password is then used to RE-AUTHENTICATE through the same seam sign-in
  /// uses. Deletion is irreversible, so a borrowed or unattended device must not
  /// be enough to destroy an account.
  ///
  /// ⚠️ THE CONTROLLER IS CREATED HERE, NOT IN THE DIALOG, so the confirm
  /// callback can be the zero-argument closure
  /// `assert-stamp-properties.mjs:728` anchors (`onConfirm: () =>
  /// _deleteAccount(`). The dialog still owns its DISPOSAL — it is the last
  /// reader, and the closure only touches `.text` while the dialog is mounted.
  void _confirmDelete(
    BuildContext context,
    WidgetRef ref,
    AppLocalizations l10n,
  ) {
    final TextEditingController password = TextEditingController();
    showDialog<void>(
      context: context,
      // 🔴 NOT DISMISSIBLE, and the dialog also refuses a system back/Escape
      // while the request is in flight (`PopScope` below). On desktop and web
      // Escape closes a dialog and on Android the back gesture does, so a stray
      // input would look exactly like a cancelled deletion while the request
      // carried on — on the five platforms this is least likely to be tried by
      // hand.
      barrierDismissible: false,
      builder: (BuildContext dialogContext) => _DeleteAccountDialog(
        l10n: l10n,
        password: password,
        onConfirm: () => _deleteAccount(ref, password.text),
      ),
    );
  }

  /// Runs the real path and returns WHAT ACTUALLY HAPPENED.
  ///
  /// 🔴 IT RETURNS AN OUTCOME RATHER THAN A BOOL, and that is the whole point.
  /// `DELETE /v1/account` answers 501 when the server cannot delete the identity
  /// record (nothing was deleted) and 502 when the rows went and the identity did
  /// not (the data is gone and the login still works). A `catch (_)` that prints
  /// one message collapses those into each other, and the 502 case is the one a
  /// user can never discover for themselves.
  ///
  /// Nothing here invents a turnaround time, a retention period or a legal
  /// statement — `sites/nikatru/delete-account.html` deliberately publishes none.
  Future<core.AccountDeletionOutcome> _deleteAccount(
    WidgetRef ref,
    String password,
  ) async {
    final AuthRepository auth = ref.read(authRepositoryProvider);
    final AuthUser? user = auth.currentUser;
    core.AccountDeletionOutcome outcome;
    String? detail;
    try {
      if (user == null) throw core.AuthFailure('Not signed in');
      // Re-authenticate through the SAME seam sign-in uses, so it works against
      // whatever identity provider is wired.
      await auth.signInWithEmail(email: user.email, password: password);
      try {
        await auth.deleteAccount();
        outcome = core.AccountDeletionOutcome.deleted;
      } catch (e) {
        // `accountDeletionOutcomeOf` resolves an unrecognised error to `unknown`
        // rather than to a refusal shape this screen invented — an error nobody
        // modelled is exactly the case where how far the deletion got is unknown.
        outcome = core.accountDeletionOutcomeOf(e);
        // 🔴 KEEP THE ERROR ITSELF. Until 2026-08-09 this line did not exist and
        // `e` was discarded here — so `unknown` arrived at the screen with the
        // one fact that explains it already thrown away. Parked, not rendered in
        // release: see [lastAccountDeletionDetailProvider].
        detail = '$e';
      }
    } on core.AuthFailure {
      // The provider REFUSED the credentials. Nothing was sent, nothing was
      // deleted, and — unlike every server-side refusal — the session is
      // untouched, which is why this is not `nothingDeleted` (whose message says
      // the user was signed out).
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
    // login screen renders whatever is left here. Measured: without this the
    // result widget is GONE by the time the redirect settles.
    ref.read(lastAccountDeletionOutcomeProvider.notifier).state = outcome;
    ref.read(lastAccountDeletionDetailProvider.notifier).state = detail;
    return outcome;
  }

  Widget _prefRow(String label, String desc, bool value, VoidCallback onTap) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  label,
                  style: AppText.body.copyWith(
                    fontWeight: FontWeight.w700,
                    fontSize: 14,
                  ),
                ),
                Text(desc, style: AppText.muted.copyWith(fontSize: 12)),
              ],
            ),
          ),
          _Toggle(value: value, onTap: onTap, semanticLabel: label),
        ],
      ),
    );
  }
}

/// The sentence for each way a deletion can fail, in the app's own language.
///
/// TOP-LEVEL AND PUBLIC so `test/chassis_properties_test.dart` can assert on it
/// directly: a mapping only reachable through a dialog is one nobody tests, and
/// the whole defect this replaces was invisible for exactly that reason. That
/// test loads the `en` delegate and requires FOUR DISTINCT sentences for
/// 501/502/503/no-status.
///
/// ⚠️ TWO MAPPINGS EXIST FOR ONE FACT, AND THAT IS A KNOWN DEBT, NOT A DESIGN.
/// The dialog below renders `outcome.plainMessage` from `packages/core` rather
/// than this function, because `delete_account_test.dart` pins core's exact
/// wording (`'sign-in was NOT'` is case-sensitive there and the `.arb` says
/// "was not"; `reauthFailed` has no matching key at all). Collapsing them is a
/// Phase-4 item: make the `.arb` values byte-identical to `plainMessage`, then
/// this function becomes the single source and `plainMessage` loses its UI role.
/// Recorded here rather than in a note because the next person to read this file
/// will otherwise "tidy" one of the two away.
///
/// ⚠️ NO TURNAROUND TIME, RETENTION PERIOD OR LEGAL STATEMENT appears in any of
/// these strings, because `sites/nikatru/delete-account.html` publishes none —
/// an app promising one would be committing the business to it.
String deleteAccountFailureMessage(
  AppLocalizations l10n,
  core.AccountDeletionOutcome outcome,
) {
  switch (outcome) {
    // Cannot happen on this path — stated rather than defaulted, so adding an
    // outcome to the chassis is a compile error here instead of a silently wrong
    // sentence.
    case core.AccountDeletionOutcome.deleted:
      return l10n.deleteAccountFailed;
    // 501 — the route refused BEFORE touching anything, because it cannot remove
    // the identity record (`SUPABASE_SERVICE_ROLE_KEY` is an owner action).
    // Nothing was deleted, and that is safe to say.
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
class _EditProfileDialog extends StatefulWidget {
  const _EditProfileDialog({
    required this.l10n,
    required this.name,
    required this.onSave,
  });

  final AppLocalizations l10n;
  final TextEditingController name;
  final VoidCallback onSave;

  @override
  State<_EditProfileDialog> createState() => _EditProfileDialogState();
}

class _EditProfileDialogState extends State<_EditProfileDialog> {
  // Stateful only to own the disposal. The stamped version leaks the controller
  // on every open; a screen a user visits repeatedly is the wrong place to do
  // that.
  @override
  void dispose() {
    widget.name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: AppColors.surface,
      title: Text(widget.l10n.editProfile),
      content: TextField(
        key: const Key('editProfileName'),
        controller: widget.name,
        autofocus: true,
        textCapitalization: TextCapitalization.words,
        decoration: InputDecoration(labelText: widget.l10n.displayName),
        onSubmitted: (_) => widget.onSave(),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(widget.l10n.cancel),
        ),
        FilledButton(
          key: const Key('editProfileSave'),
          onPressed: widget.onSave,
          child: Text(widget.l10n.save),
        ),
      ],
    );
  }
}

/// The irreversible confirmation, and then THE HONEST ANSWER, in one place.
///
/// 🔴 THE RESULT IS SHOWN IN THIS DIALOG RATHER THAN IN A SNACKBAR, and that is
/// not styling. `deleteAccount()` signs out whichever way the request went, and
/// a sign-out flips the router straight to `/login` — a `SnackBar` posted to the
/// settings screen's `ScaffoldMessenger` would be raced by the teardown of the
/// very screen that owns it. The one message a user must not miss is the one
/// saying their data is gone and their login is not.
///
/// 🔑 FOUR KEYS, DRIVEN BY `test/delete_account_test.dart` AND — since
/// [pipeline N-6 leg 6] — BY THE LIVE `integration_test/app_test.dart` TOO.
/// Renaming any of them silently disarms both:
///   · `deleteAccountPassword`    — the password field
///   · `deleteAccountConfirm`     — the destructive button, inert until typed
///   · `deleteAccountResult`      — the outcome sentence
///   · `deleteAccountResultTitle` — "Account deleted" / "Not deleted"
///
/// ⚠️ THEY ARE NOW DECLARED IN `core/e2e_keys.dart` AND THEIR VALUES DID NOT
/// CHANGE. `Key` compares by value, so the eleven literal
/// `const Key('deleteAccountConfirm')` finders in the widget test still resolve
/// to these widgets — the hoist gives the two suites ONE declaration to share
/// without renaming a live test contract. The line numbers this comment used to
/// carry are gone on purpose: they were pointers into a file other people edit,
/// and nothing recomputed them.
class _DeleteAccountDialog extends StatefulWidget {
  const _DeleteAccountDialog({
    required this.l10n,
    required this.password,
    required this.onConfirm,
  });

  final AppLocalizations l10n;

  /// Owned by the caller so `onConfirm` can be the zero-argument closure the
  /// stamp-properties anchor names; disposed here, the last reader.
  final TextEditingController password;

  /// Runs the real deletion and reports what happened.
  final Future<core.AccountDeletionOutcome> Function() onConfirm;

  @override
  State<_DeleteAccountDialog> createState() => _DeleteAccountDialogState();
}

class _DeleteAccountDialogState extends State<_DeleteAccountDialog> {
  bool _busy = false;
  core.AccountDeletionOutcome? _outcome;

  @override
  void dispose() {
    widget.password.dispose();
    super.dispose();
  }

  Future<void> _run() async {
    setState(() => _busy = true);
    final core.AccountDeletionOutcome outcome = await widget.onConfirm();
    if (!mounted) return;
    setState(() {
      _busy = false;
      _outcome = outcome;
    });
  }

  @override
  Widget build(BuildContext context) {
    final core.AccountDeletionOutcome? outcome = _outcome;
    // Nothing may dismiss this while the request is in flight — a stray Escape
    // or back gesture would look exactly like a cancelled deletion.
    if (outcome != null) {
      return PopScope(canPop: true, child: _result(context, outcome));
    }
    return PopScope(canPop: !_busy, child: _form(context));
  }

  Widget _form(BuildContext context) {
    final AppLocalizations l10n = widget.l10n;
    return AlertDialog(
      backgroundColor: AppColors.surface,
      title: Text(l10n.deleteAccountConfirmTitle),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(l10n.deleteAccountConfirmBody, style: AppText.body),
          const SizedBox(height: 14),
          Text(l10n.deleteAccountReauthHint, style: AppText.muted),
          const SizedBox(height: 8),
          TextField(
            key: E2EKeys.deleteAccountPassword,
            controller: widget.password,
            obscureText: true,
            enabled: !_busy,
            // The button below is disabled until this is non-empty, so the
            // destructive action cannot be reached by a stray tap.
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(labelText: l10n.deleteAccountPassword),
          ),
        ],
      ),
      actions: <Widget>[
        TextButton(
          onPressed: _busy ? null : () => Navigator.pop(context),
          child: Text(l10n.cancel),
        ),
        FilledButton(
          key: E2EKeys.deleteAccountConfirm,
          style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
          onPressed: (_busy || widget.password.text.isEmpty) ? null : _run,
          child: Text(_busy ? l10n.deletingEllipsis : l10n.deleteAccount),
        ),
      ],
    );
  }

  /// WHAT ACTUALLY HAPPENED, in the outcome's own words.
  ///
  /// The sentence comes from `packages/core` so that no app can invent a kinder
  /// one, and the only path that offers an email route is the one where the
  /// account is still there. See the note on [deleteAccountFailureMessage] for
  /// why this is `plainMessage` and not the l10n mapping.
  Widget _result(BuildContext context, core.AccountDeletionOutcome outcome) {
    final AppLocalizations l10n = widget.l10n;
    return AlertDialog(
      backgroundColor: AppColors.surface,
      title: Text(
        outcome.accountIsGone
            ? l10n.deleteAccountResultGone
            : l10n.deleteAccountResultNotDeleted,
        key: E2EKeys.deleteAccountResultTitle,
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            outcome.plainMessage,
            key: E2EKeys.deleteAccountResult,
            style: AppText.body,
          ),
          // 🔴 THE EMAIL ROUTE ON EVERY FAILURE, INCLUDING reauthFailed — and
          // that inclusion is not tidiness. Re-auth is `signInWithEmail`, and an
          // account created through "Continue with Apple" has NO PASSWORD here,
          // so the in-app path cannot confirm it and the person Apple's rule is
          // most about would otherwise be left with a dead end. Fixing that
          // properly needs the identity seam to report which provider an account
          // uses, which is chassis work and is a named follow-up in [ADR 027];
          // until then the address is on screen rather than absent.
          if (!outcome.accountIsGone) ...<Widget>[
            const SizedBox(height: 12),
            // No turnaround time is stated here because none is published.
            Text(
              l10n.deleteAccountEmailRoute(AppConfig.supportEmail),
              style: AppText.muted,
            ),
          ],
        ],
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(l10n.close),
        ),
      ],
    );
  }
}

class _Toggle extends StatelessWidget {
  const _Toggle({
    required this.value,
    required this.onTap,
    required this.semanticLabel,
  });
  final bool value;
  final VoidCallback onTap;
  final String semanticLabel;

  @override
  Widget build(BuildContext context) {
    // 48x48 HIT AREA around the 46x28 visual — the chassis floor for a control
    // with no text of its own — and a label + toggled state for screen readers
    // (the row's texts sit BESIDE this control, not inside it, so without this
    // it announces nothing).
    return Semantics(
      button: true,
      toggled: value,
      label: semanticLabel,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: SizedBox(
          width: 48,
          height: 48,
          child: Center(
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              width: 46,
              height: 28,
              decoration: BoxDecoration(
                color: value ? AppColors.accent : const Color(0xFFE2E2EA),
                borderRadius: BorderRadius.circular(999),
              ),
              child: AnimatedAlign(
                duration: const Duration(milliseconds: 180),
                alignment: value ? Alignment.centerRight : Alignment.centerLeft,
                child: Container(
                  margin: const EdgeInsets.all(3),
                  width: 22,
                  height: 22,
                  decoration: const BoxDecoration(
                    color: Colors.white,
                    shape: BoxShape.circle,
                    boxShadow: <BoxShadow>[
                      BoxShadow(
                        color: Color(0x40000000),
                        blurRadius: 3,
                        offset: Offset(0, 1),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A row in one of the settings cards.
///
/// MERGE NOTE: the live version took a `url` and derived the tap from it, which
/// could only ever open a browser. It now takes an `onTap` so the same row shape
/// carries the in-app navigations (`/paywall`, `/manage-plan`) and the `mailto:`
/// as well. `onTap == null` still renders an inert row — which is what
/// "Connected accounts" and "Export data (CSV)" are until they are wired.
class _LinkRow extends StatelessWidget {
  const _LinkRow({
    required this.icon,
    required this.label,
    required this.last,
    this.subtitle,
    this.onTap,
  });
  final String icon;
  final String label;
  final String? subtitle;
  final bool last;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final String? sub = subtitle;
    return Container(
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: last ? Colors.transparent : AppColors.line),
        ),
      ),
      // ⚠️ `button:` IS CONDITIONAL, AND THAT IS THE HONEST HALF. This class's
      // own doc records that `onTap == null` renders an INERT row — "Connected
      // accounts" and "Export data (CSV)" are exactly that until they are wired
      // — and announcing "button" for a row that does nothing when activated
      // sends somebody tapping at a dead surface and blaming their reader.
      //
      // Merged so the label and its subtitle arrive as one stop rather than two,
      // matching the profile card above.
      child: MergeSemantics(
        child: Semantics(
          button: onTap != null,
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
              child: Row(
                children: <Widget>[
                  // 🔴 THE LEADING GLYPH IS AN EMOJI IN A `Text`, NOT AN `Icon`,
                  // WHICH IS WHY IT WAS AUDIBLE AT ALL. An `Icon` with no
                  // `semanticLabel` contributes nothing, so the chevron on the
                  // far right of this row has always been silent — correctly.
                  // This one is a real string, so a reader announced the
                  // emoji's CLDR name in front of every settings row ("locked
                  // with key, Privacy policy"). Same decorative rule as
                  // [GlyphTile]: the label beside it is the row.
                  ExcludeSemantics(
                    child: Container(
                      width: 34,
                      height: 34,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(10),
                        gradient: const LinearGradient(
                          colors: <Color>[
                            Color.fromRGBO(100, 89, 245, 0.13),
                            Color.fromRGBO(155, 107, 255, 0.13),
                          ],
                        ),
                      ),
                      child: Text(
                        icon,
                        style: const TextStyle(
                          color: AppColors.accent,
                          fontSize: 15,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          label,
                          style: AppText.body.copyWith(
                            fontWeight: FontWeight.w700,
                            fontSize: 14,
                          ),
                        ),
                        if (sub != null)
                          Text(
                            sub,
                            style: AppText.muted.copyWith(fontSize: 12),
                          ),
                      ],
                    ),
                  ),
                  const Icon(
                    Icons.chevron_right,
                    color: AppColors.muted,
                    size: 18,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
