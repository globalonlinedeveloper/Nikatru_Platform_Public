import 'package:flutter/foundation.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// The [core.AgeSignalHost] for a platform — [ADR 082] §5. The mapping itself is
/// `core.ageSignalHostNamed`, shared with the live app; this is the Flutter half.
core.AgeSignalHost ageSignalHostOf({
  required bool isWeb,
  required TargetPlatform platform,
}) =>
    core.ageSignalHostNamed(isWeb: isWeb, platform: platform.name);

/// The host this build is running on.
core.AgeSignalHost currentAgeSignalHost() =>
    ageSignalHostOf(isWeb: kIsWeb, platform: defaultTargetPlatform);

/// The age-signal source this build reads when nothing is injected: no store
/// adapter is built into this binary yet, so android and ios read
/// `NoAgeSignal(unavailable)` and every other host `NoAgeSignal(noApiOnTarget)`
/// — both proceed on the 18+ declaration. The store adapters are passed to
/// [core.ageSignalSourceFor] by whoever builds them.
core.AgeSignalSource defaultAgeSignalSource() =>
    core.ageSignalSourceFor(currentAgeSignalHost());
