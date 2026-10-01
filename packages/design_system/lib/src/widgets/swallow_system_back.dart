import 'package:flutter/widgets.dart';

/// ⏱ 2026-10-01 · EN-11 — the system back does nothing while this is mounted.
///
/// For a modal that is painted ABOVE the router's Navigator — an app's consent
/// scrim lives in `MaterialApp.router`'s `builder` — where a `PopScope` is a
/// no-op: there is no `ModalRoute` for it to register with, so Android back
/// went straight to the router and popped the page UNDER a question the user
/// had not answered. `BackButtonListener` cannot be used there either: its
/// context needs a `Router` ancestor. This takes priority on the router's own
/// back-button dispatcher ([of]'s `backButtonDispatcher`) and answers "handled"
/// for as long as it is mounted. Paints nothing.
class SwallowSystemBack extends StatefulWidget {
  const SwallowSystemBack({required this.of, super.key});

  /// The app's router config (a `GoRouter` is one).
  final RouterConfig<Object?> of;

  @override
  State<SwallowSystemBack> createState() => _SwallowSystemBackState();
}

class _SwallowSystemBackState extends State<SwallowSystemBack> {
  BackButtonDispatcher? _root;
  ChildBackButtonDispatcher? _mine;

  Future<bool> _handled() => Future<bool>.value(true);

  @override
  void initState() {
    super.initState();
    final BackButtonDispatcher? root = widget.of.backButtonDispatcher;
    if (root == null) return;
    _root = root;
    _mine = ChildBackButtonDispatcher(root)
      ..addCallback(_handled)
      ..takePriority();
  }

  @override
  void dispose() {
    final ChildBackButtonDispatcher? mine = _mine;
    if (mine != null) {
      mine.removeCallback(_handled);
      _root?.forget(mine);
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}
