// The root Navigator's key, on its own, because two files name it — the route
// table (`routes.dart`, four `parentNavigatorKey:` uses) and the router itself
// (`router_provider.dart`) — and it is one of exactly two symbols `../router.dart`
// re-exports, so it is the router's public surface rather than its working.

import 'package:flutter/material.dart';

/// The root Navigator's key — public, not an implementation detail, because the
/// routes in `routes.dart` that must cover the shell rather than sit inside it
/// (`parentNavigatorKey:`, four of them) have to name the Navigator they are
/// pushed onto, and a shell route's own Navigator is the wrong one.
///
/// ⚠️ P1b MOVED THE WORD, NOT THE USES. This comment said "the routes below"
/// and "the four uses below" while the router was one file. They are the same
/// four `parentNavigatorKey:` routes, and they are now in `routes.dart`.
///
/// 🔴 ITS ORIGINAL REASON IS GONE, AND SAYING SO IS THE POINT. This comment used
/// to explain that [pipeline C-6]'s `ConsentGate` — installed via
/// `MaterialApp.router`'s `builder`, which Flutter inserts ABOVE this Navigator
/// — borrowed the key's context so `showDialog` had somewhere to push. That
/// widget lost its last mount in the P2.6 chassis merge (the consent question is
/// now an inline scrim inside `AnalyticsGate`, which needs no Navigator at all)
/// and was deleted 2026-08-10. The key survives on those four uses, which
/// are reason enough on their own — but a symbol kept alive by a comment
/// describing a deleted caller is a symbol nobody dares touch.
///
/// 🔴 CARRIED FROM app_router.dart UNCHANGED. The stamped router declares no
/// navigatorKey at all, so dropping this line un-roots those four routes.
final GlobalKey<NavigatorState> rootNavigatorKey = GlobalKey<NavigatorState>();
