import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_ta.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('ta'),
  ];

  /// The application title shown in the OS task switcher.
  ///
  /// In en, this message translates to:
  /// **'Subly — Subscription Tracker'**
  String get appTitle;

  /// Title of the settings screen.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settingsTitle;

  /// Settings entry that opens a support email.
  ///
  /// In en, this message translates to:
  /// **'Contact support'**
  String get contactSupport;

  /// Settings entry to delete the account and its data.
  ///
  /// In en, this message translates to:
  /// **'Delete account'**
  String get deleteAccount;

  /// Settings section for the light/dark theme choice.
  ///
  /// In en, this message translates to:
  /// **'Appearance'**
  String get appearance;

  /// Theme option that follows the operating system setting.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get themeSystem;

  /// Theme option forcing the light colour scheme.
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get themeLight;

  /// Theme option forcing the dark colour scheme.
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get themeDark;

  /// Explains what the delete-account entry does.
  ///
  /// In en, this message translates to:
  /// **'Permanently delete your account and data'**
  String get deleteAccountSubtitle;

  /// Title of the irreversible delete-account confirmation dialog.
  ///
  /// In en, this message translates to:
  /// **'Delete account?'**
  String get deleteAccountConfirmTitle;

  /// Body of the delete-account confirmation. Must state that the action cannot be undone.
  ///
  /// In en, this message translates to:
  /// **'This permanently deletes your account and all its data. This cannot be undone.'**
  String get deleteAccountConfirmBody;

  /// Dismisses a dialog without acting.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// Confirms the destructive delete action.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get delete;

  /// Opens the standard about dialog.
  ///
  /// In en, this message translates to:
  /// **'About'**
  String get about;

  /// Copyright line in the about dialog. The company name is not translated.
  ///
  /// In en, this message translates to:
  /// **'© Nikatru'**
  String get legalese;

  /// Grants analytics consent. Must be as prominent as the refusal.
  ///
  /// In en, this message translates to:
  /// **'Allow'**
  String get consentAllow;

  /// Refuses analytics consent. A one-sided prompt is a dark pattern, not a choice.
  ///
  /// In en, this message translates to:
  /// **'No thanks'**
  String get consentDecline;

  /// Placeholder home copy in a freshly stamped app.
  ///
  /// In en, this message translates to:
  /// **'Stamped from the NIKATRU app brick.'**
  String get homeTagline;

  /// Home screen greeting.
  ///
  /// In en, this message translates to:
  /// **'Welcome to {appName}'**
  String welcomeTo(String appName);

  /// Consent prompt heading.
  ///
  /// In en, this message translates to:
  /// **'Help improve {appName}?'**
  String consentTitle(String appName);

  /// What the analytics consent actually covers.
  ///
  /// In en, this message translates to:
  /// **'We can record which features you use, so we can see what works and fix what does not.'**
  String get consentBody;

  /// States exactly what is NOT collected. Must stay accurate to the privacy policy.
  ///
  /// In en, this message translates to:
  /// **'No name, no email, no advertising ID and no IP address — just a random code for this installation.'**
  String get consentPrivacy;

  /// Primary navigation destination.
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get navHome;

  /// Secondary navigation destination.
  ///
  /// In en, this message translates to:
  /// **'Explore'**
  String get navExplore;

  /// Settings navigation destination.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get navSettings;

  /// Re-authentication field before an irreversible account deletion.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get deleteAccountPassword;

  /// Explains why a password is required to delete the account.
  ///
  /// In en, this message translates to:
  /// **'Confirm your password to continue.'**
  String get deleteAccountReauthHint;

  /// Shown when deletion fails with nothing removed. Must state plainly that nothing was deleted.
  ///
  /// In en, this message translates to:
  /// **'Could not delete your account. Your account has NOT been deleted.'**
  String get deleteAccountFailed;

  /// The 501 answer: the server cannot remove the identity record, so it refused BEFORE deleting anything. Must not state a turnaround time, a retention period or a legal basis — the published deletion page states none.
  ///
  /// In en, this message translates to:
  /// **'Nothing was deleted. This app cannot complete an account deletion yet, so the request was refused rather than carried out in part. Your account and your data are unchanged.'**
  String get deleteAccountNotConfigured;

  /// The 502 answer: rows purged, identity delete failed. Must NOT say nothing was deleted — the data really is gone and only the login survived.
  ///
  /// In en, this message translates to:
  /// **'Your data was deleted, but your sign-in was not: the same email and password can still sign in. The deletion is incomplete.'**
  String get deleteAccountSignInSurvives;

  /// No response, or a status the contract does not model. How far the deletion got is unknown, so nothing is claimed either way.
  ///
  /// In en, this message translates to:
  /// **'We could not confirm what happened to your account. Do not assume it has been deleted.'**
  String get deleteAccountUnknown;

  /// Heading of the global error screen shown when a widget fails to build.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong'**
  String get errorTitle;

  /// Body of the global error screen. Must offer the user a way forward.
  ///
  /// In en, this message translates to:
  /// **'The app hit an unexpected problem. Restarting usually helps.'**
  String get errorMessage;

  /// Heading of the 404 screen.
  ///
  /// In en, this message translates to:
  /// **'Page not found'**
  String get notFoundTitle;

  /// Body of the 404 screen.
  ///
  /// In en, this message translates to:
  /// **'That address does not exist in this app.'**
  String get notFoundMessage;

  /// Returns the user to the home screen from an error or 404.
  ///
  /// In en, this message translates to:
  /// **'Go home'**
  String get goHome;

  /// Shown when a request failed — driven by a failed request, not a connectivity plugin.
  ///
  /// In en, this message translates to:
  /// **'Could not reach the network. Some things may be out of date.'**
  String get offlineMessage;

  /// Retries the action that failed.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get retry;

  /// Title of the sign-in screen.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get signInTitle;

  /// Title of the sign-up screen.
  ///
  /// In en, this message translates to:
  /// **'Create account'**
  String get signUpTitle;

  /// Email field label.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get email;

  /// Password field label.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get password;

  /// Submits the sign-in form.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get signIn;

  /// Submits the sign-up form.
  ///
  /// In en, this message translates to:
  /// **'Create account'**
  String get signUp;

  /// Sends a password-reset email.
  ///
  /// In en, this message translates to:
  /// **'Forgot your password?'**
  String get forgotPassword;

  /// Deliberately does NOT confirm whether the account exists — that would let anyone test which emails are registered.
  ///
  /// In en, this message translates to:
  /// **'If that address has an account, a reset link is on its way.'**
  String get resetSent;

  /// Shown when a password reset is requested with an empty email field.
  ///
  /// In en, this message translates to:
  /// **'Enter your email address first.'**
  String get emailRequired;

  /// Client-side length check before sending a sign-up.
  ///
  /// In en, this message translates to:
  /// **'Use at least 8 characters.'**
  String get passwordTooShort;

  /// Link from sign-in to sign-up.
  ///
  /// In en, this message translates to:
  /// **'Need an account? Create one'**
  String get needAccount;

  /// Link from sign-up to sign-in.
  ///
  /// In en, this message translates to:
  /// **'Already have an account? Sign in'**
  String get haveAccount;

  /// OAuth sign-in. Shown only where the platform can complete a redirect.
  ///
  /// In en, this message translates to:
  /// **'Continue with Apple'**
  String get continueWithApple;

  /// Ends the session on this device.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get signOut;

  /// Settings section for reminders.
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get notifications;

  /// Toggle for scheduled reminders.
  ///
  /// In en, this message translates to:
  /// **'Reminders'**
  String get remindersEnabled;

  /// Shown INSTEAD of the toggle where the platform cannot schedule — a switch that silently does nothing is worse than an honest sentence.
  ///
  /// In en, this message translates to:
  /// **'Reminders are not available on this platform.'**
  String get remindersUnavailable;

  /// Heading of the pre-permission explanation.
  ///
  /// In en, this message translates to:
  /// **'Allow reminders?'**
  String get permissionPrimingTitle;

  /// Explains WHY before the OS prompt appears. The OS prompt can only be shown once on most platforms, so a refusal there is effectively permanent.
  ///
  /// In en, this message translates to:
  /// **'We will ask your device for permission to send reminders. You can change this at any time in Settings.'**
  String get permissionPrimingBody;

  /// Title of the scheduled daily notification itself — the text the OS shows on the lock screen, NOT a settings label. Deliberately app-neutral: a stamped app should replace it with its own hook.
  ///
  /// In en, this message translates to:
  /// **'Time for today'**
  String get reminderTitle;

  /// Body of the scheduled daily notification. Kept short — most platforms truncate a collapsed notification to roughly one line.
  ///
  /// In en, this message translates to:
  /// **'A minute now keeps your streak going.'**
  String get reminderBody;

  /// Heading of the IN-APP catch-up nudge, shown on platforms whose OS cannot schedule a repeating notification (Web, Windows, Linux). It appears the next time the app is opened after the reminder's moment has passed — there is no background work to lean on.
  ///
  /// In en, this message translates to:
  /// **'Your reminder was due'**
  String get catchUpTitle;

  /// Says PLAINLY why the reminder arrives inside the app instead of from the system. A vague banner would read as a bug.
  ///
  /// In en, this message translates to:
  /// **'This device cannot deliver scheduled reminders, so here it is now.'**
  String get catchUpBody;

  /// Dismisses the catch-up nudge for this occurrence. It never re-appears for the same day's reminder.
  ///
  /// In en, this message translates to:
  /// **'Got it'**
  String get catchUpDismiss;

  /// Declines the priming dialog WITHOUT spending the one OS prompt.
  ///
  /// In en, this message translates to:
  /// **'Not now'**
  String get notNow;

  /// Proceeds to the OS permission prompt.
  ///
  /// In en, this message translates to:
  /// **'Continue'**
  String get continueLabel;

  /// Settings section for the policy documents.
  ///
  /// In en, this message translates to:
  /// **'Legal'**
  String get legal;

  /// Opens the privacy policy. Both stores require it to be reachable in-app.
  ///
  /// In en, this message translates to:
  /// **'Privacy policy'**
  String get privacyPolicy;

  /// Opens the terms of service.
  ///
  /// In en, this message translates to:
  /// **'Terms of service'**
  String get termsOfService;

  /// Opens the refund policy. [pipeline 8]K-6 — the third published legal page; the in-app set must equal the published set.
  ///
  /// In en, this message translates to:
  /// **'Refund policy'**
  String get refundPolicy;

  /// Settings section for the app language.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get language;

  /// Follow the device language.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get languageSystem;

  /// Language names are shown in their OWN language, so a speaker can find theirs without reading the current one.
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get languageEnglish;

  /// Tamil, written in Tamil — see languageEnglish.
  ///
  /// In en, this message translates to:
  /// **'தமிழ்'**
  String get languageTamil;

  /// Settings section for the user's own account details.
  ///
  /// In en, this message translates to:
  /// **'Profile'**
  String get profile;

  /// The name shown to the user in the app. Editable.
  ///
  /// In en, this message translates to:
  /// **'Display name'**
  String get displayName;

  /// Shown in place of the display name when the user has not chosen one. An empty line would read as a rendering fault.
  ///
  /// In en, this message translates to:
  /// **'No name set'**
  String get displayNameNotSet;

  /// Title of the dialog for changing the display name.
  ///
  /// In en, this message translates to:
  /// **'Edit profile'**
  String get editProfile;

  /// Commits an edit.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get save;

  /// Shown when the profile update fails. Must state plainly that nothing changed: 'saved' on a failed write is a lie the user only discovers at their next launch.
  ///
  /// In en, this message translates to:
  /// **'Could not save your name. Nothing was changed.'**
  String get profileUpdateFailed;

  /// First onboarding page heading. Overridable per app via AppConfig.copy['onboarding.1.title'] — this is the CHASSIS DEFAULT, shown by a freshly stamped app that has overridden nothing, so it must not promise a feature the chassis does not have.
  ///
  /// In en, this message translates to:
  /// **'Welcome'**
  String get onboarding1Title;

  /// First onboarding page body. See onboarding1Title.
  ///
  /// In en, this message translates to:
  /// **'A quick tour, and then you are done.'**
  String get onboarding1Body;

  /// Second onboarding page heading. Overridable via AppConfig.copy['onboarding.2.title'].
  ///
  /// In en, this message translates to:
  /// **'Yours, on every device'**
  String get onboarding2Title;

  /// Second onboarding page body.
  ///
  /// In en, this message translates to:
  /// **'Sign in and your settings follow you.'**
  String get onboarding2Body;

  /// Third onboarding page heading. Overridable via AppConfig.copy['onboarding.3.title'].
  ///
  /// In en, this message translates to:
  /// **'You are in control'**
  String get onboarding3Title;

  /// Third onboarding page body. Deliberately points at Settings, which every stamped app really has.
  ///
  /// In en, this message translates to:
  /// **'Change your mind at any time in Settings.'**
  String get onboarding3Body;

  /// Leaves onboarding immediately. Present on EVERY page: onboarding a user cannot leave is a wall, not an introduction.
  ///
  /// In en, this message translates to:
  /// **'Skip'**
  String get onboardingSkip;

  /// Advances to the next onboarding page.
  ///
  /// In en, this message translates to:
  /// **'Next'**
  String get onboardingNext;

  /// Finishes onboarding on the last page.
  ///
  /// In en, this message translates to:
  /// **'Get started'**
  String get onboardingStart;

  /// Settings section for the money rail. Upgrade and Manage sit side by side so cancelling is never buried deeper than subscribing (ROSCA).
  ///
  /// In en, this message translates to:
  /// **'Subscription'**
  String get plan;

  /// App-bar title of the paywall screen.
  ///
  /// In en, this message translates to:
  /// **'Upgrade'**
  String get paywallTitle;

  /// Paywall heading, also used as the in-place PaywallGate title. CHASSIS DEFAULT — a freshly stamped app that has overridden nothing shows this, so it must not promise a feature the chassis does not have.
  ///
  /// In en, this message translates to:
  /// **'Unlock the full experience'**
  String get paywallHeadline;

  /// Shown in place of a gated surface. States a fact, never a countdown or a discount — the chassis knows neither.
  ///
  /// In en, this message translates to:
  /// **'This part of the app is included with a subscription.'**
  String get paywallGateMessage;

  /// The call to action that opens the checkout.
  ///
  /// In en, this message translates to:
  /// **'Upgrade'**
  String get paywallUpgrade;

  /// Shown while the hosted checkout is being handed to the platform. Names the BROWSER deliberately: the page opens outside the app, and a user who is not told that reads the app-switch as a crash.
  ///
  /// In en, this message translates to:
  /// **'Opening the secure checkout in your browser…'**
  String get paywallOpening;

  /// 🔴 MUST NEVER READ AS A FAILURE. The user may well have paid; the merchant of record's notification simply has not reached our server yet. Saying 'purchase failed' here tells a paying customer their money vanished. WORDING IS A HUMAN DECISION — a green CI lane proves the mechanism, not this sentence.
  ///
  /// In en, this message translates to:
  /// **'Your payment is being confirmed. This can take a moment — nothing more is needed from you.'**
  String get paywallPending;

  /// Re-reads the entitlement from the server. Present because the automatic wait is BOUNDED — five attempts over about a minute — and a user whose purchase lands after that needs something to press other than the back button.
  ///
  /// In en, this message translates to:
  /// **'Check again'**
  String get paywallCheckAgain;

  /// Shown only after the SERVER confirms the entitlement, never on the checkout's return.
  ///
  /// In en, this message translates to:
  /// **'You are all set. Thank you.'**
  String get paywallUnlocked;

  /// Shown when the rail is unconfigured, or when the store this build ships through forbids an external checkout. The specific reason is shown beneath it — a refusal with no reason is indistinguishable from a broken button.
  ///
  /// In en, this message translates to:
  /// **'Purchases are not available here.'**
  String get paywallUnavailable;

  /// The billing period, from the rail config. NOT a price — the price is formatted from the rail's own amount and currency and is never typed into the app.
  ///
  /// In en, this message translates to:
  /// **'Billed per {term}'**
  String paywallTerm(String term);

  /// As paywallTerm, with the trial length from the rail config.
  ///
  /// In en, this message translates to:
  /// **'Billed per {term}, after a {days}-day free trial'**
  String paywallTermWithTrial(String term, int days);

  /// App-bar title of the manage screen, and the settings entry that opens it.
  ///
  /// In en, this message translates to:
  /// **'Manage subscription'**
  String get managePlanTitle;

  /// Reflects the SERVER's entitlement answer, not a local flag.
  ///
  /// In en, this message translates to:
  /// **'Your subscription is active'**
  String get planActive;

  /// See subscriptionActive.
  ///
  /// In en, this message translates to:
  /// **'You do not have an active subscription'**
  String get planInactive;

  /// Re-reads the entitlement from the server. On this rail the entitlement is a server row keyed to the account, so signing in IS the restore — but Apple guideline 3.1.1 makes an explicit control mandatory the day a native IAP rail ships, and its absence is a documented rejection cause.
  ///
  /// In en, this message translates to:
  /// **'Restore purchases'**
  String get restorePurchases;

  /// Explains what the control does in terms of the user's situation rather than the mechanism.
  ///
  /// In en, this message translates to:
  /// **'Signed in on a new device? This re-checks your subscription.'**
  String get restorePurchasesHint;

  /// Starts the cancellation. One tap from Manage, which is one tap from Settings — the same depth as Upgrade (ROSCA).
  ///
  /// In en, this message translates to:
  /// **'Cancel subscription'**
  String get cancelPlan;

  /// Dismisses the cancellation confirmation.
  ///
  /// In en, this message translates to:
  /// **'Keep it'**
  String get keepPlan;

  /// The confirmation body. States what happens and that it is reversible; makes no retention offer, because a cancel flow that bargains is the pattern ROSCA exists to stop.
  ///
  /// In en, this message translates to:
  /// **'This will end your subscription. You can subscribe again at any time.'**
  String get cancelPlanConfirm;

  /// 🔴 THE HONEST SENTENCE FOR THE STATE THAT IS REAL TODAY. Our server recorded the request; the merchant of record has not yet confirmed it. Saying 'cancelled' here would be the app asserting an outcome it has no evidence for, while the billing continues.
  ///
  /// In en, this message translates to:
  /// **'We have recorded your cancellation and passed it on. Your access continues until the end of the period you have paid for.'**
  String get cancelRecorded;

  /// Said ONLY when the merchant of record confirms. Distinct from cancelRecorded on purpose.
  ///
  /// In en, this message translates to:
  /// **'Your subscription has been cancelled.'**
  String get cancelExecuted;

  /// The server found nothing to cancel.
  ///
  /// In en, this message translates to:
  /// **'There is no active subscription on this account.'**
  String get cancelNoPlan;

  /// States plainly that nothing changed. A cancellation that silently did not happen is the worst outcome this screen has, and it must never be reported as success.
  ///
  /// In en, this message translates to:
  /// **'We could not cancel your subscription. Nothing has changed — please try again.'**
  String get cancelFailed;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'ta'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'ta':
      return AppLocalizationsTa();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
