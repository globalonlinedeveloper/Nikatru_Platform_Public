/// The CLIENT half of the NIKATRU money rail — [pipeline 5].
///
/// One inherited purchase path for every stamped app:
/// - prices come from the RAIL CONFIG, never from app code ([5]M-11);
/// - checkout is a hosted page the merchant of record owns ([ADR 004]);
/// - the unlock is a SERVER read the client converges on ([5]M-5, [5]M-6) — the
///   client grants nothing, ever;
/// - cancellation is a real request to our own host ([5]M-9);
/// - where a store forbids the rail, the refusal is DECLARED and explained
///   rather than discovered at review ([5]M-15).
library;

export 'src/checkout_launcher.dart';
export 'src/entitlement_convergence.dart';
export 'src/hosted_checkout_rail.dart';
export 'src/money_funnel.dart';
export 'src/offering.dart';
export 'src/purchase_capabilities.dart';
export 'src/purchase_rail.dart';
export 'src/rail_config.dart';
