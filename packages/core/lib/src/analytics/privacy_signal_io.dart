// [pipeline K-15] — the non-web arm of the conditional import.
//
// GPC is a browser concept. iOS, Android, Windows, macOS and Linux have no
// equivalent device signal, so there is nothing to read and the honest answer
// is "no opt-out signal present" — which falls through to the ordinary consent
// prompt rather than denying silently.
import 'privacy_signal.dart';

PrivacySignal createPrivacySignal() => const NoPrivacySignal();
