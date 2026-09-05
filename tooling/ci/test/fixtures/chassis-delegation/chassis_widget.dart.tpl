// The package widget the adapter delegates to. It carries EVERY property the
// thirteen path-pinned guards used to read off the brick file.
import 'package:flutter/material.dart';

class __CLASS__ extends StatelessWidget {
  const __CLASS__({super.key, this.caps});

  final dynamic caps;

  @override
  Widget build(BuildContext context) {
    if (caps?.canSchedule ?? false) {
      return const SizedBox.shrink();
    }
    return Semantics(
      label: 'delegated surface',
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 720),
        child: const SizedBox.shrink(),
      ),
    );
  }
}
