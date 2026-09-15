import Flutter
import UIKit

#if canImport(DeclaredAgeRange)
import DeclaredAgeRange
#endif

/// [ADR 082] §5 — reads Apple's Declared Age Range for the sign-up age gate.
///
/// USE RESTRICTION: the age range is used ONLY to decide whether an account may be
/// created — an age-appropriate experience. It is never used for analytics,
/// advertising, marketing or profiling, and this class never stores, logs or
/// sends it: it is handed to Dart once, decided on there, and discarded.
///
/// Returns raw fields only — `eligible`, `response`, `lowerBound`, `upperBound` —
/// or `error: true`. What they MEAN is `core.ageSignalFromApple`, tested in Dart.
/// Before iOS 26, or where the framework is absent, `eligible` is null: no API.
public final class AgeSignalsPlugin: NSObject, FlutterPlugin {
  public static func register(with registrar: FlutterPluginRegistrar) {
    let channel = FlutterMethodChannel(
      name: "nikatru/age_signals",
      binaryMessenger: registrar.messenger()
    )
    registrar.addMethodCallDelegate(AgeSignalsPlugin(), channel: channel)
  }

  public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    guard call.method == "read" else {
      result(FlutterMethodNotImplemented)
      return
    }
    #if canImport(DeclaredAgeRange)
    if #available(iOS 26.0, *) {
      Task { @MainActor in
        result(await AgeSignalsPlugin.readAgeRange())
      }
      return
    }
    #endif
    result(["eligible": NSNull()])
  }

  #if canImport(DeclaredAgeRange)
  @available(iOS 26.0, *)
  @MainActor
  private static func readAgeRange() async -> [String: Any] {
    do {
      let eligible = try await AgeRangeService.shared.isEligibleForAgeFeatures
      guard eligible else { return ["eligible": false] }
      guard let presenter = topViewController() else { return ["error": true] }
      let response = try await AgeRangeService.shared.requestAgeRange(
        ageGates: 18, nil, nil, in: presenter)
      switch response {
      case .declinedSharing:
        return ["eligible": true, "response": "declinedSharing"]
      case .sharing(let range):
        return [
          "eligible": true,
          "response": "sharing",
          "lowerBound": range.lowerBound.map { $0 as Any } ?? NSNull(),
          "upperBound": range.upperBound.map { $0 as Any } ?? NSNull(),
        ]
      @unknown default:
        return ["eligible": true, "response": "unknown"]
      }
    } catch {
      return ["error": true]
    }
  }

  @MainActor
  private static func topViewController() -> UIViewController? {
    let window = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
    var top = window?.rootViewController
    while let presented = top?.presentedViewController {
      top = presented
    }
    return top
  }
  #endif
}
