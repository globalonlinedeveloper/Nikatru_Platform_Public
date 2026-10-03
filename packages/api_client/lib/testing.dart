/// Test support for the AI port's client half: the bring-your-own-key fake and
/// the conformance suite every client adapter passes
/// (tooling/ports/README.md §3 — each seam package exports `lib/testing.dart`).
library;

export 'src/ai_byok/ai_provider_conformance.dart';
export 'src/ai_byok/fake_ai_provider.dart';
