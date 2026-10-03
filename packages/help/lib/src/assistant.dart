import 'search.dart';

/// THE HELP ASSISTANT SEAM (lane help-search, Do 8). Today the help centre
/// answers from search alone: [SearchOnlyAssistant] returns the ranked
/// articles and nothing else, at no cost per question. A chat that answers in
/// words is lane help-ai-chat's to build, on the AI meter, and it is shown ONLY
/// when [helpChatAvailable] says so: the remote flag is on AND the person has
/// Pro AND they hold AI credits. AI on this platform is paid only — never a
/// free tier, a trial or "first N free" — so zero credits is no chat entry,
/// whatever the flag says.
abstract interface class HelpAssistant {
  /// The articles (and, for a future chat, the words) that answer [query].
  List<HelpHit> answer(HelpIndex index, String query, {Set<String>? scopes});
}

/// The default, and today the only, assistant: the index's own ranking.
class SearchOnlyAssistant implements HelpAssistant {
  const SearchOnlyAssistant();

  @override
  List<HelpHit> answer(HelpIndex index, String query, {Set<String>? scopes}) =>
      index.search(query, scopes: scopes);
}

/// What decides whether a chat entry may be shown at all.
class HelpChatGate {
  const HelpChatGate({
    this.flagOn = false,
    this.hasPro = false,
    this.aiCredits = 0,
  });

  /// The remote config flag for the help chat.
  final bool flagOn;

  /// The person's plan includes Pro.
  final bool hasPro;

  /// The AI credits the person holds on the meter.
  final int aiCredits;

  /// Off: the gate every app passes until lane help-ai-chat wires the three
  /// facts above to the config flag, the entitlement and the meter.
  static const HelpChatGate off = HelpChatGate();
}

/// A chat entry is shown only when all three hold.
bool helpChatAvailable(HelpChatGate gate) =>
    gate.flagOn && gate.hasPro && gate.aiCredits > 0;
