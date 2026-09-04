// ─────────────────────────────────────────────────────────────────────────────
// gate_destination_test.dart — the open-redirect validator, tested DIRECTLY.
//
// 🔴 UNTIL NOW THIS LOGIC HAD NO DIRECT TEST IN EITHER TREE. It was exercised
// only through the real router in `apps/subly/test/legal_gates_test.dart`, which
// is a good test of the ROUTER and a poor one of the validator: driving it needs
// a container, a widget pump and a settled navigation, so the cases anybody
// actually writes are the ones that are convenient rather than the ones that are
// dangerous. The brick had no equivalent at all.
//
// These are microseconds each, so the awkward inputs get written.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// A stand-in for an app's own list. The real ones differ per app — Subly's
/// carries `/login` and the brick's does not — which is exactly why this is a
/// parameter and not a constant inside the library.
const Set<String> kGates = <String>{
  '/onboarding',
  '/sign-in',
  '/sign-up',
  '/check-inbox',
  '/verify-email',
  '/reaccept-terms',
  '/reset-password',
};

Uri at(String s) => Uri.parse(s);

void main() {
  group('nextOr — an off-origin destination is never honoured', () {
    // 🔴 THE WHOLE REASON THE FUNCTION EXISTS. `next` rides in a public URL, so
    // on web anybody can type one and mail it to somebody else.
    test('a protocol-relative URL is refused — a browser resolves it OFF-ORIGIN', () {
      expect(
        nextOr(at('/reaccept-terms?next=%2F%2Fevil.test'), '/home', neverADestination: kGates),
        '/home',
      );
    });

    test('an absolute URL with a scheme is refused', () {
      for (final String hostile in <String>[
        'https%3A%2F%2Fevil.test',
        'http%3A%2F%2Fevil.test',
        'javascript%3Aalert(1)',
        'data%3Atext%2Fhtml%2Chi',
      ]) {
        expect(
          nextOr(at('/reaccept-terms?next=$hostile'), '/home', neverADestination: kGates),
          '/home',
          reason: '$hostile must not be honoured as a destination',
        );
      }
    });

    test('a bare relative path with no leading slash is refused', () {
      expect(nextOr(at('/reaccept-terms?next=evil.test'), '/home', neverADestination: kGates), '/home');
    });
  });

  group('nextOr — a gate is never a destination', () {
    test('naming the gate just cleared is refused', () {
      expect(
        nextOr(at('/reaccept-terms?next=%2Freaccept-terms'), '/home', neverADestination: kGates),
        '/home',
      );
    });

    // 🔴 THE SMUGGLING CASE. Without splitting the query off, the comparison is
    // a whole-string match and `/verify-email?x=1` is not equal to
    // `/verify-email`, so a gate walks straight through.
    test('a gate carrying a query is still a gate', () {
      expect(
        nextOr(at('/reaccept-terms?next=%2Fverify-email%3Fx%3D1'), '/home', neverADestination: kGates),
        '/home',
      );
    });

    test('a gate carrying a fragment is still a gate', () {
      expect(
        nextOr(at('/reaccept-terms?next=%2Fsign-in%23top'), '/home', neverADestination: kGates),
        '/home',
      );
    });

    // The OPEN half. Without it every assertion above passes just as well
    // against a function that returns the fallback unconditionally — the
    // fail-closed dead seam this repository keeps rediscovering.
    test('🔴 a legitimate destination IS honoured, query and all', () {
      expect(
        nextOr(at('/reaccept-terms?next=%2Fscan'), '/home', neverADestination: kGates),
        '/scan',
      );
      expect(
        nextOr(at('/reaccept-terms?next=%2Fsub%2F42%3Ffrom%3Dmail'), '/home', neverADestination: kGates),
        '/sub/42?from=mail',
      );
    });

    test('the list is the CALLER\'s — a path absent from it is a destination', () {
      // `/login` is in Subly's list and not in the brick's. With this stand-in
      // list, which omits it, it must be honoured — proving the function reads
      // the parameter rather than a constant of its own.
      expect(
        nextOr(at('/reaccept-terms?next=%2Flogin'), '/home', neverADestination: kGates),
        '/login',
      );
      expect(
        nextOr(at('/reaccept-terms?next=%2Flogin'), '/home',
            neverADestination: <String>{...kGates, '/login'}),
        '/home',
      );
    });
  });

  group('bankedNext — a malformed escape must not crash the app', () {
    // 🔴 MEASURED AGAINST THE REAL SDK. These are well-formed HEX but not
    // well-formed UTF-8; `Uri.parse` accepts them and `queryParameters` throws
    // on DECODE. The read runs for every user who does NOT owe the gate, so
    // without the catch one typed link is an app-wide crash.
    test('an invalid UTF-8 escape yields null rather than throwing', () {
      expect(bankedNext(at('/reaccept-terms?next=%FF')), isNull);
      expect(bankedNext(at('/reaccept-terms?next=%E0%A4%A')), isNull);
    });

    test('a throwing key NOTHING here reads still cannot crash it', () {
      // `queryParameters` decodes the WHOLE query, so the bad escape need not be
      // on `next` at all.
      expect(bankedNext(at('/reaccept-terms?a=%ED%A0%80&next=%2Fhome')), isNull);
    });

    test('and nextOr survives the same inputs, falling back', () {
      for (final String u in <String>[
        '/reaccept-terms?next=%FF',
        '/reaccept-terms?next=%E0%A4%A',
        '/reaccept-terms?a=%ED%A0%80&next=%2Fhome',
      ]) {
        expect(nextOr(at(u), '/home', neverADestination: kGates), '/home');
      }
    });

    test('no `next` at all is null, not an error', () {
      expect(bankedNext(at('/reaccept-terms')), isNull);
      expect(nextOr(at('/reaccept-terms'), '/home', neverADestination: kGates), '/home');
    });
  });

  group('gateWithNext — banking the destination on the way in', () {
    test('a real location is banked, whole uri and all', () {
      expect(
        gateWithNext('/reaccept-terms',
            matchedLocation: '/scan', uri: at('/scan'), neverADestination: kGates),
        '/reaccept-terms?next=%2Fscan',
      );
    });

    test('a deep link\'s own query survives the detour', () {
      expect(
        gateWithNext('/reaccept-terms',
            matchedLocation: '/sub/42', uri: at('/sub/42?from=mail'), neverADestination: kGates),
        '/reaccept-terms?next=%2Fsub%2F42%3Ffrom%3Dmail',
      );
    });

    test('a gate is not banked — a bare gate comes back', () {
      expect(
        gateWithNext('/reaccept-terms',
            matchedLocation: '/sign-in', uri: at('/sign-in'), neverADestination: kGates),
        '/reaccept-terms',
      );
    });

    // 🔬 THE ROUND TRIP, which is the property that actually matters: whatever
    // gateWithNext banks, nextOr must hand back unchanged.
    test('🔴 round-trip: what is banked is what comes back', () {
      for (final String dest in <String>['/scan', '/sub/42?from=mail', '/budget', '/settings']) {
        final String gated = gateWithNext('/reaccept-terms',
            matchedLocation: dest.split('?').first, uri: at(dest), neverADestination: kGates);
        expect(
          nextOr(at(gated), '/home', neverADestination: kGates),
          dest,
          reason: 'banking $dest then satisfying the gate must return exactly $dest',
        );
      }
    });
  });

  group('pendingAddress', () {
    test('a non-empty string is the address', () {
      expect(pendingAddress('a@b.test'), 'a@b.test');
    });

    test('empty and non-strings are absent — a sign-up cannot have mailed nowhere', () {
      expect(pendingAddress(''), isNull);
      expect(pendingAddress(null), isNull);
      expect(pendingAddress(42), isNull);
      expect(pendingAddress(<String>['a@b.test']), isNull);
    });
  });
}
