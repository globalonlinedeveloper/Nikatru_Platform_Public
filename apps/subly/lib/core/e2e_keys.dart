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

  // ── Settings → delete account (golden-path leg 6) ─────────────────────────
  //
  // The SoftButton that OPENS the confirmation carried no key at all, and its
  // label is `l10n.deleteAccount` — the SAME string the dialog's destructive
  // button uses. `find.text('Delete account')` therefore matches ONE widget
  // before the dialog opens and TWO after, so a finder written against the text
  // is ambiguous exactly at the moment the E2E needs to tell them apart.
  static const Key settingsDeleteAccount = Key('e2e_settings_delete_account');

  // 🔴 THE THREE BELOW KEEP THEIR ORIGINAL STRING VALUES ON PURPOSE.
  // `test/delete_account_test.dart` drives this dialog by LITERAL
  // `const Key('deleteAccountPassword')` in eleven places, and a `Key` compares
  // by value — so hoisting the definitions here changes nothing that test sees
  // while leaving exactly ONE place where the identifier is written down. Giving
  // them fresh `e2e_`-prefixed values instead would have been a rename of a live
  // widget-test contract for cosmetic consistency, which is how a suite is
  // silently disarmed.
  static const Key deleteAccountPassword = Key('deleteAccountPassword');
  static const Key deleteAccountConfirm = Key('deleteAccountConfirm');
  static const Key deleteAccountResult = Key('deleteAccountResult');
  static const Key deleteAccountResultTitle = Key('deleteAccountResultTitle');

  /// The inline notice the LOGIN screen renders after a deletion, parked there
  /// by `lastAccountDeletionOutcomeProvider` because the sign-out redirect
  /// carries the dialog away with the settings page. It is the only surface on
  /// which "Account deleted" survives long enough to be asserted after the
  /// router has finished, so it is the E2E's landing assertion. [ADR 027]
  static const Key accountDeletionNotice = Key('accountDeletionNotice');

  /// WHY that notice says what it says — DEBUG BUILDS ONLY, and that is not a
  /// caveat but the point: `flutter drive` builds debug, a store artifact does
  /// not, so the E2E can name a cause the user is never shown.
  ///
  /// Its absence is what made the 2026-08-09 delete leg unreadable. The notice
  /// text alone cannot tell a 404 from a 500 from a client-side throw that never
  /// sent a request — all three render "we cannot tell how much of it was
  /// removed" — so three sessions searched for an HTTP status that had never
  /// been returned to anybody.
  static const Key accountDeletionNoticeDetail = Key(
    'accountDeletionNoticeDetail',
  );
}
