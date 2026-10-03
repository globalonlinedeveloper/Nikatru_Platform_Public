/// Where each bring-your-own-key AI adapter works — [pipeline C-7].
///
/// 🔴 WEB IS SUPPORTED ONLY WHERE THE PROVIDER DOCUMENTS BROWSER ACCESS. A
/// browser enforces CORS, and a provider that does not say it accepts calls
/// from a page is a provider whose next CORS change breaks the feature with no
/// notice. So each provider's web row is what its own documentation says,
/// read 2026-10-02 (tooling/ports/ai.json `readAt`):
///   · Anthropic — the official SDK's `dangerouslyAllowBrowser` option sends
///     `anthropic-dangerous-direct-browser-access: true`, the opt-in the
///     Messages API requires of a browser caller
///     (https://github.com/anthropics/anthropic-sdk-typescript, src/client.ts).
///     SUPPORTED, with that header. The key is the USER's own, in their own
///     browser — the case the header exists for.
///   · OpenAI — no documented browser access: its API does not answer a
///     browser origin, and its docs route keys through a server. UNSUPPORTED.
///   · Gemini — "Never expose keys client-side in production … run a backend
///     proxy server" (https://ai.google.dev/gemini-api/docs/api-key).
///     UNSUPPORTED.
/// Every other platform calls each provider directly over dio.
///
/// Pure Dart like [HttpCapabilities], so the platform is [HttpPlatform] and the
/// caller maps its `TargetPlatform` onto it.
library;

import '../http_capabilities.dart';

/// The providers a user can bring a key for.
enum AiByokProvider { anthropic, openai, gemini }

class AiByokCapabilities {
  const AiByokCapabilities({
    required this.supported,
    required this.browserHeaders,
    required this.note,
  });

  /// Whether this provider can be called from this platform at all.
  final bool supported;

  /// Headers the provider documents for a call from a browser (web only).
  final Map<String, String> browserHeaders;

  /// Why, in one line, when the platform differs. Empty when it does not.
  final String note;

  static const AiByokCapabilities _native = AiByokCapabilities(
    supported: true,
    browserHeaders: <String, String>{},
    note: '',
  );

  /// The capabilities of [provider] on [platform].
  static AiByokCapabilities forPlatform(
    HttpPlatform platform,
    AiByokProvider provider,
  ) {
    return switch (platform) {
      HttpPlatform.web => switch (provider) {
        AiByokProvider.anthropic => const AiByokCapabilities(
          supported: true,
          browserHeaders: <String, String>{
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          note:
              'Web: Anthropic documents direct browser access with the '
              'anthropic-dangerous-direct-browser-access opt-in header.',
        ),
        AiByokProvider.openai => const AiByokCapabilities(
          supported: false,
          browserHeaders: <String, String>{},
          note:
              'Web: OpenAI documents no browser access, so a call from a '
              'page is not offered.',
        ),
        AiByokProvider.gemini => const AiByokCapabilities(
          supported: false,
          browserHeaders: <String, String>{},
          note:
              'Web: Gemini documents no browser access (its key guidance '
              'says to call through a server), so a call from a page is not '
              'offered.',
        ),
      },
      HttpPlatform.android ||
      HttpPlatform.iOS ||
      HttpPlatform.macOS ||
      HttpPlatform.windows ||
      HttpPlatform.linux => _native,
      HttpPlatform.fuchsia => const AiByokCapabilities(
        supported: false,
        browserHeaders: <String, String>{},
        note: 'Fuchsia is not a target platform for this portfolio.',
      ),
    };
  }
}
