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
// already seeded — which is the exact state it exists for. The decisions here
// are pure and take the board as data, the order below takes its two side
// effects as callbacks, and all of it is driven in both directions by a widget
// test that runs the seed TWICE.
//
// ── AND THE ORCHESTRATION LIVES HERE TOO, ADDED 2026-09-22 ─────────────────
// The first cut moved only the DECISION (`rowsMissingFrom`) out of the suite
// and left the ORDER — wait for the board, take the census, create what is
// missing, read the board back — inline in the suite's `testWidgets` body. The
// widget test then drove its OWN copy of that order, so reverting the suite's
// loop to `for (… in kIllustrative)` left every case in `test/` green: the
// test proved the copy, and the copy was not what the capture ran.
//
// So the order is two functions, [waitForLoadedBoard] and [seedMissingRows],
// parameterised by callbacks for the only two things that differ between a
// live capture and a widget test — how to let time pass, and how to create
// one row (through the real sheet on screen, or through the controller the
// sheet calls). Both callers call THESE, and nothing else decides what to
// seed. `tooling/ci/test/store-capture-board-parity.test.mjs` reads the
// suite's source and refuses a seeding loop over `kIllustrative` that
// bypasses them.
// ─────────────────────────────────────────────────────────────────────────────

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';

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

/// The board could not be read, so nothing may be concluded about it.
///
/// Its own type rather than a `StateError`, so a caller that wants to say
/// "the board never arrived" can catch exactly that and nothing wider.
class BoardNotReadable implements Exception {
  BoardNotReadable(this.message);

  final String message;

  @override
  String toString() => 'BoardNotReadable: $message';
}

/// The board the app holds, WAITED FOR rather than snatched.
///
/// [read] returns the provider's current state (the suite reads
/// `subscriptionsControllerProvider` out of the running `ProviderScope`);
/// [pause] lets time pass between reads (a real-clock pump on a live drive, a
/// fake-clock `tester.pump` in `test/`); [polls] bounds the wait by a COUNT of
/// reads, because a widget test runs on a fake clock and a `Stopwatch`
/// deadline would never expire there; [onScreen] says what the app was showing
/// when the wait gave up.
///
/// 🔴 AN UNFINISHED FETCH IS A FAILURE, NEVER AN EMPTY LIST, AND THAT LIMB IS
/// THE WHOLE FIX ALL OVER AGAIN IF IT IS DROPPED. `SubscriptionsController
/// .build()` is async: on the SECOND drive the app signs in and asks the Worker
/// for the board it already holds, and until that answers the provider is
/// `AsyncLoading` with NO value. A reader that took `valueOrNull ?? []` would
/// see an EMPTY board, conclude every illustrative row is missing, and seed a
/// second copy of all six — the exact defect this file exists to close,
/// arriving through the instrument written to close it.
/// `test/store_seed_idempotence_test.dart` drives exactly that state: a fresh
/// scope over a board that already holds the set, whose fetch has not answered
/// at the first read.
Future<List<Subscription>> waitForLoadedBoard({
  required AsyncValue<List<Subscription>> Function() read,
  required Future<void> Function() pause,
  required int polls,
  required String Function() onScreen,
}) async {
  AsyncValue<List<Subscription>> latest = read();
  for (int i = 0; i < polls; i++) {
    latest = read();
    if (latest.hasError) {
      throw BoardNotReadable(
        'The subscriptions the app holds are in an ERROR state '
        '(${latest.error}), so this capture cannot say what board it is about '
        'to photograph. On screen: ${onScreen()}',
      );
    }
    if (latest.hasValue && !latest.isLoading) return latest.requireValue;
    await pause();
  }
  throw BoardNotReadable(
    'The subscriptions the app holds never finished loading '
    '(${latest.runtimeType}) after $polls reads. This is NOT an empty board and '
    'must never be read as one: on the second viewport the board already holds '
    'the illustrative rows, and treating "not arrived" as "not there" seeds a '
    'SECOND copy of all six — which is the defect this reader exists to '
    'prevent. On screen: ${onScreen()}',
  );
}

/// What one pass of the seed found, did, and left behind.
class SeedPass {
  const SeedPass({
    required this.onArrival,
    required this.seeded,
    required this.board,
    required this.complaints,
  });

  /// The board as the pass found it, before it created anything.
  final List<Subscription> onArrival;

  /// The rows this pass created, in the order it created them.
  final List<List<String>> seeded;

  /// The board as the pass left it, read back through [waitForLoadedBoard].
  final List<Subscription> board;

  /// [boardComplaints] over [board]. The caller asserts it is EMPTY.
  final List<String> complaints;
}

/// One pass of the capture's seed: wait for the board, create exactly the rows
/// of [wanted] it does not already hold, and read the board back.
///
/// [loadBoard] is the caller's [waitForLoadedBoard]; [addRow] creates ONE row
/// (the suite drives the real "Add subscription" sheet, the widget test calls
/// the `addSubscription` the sheet awaits); [onPlan], when given, is told what
/// the pass found and is about to create, before it creates anything.
///
/// 🔴 IT ITERATES [rowsMissingFrom]'s ANSWER, NEVER [wanted]. On the first
/// viewport the two are the same list; on the second the answer is EMPTY, and
/// that difference is the entire fix for the doubled tablet board.
///
/// ⚠️ IT RETURNS THE COMPLAINTS RATHER THAN THROWING ON THEM. Seeding
/// idempotently and photographing the right board are two claims: a board that
/// arrived already doubled is not repaired by creating nothing, and the caller
/// is the one that knows how to refuse it — with `expect(..., isEmpty)` and the
/// frame it was about to take.
Future<SeedPass> seedMissingRows({
  required Future<List<Subscription>> Function() loadBoard,
  required Future<void> Function(List<String> row) addRow,
  required List<List<String>> wanted,
  void Function(List<Subscription> onArrival, List<List<String>> toSeed)?
  onPlan,
}) async {
  final List<Subscription> onArrival = await loadBoard();
  final List<List<String>> toSeed = rowsMissingFrom(
    censusOf(onArrival.map((Subscription s) => s.name)),
    wanted,
  );
  onPlan?.call(onArrival, toSeed);
  for (final List<String> row in toSeed) {
    await addRow(row);
  }
  final List<Subscription> board = await loadBoard();
  return SeedPass(
    onArrival: onArrival,
    seeded: toSeed,
    board: board,
    complaints: boardComplaints(
      censusOf(board.map((Subscription s) => s.name)),
      wanted,
    ),
  );
}
