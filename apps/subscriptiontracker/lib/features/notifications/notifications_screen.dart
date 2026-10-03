import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show LogicalKeyboardKey;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/e2e_keys.dart';
import '../../core/format/money_format.dart';
import '../../core/format/sub_math.dart';
import '../../data/models/subscription.dart';
import '../../l10n/chassis_bridge.g.dart';
import '../../state/providers.dart' show nowProvider, renewalRemindersProvider;
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart'
    show monthDayFormat, subscriptionsControllerProvider;
import '../shared/async_gate.dart';
import '../shared/due.dart' show LifeStatus;

/// What is coming up, derived from the subscriptions the user holds.
///
/// ⏱ 2026-09-28 · train ST-D5 — REBUILT ON THE DESIGN FOUNDATION. Every
/// colour, size and face now comes from the scheme, the type ramp,
/// [AppSpacing]/[AppRadius] or [StatusTones], with no `isLight` fork left:
///
///   · THE CLOSE is the chassis [AppIconAction]. It was
///     `Semantics(button: true)` over a bare `GestureDetector` — announced as
///     a button, with no `FocusNode` behind it.
///   · THE RENEWALS are ONE card of [AppListRow]s, one row per plan due within
///     a week, each led by an icon [AppMonogram] that takes the warn tint when
///     the charge is today or tomorrow. The title and the sentence under it
///     may wrap (`titleMaxLines`/`subtitleMaxLines`): they are sentences, and
///     an ellipsis cuts the part that says when.
///   · THE UNUSED NUDGE is a [DecisionStrip] of kind warn — an opaque,
///     measured tint instead of a 13% alpha wash under an `AppColors.warn`
///     glyph that was 2.15:1 on white. It offers no answers yet: nothing in
///     the app records usage, so the only honest strip is one that informs.
///   · LOADING is a [SkeletonList] in the card the rows will arrive in, and
///     "nothing due" is the shared empty treatment, not a bare line of text.
///
/// ⏱ 2026-10-01 · NO-09/NO-10 — THE LIST ACTS, AND SAYS WHERE REMINDERS GO.
/// Each due row carries Mark as paid (one payment), Snooze (the OS reminder
/// in 24 h; no network), Keep it (the notice goes; no network) and How to
/// stop (the plan's detail, where the stop flow lives — train T10). Above the
/// list, ONE status line by capability: where this device posts reminders,
/// what and when; where it cannot (web), the e-mail and calendar channels,
/// with a link to Settings.
///
/// ⚠️ THE AGGREGATE STRIP IS STILL INERT, ON PURPOSE. Making a due-soon row open its
/// plan is the obvious next affordance, but those rows are built from
/// `daysUntil(now)`, so every control count the a11y and keyboard sweeps pin
/// for this route would become a function of the wall clock. That wants the
/// sweeps moved onto `nowProvider` first, in its own change.
class NotificationsScreen extends ConsumerWidget {
  /// Closing this screen, guarded the way `subscription_detail_screen.dart`'s
  /// [SubscriptionDetailScreen._dismiss] is guarded and for the second of the
  /// two reasons recorded there.
  ///
  /// 🔴 THE CLOSE BUTTON ASSUMED IT HAD BEEN PUSHED. It is pushed from home
  /// (`home_screen.dart`'s bell, `context.push('/notifications')`), and that is
  /// the only in-app way here — so a bare `context.pop()` looks total. It is
  /// not, because web is on the HASH url strategy (see
  /// `reset_password_screen.dart`): `https://subly.nikatru.com/#/notifications`
  /// is a real URL a user can bookmark, share, or simply RELOAD, and go_router
  /// restores it with a ONE-ENTRY stack. Close then threw `GoError: There is
  /// nothing to pop` — the same defect GlitchTip SUBLY-9 reported against the
  /// detail screen, at the call site nothing has reported yet.
  ///
  /// ⚠️ NOT FIXED BY DELETING THE BUTTON on the reloaded case. A close control
  /// that is absent on a reload is a screen with no way out; `/home` is where
  /// `/` redirects, so it is the same place the browser's own back would land.
  void _close(BuildContext context) {
    if (context.canPop()) {
      context.pop();
      return;
    }
    context.go('/home');
  }

  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final MoneyFormatter money = MoneyFormatter(l10n.localeName);
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final TextTheme text = theme.textTheme;

    // 🔴 D/M/Y WAS HARDCODED, and it was wrong for most of the world rather
    // than merely untranslated: `'${d.day}/${d.month}/${d.year}'` gave every
    // locale day-first, including `en`, where 9/8/2026 means September 8th to
    // the reader and August 9th to the code. Only a formatter can localise a
    // date. `toString()` (not `toLanguageTag()`) because intl keys its symbol
    // tables with the underscore form.
    //
    // ⏱ ST-R6 (audit C18): and not `yMd` either — "9/29/2026" reads two ways
    // between US and Indian readers. It is the OS reminder's own month-day
    // formatter now, so the two surfaces say the same date the same way.
    final DateFormat renewalDate = monthDayFormat(
      Localizations.localeOf(context).toString(),
    );

    return Scaffold(
      // No `backgroundColor`: the scaffold inherits `scheme.surface` from
      // `buildAppTheme` in both brightnesses. The light-literal override that
      // stood here (`AppColors.bg`) is retired with the rest of the forks.
      // ST-R6 (audit C17): Esc closes, as the Close button does. Autofocused
      // so the key reaches it without a first click on web and desktop.
      body: CallbackShortcuts(
        bindings: <ShortcutActivator, VoidCallback>{
          const SingleActivator(LogicalKeyboardKey.escape): () =>
              _close(context),
        },
        child: Focus(
          autofocus: true,
          // Holds focus for the shortcut without being a Tab stop itself.
          skipTraversal: true,
          child: SafeArea(
            // ── THE CONTENT PANE ────────────────────────────────────────────────
            // `.reading` (720): the card content is PROSE — `notifRenewsInDays`
            // and `notifCancellingSaves` are whole sentences, and the Tamil arms
            // are longer — so the design system's reading width, 45–75 characters
            // before the eye loses the line return. The default `kMaxBodyWidth`
            // never bound on a real desktop.
            //
            // The pane wraps the WHOLE column — header, rule and list together —
            // because capping only the list would leave the title and the close
            // button hanging off the edges of a centred list.
            // `test/width_notifications_test.dart` pins both halves.
            child: ContentPane.reading(
              child: Column(
                children: <Widget>[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(
                      AppSpacing.gutterCompact,
                      AppSpacing.sm,
                      AppSpacing.gutterCompact,
                      AppSpacing.md,
                    ),
                    child: Row(
                      children: <Widget>[
                        Expanded(
                          child: Semantics(
                            header: true,
                            child: Text(
                              l10n.notifications,
                              style: text.headlineSmall?.copyWith(
                                color: scheme.onSurface,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: AppSpacing.md),
                        AppIconAction(
                          key: E2EKeys.notificationsClose,
                          icon: Icons.close,
                          label: l10n.close,
                          onPressed: () => _close(context),
                        ),
                      ],
                    ),
                  ),
                  // NO-09 (was ST-U1, audit C20): this list is DERIVED, not
                  // an inbox. One honest line says where reminders go.
                  const _ReminderStatusLine(),
                  const Divider(height: 1),
                  Expanded(
                    // 🔴 THE GATE IS INSIDE THE CHROME, NOT AROUND IT. The title
                    // row above carries the ONLY close control, and `_close` is the
                    // only way back to /home from a URL a user can reload directly.
                    // Wrapping the `Scaffold` instead would take that control away
                    // for the whole of a failed fetch — a dead end reached
                    // precisely when the user most needs out.
                    child: subscriptionsGate(
                      ref,
                      l10n: l10n,
                      emptyTitle: l10n.dataEmptyTitle,
                      emptyBody: l10n.dataEmptyBody,
                      // The list's own outline, in the card the rows arrive in.
                      loading: ListView(
                        padding: const EdgeInsets.all(AppSpacing.gutterCompact),
                        children: <Widget>[
                          AppCard(
                            padding: EdgeInsets.zero,
                            child: SkeletonList(label: l10n.dataLoading),
                          ),
                        ],
                      ),
                      builder: (List<Subscription> subs) => _body(
                        context,
                        ref,
                        subs,
                        l10n: l10n,
                        money: money,
                        renewalDate: renewalDate,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// The derived notices, or the "nothing due" state.
  ///
  /// 2026-07-27 — this list was FIVE HARDCODED entries naming real brands and
  /// inventing facts about the user's own accounts. Every row is now computed
  /// from the subscriptions actually held, and anything that cannot be
  /// computed is not shown at all.
  Widget _body(
    BuildContext context,
    WidgetRef ref,
    List<Subscription> subs, {
    required AppLocalizations l10n,
    required MoneyFormatter money,
    required DateFormat renewalDate,
  }) {
    // The wall clock through `nowProvider`, so a golden and a state test can
    // pin the day instead of rotting when the demo renewal dates pass.
    final DateTime now = ref.watch(nowProvider)();
    final MoneyBag savings = SubMath.savings(subs);

    // ⏱ ST truth pass (NO-08): CHARGING rows only, for both cards. A paused or
    // cancelled plan is not "renewing in 2 days" and did not just charge; it
    // used to be listed as though it would, beside a Home total that rightly
    // left it out.
    final List<Subscription> charging = SubMath.charging(subs);

    // NO-10: a notice the user answered (paid, snoozed, kept) leaves the list
    // for this session.
    final Set<String> answered = ref.watch(answeredNoticesProvider);
    final List<Subscription> dueSoon =
        charging.where((Subscription x) {
          final int d = x.daysUntil(now);
          return d >= 0 && d <= 7 && !answered.contains(x.id);
        }).toList()..sort(
          (Subscription a, Subscription b) =>
              a.daysUntil(now).compareTo(b.daysUntil(now)),
        );

    // ST-R6 (audit C19): a charge that happened in the last week — the stored
    // date has passed and the row ROLLED to its next charge (ST-T3b) — was
    // never said. It is, and it asks the question. Older than the week the
    // list covers is not news.
    final DateTime today = DateTime(now.year, now.month, now.day);
    final List<Subscription> renewed =
        charging.where((Subscription x) {
          if (x.cycle == null) return false;
          final DateTime r = DateTime(
            x.nextRenewal.year,
            x.nextRenewal.month,
            x.nextRenewal.day,
          );
          final int d = r.difference(today).inDays;
          return d < 0 && d >= -7;
        }).toList()..sort(
          (Subscription a, Subscription b) =>
              a.nextRenewal.compareTo(b.nextRenewal),
        );

    final List<Subscription> flaggedUnused = subs
        .where((Subscription x) => x.unused)
        .toList();

    if (dueSoon.isEmpty && renewed.isEmpty && flaggedUnused.isEmpty) {
      return DataStateView.empty(
        title: l10n.notifNothingDue,
        icon: Icons.notifications_none,
      );
    }

    // 🔴 THE PLURAL ARMS CARRY WHOLE CLAUSES, NOT A NOUN. The count selects
    // the arm of `notifUnusedCount` / `notifCancellingSaves`; the arm is what
    // a translator rewrites freely. Gluing "plan is" / "plans are" fragments
    // with an inline ternary is English grammar written as Dart.
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.gutterCompact,
        AppSpacing.gutterCompact,
        AppSpacing.gutterCompact,
        AppSpacing.xl,
      ),
      children: <Widget>[
        if (flaggedUnused.isNotEmpty) ...<Widget>[
          DecisionStrip(
            key: const Key('notifications-unused-strip'),
            kind: StatusKind.warn,
            message: l10n.notifUnusedCount(flaggedUnused.length),
            detail: l10n.notifCancellingSaves(
              flaggedUnused.length,
              money.formatBag(savings),
            ),
          ),
          if (dueSoon.isNotEmpty || renewed.isNotEmpty)
            const SizedBox(height: AppSpacing.lg),
        ],
        if (dueSoon.isNotEmpty)
          AppCard(
            key: const Key('notifications-due-card'),
            padding: EdgeInsets.zero,
            child: Column(
              children: <Widget>[
                for (int i = 0; i < dueSoon.length; i++) ...<Widget>[
                  if (i > 0) const Divider(height: 1),
                  _dueRow(context, dueSoon[i], now, l10n, money, renewalDate),
                  _RowActions(sub: dueSoon[i]),
                ],
              ],
            ),
          ),
        // Past charges in their own card: the due card is what is COMING.
        if (renewed.isNotEmpty) ...<Widget>[
          if (dueSoon.isNotEmpty) const SizedBox(height: AppSpacing.lg),
          AppCard(
            key: const Key('notifications-renewed-card'),
            padding: EdgeInsets.zero,
            child: Column(
              children: <Widget>[
                for (int i = 0; i < renewed.length; i++) ...<Widget>[
                  if (i > 0) const Divider(height: 1),
                  _renewedRow(context, renewed[i], l10n, renewalDate),
                ],
              ],
            ),
          ),
        ],
      ],
    );
  }

  /// One renewal notice: the plan and when, then what it will charge.
  ///
  /// ✅ ST-U8 (C16): A NOTICE ABOUT ONE SUBSCRIPTION OPENS IT. "Netflix renews
  /// in 2 days" was a dead end — the screen could inform and never act. The
  /// row pushes `/sub/:id` (back returns here); the aggregate "unused" strip
  /// names no single subscription and stays inert.
  Widget _dueRow(
    BuildContext context,
    Subscription x,
    DateTime now,
    AppLocalizations l10n,
    MoneyFormatter money,
    DateFormat renewalDate,
  ) {
    final int days = x.daysUntil(now);
    final String charge = l10n.notifChargeOn(
      money.format(x.price),
      renewalDate.format(x.nextCharge(now)),
    );
    // ST truth pass (NO-08): a trial says so before it charges.
    final LifeStatus? life = LifeStatus.of(l10n, x);
    return AppListRow(
      leading: AppMonogram.icon(
        Icons.notifications_none,
        // Today or tomorrow is the last chance to act before the charge, so
        // it is the one notice drawn as a warning; the sentence says so too.
        status: days <= 1 ? StatusKind.warn : null,
      ),
      title: days == 0
          ? l10n.notifRenewsToday(x.name)
          // (name, count) — gen-l10n orders the parameters by the arb's
          // placeholder map, and the plural SELECTOR is the second one here.
          : l10n.notifRenewsInDays(x.name, days),
      titleMaxLines: 2,
      subtitle: life == null ? charge : '${life.label} · $charge',
      status: life?.kind,
      subtitleMaxLines: 3,
      onTap: () => context.push('/sub/${x.id}'),
    );
  }

  Widget _renewedRow(
    BuildContext context,
    Subscription x,
    AppLocalizations l10n,
    DateFormat renewalDate,
  ) {
    return AppListRow(
      leading: AppMonogram.icon(Icons.history),
      title: x.name,
      titleMaxLines: 2,
      subtitle: l10n.notificationsRenewedOn(renewalDate.format(x.nextRenewal)),
      subtitleMaxLines: 3,
      onTap: () => context.push('/sub/${x.id}'),
    );
  }
}

/// NO-10: the notices answered this session — paid, snoozed or kept. Session
/// state on purpose: the next renewal is a new notice, and a payment is on
/// the server, not here.
class AnsweredNotices extends Notifier<Set<String>> {
  @override
  Set<String> build() => const <String>{};

  void answer(String subscriptionId) =>
      state = <String>{...state, subscriptionId};
}

final NotifierProvider<AnsweredNotices, Set<String>> answeredNoticesProvider =
    NotifierProvider<AnsweredNotices, Set<String>>(AnsweredNotices.new);

/// NO-09: the one line that says where reminders go, by capability.
///
/// - No notifications here (web; Windows without the app's identity): the
///   e-mail reminders and the calendar feed, which reach every target, and a
///   link to Settings where both live.
/// - Notifications here: "Reminders: on, {lead} before at {time}", or off.
class _ReminderStatusLine extends ConsumerWidget {
  const _ReminderStatusLine();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final TextStyle? style = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final bool push = ref
        .watch(renewalRemindersProvider)
        .capabilities
        .canNotify;
    final SettingsState s = ref.watch(settingsControllerProvider);
    final Widget line;
    if (!push) {
      line = Column(
        key: const Key('notificationsNoRemindersHere'),
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(l10n.notificationsStatusNoPush, style: style),
          TextButton(
            key: const Key('notificationsOpenSettings'),
            onPressed: () => context.go('/settings'),
            child: Text(l10n.notificationsOpenSettings),
          ),
        ],
      );
    } else {
      final bool on = s.prefs['alerts'] ?? true;
      final String time = MaterialLocalizations.of(context).formatTimeOfDay(
        TimeOfDay(
          hour: s.reminderMinuteOfDay ~/ 60,
          minute: s.reminderMinuteOfDay % 60,
        ),
        alwaysUse24HourFormat: MediaQuery.alwaysUse24HourFormatOf(context),
      );
      line = Text(
        on
            ? l10n.notificationsStatusOn(s.reminderLeadDays, time)
            : l10n.notificationsStatusOff,
        key: const Key('notificationsStatusLine'),
        style: style,
      );
    }
    // Its OWN semantics node: without the container the sentence merges into
    // the title's node, which then reads "Notifications Reminders: on, …" as
    // one label — and the title stops being a heading a reader can find.
    return Semantics(
      container: true,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.gutterCompact,
          0,
          AppSpacing.gutterCompact,
          AppSpacing.md,
        ),
        child: Align(alignment: AlignmentDirectional.centerStart, child: line),
      ),
    );
  }
}

/// NO-10: what a due row can do — each button does ONE thing.
class _RowActions extends ConsumerWidget {
  const _RowActions({required this.sub});

  final Subscription sub;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AnsweredNotices answered = ref.read(answeredNoticesProvider.notifier);
    void say(String text) => ScaffoldMessenger.maybeOf(
      context,
    )?.showSnackBar(SnackBar(content: Text(text)));
    return Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(
        AppSpacing.md,
        0,
        AppSpacing.md,
        AppSpacing.sm,
      ),
      child: Wrap(
        spacing: AppSpacing.sm,
        children: <Widget>[
          TextButton(
            key: Key('notifications.paid.${sub.id}'),
            onPressed: () async {
              try {
                await ref
                    .read(subscriptionsControllerProvider.notifier)
                    .markPaid(sub.id);
              } on Object {
                say(l10n.reminderMarkPaidFailed);
                return;
              }
              answered.answer(sub.id);
              say(l10n.reminderMarkedPaid(sub.name));
            },
            child: Text(l10n.reminderActionMarkPaid),
          ),
          TextButton(
            key: Key('notifications.snooze.${sub.id}'),
            onPressed: () async {
              answered.answer(sub.id);
              await ref
                  .read(subscriptionsControllerProvider.notifier)
                  .snoozeReminder(sub.id);
              say(l10n.reminderSnoozed);
            },
            child: Text(l10n.reminderActionSnooze),
          ),
          TextButton(
            key: Key('notifications.keep.${sub.id}'),
            onPressed: () => answered.answer(sub.id),
            child: Text(l10n.reminderActionKeep),
          ),
          TextButton(
            key: Key('notifications.stop.${sub.id}'),
            // The plan's detail carries the stop entry; `stop=1` is the
            // anchor train T10's stop flow opens on (ignored until then).
            onPressed: () => context.push('/sub/${sub.id}?stop=1'),
            child: Text(l10n.reminderActionHowToStop),
          ),
        ],
      ),
    );
  }
}
