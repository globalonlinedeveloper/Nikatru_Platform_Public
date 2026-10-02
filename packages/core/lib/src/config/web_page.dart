// The two things the force-update path needs from a BROWSER page, behind one
// conditional import so nothing outside web pulls in `dart:js_interop`
// (O-FORCE-UPDATE-VERSION-READ-UNPROVEN):
//   · [reloadPage] is the web wall's exit (see update_exit.dart, order 1);
//   · [publishVersionRead] hands the installed-version read to the page, where
//     tooling/smoke/smoke-web-artifact.mjs reads it BEFORE PUBLICATION and
//     requires it to equal the build's `--build-name`. A null read is published
//     too — as JS null — so the smoke can tell "read null" from "never read".
// Everywhere but web both are no-ops.
import 'web_page_stub.dart'
    if (dart.library.js_interop) 'web_page_web.dart'
    as impl;

/// The global the smoke reads. Keep in step with
/// `VERSION_READ.global` in tooling/smoke/smoke-web-artifact.mjs.
const String kVersionReadGlobal = '__nikatruPackageVersion';

/// Reloads the page. No-op off web.
void reloadPage() => impl.reloadPage();

/// Publishes the installed-version read ([version], null when it failed) on
/// `globalThis[kVersionReadGlobal]`. No-op off web.
void publishVersionRead(String? version) => impl.publishVersionRead(version);
