/// The ONE adapter that opens an external link — O-LINK-LAUNCHER-SEAM-UNOWNED.
///
/// Implements core's `ExternalLinkLauncher` over `url_launcher`, and checks
/// every link against core's `LinkPolicy` before the plugin is touched. An app
/// constructs it once, at its composition root, and every screen reaches it
/// through the core interface.
library;

export 'src/external_link_capabilities.dart';
export 'src/url_launcher_external_links.dart';
