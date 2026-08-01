import { describe, it, expect } from 'vitest';
// `?raw` rather than node:fs — a Workers tsconfig has no node types on purpose.
// Same trick test/wrangler-breaker.test.ts uses to read the deployed config.
import dartSource from '../../../packages/core/lib/src/analytics/analytics.dart?raw';
import { MAX_PARAM_COUNT, MAX_PARAM_VALUE_LEN } from '../src/routes/events';

// ─────────────────────────────────────────────────────────────────────────────
// THE PARAM CAPS ARE ONE CONTRACT WRITTEN IN TWO LANGUAGES.
//
// 🔴 THE DEFECT. `packages/core` stopped at `kMaxParamCount = 12` keys and the
// server enforced no key cap at all — the header of routes/events.ts said "the
// client sanitizes; we re-check", which was true of the value TYPE and the value
// LENGTH and false of the COUNT. A hand-rolled POST (the route is
// unauthenticated by design, so "the client" is whoever is calling) stored 200
// keys, measured at HEAD. The JSON-length cap did not cover it either: 200 short
// keys serialise well under 2048 bytes.
//
// F-2 says every value is declared once. Dart and TypeScript cannot share a
// literal, so the durable form of "declared once" is a check that FAILS WHEN
// THEY DISAGREE — otherwise the next person to raise one side ships a silent
// asymmetry, which is precisely the state this fixed.
//
// The parse is structural (`const int NAME = VALUE;`), and it SELF-CHECKS: if
// the Dart file moves, is renamed, or stops declaring these constants, this file
// fails loudly instead of comparing against `undefined` and passing.
// ─────────────────────────────────────────────────────────────────────────────

const DART = 'packages/core/lib/src/analytics/analytics.dart';

/** `const int kName = 12;` → 12, or null when it is not declared. */
function dartIntConst(name: string): number | null {
  const m = dartSource.match(new RegExp(`\\bconst\\s+int\\s+${name}\\s*=\\s*(\\d+)\\s*;`));
  return m ? Number(m[1]) : null;
}

describe(`the analytics param caps agree with ${DART}`, () => {
  it('the import really reached the Dart source', () => {
    // Without this, a moved or emptied file would make every assertion below
    // range over `null` — and a comparison to `null` that is written as an
    // equality against a number fails loudly, but a future `?.` would not.
    // Naming the self-check is cheaper than trusting nobody adds one.
    expect(dartSource.length).toBeGreaterThan(500);
    expect(dartSource).toContain('Map<String, Object?> sanitizeParams(');
  });

  it('kMaxParamCount is declared on the Dart side and equals the server cap', () => {
    const client = dartIntConst('kMaxParamCount');
    expect(client, `kMaxParamCount is no longer declared in ${DART}`).not.toBeNull();
    expect(
      client,
      `client kMaxParamCount=${client} vs server MAX_PARAM_COUNT=${MAX_PARAM_COUNT}. ` +
        'Raising one side alone is how the server ended up with NO key cap while the client had one.',
    ).toBe(MAX_PARAM_COUNT);
  });

  it('kMaxParamValueLength is declared on the Dart side and equals the server cap', () => {
    const client = dartIntConst('kMaxParamValueLength');
    expect(client, `kMaxParamValueLength is no longer declared in ${DART}`).not.toBeNull();
    expect(
      client,
      `client kMaxParamValueLength=${client} vs server MAX_PARAM_VALUE_LEN=${MAX_PARAM_VALUE_LEN}.`,
    ).toBe(MAX_PARAM_VALUE_LEN);
  });

  it('the Dart sanitizer still breaks on the COUNT OF ACCEPTED keys', () => {
    // The two implementations must not merely share a number — they must apply
    // it at the same point. Dart breaks on `out.length` (accepted so far), so a
    // server that counted EXAMINED entries instead would diverge on any map with
    // rejected values in it, and the shared constant would hide the difference.
    expect(dartSource).toMatch(/if\s*\(\s*out\.length\s*>=\s*kMaxParamCount\s*\)\s*break;/);
  });
});
