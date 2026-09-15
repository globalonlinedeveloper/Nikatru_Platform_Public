/// The store's age signal at sign-up — [ADR 082], amended §5 "Same gate
/// everywhere" (owner, 2026-09-15).
///
/// One sign-up flow on every target. The existing 18+ declaration
/// (`legalAcceptTerms`) stays exactly as it is. On top of it:
///
///   · a store signal that says BELOW ADULT → no account is created and no terms
///     are recorded as agreed ([SignUpAgeGate.refuse]);
///   · a store signal that says ADULT → sign-up proceeds
///     ([SignUpAgeGate.proceedOnStoreSignal]);
///   · NO SIGNAL — no API on the target, not eligible, declined, unavailable, an
///     error — → sign-up proceeds on the declaration
///     ([SignUpAgeGate.proceedOnDeclaration]). That is a STATED branch with its
///     own reason, never a silent "adult".
///
/// PURE, IN `core`: every sign-up door (the live app's two screens, the chassis
/// `SignUpView`, the brick adapter) asks the same three-way question through
/// [signUpAgeGate], so the doors cannot disagree about what a signal means.
/// Which platform API is read is decided by [ageSignalSourceFor]; the adapters
/// that read Apple's Declared Age Range and Google Play's Age Signals are
/// injected there, and a host with no adapter reads [NoAgeSignalSource].
///
/// Web sign-up is outside Texas Business & Commerce Code chapter 121 (it applies
/// to apps "made available to users in this state through an app store",
/// §121.051) and keeps its current path: web reads no signal.
library;

/// Why no age signal came back. Each is a stated reason, logged and tested; none
/// of them is treated as "adult".
enum NoAgeSignalReason {
  /// The target has no store age API this app can call (web, Linux/Snap,
  /// Windows outside the Insider channel, macOS where the OS reports no age
  /// assurance, apps-gov-in).
  noApiOnTarget,

  /// The store API exists but says this user or region is not covered
  /// (Apple `isEligibleForAgeFeatures == false`).
  notEligible,

  /// The person (or their parent) chose not to share (Apple `.declinedSharing`,
  /// Play `NOT_SHARED`).
  declined,

  /// The API could not answer usefully: not available on this device or OS
  /// version, verification still required, an open-ended range that does not
  /// decide 18+, or no adapter is built into this binary for the host.
  unavailable,

  /// The read threw.
  error,
}

/// What the store said about the person signing up.
sealed class AgeSignal {
  const AgeSignal();
}

/// The store says 18 or older.
final class AdultAgeSignal extends AgeSignal {
  const AdultAgeSignal();
}

/// The store says under 18.
final class BelowAdultAgeSignal extends AgeSignal {
  const BelowAdultAgeSignal();
}

/// The store said nothing usable, and why.
final class NoAgeSignal extends AgeSignal {
  const NoAgeSignal(this.reason);

  final NoAgeSignalReason reason;

  @override
  bool operator ==(Object other) =>
      other is NoAgeSignal && other.reason == reason;

  @override
  int get hashCode => reason.hashCode;
}

/// Reads the store's age signal for the person on this device.
abstract interface class AgeSignalSource {
  Future<AgeSignal> read();
}

/// The default source: always no signal, for a stated [reason].
final class NoAgeSignalSource implements AgeSignalSource {
  const NoAgeSignalSource(this.reason);

  final NoAgeSignalReason reason;

  @override
  Future<AgeSignal> read() async => NoAgeSignal(reason);
}

/// The three outcomes of the gate.
enum SignUpAgeGate {
  /// The store says adult: create the account.
  proceedOnStoreSignal,

  /// No signal: create the account on the person's own 18+ declaration.
  proceedOnDeclaration,

  /// The store says under 18: create nothing and record no terms.
  refuse,
}

/// The one mapping every sign-up door uses. Exhaustive over [AgeSignal]: a new
/// kind of signal without a decision here is a compile error.
SignUpAgeGate signUpAgeGate(AgeSignal signal) => switch (signal) {
      AdultAgeSignal() => SignUpAgeGate.proceedOnStoreSignal,
      BelowAdultAgeSignal() => SignUpAgeGate.refuse,
      NoAgeSignal() => SignUpAgeGate.proceedOnDeclaration,
    };

/// Reads [source] and never throws: a source that throws is
/// `NoAgeSignal(NoAgeSignalReason.error)` — the stated no-signal branch, not a
/// crash on the sign-up button and not a silent "adult".
Future<AgeSignal> readAgeSignal(AgeSignalSource source) async {
  try {
    return await source.read();
  } on Object {
    return const NoAgeSignal(NoAgeSignalReason.error);
  }
}

/// The platform a sign-up runs on, as far as the age gate cares.
enum AgeSignalHost { web, android, ios, macos, windows, linux, other }

/// The host for a Flutter build, from `kIsWeb` and `defaultTargetPlatform.name`
/// (`android`, `iOS`, `macOS`, `windows`, `linux`, `fuchsia`). Taken as a
/// NAME so this stays pure Dart and every caller — the chassis views and the live
/// app's provider — maps a platform the same way. An unknown name is [other].
AgeSignalHost ageSignalHostNamed(
    {required bool isWeb, required String platform}) {
  if (isWeb) return AgeSignalHost.web;
  return switch (platform) {
    'android' => AgeSignalHost.android,
    'iOS' => AgeSignalHost.ios,
    'macOS' => AgeSignalHost.macos,
    'windows' => AgeSignalHost.windows,
    'linux' => AgeSignalHost.linux,
    _ => AgeSignalHost.other,
  };
}

/// Which [AgeSignalSource] a host reads — [ADR 082] §5, measured from vendor
/// documentation on 2026-09-15:
///
///   · android → Google Play Age Signals (beta) when an adapter is supplied;
///   · ios     → Apple Declared Age Range (iOS 26.2+) when an adapter is supplied;
///   · macos   → none: the API exists on macOS 26 but the OS reports no age
///     assurance there (`isEligibleForAgeFeatures` is false);
///   · windows → none: the OS age APIs are Windows Insider only;
///   · linux   → none: the Snap Store has no age signal;
///   · web     → none: outside chapter 121, and it keeps its current path;
///   · other   → none.
///
/// ⚠️ An android or ios host with NO adapter reads
/// `NoAgeSignal(NoAgeSignalReason.unavailable)` — the API exists, this binary
/// cannot call it — never `noApiOnTarget`, which would state something false
/// about the store.
AgeSignalSource ageSignalSourceFor(
  AgeSignalHost host, {
  AgeSignalSource? android,
  AgeSignalSource? ios,
}) =>
    switch (host) {
      AgeSignalHost.android =>
        android ?? const NoAgeSignalSource(NoAgeSignalReason.unavailable),
      AgeSignalHost.ios =>
        ios ?? const NoAgeSignalSource(NoAgeSignalReason.unavailable),
      AgeSignalHost.web ||
      AgeSignalHost.macos ||
      AgeSignalHost.windows ||
      AgeSignalHost.linux ||
      AgeSignalHost.other =>
        const NoAgeSignalSource(
          NoAgeSignalReason.noApiOnTarget,
        ),
    };

// ─────────────────────────────────────────────────────────────────────────────
// THE STORE ANSWERS, MAPPED IN DART — so the native adapters (Part B) stay thin
// and every decision about what a store field MEANS is tested here, on every
// machine, rather than inside Kotlin and Swift that only a device can run.
// Field names and values are the vendors', read from their documentation on
// 2026-09-15.
// ─────────────────────────────────────────────────────────────────────────────

/// Google Play Age Signals (beta, `com.google.android.play:age-signals:0.0.4`).
///
/// [accessStatus] is `requestAgeSignalsAccess(...).ageSignalsStatus()`:
/// `SHARED`, `NOT_SHARED` or `VERIFICATION_REQUIRED`. [ageLower] / [ageUpper]
/// come from `checkAgeSignals()` and are inclusive; `ageUpper` is null for the
/// highest open band (18+ by default).
///
///   · SHARED, `ageLower >= 18`                    → adult
///   · SHARED, a closed range with `ageUpper < 18` → below adult
///   · SHARED, both bounds null                    → unavailable
///   · SHARED, an open band starting under 18      → unavailable (a custom
///     range this app does not configure; it cannot decide 18+ either way)
///   · NOT_SHARED                                  → declined
///   · 🔴 VERIFICATION_REQUIRED                    → UNAVAILABLE, and so the
///     sign-up proceeds on the 18+ declaration. This is a DELIBERATE READING of
///     [ADR 082] §5 ("no signal ... unavailable ... proceeds on the
///     declaration"), confirmed with the coordinator on 2026-09-15: Play returns
///     it for an eligible user in a mandatory US state who has not yet verified,
///     so no age information has been received at all. Changing it to a refusal
///     is an owner decision, not a tidy-up; the test that names it says so.
///   · any other status                            → unavailable
AgeSignal ageSignalFromPlay({
  required String accessStatus,
  int? ageLower,
  int? ageUpper,
}) {
  switch (accessStatus) {
    case 'SHARED':
      if (ageLower != null && ageLower >= 18) return const AdultAgeSignal();
      if (ageUpper != null && ageUpper < 18) return const BelowAdultAgeSignal();
      return const NoAgeSignal(NoAgeSignalReason.unavailable);
    case 'NOT_SHARED':
      return const NoAgeSignal(NoAgeSignalReason.declined);
    case 'VERIFICATION_REQUIRED':
      return const NoAgeSignal(NoAgeSignalReason.unavailable);
    default:
      return const NoAgeSignal(NoAgeSignalReason.unavailable);
  }
}

/// Apple Declared Age Range (iOS 26.2+), requested with a single age gate of 18:
/// `AgeRangeService.shared.requestAgeRange(ageGates: 18, nil, nil, in: vc)`.
///
/// [eligible] is `isEligibleForAgeFeatures` (null when the OS has no API).
/// [response] is `sharing` or `declinedSharing`. With one gate at 18,
/// `lowerBound >= 18` is an adult and a nil `lowerBound` with an `upperBound`
/// is below the gate.
///
///   · no API (older OS, or the framework is absent)  → unavailable
///   · not eligible                                   → notEligible
///   · declinedSharing                                → declined
///   · sharing, `lowerBound >= 18`                    → adult
///   · sharing, `lowerBound` nil and `upperBound` set → below adult
///   · sharing, neither bound                         → unavailable
AgeSignal ageSignalFromApple({
  required bool? eligible,
  String? response,
  int? lowerBound,
  int? upperBound,
}) {
  if (eligible == null) return const NoAgeSignal(NoAgeSignalReason.unavailable);
  if (!eligible) return const NoAgeSignal(NoAgeSignalReason.notEligible);
  switch (response) {
    case 'declinedSharing':
      return const NoAgeSignal(NoAgeSignalReason.declined);
    case 'sharing':
      if (lowerBound != null && lowerBound >= 18) return const AdultAgeSignal();
      if (lowerBound == null && upperBound != null) {
        return const BelowAdultAgeSignal();
      }
      return const NoAgeSignal(NoAgeSignalReason.unavailable);
    default:
      return const NoAgeSignal(NoAgeSignalReason.unavailable);
  }
}
