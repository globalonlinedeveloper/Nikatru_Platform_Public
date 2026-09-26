/// Which external links an app may hand to the platform — O-LINK-LAUNCHER-SEAM-UNOWNED.
///
/// Pure Dart and platform-free, so every verdict is decidable in a unit test
/// with no plugin, no platform channel and no browser. The platform call lives
/// in `packages/external_links`, which consults this BEFORE it touches the
/// plugin; nothing that fails here ever reaches the operating system.
library;

/// What a [LinkPolicy] decided about one URI.
///
/// [reason] never carries the address itself, so a caller can log it without
/// writing a user's mail address or a full URL into a device log.
final class LinkVerdict {
  const LinkVerdict.allowed()
      : allowed = true,
        reason = 'allowed';

  const LinkVerdict.refused(this.reason) : allowed = false;

  final bool allowed;
  final String reason;

  @override
  String toString() =>
      allowed ? 'LinkVerdict.allowed' : 'LinkVerdict.refused($reason)';
}

/// The external links one app may open, and nothing else.
///
/// Three rules, and every one is a refusal by default:
/// - `https:` opens only when the host is one the app's configuration names
///   (its legal pages, its site, its contact page, its update destination).
///   No credentials in the authority and no port but the default.
/// - `mailto:` opens only for the ONE configured support address, and may
///   carry a `subject` and a `body` and no other header: a `cc`, `bcc` or `to`
///   would add a recipient the policy never named.
/// - Every other scheme is refused: `http:`, `javascript:`, `file:`, `data:`,
///   `intent:` and a link with no scheme at all.
///
/// 🔴 WHY A POLICY AND NOT A SCHEME CHECK AT EACH CALL SITE. Before this seam
/// the brick and the app each called `url_launcher` directly with whatever
/// string arrived, so a misconfigured constant or a drifted config value was
/// handed to the operating system as-is. One policy, built once from the app's
/// configuration and enforced by the one adapter, makes "which links can this
/// app open" a question with a single answer.
final class LinkPolicy {
  /// A policy over explicit [httpsHosts] and an optional [supportEmail].
  ///
  /// Hosts are compared lower-cased, as `Uri.host` returns them. An empty host
  /// is dropped: it would admit nothing and read as a configured one.
  LinkPolicy({
    Iterable<String> httpsHosts = const <String>[],
    String? supportEmail,
  })  : _httpsHosts = Set<String>.unmodifiable(
          httpsHosts
              .map((String h) => h.trim().toLowerCase())
              .where((String h) => h.isNotEmpty),
        ),
        supportEmail = _normaliseEmail(supportEmail);

  /// A policy whose `https:` hosts are the hosts of [httpsUrls].
  ///
  /// A URL that is not absolute `https:` contributes NOTHING: a misconfigured
  /// constant must narrow what the app can open, never widen it.
  factory LinkPolicy.fromUrls({
    required Iterable<String> httpsUrls,
    String? supportEmail,
  }) {
    final Set<String> hosts = <String>{};
    for (final String url in httpsUrls) {
      final String? host = _httpsHostOf(url);
      if (host != null) hosts.add(host);
    }
    return LinkPolicy(httpsHosts: hosts, supportEmail: supportEmail);
  }

  final Set<String> _httpsHosts;

  /// The support address `mailto:` may reach, lower-cased; null when the app
  /// configures none, and then every `mailto:` is refused.
  final String? supportEmail;

  /// The hosts `https:` may reach, lower-cased and unmodifiable.
  Set<String> get httpsHosts => _httpsHosts;

  /// This policy, plus the host of ONE more configured `https:` URL.
  ///
  /// For a destination that is configuration resolved at RUNTIME — the
  /// force-update wall's `update_url`, which the config service serves so the
  /// destination can move without shipping a build. A null, relative or
  /// non-https [url] leaves the policy as it was.
  LinkPolicy withHttpsUrl(String? url) {
    final String? host = url == null ? null : _httpsHostOf(url);
    if (host == null || _httpsHosts.contains(host)) return this;
    return LinkPolicy(
      httpsHosts: <String>{..._httpsHosts, host},
      supportEmail: supportEmail,
    );
  }

  /// The verdict for [uri]. Pure: it opens nothing and reads no platform.
  LinkVerdict check(Uri uri) {
    switch (uri.scheme) {
      case 'https':
        return _checkHttps(uri);
      case 'mailto':
        return _checkMailto(uri);
      case '':
        return const LinkVerdict.refused('a link with no scheme is not opened');
      default:
        return LinkVerdict.refused('the ${uri.scheme}: scheme is never opened');
    }
  }

  /// [check] over a string. A string that does not parse as a URI is refused.
  LinkVerdict checkUrl(String url) {
    final Uri? uri = Uri.tryParse(url.trim());
    if (uri == null) {
      return const LinkVerdict.refused('the link does not parse as a URI');
    }
    return check(uri);
  }

  LinkVerdict _checkHttps(Uri uri) {
    if (uri.host.isEmpty) {
      return const LinkVerdict.refused('an https: link with no host');
    }
    if (uri.userInfo.isNotEmpty) {
      return const LinkVerdict.refused('an https: link carrying credentials');
    }
    if (uri.hasPort && uri.port != 443) {
      return const LinkVerdict.refused('an https: link on a non-default port');
    }
    if (!_httpsHosts.contains(uri.host)) {
      return LinkVerdict.refused(
        'the host ${uri.host} is not one this app configures',
      );
    }
    return const LinkVerdict.allowed();
  }

  LinkVerdict _checkMailto(Uri uri) {
    final String? support = supportEmail;
    if (support == null) {
      return const LinkVerdict.refused('no support address is configured');
    }
    final String? recipient = _decodedOrNull(
      () => Uri.decodeComponent(uri.path).trim().toLowerCase(),
    );
    final List<String>? headers = _decodedOrNull(
      () => uri.queryParametersAll.keys.toList(),
    );
    if (recipient == null || headers == null) {
      return const LinkVerdict.refused('a mailto: link that does not decode');
    }
    if (recipient != support) {
      return const LinkVerdict.refused(
        'a mailto: link to an address other than the support address',
      );
    }
    for (final String header in headers) {
      if (header != 'subject' && header != 'body') {
        return LinkVerdict.refused(
          'a mailto: link carrying the $header header',
        );
      }
    }
    return const LinkVerdict.allowed();
  }

  /// [read], or null when it throws: a malformed percent-escape in a `mailto:`
  /// is a refusal, never an exception thrown at the tap that asked for it.
  static T? _decodedOrNull<T extends Object>(T Function() read) {
    try {
      return read();
    } catch (_) {
      return null;
    }
  }

  static String? _normaliseEmail(String? email) {
    final String? e = email?.trim().toLowerCase();
    return (e == null || e.isEmpty) ? null : e;
  }

  static String? _httpsHostOf(String url) {
    final Uri? uri = Uri.tryParse(url.trim());
    if (uri == null ||
        uri.scheme != 'https' ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        (uri.hasPort && uri.port != 443)) {
      return null;
    }
    return uri.host;
  }
}
