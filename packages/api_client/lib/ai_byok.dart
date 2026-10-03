/// Bring-your-own-key AI: the client half of the AI port (tooling/ports/ai.json).
///
/// One adapter per provider — [AnthropicByok], [OpenAiByok], [GeminiByok] —
/// each over plain HTTP to its provider's documented endpoint, with the USER's
/// key read from `SecureStore` on every call. No request touches a Nikatru host,
/// and nothing is logged. [AiByokCapabilities] says where each one works: web
/// only where the provider documents browser access.
///
/// A separate library from `nikatru_api_client.dart` on purpose: an app that
/// talks to our Worker does not import a provider client by accident, and an
/// app that offers bring-your-own-key names this import.
library;

export 'src/ai_byok/ai_byok_capabilities.dart';
export 'src/ai_byok/anthropic_byok.dart';
export 'src/ai_byok/byok_call.dart' show byokKeyName;
export 'src/ai_byok/gemini_byok.dart';
export 'src/ai_byok/openai_byok.dart';
