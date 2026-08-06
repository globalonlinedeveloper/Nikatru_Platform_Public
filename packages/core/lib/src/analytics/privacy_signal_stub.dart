// [pipeline K-15] — the default arm of the conditional import.
//
// Reached only on a platform that has neither dart:io nor dart:js_interop.
// No such target ships today; it exists so the import resolves rather than
// failing to compile, and it answers the same as every non-web platform.
import 'privacy_signal.dart';

PrivacySignal createPrivacySignal() => const NoPrivacySignal();
