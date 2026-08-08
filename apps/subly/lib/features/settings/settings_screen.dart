import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../core/config/app_config.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
// `auth_repository.dart` is the F0-4 re-export shim: it carries AuthRepository
// AND the AuthUser/AuthFailure types, so one import covers both.
import '../../data/auth/auth_repository.dart';
import '../../state/analytics_providers.dart';
import '../../state/providers.dart';
import '../../state/settings_controller.dart';
import '../shared/widgets.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  static const List<List<String>> _toggles = <List<String>>[
    <String>['alerts', 'Renewal alerts', 'Notify 2 days before charge'],
    <String>['unused', 'Unused plans', 'Flag subscriptions you don’t use'],
    <String>['weekly', 'Weekly digest', 'Sunday spending summary'],
  ];

  // 'priceHike' / 'Price-hike alerts' was REMOVED 2026-07-27, not wired.
  //
  // It was declared in settings_controller.dart and read nowhere, so the switch
  // did nothing. Unlike `alerts`, `unused` and `weekly` it cannot simply be
  // wired: detecting a price rise needs the PROVIDER's price to change, which
  // needs an external data source the app does not have. Comparing against a
  // figure the user just typed themselves is not detection.
  //
  // A switch that promises a feature and delivers none is the same defect class
  // as copy that claims one, so it is gone rather than left looking live. The
  // pref key stays in SettingsState so any persisted value round-trips harmlessly.

  // [icon, label, url] — url empty = in-app action (not yet wired), non-empty =
  // opens the live nikatru.com page in the browser.
  static const List<List<String>> _links = <List<String>>[
    <String>['⇄', 'Connected accounts', ''],
    <String>['⇩', 'Export data (CSV)', ''],
    <String>['?', 'Help & support', AppConfig.contactUrl],
    <String>['§', 'Privacy & terms', AppConfig.privacyUrl],
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final SettingsState settings = ref.watch(settingsControllerProvider);
    final SettingsController controller = ref.read(
      settingsControllerProvider.notifier,
    );
    final AuthUser? user = ref.watch(authRepositoryProvider).currentUser;

    return ListView(
      padding: const EdgeInsets.fromLTRB(18, 58, 18, 108),
      children: <Widget>[
        Text('Settings', style: AppText.title.copyWith(fontSize: 26)),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: cardDecoration(),
          child: Row(
            children: <Widget>[
              Container(
                width: 52,
                height: 52,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  gradient: AppColors.brandGradient,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Text(
                  user?.initial ?? 'A',
                  style: const TextStyle(
                    fontFamily: 'Manrope',
                    fontWeight: FontWeight.w800,
                    fontSize: 20,
                    color: Colors.white,
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      user?.displayName ?? 'Account',
                      style: AppText.body.copyWith(
                        fontWeight: FontWeight.w800,
                        fontSize: 16,
                      ),
                    ),
                    // No tier is shown, deliberately. This read '· Pro plan' as a
                    // HARDCODED string — not derived from `isPro`, so every user
                    // saw it regardless of entitlement, for a tier that is not
                    // sold and gates nothing (`PaywallGate` has no consumers).
                    // A paid-tier claim is the category Apple's accurate-metadata
                    // rule and Google's deceptive-behaviour policy scrutinise
                    // hardest, and Paddle reviews the site against the product.
                    // Restore a tier line only when a real entitlement backs it.
                    Text(
                      user?.email ?? '',
                      style: AppText.muted.copyWith(fontSize: 13),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: AppColors.muted),
            ],
          ),
        ),
        const Padding(
          padding: EdgeInsets.fromLTRB(2, 22, 2, 8),
          child: Text('CURRENCY', style: AppText.label),
        ),
        Row(
          children: <String>['\$', '€', '£', '₹'].map((String sym) {
            final bool sel = settings.currencySymbol == sym;
            return Expanded(
              child: Padding(
                padding: const EdgeInsets.only(right: 8),
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
                        color: sel ? Colors.transparent : AppColors.line,
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
            );
          }).toList(),
        ),
        const Padding(
          padding: EdgeInsets.fromLTRB(2, 22, 2, 8),
          child: Text('PREFERENCES', style: AppText.label),
        ),
        Container(
          decoration: cardDecoration(),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: <Widget>[
              for (int i = 0; i < _toggles.length; i++)
                Container(
                  decoration: BoxDecoration(
                    border: Border(
                      bottom: BorderSide(
                        color: i == _toggles.length - 1
                            ? Colors.transparent
                            : AppColors.line,
                      ),
                    ),
                  ),
                  child: _prefRow(
                    _toggles[i][1],
                    _toggles[i][2],
                    settings.prefs[_toggles[i][0]] ?? false,
                    () => controller.toggle(_toggles[i][0]),
                  ),
                ),
            ],
          ),
        ),
        const Padding(
          padding: EdgeInsets.fromLTRB(2, 22, 2, 8),
          child: Text('PRIVACY', style: AppText.label),
        ),
        // The DPDP §6(3) withdrawal path. `privacy.html` promises the user can
        // turn this off in Settings without contacting us, so this row is what
        // makes that promise true — and it is the same `record()` call the
        // first-run prompt makes, with granted flipped. Withdrawal is a NEW
        // append-only artifact, never an edit of the old one.
        Container(
          decoration: cardDecoration(),
          clipBehavior: Clip.antiAlias,
          child: _prefRow(
            'Usage statistics',
            ref.watch(analyticsConsentProvider) == core.ConsentStatus.granted
                ? 'On — helping us improve the app'
                : 'Off — nothing is being collected',
            ref.watch(analyticsConsentProvider) == core.ConsentStatus.granted,
            () => recordAnalyticsConsent(
              ref,
              granted:
                  ref.read(analyticsConsentProvider) !=
                  core.ConsentStatus.granted,
            ),
          ),
        ),
        const SizedBox(height: 12),
        Container(
          decoration: cardDecoration(),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: <Widget>[
              for (int i = 0; i < _links.length; i++)
                _LinkRow(
                  icon: _links[i][0],
                  label: _links[i][1],
                  url: _links[i][2],
                  last: i == _links.length - 1,
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        // ── OPEN-SOURCE LICENCES ([pipeline 8]K-11) ─────────────────────────
        //
        // 🔴 THE BRICK HAD THIS AND THE ONE SHIPPING APP DID NOT. Every app the
        // factory stamps is born with an `AboutListTile` into Flutter's own
        // `LicensePage`; `apps/subly` predates the brick and had ZERO licences
        // surface — `AboutListTile`, `showLicensePage`, `LicensePage` and
        // `LicenseRegistry` all had no match anywhere under `apps/subly/lib/`.
        //
        // This is not decoration. Several packages this app ships (and the
        // MaterialIcons font `uses-material-design: true` bundles) carry
        // attribution obligations that are discharged by DISPLAYING the notice,
        // and both stores may ask for evidence of rights on demand. The answer
        // has to be a screen, not a search.
        //
        // `LicensePage` is the framework's own aggregator: it reads
        // `LicenseRegistry`, which every package registers into automatically,
        // so this stays correct as dependencies change instead of being a list
        // somebody has to remember to update.
        Container(
          decoration: cardDecoration(),
          clipBehavior: Clip.antiAlias,
          // The Material is REQUIRED, not decoration. `ListTile` paints its
          // background and ink splashes on the nearest Material ancestor, and
          // `cardDecoration()` puts a DecoratedBox in between — Flutter asserts
          // on exactly that, which turned four delete-account tests red.
          child: Material(
            color: Colors.transparent,
            child: AboutListTile(
              icon: const Icon(Icons.copyright_outlined),
              applicationName: AppConfig.appName,
              applicationLegalese: '© ${AppConfig.companyName}',
              child: const Text('Open-source licences'),
            ),
          ),
        ),
        const SizedBox(height: 14),
        // 🔴 SIGN OUT AND NAVIGATE NOWHERE. The router owns this, and it is the
        // only thing that can own it correctly.
        //
        // This used to `await signOut()` and then `context.go('/onboarding')`,
        // which raced the router's own redirect. gotrue notifies its
        // subscribers of `signedOut` BEFORE awaiting `POST /logout`, so the auth
        // stream fires first and the router sends /settings → /login; the
        // awaited continuation then resumed and pushed /onboarding on top. And
        // because `/onboarding` sits inside the router's `authFlow` allowlist,
        // the redirect does NOT correct it — so a user who tapped Log out was
        // left in the first-run marketing carousel and had to tap Skip to reach
        // the login form. The handler was written that way from the initial
        // commit; it has always been wrong.
        //
        // The brick chassis never had this bug — it calls `signOut()` and stops
        // (`__brick__/…/settings_screen.dart`). Subly had forked from it.
        //
        // ⚠️ The nightly E2E polled for 'Welcome back' and returned on the first
        // match, so it could pass on the /login frame the app was merely passing
        // THROUGH — a screenshot from a *green* run shows the carousel sliding
        // in over the login screen. `test/sign_out_destination_test.dart` asserts
        // after a settle instead, at two different logout latencies.
        SoftButton(
          label: 'Log out',
          color: AppColors.danger,
          onPressed: () => ref.read(authRepositoryProvider).signOut(),
        ),
        // ── DELETE ACCOUNT ───────────────────────────────────────────────────
        //
        // 🔴 [ADR 027] BOTH STORES REQUIRE AN IN-APP DELETION PATH WHEREVER AN
        // ACCOUNT CAN BE CREATED, and this app had none: `deleteAccount()` was
        // an unconditional throw, so there was nothing honest to point a button
        // at and no button was drawn. `sites/nikatru/delete-account.html` had to
        // scope its own sentence around that absence.
        //
        // BELOW "Log out", deliberately, and the order is the point: logging out
        // is the action a user wants hundreds of times more often, and putting
        // the irreversible one first invites a misfire. It is gated on a session
        // for the same reason the profile block is — offering "delete your
        // account" to a signed-out user is an offer the app cannot honour.
        if (user != null) ...<Widget>[
          const SizedBox(height: 10),
          SoftButton(
            label: 'Delete account',
            color: AppColors.danger,
            onPressed: () => _confirmDelete(context, ref),
          ),
        ],
        const SizedBox(height: 22),
        const Center(child: PoweredByNikatru()),
        const SizedBox(height: 12),
        Center(
          child: Text(
            '${AppConfig.appName} v1.0 · © 2026 ${AppConfig.companyName}',
            style: AppText.muted.copyWith(fontSize: 11),
          ),
        ),
      ],
    );
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
  void _confirmDelete(BuildContext context, WidgetRef ref) {
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
        onConfirm: (String password) => _deleteAccount(ref, password),
      ),
    );
  }

  /// Runs the real path and returns WHAT ACTUALLY HAPPENED.
  ///
  /// 🔴 IT RETURNS AN OUTCOME RATHER THAN A BOOL, and that is the whole point.
  /// `DELETE /v1/account` answers 501 when the server cannot delete the identity
  /// record (nothing was deleted) and 502 when the rows went and the identity
  /// did not (the data is gone and the login still works). A `catch (_)` that
  /// prints one message collapses those into each other, and the 502 case is the
  /// one a user can never discover for themselves.
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
          _Toggle(value: value, onTap: onTap),
        ],
      ),
    );
  }
}

/// The irreversible confirmation, and then THE HONEST ANSWER, in one place.
///
/// 🔴 THE RESULT IS SHOWN IN THIS DIALOG RATHER THAN IN A SNACKBAR, and that is
/// not styling. `deleteAccount()` signs out whichever way the request went, and
/// a sign-out flips the router straight to `/onboarding` — a `SnackBar` posted
/// to the settings screen's `ScaffoldMessenger` would be raced by the teardown
/// of the very screen that owns it. The one message a user must not miss is the
/// one saying their data is gone and their login is not.
class _DeleteAccountDialog extends StatefulWidget {
  const _DeleteAccountDialog({required this.onConfirm});

  /// Runs the real deletion and reports what happened.
  final Future<core.AccountDeletionOutcome> Function(String password) onConfirm;

  @override
  State<_DeleteAccountDialog> createState() => _DeleteAccountDialogState();
}

class _DeleteAccountDialogState extends State<_DeleteAccountDialog> {
  final TextEditingController _password = TextEditingController();
  bool _busy = false;
  core.AccountDeletionOutcome? _outcome;

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  Future<void> _run() async {
    setState(() => _busy = true);
    final core.AccountDeletionOutcome outcome = await widget.onConfirm(
      _password.text,
    );
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
    return AlertDialog(
      backgroundColor: AppColors.surface,
      title: const Text('Delete your account?'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text(
            'This cannot be undone. Deleting removes your sign-in, so the same '
            'email and password will no longer work.',
            style: AppText.body,
          ),
          const SizedBox(height: 14),
          const Text(
            'Enter your password to confirm it is you.',
            style: AppText.muted,
          ),
          const SizedBox(height: 8),
          TextField(
            key: const Key('deleteAccountPassword'),
            controller: _password,
            obscureText: true,
            enabled: !_busy,
            // The button below is disabled until this is non-empty, so the
            // destructive action cannot be reached by a stray tap.
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(labelText: 'Password'),
          ),
        ],
      ),
      actions: <Widget>[
        TextButton(
          onPressed: _busy ? null : () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          key: const Key('deleteAccountConfirm'),
          style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
          onPressed: (_busy || _password.text.isEmpty) ? null : _run,
          child: Text(_busy ? 'Deleting…' : 'Delete account'),
        ),
      ],
    );
  }

  /// WHAT ACTUALLY HAPPENED, in the outcome's own words.
  ///
  /// The sentence comes from `packages/core` so that no app can invent a kinder
  /// one, and the only path that offers "Sign in again" is the one where the
  /// deletion never left the device.
  Widget _result(BuildContext context, core.AccountDeletionOutcome outcome) {
    return AlertDialog(
      backgroundColor: AppColors.surface,
      title: Text(
        outcome.accountIsGone ? 'Account deleted' : 'Not deleted',
        key: const Key('deleteAccountResultTitle'),
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            outcome.plainMessage,
            key: const Key('deleteAccountResult'),
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
            // The email route, which the published page also names. No
            // turnaround time is stated here because none is published.
            const Text(
              'Email ${AppConfig.supportEmail} and we will finish it.',
              style: AppText.muted,
            ),
          ],
        ],
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Close'),
        ),
      ],
    );
  }
}

class _Toggle extends StatelessWidget {
  const _Toggle({required this.value, required this.onTap});
  final bool value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
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
    );
  }
}

class _LinkRow extends StatelessWidget {
  const _LinkRow({
    required this.icon,
    required this.label,
    required this.last,
    this.url = '',
  });
  final String icon;
  final String label;
  final bool last;
  final String url;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: last ? Colors.transparent : AppColors.line),
        ),
      ),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: url.isEmpty ? null : () => openExternalUrl(url),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
          child: Row(
            children: <Widget>[
              Container(
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
                  style: const TextStyle(color: AppColors.accent, fontSize: 15),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  label,
                  style: AppText.body.copyWith(
                    fontWeight: FontWeight.w700,
                    fontSize: 14,
                  ),
                ),
              ),
              const Icon(Icons.chevron_right, color: AppColors.muted, size: 18),
            ],
          ),
        ),
      ),
    );
  }
}
