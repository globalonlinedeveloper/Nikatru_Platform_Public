// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE — DIRTY ON PURPOSE. DO NOT "FIX" THE STRINGS IN THIS FILE.
//
// The LABELLING-PARAMETER family's evidence, kept in its own file so the split
// between the two matcher families is visible at a glance rather than buried in
// one blob.
//
// 🔴 WHY A SECOND FAMILY IS NOT OPTIONAL. The old canary (apps/subly/lib)
// measures 58 `Text(…)` hits against 13 labelling hits, so DELETING THE
// LABELLING MATCHER OUTRIGHT still cleared any total floor by more than 2× and
// printed "matchers verified". A total count cannot see half a guard die. Each
// family therefore has to show its OWN evidence, and this file is that evidence
// — which means it must keep at least one hit for every parameter name the
// matcher lists that is worth exercising.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';

/// One tile, labelled entirely with baked-in strings.
class FixtureEntryTile extends StatelessWidget {
  const FixtureEntryTile({super.key});

  @override
  Widget build(BuildContext context) {
    return FixtureTile(
      label: 'Home',
      title: 'Entry details',
      subtitle: 'Renews every month',
      tooltip: 'Edit this entry',
      hintText: 'Search your entries',
      labelText: 'Reminder name',
      helperText: 'We will remind you the day before',
      semanticsLabel: 'Entry status',
      semanticLabel: 'Renewal chart',
      children: const [
        Text('Open the entry'),
        Text('Duplicate the entry'),
        Text('Move to archive'),
        Text('Restore from archive'),
        Text('Remove this entry'),
        Text('Undo the last change'),
      ],
    );
  }
}
