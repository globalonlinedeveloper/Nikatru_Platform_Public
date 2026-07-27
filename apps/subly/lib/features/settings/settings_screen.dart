import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../core/config/app_config.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../data/auth/auth_models.dart';
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
        const SizedBox(height: 14),
        SoftButton(
          label: 'Log out',
          color: AppColors.danger,
          onPressed: () async {
            await ref.read(authRepositoryProvider).signOut();
            if (context.mounted) context.go('/onboarding');
          },
        ),
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
