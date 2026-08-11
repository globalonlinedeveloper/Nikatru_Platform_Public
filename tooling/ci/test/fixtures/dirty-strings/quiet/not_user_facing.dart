// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE — THE NEAR MISSES. Every literal below sits in a position the matchers
// DO look at, and every one of them must stay SILENT.
//
// Silence matters as much as noise. A guard that fires on keys, hex colours and
// asset paths is one somebody switches off within a week, and a switched-off
// guard is the failure this repository keeps recording. So the exemptions are
// not decoration — they are load-bearing, and therefore asserted:
//
//   · the guard requires EVERY entry in its NOT_USER_FACING list to have at
//     least one literal here that it exempts. Add an exemption without a near
//     miss and the guard fails: an exemption nobody has written the input for is
//     a hole, not a filter.
//   · the guard requires this tree to yield ZERO enforced hits. Narrow or delete
//     an exemption and its near miss starts counting, and that shows up here as
//     a hit rather than as a mystery failure in some app six months later.
//
// The two limbs pull in opposite directions on purpose, so neither an exemption
// nor its evidence can go missing quietly.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';

/// Nothing here is prose, so nothing here is a translation defect.
class FixtureQuietCases extends StatelessWidget {
  const FixtureQuietCases({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // `^\s*$` — empty or whitespace. A spacer, not a sentence.
        const Text(''),
        const Text('   '),

        // `^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$` — a snake_case key. The SEPARATOR is
        // what makes it an identifier; a bare lowercase word like `settings` is
        // prose and is NOT exempt (tightened 2026-08-01 after four such labels
        // shipped past this guard).
        const Text('analytics_opt_in'),
        const Text('first_run_complete'),

        // `^[A-Z][A-Z0-9_]+$` — a CONSTANT_KEY.
        const Text('PLATFORM_BASE_URL'),

        // `^#?[0-9a-fA-F]{3,8}$` — a hex colour, with and without the hash.
        const Text('#6459F5'),
        const Text('101418'),

        // `^(?:https?:|mailto:|tel:|package:|asset|assets/)` — a URL, an asset
        // path or a package URI. Machine addresses, never read by a person.
        const Text('https://nikatru.com/privacy'),
        const Text('assets/icons/home.png'),
        const Text('package:flutter/material.dart'),

        // `^\{\{.*\}\}$` — a mustache token, substituted at stamp time. It is
        // the BRICK's spelling of a value, not a string anybody reads.
        const Text('{{app_id}}'),

        // `^[^a-zA-Z]*$` — no letters at all: punctuation, digits, symbols.
        const Text(' — '),
        const Text('· 2026 ·'),

        // Composed only of interpolations: every letter comes from a value, and
        // the literal parts are a separator and a percent sign. There is no
        // prose here, so there is nothing to translate. One letter OUTSIDE an
        // interpolation and it counts again — `'Welcome, $name'` is a violation
        // and lives in `dirty/` for that reason.
        Text('${s.category} · ${s.plan}'),
        Text('$_pct%'),

        // The exemptions apply in the labelling family too, not only in
        // `Text(…)` — so at least one near miss is proven there as well.
        FixtureTile(
          label: 'analytics_opt_in',
          tooltip: 'assets/icons/edit.png',
        ),

        // Read from l10n, which is the shape every one of the dirty siblings
        // should have been written in. Not a literal at all, so not a match.
        Text(AppLocalizations.of(context).homeTitle),
      ],
    );
  }
}
