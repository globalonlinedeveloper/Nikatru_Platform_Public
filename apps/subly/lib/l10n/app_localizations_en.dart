// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Subly — Subscription Tracker';

  @override
  String get settingsTitle => 'Settings';

  @override
  String get contactSupport => 'Contact support';

  @override
  String get deleteAccount => 'Delete account';

  @override
  String get appearance => 'Appearance';

  @override
  String get themeSystem => 'System';

  @override
  String get themeLight => 'Light';

  @override
  String get themeDark => 'Dark';

  @override
  String get deleteAccountSubtitle =>
      'Permanently delete your account and data';

  @override
  String get deleteAccountConfirmTitle => 'Delete account?';

  @override
  String get deleteAccountConfirmBody =>
      'This permanently deletes your account and all its data. This cannot be undone.';

  @override
  String get cancel => 'Cancel';

  @override
  String get delete => 'Delete';

  @override
  String get about => 'About';

  @override
  String get legalese => '© Nikatru';

  @override
  String get consentAllow => 'Allow';

  @override
  String get consentDecline => 'No thanks';

  @override
  String get homeTagline => 'Stamped from the NIKATRU app brick.';

  @override
  String welcomeTo(String appName) {
    return 'Welcome to $appName';
  }

  @override
  String consentTitle(String appName) {
    return 'Help improve $appName?';
  }

  @override
  String get consentBody =>
      'We can record which features you use, so we can see what works and fix what does not.';

  @override
  String get consentPrivacy =>
      'No name, no email, no advertising ID and no IP address — just a random code for this installation.';

  @override
  String get navHome => 'Home';

  @override
  String get navExplore => 'Explore';

  @override
  String get navSettings => 'Settings';

  @override
  String get deleteAccountPassword => 'Password';

  @override
  String get deleteAccountReauthHint => 'Confirm your password to continue.';

  @override
  String get deleteAccountFailed =>
      'Could not delete your account. Your account has NOT been deleted.';

  @override
  String get deleteAccountNotConfigured =>
      'Nothing was deleted. This app cannot complete an account deletion yet, so the request was refused rather than carried out in part. Your account and your data are unchanged.';

  @override
  String get deleteAccountSignInSurvives =>
      'Your data was deleted, but your sign-in was not: the same email and password can still sign in. The deletion is incomplete.';

  @override
  String get deleteAccountUnknown =>
      'We could not confirm what happened to your account. Do not assume it has been deleted.';

  @override
  String get errorTitle => 'Something went wrong';

  @override
  String get errorMessage =>
      'The app hit an unexpected problem. Restarting usually helps.';

  @override
  String get notFoundTitle => 'Page not found';

  @override
  String get notFoundMessage => 'That address does not exist in this app.';

  @override
  String get goHome => 'Go home';

  @override
  String get offlineMessage =>
      'Could not reach the network. Some things may be out of date.';

  @override
  String get retry => 'Retry';

  @override
  String get signInTitle => 'Sign in';

  @override
  String get signUpTitle => 'Create account';

  @override
  String get email => 'Email';

  @override
  String get password => 'Password';

  @override
  String get signIn => 'Sign in';

  @override
  String get signUp => 'Create account';

  @override
  String get forgotPassword => 'Forgot your password?';

  @override
  String get resetSent =>
      'If that address has an account, a reset link is on its way.';

  @override
  String get emailRequired => 'Enter your email address first.';

  @override
  String get passwordTooShort => 'Use at least 8 characters.';

  @override
  String get needAccount => 'Need an account? Create one';

  @override
  String get haveAccount => 'Already have an account? Sign in';

  @override
  String get continueWithApple => 'Continue with Apple';

  @override
  String get signOut => 'Sign out';

  @override
  String get notifications => 'Notifications';

  @override
  String get remindersEnabled => 'Reminders';

  @override
  String get remindersUnavailable =>
      'Reminders are not available on this platform.';

  @override
  String get permissionPrimingTitle => 'Allow reminders?';

  @override
  String get permissionPrimingBody =>
      'We will ask your device for permission to send reminders. You can change this at any time in Settings.';

  @override
  String get reminderTitle => 'Time for today';

  @override
  String get reminderBody => 'A minute now keeps your streak going.';

  @override
  String get catchUpTitle => 'Your reminder was due';

  @override
  String get catchUpBody =>
      'This device cannot deliver scheduled reminders, so here it is now.';

  @override
  String get catchUpDismiss => 'Got it';

  @override
  String get notNow => 'Not now';

  @override
  String get continueLabel => 'Continue';

  @override
  String get legal => 'Legal';

  @override
  String get privacyPolicy => 'Privacy policy';

  @override
  String get termsOfService => 'Terms of service';

  @override
  String get refundPolicy => 'Refund policy';

  @override
  String get language => 'Language';

  @override
  String get languageSystem => 'System';

  @override
  String get languageEnglish => 'English';

  @override
  String get languageTamil => 'தமிழ்';

  @override
  String get profile => 'Profile';

  @override
  String get displayName => 'Display name';

  @override
  String get displayNameNotSet => 'No name set';

  @override
  String get editProfile => 'Edit profile';

  @override
  String get save => 'Save';

  @override
  String get profileUpdateFailed =>
      'Could not save your name. Nothing was changed.';

  @override
  String get onboarding1Title => 'Welcome';

  @override
  String get onboarding1Body => 'A quick tour, and then you are done.';

  @override
  String get onboarding2Title => 'Yours, on every device';

  @override
  String get onboarding2Body => 'Sign in and your settings follow you.';

  @override
  String get onboarding3Title => 'You are in control';

  @override
  String get onboarding3Body => 'Change your mind at any time in Settings.';

  @override
  String get onboardingSkip => 'Skip';

  @override
  String get onboardingNext => 'Next';

  @override
  String get onboardingStart => 'Get started';

  @override
  String get plan => 'Subscription';

  @override
  String get paywallTitle => 'Upgrade';

  @override
  String get paywallHeadline => 'Unlock the full experience';

  @override
  String get paywallGateMessage =>
      'This part of the app is included with a subscription.';

  @override
  String get paywallUpgrade => 'Upgrade';

  @override
  String get paywallOpening => 'Opening the secure checkout in your browser…';

  @override
  String get paywallPending =>
      'Your payment is being confirmed. This can take a moment — nothing more is needed from you.';

  @override
  String get paywallCheckAgain => 'Check again';

  @override
  String get paywallUnlocked => 'You are all set. Thank you.';

  @override
  String get paywallUnavailable => 'Purchases are not available here.';

  @override
  String paywallTerm(String term) {
    return 'Billed per $term';
  }

  @override
  String paywallTermWithTrial(String term, int days) {
    return 'Billed per $term, after a $days-day free trial';
  }

  @override
  String get managePlanTitle => 'Manage subscription';

  @override
  String get planActive => 'Your subscription is active';

  @override
  String get planInactive => 'You do not have an active subscription';

  @override
  String get restorePurchases => 'Restore purchases';

  @override
  String get restorePurchasesHint =>
      'Signed in on a new device? This re-checks your subscription.';

  @override
  String get cancelPlan => 'Cancel subscription';

  @override
  String get keepPlan => 'Keep it';

  @override
  String get cancelPlanConfirm =>
      'This will end your subscription. You can subscribe again at any time.';

  @override
  String get cancelRecorded =>
      'We have recorded your cancellation and passed it on. Your access continues until the end of the period you have paid for.';

  @override
  String get cancelExecuted => 'Your subscription has been cancelled.';

  @override
  String get cancelNoPlan => 'There is no active subscription on this account.';

  @override
  String get cancelFailed =>
      'We could not cancel your subscription. Nothing has changed — please try again.';
}
