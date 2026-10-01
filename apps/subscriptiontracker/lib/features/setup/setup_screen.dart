// ⏱ ST-T9 (EN-18) — Subly's after-sign-in setup: an ADAPTER over the chassis
// [SetupStepsView] (packages/chassis_screens/lib/firstrun/), which owns the
// frame, Skip on every step and the step position. This file holds only what
// is Subly's: the three steps' words and controls, and what finishing writes —
//   1. home currency, the locale default explained;
//   2. reminder channels: push where this platform can schedule it, and the
//      e-mail / calendar card every platform has once signed in;
//   3. "pick what you pay for": catalogue tiles, several at once, each pick
//      added as a prefilled row (service_prefill.dart, the add sheet's rule).
// Shown once per ACCOUNT ([setupSeenProvider]); Skip and Done both mark it.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart'
    show ServiceCatalogue, ServiceEntry;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
import '../add/service_prefill.dart';
import '../settings/reminder_settings.dart' show ReminderChannelsCard;
import '../shared/chassis_adapters.dart' show SetupStep, SetupStepsView;

/// How many catalogue tiles the pick step offers: the region's first, the
/// same ordering the add sheet's pick step uses.
const int kSetupTileCount = 12;

/// Keys for the setup's own controls, for its tests.
abstract final class SetupKeys {
  static const Key currency = Key('setup_currency');
  static const Key push = Key('setup_push');
  static Key tile(String serviceId) => Key('setup_tile_$serviceId');
}

/// Whether a signed-in account should be offered setup now: it has not seen
/// it ([seen] is a definite `false`) and its list loaded EMPTY. A first sign-in
/// with rows already (an import, another device) skips straight to them.
bool shouldOfferSetup({
  required bool? seen,
  required AsyncValue<List<Subscription>> subscriptions,
}) =>
    seen == false &&
    subscriptions.hasValue &&
    !subscriptions.hasError &&
    subscriptions.requireValue.isEmpty;

class SetupScreen extends ConsumerStatefulWidget {
  const SetupScreen({super.key, @visibleForTesting this.now = DateTime.now});

  /// "Today" for the prefilled rows' first renewal; a test pins it.
  final DateTime Function() now;

  @override
  ConsumerState<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends ConsumerState<SetupScreen> {
  late String _currency = ref.read(currencyCodeProvider);
  final Set<String> _picked = <String>{};
  bool _busy = false;

  String? get _region =>
      _currency == 'INR' ? 'IN' : ref.read(deviceRegionProvider);

  void _leave() {
    final GoRouter? router = GoRouter.maybeOf(context);
    if (router != null) {
      router.go('/home');
    } else {
      Navigator.of(context).maybePop();
    }
  }

  Future<void> _skip() async {
    await ref.read(setupSeenProvider.notifier).markSeen();
    if (mounted) _leave();
  }

  Future<void> _finish(ServiceCatalogue? catalogue) async {
    setState(() => _busy = true);
    await ref.read(settingsControllerProvider.notifier).setCurrency(_currency);
    final SubscriptionsController ctl = ref.read(
      subscriptionsControllerProvider.notifier,
    );
    final DateTime today = widget.now();
    for (final String id in _picked) {
      final ServiceEntry? e = catalogue?.byId(id);
      if (e == null) continue;
      try {
        await ctl.addSubscription(
          draftFromService(e, currencyCode: _currency, today: today),
        );
      } on Object {
        // One failed add does not lose the others; the row can be added
        // from the sheet, and the outbox replays a queued one.
      }
    }
    await ref.read(setupSeenProvider.notifier).markSeen();
    if (mounted) _leave();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ServiceCatalogue? catalogue = ref
        .watch(serviceCatalogueProvider(l10n.localeName))
        .value;
    return SetupStepsView(
      busy: _busy,
      onSkip: _skip,
      onFinish: () => _finish(catalogue),
      nextLabel: l10n.setupNext,
      finishLabel: l10n.setupFinish,
      skipLabel: l10n.setupSkip,
      backLabel: l10n.setupBack,
      positionLabel: l10n.setupPosition,
      steps: <SetupStep>[
        SetupStep(
          title: l10n.setupCurrencyTitle,
          body: l10n.setupCurrencyBody(_currency),
          child: _currencyField(l10n),
        ),
        SetupStep(
          title: l10n.setupRemindersTitle,
          body: l10n.setupRemindersBody,
          child: _channels(l10n),
        ),
        SetupStep(
          title: l10n.setupPickTitle,
          body: l10n.setupPickBody,
          child: _tiles(l10n, catalogue),
        ),
      ],
    );
  }

  Widget _currencyField(AppLocalizations l10n) {
    final ThemeData theme = Theme.of(context);
    return DropdownButtonFormField<String>(
      key: SetupKeys.currency,
      initialValue: _currency,
      decoration: AppFieldDecoration.of(
        context,
        label: l10n.fieldLabelCurrency,
      ),
      dropdownColor: AppCard.fillOf(theme),
      isExpanded: true,
      items: <DropdownMenuItem<String>>[
        for (final String c in <String>{...Money.symbols.keys, _currency})
          DropdownMenuItem<String>(value: c, child: Text(c)),
      ],
      onChanged: _busy
          ? null
          : (String? c) => setState(() => _currency = c ?? _currency),
    );
  }

  Widget _channels(AppLocalizations l10n) {
    final bool canSchedule = ref
        .watch(notificationCapabilitiesProvider)
        .canSchedule;
    final bool alerts =
        ref.watch(settingsControllerProvider).prefs['alerts'] ?? true;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        // One merged node — "Notifications on this device, switch, on" —
        // as the add sheet's trial switch: a SwitchListTile announced its
        // switch as a second, nameless control (a11y_semantics_test caught it).
        if (canSchedule)
          MergeSemantics(
            child: Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    l10n.setupRemindersPush,
                    style: Theme.of(context).textTheme.bodyLarge,
                  ),
                ),
                Switch(
                  key: SetupKeys.push,
                  value: alerts,
                  onChanged: _busy
                      ? null
                      : (_) => ref
                            .read(settingsControllerProvider.notifier)
                            .toggle('alerts'),
                ),
              ],
            ),
          )
        else
          Text(
            l10n.setupRemindersNoPush,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        // E-mail and the calendar feed: the Settings card itself, which
        // paints nothing where the backend or the account is absent.
        const ReminderChannelsCard(),
      ],
    );
  }

  Widget _tiles(AppLocalizations l10n, ServiceCatalogue? catalogue) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    if (catalogue == null) {
      return Text(l10n.addPickUnavailable, style: theme.textTheme.bodyMedium);
    }
    final List<ServiceEntry> offered = catalogue
        .orderedFor(_region)
        .take(kSetupTileCount)
        .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Semantics(
          liveRegion: true,
          child: Text(
            l10n.setupPicked(_picked.length),
            style: theme.textTheme.labelLarge?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.sm,
          children: <Widget>[
            for (final ServiceEntry e in offered)
              FilterChip(
                key: SetupKeys.tile(e.id),
                label: Text(e.name),
                selected: _picked.contains(e.id),
                onSelected: _busy
                    ? null
                    : (bool on) => setState(
                        () => on ? _picked.add(e.id) : _picked.remove(e.id),
                      ),
              ),
          ],
        ),
      ],
    );
  }
}
