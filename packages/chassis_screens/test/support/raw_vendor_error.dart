/// A vendor exception that reached a screen UNWRAPPED — the shape the auth
/// views' old `catch (e) { _error = '$e'; }` arm printed whole.
///
/// It is deliberately NOT a `core.AuthFailure`: that arm only ever saw
/// everything else. Its `toString()` is gotrue-dart's own format for a captcha
/// refusal from the self-hosted server, so a view that interpolates it shows
/// [rawVendorFragment] and a view that maps it shows `authCaptchaFailed`.
class RawVendorError implements Exception {
  const RawVendorError();

  @override
  String toString() =>
      'AuthApiException(message: $rawVendorFragment (invalid-input-response), '
      'statusCode: 400, code: captcha_failed)';
}

/// The words no user may be shown: present in [RawVendorError]'s text, and in
/// no localized sentence.
const String rawVendorFragment = 'captcha protection: request disallowed';
