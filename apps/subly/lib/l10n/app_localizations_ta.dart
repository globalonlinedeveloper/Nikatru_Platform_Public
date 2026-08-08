// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Tamil (`ta`).
class AppLocalizationsTa extends AppLocalizations {
  AppLocalizationsTa([String locale = 'ta']) : super(locale);

  @override
  String get appTitle => 'Subly — Subscription Tracker';

  @override
  String get settingsTitle => 'அமைப்புகள்';

  @override
  String get contactSupport => 'ஆதரவைத் தொடர்பு கொள்ளவும்';

  @override
  String get deleteAccount => 'கணக்கை நீக்கு';

  @override
  String get appearance => 'தோற்றம்';

  @override
  String get themeSystem => 'சாதன அமைப்பு';

  @override
  String get themeLight => 'வெளிர்';

  @override
  String get themeDark => 'இருள்';

  @override
  String get deleteAccountSubtitle =>
      'உங்கள் கணக்கையும் தரவையும் நிரந்தரமாக நீக்கும்';

  @override
  String get deleteAccountConfirmTitle => 'கணக்கை நீக்கவா?';

  @override
  String get deleteAccountConfirmBody =>
      'இது உங்கள் கணக்கையும் அதன் அனைத்து தரவையும் நிரந்தரமாக நீக்கும். இதைத் திரும்பப் பெற முடியாது.';

  @override
  String get cancel => 'ரத்து செய்';

  @override
  String get delete => 'நீக்கு';

  @override
  String get about => 'பற்றி';

  @override
  String get legalese => '© Nikatru';

  @override
  String get consentAllow => 'அனுமதி';

  @override
  String get consentDecline => 'வேண்டாம்';

  @override
  String get homeTagline => 'NIKATRU செயலி அச்சிலிருந்து உருவாக்கப்பட்டது.';

  @override
  String welcomeTo(String appName) {
    return '$appName க்கு வரவேற்கிறோம்';
  }

  @override
  String consentTitle(String appName) {
    return '$appName ஐ மேம்படுத்த உதவுங்களா?';
  }

  @override
  String get consentBody =>
      'நீங்கள் எந்த அம்சங்களைப் பயன்படுத்துகிறீர்கள் என்பதை நாங்கள் பதிவு செய்யலாம், இதனால் எது வேலை செய்கிறது என்பதைப் பார்த்து, வேலை செய்யாததைச் சரிசெய்ய முடியும்.';

  @override
  String get consentPrivacy =>
      'பெயர் இல்லை, மின்னஞ்சல் இல்லை, விளம்பர ID இல்லை, IP முகவரி இல்லை — இந்த நிறுவலுக்கான ஒரு சீரற்ற குறியீடு மட்டுமே.';

  @override
  String get navHome => 'முகப்பு';

  @override
  String get navExplore => 'ஆராய்';

  @override
  String get navSettings => 'அமைப்புகள்';

  @override
  String get deleteAccountPassword => 'கடவுச்சொல்';

  @override
  String get deleteAccountReauthHint =>
      'தொடர உங்கள் கடவுச்சொல்லை உறுதிப்படுத்தவும்.';

  @override
  String get deleteAccountFailed =>
      'உங்கள் கணக்கை நீக்க முடியவில்லை. உங்கள் கணக்கு நீக்கப்படவில்லை.';

  @override
  String get deleteAccountNotConfigured =>
      'எதுவும் நீக்கப்படவில்லை. இந்தச் செயலியால் இப்போது கணக்கை முழுமையாக நீக்க முடியாததால், பகுதியாக நீக்காமல் கோரிக்கை நிராகரிக்கப்பட்டது. உங்கள் கணக்கும் தரவும் மாறாமல் உள்ளன.';

  @override
  String get deleteAccountSignInSurvives =>
      'உங்கள் தரவு நீக்கப்பட்டது, ஆனால் உங்கள் உள்நுழைவு நீக்கப்படவில்லை: அதே மின்னஞ்சல் மற்றும் கடவுச்சோல் இன்னும் உள்நுழைய முடியும். நீக்கம் முழுமையடையவில்லை.';

  @override
  String get deleteAccountUnknown =>
      'உங்கள் கணக்கிற்கு என்ன நடந்தது என்பதை உறுதிப்படுத்த முடியவில்லை. அது நீக்கப்பட்டதாக கருத வேண்டாம்.';

  @override
  String get errorTitle => 'ஏதோ தவறு நடந்தது';

  @override
  String get errorMessage =>
      'செயலியில் எதிர்பாராத சிக்கல் ஏற்பட்டது. மறுதொடக்கம் செய்வது பொதுவாக உதவும்.';

  @override
  String get notFoundTitle => 'பக்கம் கிடைக்கவில்லை';

  @override
  String get notFoundMessage => 'அந்த முகவரி இந்தச் செயலியில் இல்லை.';

  @override
  String get goHome => 'முகப்புக்குச் செல்';

  @override
  String get offlineMessage =>
      'நெட்வொர்க்கை அணுக முடியவில்லை. சில தகவல்கள் பழையதாக இருக்கலாம்.';

  @override
  String get retry => 'மீண்டும் முயற்சி';

  @override
  String get signInTitle => 'உள்நுழைக';

  @override
  String get signUpTitle => 'கணக்கை உருவாக்கு';

  @override
  String get email => 'மின்னஞ்சல்';

  @override
  String get password => 'கடவுச்சொல்';

  @override
  String get signIn => 'உள்நுழை';

  @override
  String get signUp => 'கணக்கை உருவாக்கு';

  @override
  String get forgotPassword => 'கடவுச்சொல்லை மறந்துவிட்டீர்களா?';

  @override
  String get resetSent =>
      'அந்த முகவரிக்குக் கணக்கு இருந்தால், மீட்டமைப்பு இணைப்பு அனுப்பப்படும்.';

  @override
  String get emailRequired => 'முதலில் உங்கள் மின்னஞ்சல் முகவரியை உள்ளிடவும்.';

  @override
  String get passwordTooShort => 'குறைந்தது 8 எழுத்துகளைப் பயன்படுத்தவும்.';

  @override
  String get needAccount => 'கணக்கு தேவையா? ஒன்றை உருவாக்குங்கள்';

  @override
  String get haveAccount => 'ஏற்கனவே கணக்கு உள்ளதா? உள்நுழையவும்';

  @override
  String get continueWithApple => 'Apple மூலம் தொடரவும்';

  @override
  String get signOut => 'வெளியேறு';

  @override
  String get notifications => 'அறிவிப்புகள்';

  @override
  String get remindersEnabled => 'நினைவூட்டல்கள்';

  @override
  String get remindersUnavailable =>
      'இந்தத் தளத்தில் நினைவூட்டல்கள் கிடைக்கவில்லை.';

  @override
  String get permissionPrimingTitle => 'நினைவூட்டல்களை அனுமதிக்கவா?';

  @override
  String get permissionPrimingBody =>
      'நினைவூட்டல்களை அனுப்ப உங்கள் சாதனத்திடம் அனுமதி கேட்போம். இதை எப்போது வேண்டுமானாலும் அமைப்புகளில் மாற்றலாம்.';

  @override
  String get reminderTitle => 'இன்றைக்கான நேரம்';

  @override
  String get reminderBody =>
      'ஒரு நிமிடம் செலவழித்தால் உங்கள் தொடர் நீடிக்கும்.';

  @override
  String get catchUpTitle => 'உங்கள் நினைவூட்டல் நேரம் வந்துவிட்டது';

  @override
  String get catchUpBody =>
      'இந்தச் சாதனத்தில் திட்டமிட்ட நினைவூட்டல்களை அனுப்ப முடியாது, எனவே இதோ இப்போது.';

  @override
  String get catchUpDismiss => 'சரி';

  @override
  String get notNow => 'இப்போது வேண்டாம்';

  @override
  String get continueLabel => 'தொடரவும்';

  @override
  String get legal => 'சட்டப்பூர்வம்';

  @override
  String get privacyPolicy => 'தனியுரிமைக் கொள்கை';

  @override
  String get termsOfService => 'சேவை விதிமுறைகள்';

  @override
  String get refundPolicy => 'பணம் திருப்பி கோட்பாடு';

  @override
  String get language => 'மொழி';

  @override
  String get languageSystem => 'சாதன மொழி';

  @override
  String get languageEnglish => 'English';

  @override
  String get languageTamil => 'தமிழ்';

  @override
  String get profile => 'சுயவிவரம்';

  @override
  String get displayName => 'காட்சிப் பெயர்';

  @override
  String get displayNameNotSet => 'பெயர் அமைக்கப்படவில்லை';

  @override
  String get editProfile => 'சுயவிவரத்தைத் திருத்து';

  @override
  String get save => 'சேமி';

  @override
  String get profileUpdateFailed =>
      'உங்கள் பெயரைச் சேமிக்க முடியவில்லை. எதுவும் மாற்றப்படவில்லை.';

  @override
  String get onboarding1Title => 'வரவேற்கிறோம்';

  @override
  String get onboarding1Body => 'ஒரு சிறு அறிமுகம், அவ்வளவுதான்.';

  @override
  String get onboarding2Title => 'எல்லா சாதனங்களிலும் உங்களுடையது';

  @override
  String get onboarding2Body =>
      'உள்நுழைந்தால் உங்கள் அமைப்புகள் உங்களைப் பின்தொடரும்.';

  @override
  String get onboarding3Title => 'கட்டுப்பாடு உங்களிடம்';

  @override
  String get onboarding3Body =>
      'எப்போது வேண்டுமானாலும் அமைப்புகளில் மாற்றிக்கொள்ளலாம்.';

  @override
  String get onboardingSkip => 'தவிர்';

  @override
  String get onboardingNext => 'அடுத்து';

  @override
  String get onboardingStart => 'தொடங்கு';

  @override
  String get plan => 'சந்தா';

  @override
  String get paywallTitle => 'மேம்படுத்து';

  @override
  String get paywallHeadline => 'முழு அனுபவத்தைத் திறக்கவும்';

  @override
  String get paywallGateMessage => 'இந்தப் பகுதி சந்தாவில் சேர்ந்தது.';

  @override
  String get paywallUpgrade => 'மேம்படுத்து';

  @override
  String get paywallOpening =>
      'உங்கள் உலாவியில் பாதுகாப்பான கட்டணப் பக்கம் திறக்கப்படுகிறது…';

  @override
  String get paywallPending =>
      'உங்கள் கட்டணம் உறுதிப்படுத்தப்படுகிறது. சிறிது நேரம் ஆகலாம் — உங்களிடமிருந்து வேறெதுவும் தேவையில்லை.';

  @override
  String get paywallCheckAgain => 'மீண்டும் சரிபார்';

  @override
  String get paywallUnlocked => 'எல்லாம் தயார். நன்றி.';

  @override
  String get paywallUnavailable => 'இங்கு வாங்குதல் கிடையாது.';

  @override
  String paywallTerm(String term) {
    return 'ஒரு $term க்கு கட்டணம்';
  }

  @override
  String paywallTermWithTrial(String term, int days) {
    return '$days நாள் இலவச சோதனைக்குப் பிறகு, ஒரு $term க்கு கட்டணம்';
  }

  @override
  String get managePlanTitle => 'சந்தாவை நிர்வகி';

  @override
  String get planActive => 'உங்கள் சந்தா செயலில் உள்ளது';

  @override
  String get planInactive => 'செயலில் உள்ள சந்தா ஏதுமில்லை';

  @override
  String get restorePurchases => 'வாங்கியவை மீட்டெடு';

  @override
  String get restorePurchasesHint =>
      'புதிய சாதனத்தில் உள்நுழைந்தீர்களா? உங்கள் சந்தா மீண்டும் சரிபார்க்கப்படும்.';

  @override
  String get cancelPlan => 'சந்தாவை ரத்துசெய்';

  @override
  String get keepPlan => 'வைத்திரு';

  @override
  String get cancelPlanConfirm =>
      'இது உங்கள் சந்தாவை முடிவுக்குக் கொண்டுவரும். எப்போது வேண்டுமானாலும் மீண்டும் சேரலாம்.';

  @override
  String get cancelRecorded =>
      'உங்கள் ரத்துக்கோரிக்கை பதிவுசெய்யப்பட்டது. நீங்கள் பணம் செலுத்திய காலகட்டம் முடியும் வரை அணுகல் தொடரும்.';

  @override
  String get cancelExecuted => 'உங்கள் சந்தா ரத்துசெய்யப்பட்டது.';

  @override
  String get cancelNoPlan => 'இந்தக் கணக்கில் செயலில் உள்ள சந்தா ஏதுமில்லை.';

  @override
  String get cancelFailed =>
      'உங்கள் சந்தாவை ரத்துசெய்ய முடியவில்லை. எதுவும் மாற்றப்படவில்லை — மீண்டும் முயற்சிக்கவும்.';
}
