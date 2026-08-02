import 'package:flutter/widgets.dart';

/// Stable widget keys consumed by the `integration_test/` E2E suite.
///
/// Kept in one place so the app and the tests reference the SAME identifiers
/// (a typo would silently break a finder). These add no behaviour — they only
/// make the end-to-end suite target fields/buttons deterministically, which
/// matters for a Flutter web app where the UI is a canvas with no DOM.
class E2EKeys {
  E2EKeys._();

  // Login screen.
  static const Key loginEmail = Key('e2e_login_email');
  static const Key loginPassword = Key('e2e_login_password');
  static const Key loginSubmit = Key('e2e_login_submit');

  // Add-subscription sheet.
  static const Key addName = Key('e2e_add_name');
  static const Key addPrice = Key('e2e_add_price');
  static const Key addSubmit = Key('e2e_add_submit');

  // App shell.
  static const Key fabAdd = Key('e2e_fab_add');
}
