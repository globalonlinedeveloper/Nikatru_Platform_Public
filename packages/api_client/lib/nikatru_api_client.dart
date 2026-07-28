/// Generic, auth-agnostic HTTP client for NIKATRU app backends (Cloudflare
/// Workers). Inject a base URL and a token provider; no auth SDK, no app-config
/// coupling, and — by design — no app domain models. Per-app domain clients
/// build on top of [RestClient].
library;

export 'src/http_capabilities.dart';
export 'src/dio_config_transport.dart';
export 'src/dio_consent_transport.dart';
export 'src/dio_event_transport.dart';
export 'src/rest_client.dart';
