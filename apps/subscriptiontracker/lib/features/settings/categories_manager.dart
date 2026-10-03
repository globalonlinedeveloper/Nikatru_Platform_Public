// ⏱ ST-T9 (AD-05) — Settings › Categories: the built-ins, localised BY ID,
// and the user's own, which this sheet adds, renames and deletes through
// `/v1/categories`. A rename is one server batch that moves the category,
// every row filed under it and its budget cap together (routes/categories.ts),
// so a renamed category keeps its cap and its rows; this sheet then refreshes
// the two reads that show them.
//
// Built from the chassis form sheet (`showAppFormSheet`, `AppFormSheet`,
// `AppFormActions`, `AppFieldDecoration`) — no colour, size or radius of its
// own.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/e2e_keys.dart';
import '../../data/models/category.dart';
import '../../l10n/chassis_bridge.g.dart';
import '../../state/providers.dart';
import '../../state/subscriptions_controller.dart';
import '../insights/budget_editor.dart' show budgetProvider;
import '../shared/widgets.dart' show cardDecoration;

/// The localised name of the built-in [id], or null for an id that is not a
/// built-in.
String? builtinCategoryLabel(AppLocalizations l10n, String id) => switch (id) {
  'streaming' => l10n.categoryStreaming,
  'music' => l10n.categoryMusic,
  'ai_tools' => l10n.categoryAiTools,
  'creative' => l10n.categoryCreative,
  'fitness' => l10n.categoryFitness,
  'developer' => l10n.categoryDeveloper,
  'productivity' => l10n.categoryProductivity,
  'cloud' => l10n.categoryCloud,
  'news' => l10n.categoryNews,
  'security' => l10n.categorySecurity,
  _ => null,
};

/// Settings' "Categories" row (ST-T9, AD-05): the categories manager — the
/// built-ins by id, the user's own added, renamed and deleted through
/// `/v1/categories`. Its own widget, here, because Settings is a capped
/// private fork of a chassis file (tooling/chassis-parity.json) that may not
/// grow; the fork mounts this in two lines.
class CategoriesSettingsRow extends StatelessWidget {
  const CategoriesSettingsRow({super.key});

  @override
  Widget build(BuildContext context) => Container(
    decoration: cardDecoration(context),
    clipBehavior: Clip.antiAlias,
    child: Material(
      color: Colors.transparent,
      child: ListTile(
        key: E2EKeys.settingsCategories,
        leading: const Icon(Icons.label_outline),
        title: Text(AppLocalizations.of(context).settingsCategories),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => showCategoriesManager(context),
      ),
    ),
  );
}

/// Opens Settings › Categories.
Future<void> showCategoriesManager(BuildContext context) =>
    showAppFormSheet<void>(
      context,
      builder: (_) => const CategoriesManagerSheet(),
    );

/// Keys for the manager's controls, for its tests.
abstract final class CategoriesManagerKeys {
  static const Key newName = Key('categories_new_name');
  static const Key add = Key('categories_add');
  static Key rename(String id) => Key('categories_rename_$id');
  static Key delete(String id) => Key('categories_delete_$id');
  static const Key renameField = Key('categories_rename_field');
  static const Key renameSave = Key('categories_rename_save');
}

class CategoriesManagerSheet extends ConsumerStatefulWidget {
  const CategoriesManagerSheet({super.key});

  @override
  ConsumerState<CategoriesManagerSheet> createState() =>
      _CategoriesManagerState();
}

class _CategoriesManagerState extends ConsumerState<CategoriesManagerSheet> {
  final TextEditingController _newName = TextEditingController();
  bool _busy = false;
  String? _failure;

  @override
  void initState() {
    super.initState();
    _newName.addListener(() {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _newName.dispose();
    super.dispose();
  }

  /// Runs one write, then refreshes what a category change moves: the rows
  /// filed under it and the budget caps keyed on it.
  Future<void> _write(Future<void> Function(CategoriesController c) w) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    setState(() {
      _busy = true;
      _failure = null;
    });
    try {
      await w(ref.read(categoriesProvider.notifier));
      ref
        ..invalidate(subscriptionsControllerProvider)
        ..invalidate(budgetProvider);
      if (mounted) setState(() => _busy = false);
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _failure = l10n.categoriesFailed;
      });
    }
  }

  Future<void> _add() async {
    final String name = _newName.text.trim();
    if (name.isEmpty) return;
    await _write((CategoriesController c) => c.add(name));
    if (mounted && _failure == null) _newName.clear();
  }

  Future<void> _rename(SubscriptionCategory c) async {
    final String? name = await showDialog<String>(
      context: context,
      builder: (_) => _RenameDialog(initial: c.name),
    );
    if (name == null || name.trim().isEmpty || name.trim() == c.name) return;
    await _write((CategoriesController ctl) => ctl.rename(c.id, name));
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final List<SubscriptionCategory> all =
        ref.watch(categoriesProvider).value ?? kBuiltinCategoryRows;
    final List<SubscriptionCategory> own = all
        .where((SubscriptionCategory c) => !c.builtin)
        .toList();
    final String? failure = _failure;
    return AppFormSheet(
      title: l10n.settingsCategories,
      onSubmit: _busy || _newName.text.trim().isEmpty ? null : _add,
      banner: failure == null
          ? null
          : DecisionStrip(kind: StatusKind.danger, message: failure),
      actions: AppFormActions(
        cancelKey: const Key('categories_close'),
        cancelLabel: l10n.close,
        onCancel: () => Navigator.of(context).pop(),
        submitKey: CategoriesManagerKeys.add,
        submitLabel: l10n.categoriesAdd,
        busyLabel: l10n.categoriesAdd,
        busy: _busy,
        onSubmit: _busy || _newName.text.trim().isEmpty ? null : _add,
      ),
      children: <Widget>[
        AppFormField(
          label: l10n.categoriesOwnHeading,
          child: own.isEmpty
              ? Text(l10n.categoriesOwnEmpty, style: theme.textTheme.bodyMedium)
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    for (final SubscriptionCategory c in own)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(c.name),
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: <Widget>[
                            IconButton(
                              key: CategoriesManagerKeys.rename(c.id),
                              tooltip: l10n.categoriesRename,
                              icon: const Icon(Icons.edit_outlined),
                              onPressed: _busy ? null : () => _rename(c),
                            ),
                            IconButton(
                              key: CategoriesManagerKeys.delete(c.id),
                              tooltip: l10n.categoriesDelete,
                              icon: const Icon(Icons.delete_outline),
                              onPressed: _busy
                                  ? null
                                  : () => _write(
                                      (CategoriesController ctl) =>
                                          ctl.remove(c.id),
                                    ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
        ),
        TextField(
          key: CategoriesManagerKeys.newName,
          controller: _newName,
          enabled: !_busy,
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => _add(),
          style: AppFieldDecoration.valueStyle(context),
          decoration: AppFieldDecoration.of(
            context,
            label: l10n.categoriesNewLabel,
          ),
        ),
        AppFormField(
          label: l10n.categoriesBuiltinHeading,
          child: Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: <Widget>[
              for (final SubscriptionCategory c in all.where(
                (SubscriptionCategory c) => c.builtin,
              ))
                Chip(label: Text(builtinCategoryLabel(l10n, c.id) ?? c.name)),
            ],
          ),
        ),
      ],
    );
  }
}

/// The rename prompt. It OWNS its controller: disposing one from the caller
/// the moment the dialog's future completes frees it while the dialog is
/// still animating out and building with it.
class _RenameDialog extends StatefulWidget {
  const _RenameDialog({required this.initial});

  final String initial;

  @override
  State<_RenameDialog> createState() => _RenameDialogState();
}

class _RenameDialogState extends State<_RenameDialog> {
  late final TextEditingController _field = TextEditingController(
    text: widget.initial,
  );

  @override
  void dispose() {
    _field.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(l10n.categoriesRenameTitle),
      content: TextField(
        key: CategoriesManagerKeys.renameField,
        controller: _field,
        autofocus: true,
        style: AppFieldDecoration.valueStyle(context),
        decoration: AppFieldDecoration.of(
          context,
          label: l10n.categoriesNewLabel,
        ),
        onSubmitted: (String v) => Navigator.of(context).pop(v),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.cancel),
        ),
        FilledButton(
          key: CategoriesManagerKeys.renameSave,
          onPressed: () => Navigator.of(context).pop(_field.text),
          child: Text(l10n.save),
        ),
      ],
    );
  }
}
