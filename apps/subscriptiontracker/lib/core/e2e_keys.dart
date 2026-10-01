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

  /// The sign-in door's heading, on both arms. ⏱ 2026-09-28 · ST-T1b (audit
  /// A-7): the e2e, the store capture and the unit suites find the door by THIS,
  /// never by its words — the words are "Welcome" on a first visit, "Welcome
  /// back" after, and the sign-up title on the other arm.
  static const Key loginHeading = Key('e2e_login_heading');

  // Add-subscription sheet.
  static const Key addName = Key('e2e_add_name');
  static const Key addPrice = Key('e2e_add_price');
  static const Key addSubmit = Key('e2e_add_submit');

  /// The renewal-date field. The store suite taps it and TYPES a date into the
  /// picker's input mode, so each seeded row renews on its own day instead of
  /// the sheet's one-cycle default (2026-09-22).
  static const Key addRenewal = Key('e2e_add_renewal');

  /// The category dropdown, the Cancel button and the state banner (offline,
  /// a failed save) on the same sheet — which since train ST-D6 is the EDIT
  /// sheet too, so every add-sheet key above anchors the edit form as well.
  static const Key addCategory = Key('e2e_add_category');
  static const Key addCancel = Key('e2e_add_cancel');
  static const Key addBanner = Key('e2e_add_banner');

  /// ST-T9 (AD-03): the pick step's search, its "Add by hand" and "Import
  /// instead", and one row per catalogue service, keyed by the pack's id.
  static const Key addSearch = Key('e2e_add_search');
  static const Key addByHand = Key('e2e_add_by_hand');
  static const Key addImport = Key('e2e_add_import');
  static Key addPickRow(String serviceId) => Key('e2e_add_pick_$serviceId');

  /// ST-T9 (AD-06..08): "Paid with", the reminder chips, the notice
  /// dropdown and the "Then" price after a trial.
  static const Key addRail = Key('e2e_add_rail');
  static Key addLead(int days) => Key('e2e_add_lead_$days');
  static const Key addNotice = Key('e2e_add_notice');
  static const Key addThenPrice = Key('e2e_add_then_price');

  /// ST-T9 (AD-05): Settings › Categories.
  static const Key settingsCategories = Key('e2e_settings_categories');

  // Subscription detail. The button that opens the edit sheet (train ST-D6);
  // its label is `l10n.editPlan`.
  static const Key detailEdit = Key('e2e_detail_edit');

  // App shell.
  static const Key fabAdd = Key('e2e_fab_add');

  // ── Subscription detail and notifications (train ST-D5) ───────────────────
  //
  // The e2e and the store capture found these controls by ICON
  // (`Icons.arrow_back`, `Icons.close`) and by WORDS ('Cancel plan'). Both
  // still work — the redesign kept the icons and the copy — and these are the
  // anchors that survive the next one: an icon swap or a copy edit moves no
  // key.
  static const Key detailBack = Key('e2e_detail_back');
  static const Key detailCancelPlan = Key('e2e_detail_cancel_plan');

  /// The header's "More options" — the row's lifecycle menu (ST-T3b ST-E3).
  static const Key detailMoreOptions = Key('e2e_detail_more_options');
  static const Key notificationsClose = Key('e2e_notifications_close');
  // ── Stop a charge (the cancel sheet) — train ST-D7 ────────────────────────
  //
  // Keyed rather than found by words: 'Keep it', 'Confirm cancel' and 'Done'
  // are translated, and 'Cancel' is a substring of half the sheet.
  static const Key cancelKeep = Key('e2e_cancel_keep');
  static const Key cancelConfirm = Key('e2e_cancel_confirm');
  static const Key cancelDone = Key('e2e_cancel_done');

  /// The sheet's inline failure strip — present only after a cancel that did
  /// NOT happen, which is the state the unit suite asserts.
  static const Key cancelFailure = Key('e2e_cancel_failure');

  // ── Import (`/scan`, first-run setup) — train ST-D7 ───────────────────────
  //
  // The screen's ONE primary action, in all of its arms: disabled while the
  // list loads, "Go to dashboard" once it has. (A failed load hands the way out
  // to the failed state's own retry, keyed `DataStateView.retryKey`.)
  static const Key scanPrimary = Key('e2e_scan_primary');

  // ── Settings → delete account (golden-path leg 6) ─────────────────────────
  //
  // The SoftButton that OPENS the confirmation carried no key at all, and its
  // label is `l10n.deleteAccount` — the SAME string the dialog's destructive
  // button uses. `find.text('Delete account')` therefore matches ONE widget
  // before the dialog opens and TWO after, so a finder written against the text
  // is ambiguous exactly at the moment the E2E needs to tell them apart.
  static const Key settingsDeleteAccount = Key('e2e_settings_delete_account');

  /// ⏱ 2026-09-28 · train ST-D4. The Privacy card's link to Subly's own
  /// privacy notice. Keyed so a test finds the ROW, not the words: "Privacy
  /// notice" sits one card away from "Privacy policy", and the Tamil build
  /// shares a stem between them.
  static const Key settingsPrivacyNotice = Key('e2e_settings_privacy_notice');

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

  /// The `RepaintBoundary` at the app root that the store capture's desktop
  /// shutter renders to a PNG (`integration_test/store_frame_shutter.dart`).
  /// A desktop window's own pixels are whatever size the runner's desktop
  /// allows; this layer is the size the suite imposed.
  static const Key storeFrame = Key('e2e_store_frame');
}
