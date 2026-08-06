// ─────────────────────────────────────────────────────────────────────────────
// privacy_signal.dart — [pipeline K-15] a DEVICE-level opt-out, honoured
// without a prompt.
//
// Global Privacy Control is a signal the browser sends on the user's behalf:
// `navigator.globalPrivacyControl === true`, and the matching `Sec-GPC: 1`
// request header. Where it applies it is legally binding — Cal. Code Regs.
// tit. 11 §7025, Colorado's UOOM since 2024-07-01, Texas TDPSA since
// 2025-01-01, and nine more states.
//
// ⚖️ WHY THIS IS BUILT RATHER THAN CUT, since the stage file left it as an
// owner decision. GPC attaches to "sale" or "sharing", and this portfolio does
// neither — no ad SDK, a first-party sink, and privacy.html says so — so on
// today's facts the obligation arguably does not attach at all. It is built
// anyway because it is small, it costs NOTHING in data (a GPC user is one who
// would have declined the prompt, so the funnel loses a "no" it was going to
// get), and it is the cheapest good-faith posture the day any app monetises
// through a network. The asymmetry decides it: being wrong about "we didn't
// need it" costs a few lines; being wrong about "it doesn't apply to us" is a
// regulator's finding.
//
// 🔴 A GPC SIGNAL IS NOT A CONSENT ARTIFACT, AND MUST NEVER BE WRITTEN AS ONE.
// It is the device speaking, not the user deciding about this app. Recording it
// as a ConsentArtifact would forge a decision the user never made, and would
// then SURVIVE the signal being switched off. It is read live, every time.
// ─────────────────────────────────────────────────────────────────────────────

import 'privacy_signal_stub.dart'
    if (dart.library.js_interop) 'privacy_signal_web.dart'
    if (dart.library.io) 'privacy_signal_io.dart' as impl;

/// A device-level "do not sell or share" preference, read from the platform.
abstract class PrivacySignal {
  /// True when the platform is asking, on the user's behalf, not to be tracked.
  ///
  /// Read on EVERY consult rather than cached: the user can toggle GPC in the
  /// browser at any moment, and a cached `false` would outlive their turning it
  /// on. Implementations must therefore be cheap and synchronous.
  bool get optedOut;
}

/// The platform's real signal. On Web this reads
/// `navigator.globalPrivacyControl`; everywhere else there is no such concept
/// and it is always false.
///
/// 🔴 FAIL-OPEN IS CORRECT **HERE AND ONLY HERE**, which is the opposite of the
/// consent seam's rule and is worth stating so nobody "fixes" it. If the signal
/// cannot be read, this returns false — meaning "no opt-out signal present",
/// which falls through to the ordinary consent prompt. That asks the user. The
/// fail-CLOSED direction would silently deny analytics on every platform that
/// has no GPC concept at all, i.e. five of six.
PrivacySignal createPrivacySignal() => impl.createPrivacySignal();

/// Always-off signal, for platforms with no such concept and for tests that are
/// not about GPC.
class NoPrivacySignal implements PrivacySignal {
  const NoPrivacySignal();
  @override
  bool get optedOut => false;
}

/// A fixed signal. Test seam — and the ONLY way the K-15 tests can drive the
/// true branch on the VM, where `navigator` does not exist.
class StaticPrivacySignal implements PrivacySignal {
  const StaticPrivacySignal({required bool optedOut}) : _optedOut = optedOut;
  final bool _optedOut;
  @override
  bool get optedOut => _optedOut;
}
