import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/format/currency.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
import '../shared/widgets.dart';

/// U+FFFC OBJECT REPLACEMENT CHARACTER — Unicode's own "an object goes here".
///
/// 🔴 THIS IS WHAT LETS ONE SENTENCE BE ONE KEY AND STILL CARRY EMPHASIS. The
/// two bodies on this sheet are single arb messages (`cancelStep1Body`,
/// `cancelStep2Body`), never fragments — Tamil moves the verb to the END of the
/// sentence and the date clause to the FRONT, an order no concatenation of
/// styled pieces can produce in any language. But the saved amount is bold and
/// green in the design, and gen-l10n hands back a finished `String` with no
/// seam in it.
///
/// So the message is asked for ONCE with this character standing in for the
/// amount, and the finished sentence is split at the character. The split point
/// is wherever the TRANSLATOR put the placeholder, and it is exact regardless of
/// what the amount is made of — searching the sentence for the formatted amount
/// itself would be a substring hunt that a currency like `₹1` inside `₹12`
/// could get wrong.
///
/// Written as an escape rather than as the character itself: it is invisible in
/// an editor, and a control character no reviewer can see is not a thing to
/// paste around.
const String _amountSlot = '\u{FFFC}';

/// [sentence] — already localized, with [_amountSlot] marking where the money
/// goes — rendered as spans with [amount] emphasised.
///
/// The concatenation happens to the OUTPUT of one translated message, not to the
/// input of several. `sentence.substring(0, at) + amount + sentence.substring(…)`
/// is byte-identical to calling the same message with [amount] directly, which
/// is exactly what `dark_group_sheets_test.dart` asserts: the finished Text.rich
/// reports one plain-text sentence equal to `l10n.cancelStep1Body(monthly, …)`.
///
/// If a translation drops the placeholder the sentence still renders WHOLE and
/// only the emphasis is lost — the copy degrades last, never first.
List<InlineSpan> _emphasiseAmount(String sentence, String amount) {
  final int at = sentence.indexOf(_amountSlot);
  if (at < 0) return <InlineSpan>[TextSpan(text: sentence)];
  return <InlineSpan>[
    TextSpan(text: sentence.substring(0, at)),
    TextSpan(
      text: amount,
      style: const TextStyle(
        fontWeight: FontWeight.w800,
        color: AppColors.positive,
      ),
    ),
    TextSpan(text: sentence.substring(at + _amountSlot.length)),
  ];
}

/// The cancel sheet's palette. The sibling of `add_subscription_sheet.dart`'s
/// `_SheetPalette` — read that one's doc comment for the slot choices and for
/// why the ink moves with the fill rather than after it. This sheet needs three
/// of the six: it has no fields, no chips and no unselected control.
///
/// [AppColors.danger] and [AppColors.positive] deliberately do NOT appear here.
/// They are semantic status colours rather than surface tokens, and both clear
/// AA against a dark scheme surface as shipped (measured ~4.2:1 and ~5.9:1), so
/// re-pointing them at the scheme would change what the app MEANS by "this is
/// destructive" for no legibility gain.
class _SheetPalette {
  const _SheetPalette({
    required this.sheet,
    required this.ink,
    required this.muted,
  });

  factory _SheetPalette.of(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    if (theme.brightness == Brightness.light) {
      return const _SheetPalette(
        sheet: AppColors.bg,
        ink: AppColors.ink,
        muted: AppColors.muted,
      );
    }
    final ColorScheme scheme = theme.colorScheme;
    return _SheetPalette(
      sheet: scheme.surfaceContainerLow,
      ink: scheme.onSurface,
      muted: scheme.onSurfaceVariant,
    );
  }

  final Color sheet;
  final Color ink;
  final Color muted;
}

Future<void> showCancelSheet(BuildContext context, Subscription sub) {
  return showModalBottomSheet<void>(
    context: context,
    // 🔴 THE SHEET HAS TWO CALLERS ON DIFFERENT NAVIGATOR LEVELS, and without
    // this they mount on different navigators. `insights_screen.dart` calls
    // from inside a shell BRANCH navigator, so the modal scrim covered only the
    // branch — and under the chassis rail/drawer the same call would dim only
    // the body pane beside the rail. `subscription_detail_screen.dart` calls
    // from the ROOT and scrims the whole window. One destructive confirmation
    // that dims different amounts of the app depending on where it was opened
    // from is not a style difference: the scrim is what says "answer this
    // first", and a nav bar left live above it is a way out of the question.
    //
    // ⚠️ RETRACTED 2026-08-11: this said the branch scrim was drawn over by
    // "AppShell's floating pill … a later `Stack` child". That WAS true and is
    // not — the pill is handed to `AppScaffold` through the
    // `compactNavigationBar` seam (`app_shell.dart:206`) and lands in its
    // `bottomNavigationBar` slot, so it is no longer a sibling in the body
    // `Stack`. The REASON to pin the root is unchanged and never depended on
    // the pill: a branch navigator scrims only its own branch.
    //
    // Pinning it to the root unifies both. The dismiss paths are unaffected —
    // `Navigator.of(context)` inside the sheet resolves from the SHEET's own
    // route context, which is now the root route, so 'Keep it' and 'Done' still
    // pop exactly the sheet. That is asserted, not argued: see the two
    // mount-level cases in `test/width_cancel_sheet_test.dart`.
    useRootNavigator: true,
    // 🔴 THE SHEET CLIPPED ITS OWN BUTTONS ON A SHORT VIEWPORT — AND THE BUTTON
    // ROW IS NOT THE CAUSE. Measured 2026-08-21 at textScaler 1.3 on a 740×360
    // landscape phone: the step-0 `Column` overflowed by 137 px on the BOTTOM,
    // and the button row laid out at y 416.5–466.5 — wholly below a 360 px
    // screen, so 'Keep it' and 'Confirm cancel' were unreachable. The row is two
    // `Expanded`s and cannot overflow horizontally at any scale; what ran out
    // was HEIGHT. With the default `isScrollControlled: false`,
    // `showModalBottomSheet` caps the sheet at 9/16 of the window — 202.5 px
    // there, against ~340 px of content.
    //
    // This lets the sheet ask for the height it needs. It is not enough on its
    // own — measured with this line alone and no scroll view, a 375×667 phone at
    // scale 2.0 still overflowed by 80 px and 740×360 at 2.0 by 152 px, because
    // the content is then taller than the WHOLE window rather than taller than
    // 9/16 of it. That is what the `Flexible` + `SingleChildScrollView` around
    // the COPY in `build` is for; read the comment there for why the buttons are
    // deliberately outside it. Both halves are mutation-tested in
    // `sheet_failure_surface_test.dart` — each has a case the other's does not
    // catch.
    //
    // Nothing moves at ordinary sizes: `SingleChildScrollView` sizes itself to
    // its child within the incoming constraints, so the sheet still shrink-wraps
    // — 375×812 at 1.3 threw nothing before this change and is 339 px tall
    // either way.
    isScrollControlled: true,
    // With the 9/16 cap gone, a sheet tall enough to fill the window would run
    // under the status bar. This insets it by the real `MediaQuery` padding —
    // no number of ours.
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _CancelSheet(sub: sub),
  );
}

class _CancelSheet extends ConsumerStatefulWidget {
  const _CancelSheet({required this.sub});
  final Subscription sub;

  @override
  ConsumerState<_CancelSheet> createState() => _CancelSheetState();
}

class _CancelSheetState extends ConsumerState<_CancelSheet> {
  int _step = 0;
  bool _busy = false;

  // The English month table that used to live here is gone. `DateFormat.MMMMd`
  // reads the same names out of the intl locale data the l10n delegates already
  // load — so the date follows the language instead of pinning the sheet to
  // twelve English words, and it follows the ORDER too: 'September 12' in en,
  // and whatever the locale's own MMMMd pattern says elsewhere.

  Future<void> _confirm() async {
    setState(() => _busy = true);
    // Resolved BEFORE the await — see the note in add_subscription_sheet.dart.
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    final AppLocalizations l10n = AppLocalizations.of(context);
    try {
      await ref
          .read(subscriptionsControllerProvider.notifier)
          .cancelSubscription(widget.sub.id);
      if (!mounted) return;
      setState(() {
        _busy = false;
        _step = 1;
      });
    } catch (_) {
      // 🔴 THIS FAILURE PATH DID NOT EXIST, and the stakes here are higher than
      // in the add sheet: the awaited call reaches the network, so offline it
      // threw out of an unawaited future and the button stayed disabled on
      // 'Cancelling…' forever. Advancing to step 1 regardless would have been
      // worse still — that screen congratulates the user on savings from a
      // cancellation that never happened.
      if (!mounted) return;
      setState(() => _busy = false);
      messenger.showSnackBar(
        SnackBar(content: Text(l10n.cancelSubscriptionFailed)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final _SheetPalette p = _SheetPalette.of(context);
    final Currency currency = ref.watch(currencyProvider);
    final Subscription s = widget.sub;
    final String monthly = currency.fmt(s.monthlyPrice);
    final String yearly = currency.fmt0(s.monthlyPrice * 12);
    // `l10n.localeName` rather than the ambient default: `DateFormat` with no
    // locale uses whatever `Intl.defaultLocale` happens to be, which is a
    // process-wide global nothing on this screen sets. Passing the locale the
    // sentence around the date was translated in is the only way the two agree.
    final String until = DateFormat.MMMMd(
      l10n.localeName,
    ).format(s.nextRenewal);

    return Container(
      decoration: BoxDecoration(
        color: p.sheet,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
      ),
      padding: const EdgeInsets.fromLTRB(22, 26, 22, 30),
      child: _step == 0
          ? Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                // 🔴 THE COPY SCROLLS; THE ACTION ROW DOES NOT MOVE. Wrapping the
                // WHOLE sheet in one scroll view fixed the clip and cost something
                // that is not worth it: `MinimumTapTargetGuideline` skips any target
                // under an ancestor with `hasImplicitScrolling`
                // (`_accessibility_evaluations.dart:132`), so with the buttons inside
                // the viewport `a11y_semantics_test.dart`'s 48×48 sweep of this sheet
                // went from 2 inspected nodes to 0 — a guard that passes because it
                // looked at nothing, which is the failure mode this repo has been
                // bitten by most. Measured both ways on 2026-08-21.
                //
                // Scrolling only the copy keeps the two buttons out of the viewport,
                // so they stay inspectable AND stay on screen: a destructive
                // confirmation whose 'Keep it' can be scrolled out of reach is worse
                // than one whose reason can.
                //
                // `Flexible` (loose fit) is what makes it shrink ONLY when it has to.
                // With room to spare the scroll view still sizes to its child, so the
                // sheet's height and every rect in it are unchanged.
                Flexible(
                  child: SingleChildScrollView(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Container(
                          width: 64,
                          height: 64,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: const Color.fromRGBO(239, 77, 106, 0.12),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: const Icon(
                            Icons.close,
                            color: AppColors.danger,
                            size: 28,
                          ),
                        ),
                        const SizedBox(height: 14),
                        Text(
                          l10n.cancelSubscriptionTitle(s.name),
                          style: AppText.title.copyWith(
                            fontSize: 22,
                            color: p.ink,
                          ),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 8),
                        Text.rich(
                          TextSpan(
                            style: AppText.muted.copyWith(
                              fontSize: 14,
                              height: 1.55,
                              color: p.muted,
                            ),
                            // ONE message, three placeholders — not the three fragments
                            // this used to concatenate. The Tamil value reads
                            // "நீங்கள் மாதம் {monthly} · ஆண்டுக்கு {yearly}
                            // சேமிப்பீர்கள். {date} வரை அணுகல் தொடரும்.": the verb
                            // lands at the END of the first clause and the "/mo" the
                            // English glues to the amount is a WORD BEFORE it. Neither
                            // is reachable by translating a fragment.
                            children: _emphasiseAmount(
                              l10n.cancelStep1Body(_amountSlot, yearly, until),
                              monthly,
                            ),
                          ),
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 22),
                Row(
                  children: <Widget>[
                    Expanded(
                      child: SoftButton(
                        label: l10n.keepPlan,
                        onPressed: () => Navigator.of(context).pop(),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: SizedBox(
                        height: 50,
                        child: FilledButton(
                          onPressed: _busy ? null : _confirm,
                          style: FilledButton.styleFrom(
                            backgroundColor: AppColors.danger,
                            // 🔴 STATED, BECAUSE THE DEFAULT IS BRIGHTNESS-
                            // DEPENDENT AND THE BACKGROUND IS NOT.
                            // `FilledButton`'s default foreground is
                            // `colorScheme.onPrimary` — white in a light scheme
                            // (so this line changes NOTHING in light) and a very
                            // dark tone in a dark one. Against the fixed
                            // `AppColors.danger` red that would have printed
                            // near-black on red: the destructive confirmation is
                            // the last control on this sheet that may become
                            // hard to read.
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(16),
                            ),
                          ),
                          child: Text(
                            _busy
                                ? l10n.cancellingEllipsis
                                : l10n.confirmCancel,
                            style: const TextStyle(
                              fontFamily: 'Manrope',
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            )
          : Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                // Same shape as step 0, and for the same two reasons: 'Done' is the
                // only way out of this step, and it is the only tap target on it.
                Flexible(
                  child: SingleChildScrollView(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Container(
                          width: 70,
                          height: 70,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: const Color.fromRGBO(16, 185, 129, 0.14),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            Icons.check_rounded,
                            color: AppColors.positive,
                            size: 34,
                          ),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          l10n.cancelledHeading,
                          style: AppText.title.copyWith(
                            fontSize: 23,
                            color: p.ink,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text.rich(
                          TextSpan(
                            style: AppText.muted.copyWith(
                              fontSize: 14,
                              height: 1.55,
                              color: p.muted,
                            ),
                            children: _emphasiseAmount(
                              l10n.cancelStep2Body(_amountSlot),
                              monthly,
                            ),
                          ),
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                SizedBox(
                  width: double.infinity,
                  child: GradientButton(
                    label: l10n.done,
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ),
              ],
            ),
    );
  }
}
