// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE — DIRTY ON PURPOSE. DO NOT "FIX" THE STRINGS IN THIS FILE.
//
// The MESSAGE / HINT / SPAN family's evidence (2026-10-01, C-20), in its own
// file for the same reason `entry_tile.dart` and `update_wall.dart` are: each
// family has to show its own hits, because a total floor cannot see one matcher
// die.
//
// Every literal below is read by a person, and none of them sits inside a
// `Text(` call, behind a labelling parameter or in a constructor default — so
// the first three families walk past all of them. A tooltip, a screen-reader
// hint, a field's error line and a `Text.rich` span are where an app's English
// survives a retrofit that only hunted for `Text('…')`.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';

class FixtureRichNotice extends StatelessWidget {
  const FixtureRichNotice({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Tooltip(message: 'Tap to renew this plan', child: const Icon(Icons.info)),
        Semantics(hint: 'Double tap to open the renewal date', child: const Icon(Icons.event)),
        TextField(
          decoration: InputDecoration(
            errorText: 'Enter an amount above zero',
            counterText: 'characters left',
          ),
        ),
        Text.rich(
          TextSpan(
            style: const TextStyle(fontWeight: FontWeight.bold),
            text: 'Renews soon',
            children: [TextSpan(text: ' — check the price before it does')],
          ),
        ),
        Slider(value: 0.5, onChanged: null, semanticsValue: 'half of the budget'),
      ],
    );
  }
}
