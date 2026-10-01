// ─────────────────────────────────────────────────────────────────────────────
// DELETE ACCOUNT TELLS THE TRUTH ABOUT BILLING — MO-06, AB-A5-02-client.
//
// ⏱ 2026-10-01 · train st-money-ready. Two lines the delete-account dialog in
// settings_screen.dart draws, kept HERE because that file is a fork held to a
// ceiling that only falls (tooling/chassis-parity.json):
//   · BEFORE the confirm, what deleting does to an active plan — a web plan is
//     cancelled by the deletion (the server cancels it first, and refuses when it
//     cannot); a store plan is NOT, because only the store can stop it. Chosen by
//     where the plan was BOUGHT (the entitlement's `store`), never the build.
//   · AFTER a refusal, the server's own sentence from DELETE /v1/account's 503
//     `subscription_still_billing`, which says what to do first.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';

import '../../l10n/app_localizations.dart';
import '../../state/money_providers.dart';
import '../../state/providers.dart' show lastDeletionBillingSentenceProvider;

/// Clears the last sentence and returns the recorder `_deleteAccount` calls
/// with the error it caught. Its controller is captured HERE, before the
/// deletion's first await, for the reason the outcome sink beside it is: the
/// deletion signs out and the screen holding [ref] may be gone when it lands.
void Function(Object error) deletionBillingRecorder(WidgetRef ref) {
  final StateController<String?> sink = ref.read(
    lastDeletionBillingSentenceProvider.notifier,
  );
  sink.state = null;
  return (Object error) =>
      sink.state = core.accountDeletionServerSentenceOf(error);
}

/// The line on what deleting does to an active plan, or nothing for a free
/// user (or a plan that could not be read — no guess is worded).
class DeleteAccountPlanLine extends ConsumerWidget {
  const DeleteAccountPlanLine({super.key});

  static const Key lineKey = Key('deleteAccount.planLine');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final core.Entitlements? ent = ref.watch(entitlementsProvider).value;
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String? line = switch (ent == null
        ? null
        : BillingSource.activePlanOf(ent, DateTime.now())?.source) {
      BillingSource.web => l10n.deleteAccountPlanWeb,
      BillingSource.appStore => l10n.deleteAccountPlanAppStore,
      BillingSource.googlePlay => l10n.deleteAccountPlanGooglePlay,
      null => null,
    };
    if (line == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.md),
      child: Text(line, key: lineKey, style: AppText.of(context).body),
    );
  }
}

/// The server's own reason a deletion was refused, when it gave one.
class DeleteAccountServerSentence extends ConsumerWidget {
  const DeleteAccountServerSentence({super.key});

  static const Key sentenceKey = Key('deleteAccount.billingSentence');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final String? sentence = ref.watch(lastDeletionBillingSentenceProvider);
    if (sentence == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.md),
      child: Text(sentence, key: sentenceKey, style: AppText.of(context).body),
    );
  }
}
