// Settings' Help card for this app (ST-Y3 / ST-Y4, lanes feedback-intake and
// help-search): the chassis `helpCard` (packages/chassis_screens
// settings/help_section.dart) given this app's strings, links and actions.
// Its own file so the Settings screen — a capped private copy of the chassis
// screen (assert-chassis-parity) — does not grow when the card gains a row.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/app_config.dart';
import '../../l10n/chassis_bridge.g.dart';
import '../../state/providers.dart';
import '../shared/chassis_adapters.dart';
import '../shared/widgets.dart';

/// The Help card, top to bottom: the help centre, the contact page, the support
/// mail, Rate (where there is a store listing), Report a problem — each drawn
/// by [row], the Settings screen's own row widget.
Widget settingsHelpCard(
  BuildContext context,
  WidgetRef ref,
  AppLocalizations l10n, {
  required HelpRowBuilder row,
}) => helpCard(
  context,
  decoration: cardDecoration(context),
  row: row,
  helpCentreLabel: helpCentreLabelOf(context),
  openHelpCentre: () => openHelp(context, ref),
  contactPageLabel: l10n.helpAndSupport,
  openContactPage: () => openExternalUrl(AppConfig.contactUrl),
  contactSupportLabel: l10n.contactSupport,
  supportEmail: AppConfig.supportEmail,
  supportSubject: '${AppConfig.appName} support',
  reportProblemLabel: reportProblemLabelOf(context),
  onReportProblem: () => openFeedback(context, ref),
  openMail: externalLinks.open,
  canRate: ref.watch(storeListingAvailableProvider),
  rateLabel: l10n.rateApp(AppConfig.appName),
  openStoreListing: () => ref.read(reviewPrompterProvider).openStoreListing(),
  rateUnavailable: l10n.rateAppUnavailable,
);
