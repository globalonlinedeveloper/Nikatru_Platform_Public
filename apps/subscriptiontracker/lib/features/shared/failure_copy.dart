import 'package:nikatru_api_client/nikatru_api_client.dart' show ApiException;

import '../../l10n/app_localizations.dart';

/// The sentence for a failed WRITE, picked by its CAUSE (DE-09, audit B08).
///
/// 🔴 EVERY FAILURE USED TO SAY "CHECK YOUR CONNECTION" — a 400 the server
/// refused, a 500 it threw and a request that never left the device all read
/// the same, so a user whose change was REFUSED was sent to fix a network that
/// was fine. The remedy differs by cause, so the words do:
///   · no answer at all ([ApiException.isOffline]) → offline;
///   · 4xx → the change was refused (retrying the same change will not help);
///   · 5xx → the server had a problem (retrying later may);
///   · anything else → a plain "couldn't save", which blames nobody.
///
/// [fallback] replaces only that last sentence, for a caller that can name
/// WHAT was being saved (the reminder rows name the subscription, B09).
String writeFailureMessage(
  AppLocalizations l10n,
  Object error, {
  String? fallback,
}) {
  if (error is ApiException) {
    if (error.isOffline) return l10n.changeOffline;
    if (error.statusCode >= 400 && error.statusCode < 500) {
      return l10n.changeRefused;
    }
    if (error.statusCode >= 500) return l10n.changeServerError;
  }
  return fallback ?? l10n.changeFailed;
}
