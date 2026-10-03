import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' show OutboxEntry;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../data/api/api_client.dart' show ApiClient;
import '../../data/api/cached_api_client.dart' show CachedApiClient;
import '../../l10n/chassis_bridge.g.dart';
import '../../state/providers.dart';
import '../../state/subscriptions_controller.dart'
    show subscriptionsControllerProvider;

/// Changes made offline that the server refused, or that failed too often —
/// the outbox's dead letters (review #1075 finding 9; the lead's ruling:
/// "couldn't sync this change — retry or discard"). Nothing is dropped
/// silently: the user is told, under the shell, and chooses. The tree is the
/// bare [child] while there are none.
///
/// App-side WIRING only: the queue is packages/core's `DurableOutbox`, the
/// strip is design_system's `DecisionStrip`. Mounted inside [AppShell]
/// (`app_shell.dart`) rather than `app.dart`, whose fork ceiling holds, or the
/// router, whose builder target the surface guards read.
class SyncProblemsStrip extends ConsumerWidget {
  const SyncProblemsStrip({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<OutboxEntry>> state = ref.watch(syncProblemsProvider);
    final AppLocalizations l10n = AppLocalizations.of(context);
    if (state.hasError) {
      // The queue itself could not be read (review #1075 round 3, minor b): the
      // user's queued changes are kept, but the list cannot show them — say
      // so, never a silently incomplete list.
      return _withStrip(
        child,
        DecisionStrip(
          kind: StatusKind.danger,
          message: l10n.syncQueueUnreadable,
          actions: <DecisionAction>[
            DecisionAction(
              label: l10n.retry,
              primary: true,
              onPressed: () => ref
                ..invalidate(syncProblemsProvider)
                ..invalidate(subscriptionsControllerProvider),
            ),
          ],
        ),
      );
    }
    final List<OutboxEntry> problems = state.value ?? const <OutboxEntry>[];
    if (problems.isEmpty) return child;
    final ApiClient api = ref.read(apiClientProvider);

    Future<void> each(
      Future<void> Function(CachedApiClient c, String id) act,
    ) async {
      if (api is! CachedApiClient) return;
      for (final OutboxEntry e in problems) {
        await act(api, e.id);
      }
      ref
        ..invalidate(syncProblemsProvider)
        ..invalidate(subscriptionsControllerProvider);
    }

    return _withStrip(
      child,
      DecisionStrip(
        kind: StatusKind.danger,
        message: l10n.syncProblemMessage(problems.length),
        actions: <DecisionAction>[
          DecisionAction(
            label: l10n.retry,
            primary: true,
            onPressed: () =>
                each((CachedApiClient c, String id) => c.retrySync(id)),
          ),
          DecisionAction(
            label: l10n.syncDiscard,
            onPressed: () =>
                each((CachedApiClient c, String id) => c.discardSync(id)),
          ),
        ],
      ),
    );
  }

  static Widget _withStrip(Widget child, Widget strip) => Column(
    children: <Widget>[
      Expanded(child: child),
      SafeArea(top: false, child: strip),
    ],
  );
}
