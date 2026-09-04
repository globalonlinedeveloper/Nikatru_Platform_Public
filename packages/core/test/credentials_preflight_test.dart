// ─────────────────────────────────────────────────────────────────────────────
// THE TWO DOORS A CLIENT CAN REFUSE BEFORE IT SENDS ANYTHING.
//
// `signInProblem` and `passwordResetProblem` were three hand-written `if`s
// inside `apps/subly/lib/features/auth/login_screen.dart` and existed nowhere in
// the app brick. This file pins the rules themselves — every arm, both
// boundaries of the malformed test, and the ORDER, which is part of the contract
// and is the only thing a screen cannot restate for itself.
//
// 🔴 THE ORDER CASES ARE THE ONES WORTH HAVING. Each rule on its own is one
// comparison and would survive almost any rewrite. What a rewrite breaks is
// which sentence a user is shown when TWO things are wrong at once — and that is
// invisible in the code, because an `if` chain reports the first match without
// ever naming the losers. `blank beats malformed` below is the assertion that
// fails if somebody reorders the function for tidiness.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

void main() {
  group('signInProblem — the sign-in door', () {
    test('a complete, plausible pair has nothing to say', () {
      expect(
        signInProblem(email: 'a@b.test', password: 'hunter2!!'),
        isNull,
      );
    });

    test('a blank password is incomplete, not malformed-anything', () {
      expect(
        signInProblem(email: 'a@b.test', password: ''),
        CredentialsProblem.incomplete,
      );
    });

    test('a blank address is the SAME arm as a blank password', () {
      // One sentence for either blank — `authEnterBoth`. Splitting this into two
      // arms would change what a live user reads, which is why the arm's own doc
      // says so and why this case is here rather than only in the screen test.
      expect(
        signInProblem(email: '', password: 'hunter2!!'),
        CredentialsProblem.incomplete,
      );
    });

    test('BLANK BEATS MALFORMED — order is the contract', () {
      // Both are wrong: nothing typed in either box, and what is in the address
      // box is not an address. The user must fill the boxes in either case, so
      // reporting "that is not an email" first would send them to fix a field
      // they have not filled in yet.
      expect(
        signInProblem(email: '', password: ''),
        CredentialsProblem.incomplete,
      );
    });

    test('no @ is malformed', () {
      expect(
        signInProblem(email: 'a.b.test', password: 'hunter2!!'),
        CredentialsProblem.emailMalformed,
      );
    });

    test('no dot is malformed', () {
      // `user@localhost` is a legal address this refuses, and the arm's doc says
      // so out loud. The case is here so the refusal is a recorded decision
      // rather than something a reader has to discover from a live report.
      expect(
        signInProblem(email: 'user@localhost', password: 'hunter2!!'),
        CredentialsProblem.emailMalformed,
      );
    });

    test('the test is deliberately weak, and this is what that costs', () {
      // `.@.` has an @ and a dot and is not an address. Pinned so that anybody
      // tightening the rule sees, in one line, exactly what the current rule
      // lets through — and so that tightening it is a deliberate edit to this
      // expectation rather than an accident nobody notices.
      expect(signInProblem(email: '.@.', password: 'hunter2!!'), isNull);
    });

    test('it does NOT trim — the caller owns the controller', () {
      // Two places deciding what the user typed is how a trimmed check passes
      // and an untrimmed request goes out. The screen trims once, at the source.
      expect(
        signInProblem(email: '   ', password: 'hunter2!!'),
        CredentialsProblem.emailMalformed,
      );
    });
  });

  group('passwordResetProblem — the forgot-password door', () {
    test('an address is enough', () {
      expect(passwordResetProblem(email: 'a@b.test'), isNull);
    });

    test('a blank address is emailMissing, NOT incomplete', () {
      // A different arm because it is a different sentence: there is no password
      // box on this path to be told about.
      expect(
        passwordResetProblem(email: ''),
        CredentialsProblem.emailMissing,
      );
    });

    test('IT DOES NOT REFUSE A MALFORMED ADDRESS, and that is the shipped rule', () {
      // 🔴 THIS CASE EXISTS TO PIN A HOLD, NOT A BEHAVIOUR WE LIKE. The screen
      // has always checked blank only, so adding the malformed refusal here
      // would change what a live user experiences inside a change that claims to
      // move code without moving behaviour. When that follow-up is taken, THIS
      // is the line that has to be edited — which is the point of writing it.
      expect(passwordResetProblem(email: 'not-an-address'), isNull);
    });
  });
}
