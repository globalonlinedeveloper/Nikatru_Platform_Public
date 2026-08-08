// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE — DIRTY ON PURPOSE. DO NOT "FIX" THE STRINGS IN THIS FILE.
//
// This is not an app. It is the known-dirty tree that proves
// assert-no-hardcoded-strings.mjs's matchers still match. The guard enforces on
// the brick, which is CLEAN — so every enforcement assertion there passes over
// an EMPTY result set, which is indistinguishable from a scanner that has
// stopped matching. Something has to be dirty for the clean result to mean
// anything, and it has to be a tree nobody will ever tidy.
//
// Until 2026-08-08 that tree was `apps/subly/lib`, and the coverage claim was
// therefore hostage to a PRODUCT decision: the moment Subly's l10n retrofit
// lands, the guard goes red BY IMPROVEMENT and the rational response is to
// weaken it. A fixture owned by the guard cannot be cleaned by product work.
//
// This half carries the `Text(…)` family. Its sibling `entry_tile.dart` carries
// the labelling-parameter family, and `../quiet/` carries one near-miss per
// exemption. All three are asserted; see the guard's canary section.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';

/// A plausible home screen written the wrong way round: every visible string is
/// baked into the widget instead of read from AppLocalizations.
class FixtureHomeScreen extends StatelessWidget {
  const FixtureHomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const Text('Your week at a glance'),
        const Text('Nothing is due in the next seven days'),
        const Text('Renews on Friday'),
        const Text('Three items need attention'),
        const Text('Add your first entry'),
        const Text('Import from a file'),
        const Text('Sort by next renewal'),
        const Text('Sort by name'),
        const Text('Show archived entries'),
        const Text('Archived'),
        const Text('Active'),
        const Text('Paused'),
        const Text('Everything is up to date'),
        const Text('Could not reach the server'),
        const Text('Retry now'),

        // 🔴 A SENTENCE CONTAINING `//`, AND THE LITERAL DIRECTLY AFTER IT.
        // These two found a real false negative on this fixture's first run
        // (2026-08-08). The guard used to strip comments with a hand-rolled
        // `/\/\/.*$/gm`, which is not string-aware: it cut this line at the
        // slashes, and the matcher then ran on to the next quote in the file and
        // swallowed the FOLLOWING literal whole. A hardcoded string sitting
        // after a URL was invisible. The shared string-aware reducer fixed it;
        // these two lines are what fails if anyone puts the shortcut back.
        const Text('Visit https://nikatru.com for help'),
        const Text('Last updated a moment ago'),
      ],
    );
  }
}
