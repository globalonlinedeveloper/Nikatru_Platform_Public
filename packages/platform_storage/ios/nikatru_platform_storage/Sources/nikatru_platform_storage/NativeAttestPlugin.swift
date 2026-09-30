import DeviceCheck
import Flutter
import Foundation

/// ⏱ 2026-09-29 · native sign-in attestation (⏱ 2026-09-30 · wire protocol v2;
/// this side is unchanged by it: it sees only the hash) — the Apple
/// proof: App Attest (`DCAppAttestService`, iOS 14+). Registered on
/// `nikatru/native_attest` by `AgeSignalsPlugin.register(with:)`, the package's
/// one iOS pluginClass.
///
///   appAttestSupported()                          -> Bool
///   appAttestGenerateKey()                        -> keyId String (Apple's, standard base64)
///   appAttestAttestKey({keyId, clientDataHash})   -> attestation object bytes
///   appAttestAssert({keyId, clientDataHash})      -> assertion bytes
///
/// `clientDataHash` is SHA-256 of the op's clientData, computed in Dart. Every
/// failure answers a FlutterError — the Dart side turns it into a failed
/// sign-in call, never into a request sent without a proof. Below iOS 14, or on
/// a device or simulator App Attest does not support, `appAttestSupported` is
/// false and the Dart side uses the per-install key instead.
///
/// The key lives in the Secure Enclave; only its id crosses the channel, and
/// the Dart side keeps that id in the secure store. Nothing here logs anything.
public final class NativeAttestPlugin: NSObject, FlutterPlugin {
  public static func register(with registrar: FlutterPluginRegistrar) {
    let channel = FlutterMethodChannel(
      name: "nikatru/native_attest",
      binaryMessenger: registrar.messenger()
    )
    registrar.addMethodCallDelegate(NativeAttestPlugin(), channel: channel)
  }

  public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "appAttestSupported":
      result(NativeAttestPlugin.isSupported())
    case "appAttestGenerateKey":
      generateKey(result: result)
    case "appAttestAttestKey":
      attestKey(call, result: result)
    case "appAttestAssert":
      generateAssertion(call, result: result)
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  private static func isSupported() -> Bool {
    if #available(iOS 14.0, *) {
      return DCAppAttestService.shared.isSupported
    }
    return false
  }

  private static func failure(_ code: String, _ error: Error?) -> FlutterError {
    let nsError = error as NSError?
    return FlutterError(
      code: code,
      message: nsError.map { "\($0.domain)#\($0.code)" },
      details: nil
    )
  }

  private static func arguments(_ call: FlutterMethodCall) -> (keyId: String, hash: Data)? {
    guard let args = call.arguments as? [String: Any],
      let keyId = args["keyId"] as? String,
      let hash = args["clientDataHash"] as? FlutterStandardTypedData
    else {
      return nil
    }
    return (keyId: keyId, hash: hash.data)
  }

  private func generateKey(result: @escaping FlutterResult) {
    if #available(iOS 14.0, *) {
      let service = DCAppAttestService.shared
      guard service.isSupported else {
        result(NativeAttestPlugin.failure("unsupported", nil))
        return
      }
      service.generateKey { keyId, error in
        DispatchQueue.main.async {
          if let keyId = keyId, error == nil {
            result(keyId)
          } else {
            result(NativeAttestPlugin.failure("generate_key_failed", error))
          }
        }
      }
      return
    }
    result(NativeAttestPlugin.failure("unsupported", nil))
  }

  private func attestKey(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    guard let args = NativeAttestPlugin.arguments(call) else {
      result(NativeAttestPlugin.failure("bad_arguments", nil))
      return
    }
    if #available(iOS 14.0, *) {
      let service = DCAppAttestService.shared
      guard service.isSupported else {
        result(NativeAttestPlugin.failure("unsupported", nil))
        return
      }
      service.attestKey(args.keyId, clientDataHash: args.hash) { attestation, error in
        DispatchQueue.main.async {
          if let attestation = attestation, error == nil {
            result(FlutterStandardTypedData(bytes: attestation))
          } else {
            result(NativeAttestPlugin.failure("attest_failed", error))
          }
        }
      }
      return
    }
    result(NativeAttestPlugin.failure("unsupported", nil))
  }

  private func generateAssertion(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    guard let args = NativeAttestPlugin.arguments(call) else {
      result(NativeAttestPlugin.failure("bad_arguments", nil))
      return
    }
    if #available(iOS 14.0, *) {
      let service = DCAppAttestService.shared
      guard service.isSupported else {
        result(NativeAttestPlugin.failure("unsupported", nil))
        return
      }
      service.generateAssertion(args.keyId, clientDataHash: args.hash) { assertion, error in
        DispatchQueue.main.async {
          if let assertion = assertion, error == nil {
            result(FlutterStandardTypedData(bytes: assertion))
          } else {
            result(NativeAttestPlugin.failure("assert_failed", error))
          }
        }
      }
      return
    }
    result(NativeAttestPlugin.failure("unsupported", nil))
  }
}
