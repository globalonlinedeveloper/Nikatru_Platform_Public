// Settings' "Your privacy rights" row for this app (lane dpdp-rights, Do 2):
// packages/feedback's rights screen, opened from the Privacy and data card next
// to the account deletion. Its own file so the Settings screen — a capped
// private copy of the chassis screen (assert-chassis-parity) — does not grow.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/e2e_keys.dart';
import '../../state/providers/feedback.dart'
    show openPrivacyRightsScreen, privacyRightsLabelOf;
import '../shared/chassis_adapters.dart' show HelpRowBuilder;

/// The row, drawn by [row] (the Settings screen's own link row). [onDeleteAccount]
/// is the screen's own deletion flow, which the erasure right opens.
Widget settingsPrivacyRightsRow(
  BuildContext context,
  WidgetRef ref, {
  required HelpRowBuilder row,
  required Future<void> Function() onDeleteAccount,
}) => row(
  key: E2EKeys.settingsPrivacyRights,
  icon: '⚖',
  label: privacyRightsLabelOf(context),
  last: true,
  onTap: () =>
      openPrivacyRightsScreen(context, ref, onDeleteAccount: onDeleteAccount),
);
