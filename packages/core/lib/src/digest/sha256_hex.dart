import 'dart:convert' show utf8;

import 'package:crypto/crypto.dart' show sha256;

/// ⏱ 2026-10-01 · T16 — the lower-case hex SHA-256 of [text]'s UTF-8 bytes.
///
/// HERE, AND NOT AS A `crypto` DEPENDENCY OF EACH PACKAGE THAT NEEDS ONE.
/// `assert-package-boundaries.mjs` reads an adapter package's own dependency on
/// a vendor as "this package wraps it", after which core's direct `crypto`
/// imports read as going around the adapter. The app lock's PIN hash and the
/// Apple sign-in nonce both need exactly this, so core — which already
/// declares `crypto` — owns it.
String sha256Hex(String text) => sha256.convert(utf8.encode(text)).toString();
