// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS' HELP SECTION AND ITS HEADINGS — ST-Y3 / ST-Y4 (audit D8, D12/F53).
//
// 🏗️ CHASSIS, NOT APP. Every app this factory stamps has a settings page with
// group headings and a way to reach the people behind it; the WHAT of both is
// decided once here and an app adopts it with its own strings, its own card
// and its own row widget. The shipping app's settings screen is a capped
// private fork (assert-chassis-parity), so the rows' logic cannot grow there.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:nikatru_core/nikatru_core.dart' show StoreListingOutcome;

/// A settings group's heading as a HEADER node (audit D8): styled text alone
/// gave a screen reader's heading navigation nothing to jump between.
///
/// `container: true` beside `header:` for the reason [SettingsSection]
/// records — a bare `header:` bubbles up and merges into whatever sits around
/// it. [label] is what is announced; [paint] (default: [label]) is what is
/// drawn in [style], so a caller that upper-cases its paint still announces
/// the words as written.
class SettingsHeading extends StatelessWidget {
  const SettingsHeading(this.label, {this.paint, this.style, super.key});

  final String label;
  final String? paint;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    header: true,
    label: label,
    child: ExcludeSemantics(child: Text(paint ?? label, style: style)),
  );
}

/// The app's own settings row, as its constructor tears off — so the Help
/// section's rows look exactly like every other row on that app's page.
typedef HelpRowBuilder =
    Widget Function({
      Key? key,
      required String icon,
      required String label,
      required bool last,
      String? subtitle,
      VoidCallback? onTap,
    });

/// The Help section's row keys, so a test finds a ROW and not a string.
abstract final class HelpKeys {
  static const Key contactPage = Key('settings.help.contactPage');
  static const Key contactSupport = Key('settings.help.contactSupport');
  static const Key rate = Key('settings.help.rate');
  /// "Report a problem" (lane feedback-intake): the row that used to be a
  /// "Send feedback" mail.
  static const Key reportProblem = Key('settings.help.reportProblem');
  /// "Help" (lane help-search): packages/help's centre — articles searched
  /// on the device, known issues, the accessibility statement, "Ask us".
  static const Key helpCentre = Key('settings.help.helpCentre');
}

/// A mail to [email] with [subject] pre-filled, so it arrives labelled.
Uri supportMailUri(String email, String subject) =>
    Uri.parse('mailto:$email?subject=${Uri.encodeComponent(subject)}');

/// Settings' ONE Help section (audit D12/F53) as a card in [decoration], top
/// to bottom: the help centre (when [helpCentreLabel] and [openHelpCentre] are
/// given; lane help-search), the contact page, the support mail, Rate, Report a problem —
/// each drawn by [row]. The two support routes used to sit in two different cards,
/// and there was no way to rate the app or send a suggestion at all.
///
/// * The contact PAGE and the support MAIL both stay: they fail in different
///   conditions (no mail client; no browser form).
/// * **Rate** opens the store LISTING, not the quota-limited in-app prompt,
///   and is absent unless [canRate] — a platform with no listing (web,
///   Linux) gets no dead row. Anything but `opened` shows [rateUnavailable]
///   in a SnackBar: a tap that did nothing is said out loud.
/// * **Report a problem** opens packages/feedback's sheet (lane
///   feedback-intake): a category, a description, an optional blurred
///   screenshot and the diagnostics the person previews, sent to the private
///   intake. It replaced "Send feedback", which was the support mail with its
///   own subject and carried no diagnostics at all; the support MAIL row above
///   stays as the fallback, and the sheet offers it when a report cannot go.
Widget helpCard(
  BuildContext context, {
  required Decoration decoration,
  required HelpRowBuilder row,
  String? helpCentreLabel,
  VoidCallback? openHelpCentre,
  required String contactPageLabel,
  required VoidCallback openContactPage,
  required String contactSupportLabel,
  required String supportEmail,
  required String supportSubject,
  required String reportProblemLabel,
  required VoidCallback onReportProblem,
  required Future<void> Function(Uri mail) openMail,
  required bool canRate,
  required String rateLabel,
  required Future<StoreListingOutcome> Function() openStoreListing,
  required String rateUnavailable,
}) {
  Future<void> rate() async {
    if (await openStoreListing() == StoreListingOutcome.opened) return;
    if (!context.mounted) return;
    ScaffoldMessenger.maybeOf(
      context,
    )?.showSnackBar(SnackBar(content: Text(rateUnavailable)));
  }

  final List<(Key, String, String, String?, VoidCallback)> links =
      <(Key, String, String, String?, VoidCallback)>[
        if (helpCentreLabel != null && openHelpCentre != null)
          (HelpKeys.helpCentre, 'ⓘ', helpCentreLabel, null, openHelpCentre),
        (HelpKeys.contactPage, '?', contactPageLabel, null, openContactPage),
        (
          HelpKeys.contactSupport,
          '✉',
          contactSupportLabel,
          supportEmail,
          () => openMail(supportMailUri(supportEmail, supportSubject)),
        ),
        if (canRate) (HelpKeys.rate, '☆', rateLabel, null, rate),
        (
          HelpKeys.reportProblem,
          '⚑',
          reportProblemLabel,
          null,
          onReportProblem,
        ),
      ];
  return Container(
    decoration: decoration,
    clipBehavior: Clip.antiAlias,
    child: Column(
      children: <Widget>[
        for (final (int i, (Key, String, String, String?, VoidCallback) l)
            in links.indexed)
          row(
            key: l.$1,
            icon: l.$2,
            label: l.$3,
            subtitle: l.$4,
            last: i == links.length - 1,
            onTap: l.$5,
          ),
      ],
    ),
  );
}
