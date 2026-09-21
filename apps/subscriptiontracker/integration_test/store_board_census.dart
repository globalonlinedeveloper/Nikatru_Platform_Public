// ─────────────────────────────────────────────────────────────────────────────
// store_board_census.dart — WHAT IS ALREADY ON THE BOARD, AND WHAT THE CAPTURE
// STILL HAS TO CREATE.
//
// 🔴 THE DEFECT THIS EXISTS FOR, READ OFF THE PIXELS MERGED AS 9f548515 (#854).
// The phone set reads `6 active` and `$93.47` a month. The tablet set OF THE
// SAME RUN reads `12 active` and `$186.94`, and its Home list names Fitness
// club, AI assistant, Video streaming, Music streaming and News digest TWICE
// each under "All subscriptions 12". 186.94 is 93.47 doubled exactly, and
// `kIllustrative` sums to 93.47 (15.99 + 10.99 + 2.99 + 20.00 + 39.00 + 4.50),
// so the tablet board is this suite's own set seeded a second time.
//
// WHY, from the code rather than from the total:
//   · `tooling/store/capture-play-screenshots.mjs` drives `flutter drive` ONCE
//     PER VIEWPORT, against ONE account provisioned once by the workflow;
//   · the seeding loop in `store_screenshots_test.dart` was guarded only by
//     `if (AppConfig.isBackendLive)` — never by "is this board already seeded";
//   · nothing deletes the first drive's rows between the two drives. The
//     workflow's `tooling/e2e/purge.mjs` runs ONCE, after both, and it also
//     deletes the identity — so it cannot be the between-viewports reset.
//
// The phone set is correct only because it happens to run FIRST. Nothing
// asserted that, which is why capturing the tablet first would have moved the
// doubling rather than removed it.
//
// ── WHY THE DECISION LIVES IN ITS OWN FILE ──────────────────────────────────
// Same reason `store_capture_guard.dart` does: an `integration_test/` file can
// only be exercised by a live capture, which needs CI-only secrets, a
// provisioned Supabase user and a browser. A rule that lived only inside the
// seeding loop would ship having never once been run against a board that was
// already seeded — which is the exact state it exists for. Everything here is
// pure, takes the board as data, and is driven in both directions by a widget
// test that runs the seed TWICE.
// ─────────────────────────────────────────────────────────────────────────────

/// How many rows on the board carry each name.
///
/// Counts rather than a `Set`, because the defect being fixed is a name
/// appearing TWICE: a set would have reported the doubled tablet board as the
/// same six names the phone board holds, which is precisely the reading that
/// let eight frames through.
Map<String, int> censusOf(Iterable<String> boardNames) {
  final Map<String, int> out = <String, int>{};
  for (final String name in boardNames) {
    out[name] = (out[name] ?? 0) + 1;
  }
  return out;
}

/// The rows of [wanted] that the board does NOT already hold — in [wanted]'s
/// own order, because the capture photographs the board without scrolling and
/// the order rows are created in decides where they land.
///
/// 🔴 THIS IS THE WHOLE FIX. On the FIRST viewport the board is empty, every
/// row is missing, and the seeding loop does exactly what it did before. On the
/// SECOND viewport every row is already there, this returns EMPTY, and the loop
/// creates nothing — so the board the second viewport photographs is the board
/// the first one photographed.
///
/// A row is matched BY NAME. That is the handle the listing shows and the one
/// the defect duplicated; matching on price too would treat a row whose price
/// somebody edited as missing and seed a second copy of it, which is the bug
/// again in a narrower case.
List<List<String>> rowsMissingFrom(
  Map<String, int> census,
  List<List<String>> wanted,
) => wanted
    .where((List<String> row) => (census[row[0]] ?? 0) == 0)
    .toList(growable: false);

/// The names [wanted] does NOT ask for, and the names it asks for that the
/// board holds MORE THAN ONCE — i.e. everything about the board that would make
/// the frame something other than a photograph of [wanted].
///
/// ⚠️ SEEDING IDEMPOTENTLY IS NOT THE SAME CLAIM AS "THE BOARD IS RIGHT", and
/// conflating them is how this would go quiet again. A board that arrived at
/// the second drive already holding twelve rows — a previous run that died
/// before teardown, a re-used account — is not repaired by creating nothing.
/// The capture must REFUSE it, so this returns the sentences that say what is
/// wrong with it and the caller asserts the list is empty.
List<String> boardComplaints(
  Map<String, int> census,
  List<List<String>> wanted,
) {
  final Set<String> wantedNames = <String>{
    for (final List<String> row in wanted) row[0],
  };
  final List<String> out = <String>[];
  for (final List<String> row in wanted) {
    final int n = census[row[0]] ?? 0;
    if (n == 0) out.add('"${row[0]}" is MISSING from the board');
    if (n > 1) out.add('"${row[0]}" appears $n times, and must appear once');
  }
  for (final MapEntry<String, int> e in census.entries) {
    if (!wantedNames.contains(e.key)) {
      out.add(
        '"${e.key}" is on the board (${e.value}×) and is not one of the '
        'illustrative rows',
      );
    }
  }
  return out;
}
