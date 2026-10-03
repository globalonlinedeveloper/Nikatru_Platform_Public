// ═══════════════════════════════════════════════════════════════════════════
// THE IMPORT HUB (`/import`) — IM-01..06. ADR 077 §2.2 deleted `/scan`, a
// 560 ms × 5 timer over the ordinary list fetch that imported nothing; this is
// what an import means here instead.
//
// ONE SURFACE, THREE ENGINES, ALL OF THEM `package:nikatru_core`'s:
//   · a table   → `CsvReader` → the `ColumnMapping` question (a known other
//                 tracker's export is recognised by its header and mapped by
//                 its `ColumnPreset`) → the `ImportPlan` review;
//   · a backup  → `BackupRestore` → a count preview → merge, never delete;
//   · any text  → `ReceiptParser` → the same review list.
// `core.classifyImportInput` decides which, so a file, a drop, a share and a
// paste all land in the same place.
//
// 🔴 ON THE DEVICE, AND THE COPY SAYS SO BECAUSE IT IS TRUE. Every reader
// above is pure Dart in core; no file and no pasted text leaves the device.
// The ONLY network call on this screen is the ordinary add (or, for a restore,
// update) route, through `SubscriptionsController`, AFTER the user has
// reviewed the rows — the same write a typed row makes.
//
// The app-specific half — which fields a subscription has, the synonyms, the
// other trackers' presets, a candidate → `Subscription` — is
// `data/portability/subscription_columns.dart`.
// ═══════════════════════════════════════════════════════════════════════════

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/e2e_keys.dart';
import '../../core/format/money_format.dart';
import '../../data/models/subscription.dart';
import '../../data/portability/subscription_columns.dart';
import '../../l10n/chassis_bridge.g.dart';
import '../../state/providers.dart';
import '../../state/settings_controller.dart' show currencyCodeProvider;
import '../../state/subscriptions_controller.dart';
import '../shared/cadence_label.dart';

enum _Stage { hub, map, review, restore }

class ImportScreen extends ConsumerStatefulWidget {
  const ImportScreen({super.key});

  @override
  ConsumerState<ImportScreen> createState() => _ImportScreenState();
}

class _ImportScreenState extends ConsumerState<ImportScreen> {
  final TextEditingController _paste = TextEditingController();

  _Stage _stage = _Stage.hub;
  String? _notice;
  bool _busy = false;

  // CSV
  core.CsvTable? _table;
  core.ColumnPreset? _preset;
  core.ColumnMapping? _mapping;
  core.DateOrder? _dateOrder;

  // Review (CSV or receipt)
  core.ImportPlan? _plan;
  core.ImportPlan Function(List<Subscription> existing)? _replan;
  final Set<int> _selected = <int>{};

  // Restore
  core.RestorePlan? _restore;
  String? _restoreRefusal;

  @override
  void initState() {
    super.initState();
    // IM-06: a share or a drop that arrived before this screen did, and any
    // that lands while it is open.
    ref.listenManual<core.ImportedFile?>(importInboxProvider, (_, next) {
      if (next != null) _takeInbox();
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => _takeInbox());
  }

  @override
  void dispose() {
    _paste.dispose();
    super.dispose();
  }

  void _takeInbox() {
    if (!mounted) return;
    final core.ImportedFile? f = ref.read(importInboxProvider.notifier).take();
    if (f != null) _accept(f);
  }

  void _close() {
    final GoRouter? router = GoRouter.maybeOf(context);
    if (router == null) return;
    if (router.canPop()) {
      router.pop();
    } else {
      router.go('/home');
    }
  }

  void _startOver() => setState(() {
    _stage = _Stage.hub;
    _notice = null;
    _table = null;
    _preset = null;
    _mapping = null;
    _dateOrder = null;
    _plan = null;
    _replan = null;
    _selected.clear();
    _restore = null;
    _restoreRefusal = null;
  });

  Future<void> _choose() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final core.ImportedFile? f = await ref
        .read(fileImporterProvider)
        .pick(extensions: core.kImportFileExtensions);
    if (!mounted) return;
    if (f == null) {
      setState(() => _notice = l10n.importFileUnreadable);
      return;
    }
    await _accept(f);
  }

  Future<void> _readPaste() async {
    final String text = _paste.text;
    if (text.trim().isEmpty) return;
    await _accept(core.ImportedFile(name: 'pasted text', text: text));
  }

  /// The one entry every source goes through: a picked file, a paste, a share,
  /// a drop.
  Future<void> _accept(core.ImportedFile f) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    _startOver();
    switch (f.kind) {
      case core.ImportInputKind.csv:
        final core.CsvTable table = const core.CsvReader().read(f.text);
        final core.ColumnPreset? preset = core.ColumnPreset.recognise(
          table.header,
          kTrackerPresets,
        );
        setState(() {
          _table = table;
          _preset = preset;
          _mapping =
              preset?.apply(table.header, kSubscriptionImportFields) ??
              core.ColumnMapping.infer(table.header, kSubscriptionImportFields);
          _stage = _Stage.map;
        });
      case core.ImportInputKind.backup:
        final List<Subscription>? existing = await _existing(l10n);
        if (existing == null || !mounted) return;
        final core.Result<core.RestorePlan> r =
            const core.BackupRestore(appId: kBackupAppId).planText(
              f.text,
              <Map<String, Object?>>[
                for (final Subscription s in existing)
                  Map<String, Object?>.of(s.toJson()),
              ],
            );
        setState(() {
          _stage = _Stage.restore;
          switch (r) {
            case core.Ok<core.RestorePlan>(:final core.RestorePlan value):
              _restore = value;
            case core.Err<core.RestorePlan>(:final core.Failure failure):
              _restoreRefusal = failure.message;
          }
        });
      case core.ImportInputKind.text:
        final String currency = ref.read(currencyCodeProvider);
        await _review(
          (List<Subscription> existing) => core.ReceiptParser.plan(
            f.text,
            fields: kSubscriptionImportFields,
            ids: kSubscriptionReceiptIds,
            keyOf: subscriptionImportKey,
            defaultCurrency: currency,
            dateOrder: _dateOrder,
            existingKeys: existing.map(subscriptionExistingKey),
          ),
        );
    }
  }

  /// The list as it stands, for the duplicate check — or null, with the
  /// reason on screen, when it did not load. An import never guesses "no
  /// duplicates" off a list it could not see.
  Future<List<Subscription>?> _existing(AppLocalizations l10n) async {
    try {
      return await ref.read(subscriptionsControllerProvider.future);
    } catch (_) {
      if (mounted) setState(() => _notice = l10n.importListFailed);
      return null;
    }
  }

  Future<void> _review(
    core.ImportPlan Function(List<Subscription> existing) replan,
  ) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final List<Subscription>? existing = await _existing(l10n);
    if (existing == null || !mounted) return;
    final core.ImportPlan plan = replan(existing);
    setState(() {
      _replan = replan;
      _plan = plan;
      _selected
        ..clear()
        ..addAll(plan.candidates.map((core.ImportCandidate c) => c.row));
      _stage = _Stage.review;
      _notice = plan.candidates.isEmpty && plan.duplicates.isEmpty
          ? l10n.importNothingFound
          : null;
    });
  }

  Future<void> _continueFromMapping() async {
    final core.CsvTable table = _table!;
    final core.ColumnMapping mapping = _mapping!;
    final String currency = ref.read(currencyCodeProvider);
    await _review(
      (List<Subscription> existing) => core.ImportPlan.build(
        table,
        mapping,
        fields: kSubscriptionImportFields,
        keyOf: subscriptionImportKey,
        defaultCurrency: currency,
        dateOrder: _dateOrder,
        existingKeys: existing.map(subscriptionExistingKey),
      ),
    );
  }

  Future<void> _answerDateOrder(core.DateOrder order) async {
    final core.ImportPlan Function(List<Subscription>)? replan = _replan;
    if (replan == null) return;
    setState(() => _dateOrder = order);
    await _review(replan);
  }

  Future<void> _add() async {
    final core.ImportPlan? plan = _plan;
    if (plan == null || _busy) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ScaffoldMessengerState? messenger = ScaffoldMessenger.maybeOf(
      context,
    );
    final DateTime today = DateTime.now();
    final List<Subscription> drafts = <Subscription>[
      for (final core.ImportCandidate c in plan.candidates)
        if (_selected.contains(c.row))
          subscriptionFromCandidate(c, today: today),
    ];
    setState(() => _busy = true);
    final ({int added, Object? error}) r = await ref
        .read(subscriptionsControllerProvider.notifier)
        .addAll(drafts);
    if (!mounted) return;
    setState(() => _busy = false);
    if (r.error != null) {
      setState(() => _notice = l10n.importAddFailed(r.added, drafts.length));
      return;
    }
    messenger?.showSnackBar(SnackBar(content: Text(l10n.importAdded(r.added))));
    _close();
  }

  Future<void> _applyRestore() async {
    final core.RestorePlan? plan = _restore;
    if (plan == null || _busy) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ScaffoldMessengerState? messenger = ScaffoldMessenger.maybeOf(
      context,
    );
    final SubscriptionsController ctl = ref.read(
      subscriptionsControllerProvider.notifier,
    );
    final List<Subscription>? existing = await _existing(l10n);
    if (existing == null || !mounted) return;
    // A row the server re-keyed on an earlier restore has a new id and the
    // same name, price and cycle: it is already here, so it is not added
    // twice. That is what makes a second restore of one file a no-op.
    final Set<String> have = existing.map(subscriptionExistingKey).toSet();
    final String fallback = ref.read(currencyCodeProvider);
    final List<Subscription> adds = <Subscription>[
      for (final Map<String, Object?> rec in plan.toAdd)
        Subscription.fromJson(
          Map<String, dynamic>.of(rec),
          fallbackCurrencyCode: fallback,
        ),
    ].where((Subscription s) => have.add(subscriptionExistingKey(s))).toList();
    setState(() => _busy = true);
    int changed = 0;
    Object? error;
    final ({int added, Object? error}) r = await ctl.addAll(adds);
    changed += r.added;
    error = r.error;
    if (error == null) {
      for (final core.RestoreUpdate u in plan.toUpdate) {
        final Subscription current = Subscription.fromJson(
          Map<String, dynamic>.of(u.current),
          fallbackCurrencyCode: fallback,
        );
        final Subscription incoming = Subscription.fromJson(
          Map<String, dynamic>.of(u.incoming),
          fallbackCurrencyCode: fallback,
        );
        try {
          await ctl.updateSubscription(
            current.id,
            incoming.changesFrom(current),
          );
          changed++;
        } catch (e) {
          error = e;
          break;
        }
      }
    }
    if (!mounted) return;
    setState(() => _busy = false);
    if (error != null) {
      setState(
        () => _notice = l10n.importAddFailed(
          changed,
          adds.length + plan.toUpdate.length,
        ),
      );
      return;
    }
    messenger?.showSnackBar(SnackBar(content: Text(l10n.restoreDone(changed))));
    _close();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final TextTheme text = theme.textTheme;
    return Scaffold(
      body: CallbackShortcuts(
        bindings: <ShortcutActivator, VoidCallback>{
          const SingleActivator(LogicalKeyboardKey.escape): _close,
        },
        child: SafeArea(
          child: ContentPane.reading(
            child: ListView(
              padding: const EdgeInsets.all(AppSpacing.gutterCompact),
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Expanded(
                      child: Semantics(
                        header: true,
                        child: Text(
                          _stage == _Stage.restore
                              ? l10n.restoreTitle
                              : l10n.importTitle,
                          style: text.headlineSmall?.copyWith(
                            color: scheme.onSurface,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.md),
                    AppIconAction(
                      icon: Icons.close,
                      label: l10n.close,
                      onPressed: _close,
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                ...switch (_stage) {
                  _Stage.hub => _hub(l10n, text, scheme),
                  _Stage.map => _map(l10n, text, scheme),
                  _Stage.review => _reviewList(l10n, text, scheme),
                  _Stage.restore => _restorePreview(l10n, text, scheme),
                },
                if (_notice != null) ...<Widget>[
                  const SizedBox(height: AppSpacing.md),
                  DecisionStrip(kind: StatusKind.warn, message: _notice!),
                ],
                if (_stage != _Stage.hub) ...<Widget>[
                  const SizedBox(height: AppSpacing.sm),
                  Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: TextButton(
                      key: E2EKeys.importStartOver,
                      onPressed: _busy ? null : _startOver,
                      child: Text(l10n.importStartOver),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _hub(AppLocalizations l10n, TextTheme text, ColorScheme scheme) {
    final bool canPick = ref.watch(fileImporterProvider).canPick;
    return <Widget>[
      Text(
        l10n.importSubtitle,
        style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
      ),
      const SizedBox(height: AppSpacing.lg),
      if (canPick) ...<Widget>[
        FilledButton.tonalIcon(
          key: E2EKeys.importChooseFile,
          onPressed: _choose,
          icon: const Icon(Icons.upload_file),
          label: Text(l10n.importChooseFile),
        ),
        const SizedBox(height: AppSpacing.lg),
      ],
      TextField(
        key: E2EKeys.importPaste,
        controller: _paste,
        minLines: 4,
        maxLines: 10,
        keyboardType: TextInputType.multiline,
        decoration: InputDecoration(
          labelText: l10n.importPasteLabel,
          alignLabelWithHint: true,
          border: const OutlineInputBorder(),
        ),
      ),
      const SizedBox(height: AppSpacing.md),
      ListenableBuilder(
        listenable: _paste,
        builder: (BuildContext context, Widget? _) => FilledButton(
          key: E2EKeys.importRead,
          onPressed: _paste.text.trim().isEmpty ? null : _readPaste,
          child: Text(l10n.importRead),
        ),
      ),
    ];
  }

  String _fieldLabel(AppLocalizations l10n, String id) => switch (id) {
    'name' => l10n.fieldLabelName,
    'price' => l10n.fieldLabelPrice,
    'currency' => l10n.fieldLabelCurrency,
    'cycle' => l10n.fieldLabelCycle,
    _ => l10n.fieldLabelRenews,
  };

  List<Widget> _map(AppLocalizations l10n, TextTheme text, ColorScheme scheme) {
    final core.CsvTable table = _table!;
    final core.ColumnMapping mapping = _mapping!;
    final core.ColumnPreset? preset = _preset;
    final bool ready =
        mapping.columnOf('name') != null && mapping.columnOf('price') != null;
    return <Widget>[
      Text(l10n.importMapTitle, style: text.titleMedium),
      const SizedBox(height: AppSpacing.xs),
      Text(
        preset == null
            ? l10n.importMapRows(table.rows.length)
            : l10n.importMapRecognised(preset.name),
        style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
      ),
      const SizedBox(height: AppSpacing.md),
      for (final String id in kImportMappedFieldIds)
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.sm),
          child: DropdownButtonFormField<int?>(
            key: ValueKey<String>('import-map-$id'),
            initialValue: mapping.columnOf(id),
            isExpanded: true,
            decoration: InputDecoration(
              labelText: _fieldLabel(l10n, id),
              border: const OutlineInputBorder(),
            ),
            items: <DropdownMenuItem<int?>>[
              DropdownMenuItem<int?>(child: Text(l10n.importMapNone)),
              for (int c = 0; c < table.header.length; c++)
                DropdownMenuItem<int?>(
                  value: c,
                  child: Text(
                    table.header[c].trim().isEmpty
                        ? l10n.importMapColumn(c + 1)
                        : table.header[c],
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
            ],
            onChanged: (int? column) => setState(() {
              core.ColumnMapping m = _mapping!;
              final int? was = m.columnOf(id);
              if (was != null) m = m.withOverride(was, null);
              if (column != null) m = m.withOverride(column, id);
              _mapping = m;
            }),
          ),
        ),
      const SizedBox(height: AppSpacing.sm),
      FilledButton(
        key: E2EKeys.importContinue,
        onPressed: ready ? _continueFromMapping : null,
        child: Text(l10n.continueLabel),
      ),
    ];
  }

  List<Widget> _reviewList(
    AppLocalizations l10n,
    TextTheme text,
    ColorScheme scheme,
  ) {
    final core.ImportPlan plan = _plan!;
    final MoneyFormatter money = MoneyFormatter(l10n.localeName);
    final String localeName = l10n.localeName;
    String detail(core.ImportCandidate c) => <String>[
      if (c.money('price') != null) money.format(c.money('price')!),
      cadenceCaption(l10n, core.Cadence.fromLegacy(c.text('cycle'))),
      if (c.date('next_renewal') != null)
        monthDayFormat(localeName).format(c.date('next_renewal')!),
    ].where((String s) => s.isNotEmpty).join(' · ');
    final int selected = _selected.length;
    return <Widget>[
      Text(l10n.importReviewTitle, style: text.titleMedium),
      const SizedBox(height: AppSpacing.sm),
      for (final core.ImportQuestion q in plan.questions)
        if (q is core.DateOrderQuestion)
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  l10n.importDateOrderQuestion(
                    q.samples.isEmpty ? '' : q.samples.first,
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                Wrap(
                  spacing: AppSpacing.sm,
                  children: <Widget>[
                    OutlinedButton(
                      onPressed: () =>
                          _answerDateOrder(core.DateOrder.dayFirst),
                      child: Text(l10n.importDayFirst),
                    ),
                    OutlinedButton(
                      onPressed: () =>
                          _answerDateOrder(core.DateOrder.monthFirst),
                      child: Text(l10n.importMonthFirst),
                    ),
                  ],
                ),
              ],
            ),
          ),
      if (plan.candidates.isNotEmpty || plan.duplicates.isNotEmpty)
        AppCard(
          padding: EdgeInsets.zero,
          child: Column(
            children: <Widget>[
              for (final core.ImportCandidate c in plan.candidates)
                _CandidateRow(
                  key: ValueKey<String>('import-candidate-${c.row}'),
                  selected: _selected.contains(c.row),
                  title: c.text('name') ?? '',
                  subtitle: detail(c),
                  onToggle: _busy
                      ? null
                      : () => setState(() {
                          if (!_selected.remove(c.row)) _selected.add(c.row);
                        }),
                ),
              for (final core.ImportDuplicate d in plan.duplicates)
                ListTile(
                  key: ValueKey<String>('import-duplicate-${d.candidate.row}'),
                  enabled: false,
                  leading: const Icon(Icons.content_copy),
                  title: Text(d.candidate.text('name') ?? ''),
                  subtitle: Text(l10n.importReviewDuplicate),
                ),
            ],
          ),
        ),
      for (final core.ImportRowError e in plan.errors)
        Padding(
          key: ValueKey<String>('import-error-${e.row}'),
          padding: const EdgeInsets.only(top: AppSpacing.sm),
          child: DecisionStrip(
            kind: StatusKind.danger,
            message: l10n.importReviewProblem(
              e.row,
              e.problems.map((core.ImportProblem p) => '$p').join('; '),
            ),
          ),
        ),
      const SizedBox(height: AppSpacing.md),
      FilledButton(
        key: E2EKeys.importAdd,
        onPressed: selected == 0 || _busy ? null : _add,
        child: Text(
          _busy ? l10n.addingEllipsis : l10n.importAddSelected(selected),
        ),
      ),
    ];
  }

  List<Widget> _restorePreview(
    AppLocalizations l10n,
    TextTheme text,
    ColorScheme scheme,
  ) {
    final core.RestorePlan? plan = _restore;
    if (plan == null) {
      return <Widget>[
        DecisionStrip(
          kind: StatusKind.danger,
          message: l10n.restoreRefused(_restoreRefusal ?? ''),
        ),
      ];
    }
    return <Widget>[
      Text(
        l10n.restorePreview(
          plan.toAdd.length,
          plan.toUpdate.length,
          plan.unchanged.length,
        ),
        style: text.bodyMedium?.copyWith(color: scheme.onSurface),
      ),
      const SizedBox(height: AppSpacing.md),
      FilledButton(
        key: E2EKeys.restoreConfirm,
        onPressed: _busy || plan.isIdentity ? null : _applyRestore,
        child: Text(_busy ? l10n.savingEllipsis : l10n.restoreConfirm),
      ),
    ];
  }
}

/// One selectable review row. Not a `CheckboxListTile`: its inner `Checkbox`
/// is a second tap target that a screen reader meets with no name (the a11y
/// sweep's "import (review)" case). The ROW is the one control — named by its
/// text, carrying the checked state — and the box is drawn for the eye only.
class _CandidateRow extends StatelessWidget {
  const _CandidateRow({
    super.key,
    required this.selected,
    required this.title,
    required this.subtitle,
    required this.onToggle,
  });

  final bool selected;
  final String title;
  final String subtitle;
  final VoidCallback? onToggle;

  @override
  Widget build(BuildContext context) => Semantics(
    checked: selected,
    child: ListTile(
      onTap: onToggle,
      enabled: onToggle != null,
      title: Text(title),
      subtitle: Text(subtitle),
      // Out of the Tab orbit too: the row is the stop, and a second one on the
      // same control is a duplicate the keyboard has to walk past.
      trailing: ExcludeFocus(
        child: ExcludeSemantics(
          child: Checkbox(
            value: selected,
            onChanged: onToggle == null ? null : (_) => onToggle!(),
          ),
        ),
      ),
    ),
  );
}
