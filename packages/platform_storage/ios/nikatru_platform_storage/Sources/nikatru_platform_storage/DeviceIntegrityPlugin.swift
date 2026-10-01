import Flutter
import Foundation

/// ⏱ 2026-10-01 · DEVICE INTEGRITY, iOS PARITY WHERE IT IS CHEAP (row
/// O-APPS-GOV-IN-VAPT-CHECKLIST) — the jailbreak half of `core`'s
/// `DeviceIntegrityProbe`, on `nikatru/device_integrity`. Registered by
/// [AgeSignalsPlugin], the package's one iOS pluginClass.
///
/// `rootSignals` → `{signals: [wire names]}`: a jailbreak artefact on a usual
/// path (`jailbreak_artifact`), or a write outside the sandbox that succeeded
/// (`sandbox_escape`; the probe file is removed at once). Raw facts only — what
/// they MEAN is `core.detectRoot`. `signingCertificates` is android's alone: an
/// iOS binary's signature is the App Store's to enforce, so it answers
/// not-implemented and Dart never asks (`checksSigner` is android-only).
public final class DeviceIntegrityPlugin: NSObject, FlutterPlugin {
  public static func register(with registrar: FlutterPluginRegistrar) {
    let channel = FlutterMethodChannel(
      name: "nikatru/device_integrity",
      binaryMessenger: registrar.messenger()
    )
    registrar.addMethodCallDelegate(DeviceIntegrityPlugin(), channel: channel)
  }

  private static let artifactPaths = [
    "/Applications/Cydia.app",
    "/Applications/Sileo.app",
    "/Library/MobileSubstrate/MobileSubstrate.dylib",
    "/bin/bash",
    "/usr/sbin/sshd",
    "/etc/apt",
    "/private/var/lib/apt/",
    "/var/jb",
  ]

  public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    guard call.method == "rootSignals" else {
      result(FlutterMethodNotImplemented)
      return
    }
    #if targetEnvironment(simulator)
    result(["signals": [String]()])
    #else
    var signals: [String] = []
    let fm = FileManager.default
    if DeviceIntegrityPlugin.artifactPaths.contains(where: { fm.fileExists(atPath: $0) }) {
      signals.append("jailbreak_artifact")
    }
    let probe = "/private/nikatru-integrity-\(UUID().uuidString)"
    if (try? "x".write(toFile: probe, atomically: true, encoding: .utf8)) != nil {
      try? fm.removeItem(atPath: probe)
      signals.append("sandbox_escape")
    }
    result(["signals": signals])
    #endif
  }
}
