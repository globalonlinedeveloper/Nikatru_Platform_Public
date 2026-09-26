import { describe, it, expect } from 'vitest';
import MONITOR_SOURCE from '../../../tooling/ops/check-prod-provenance.mjs?raw';
import STAMP_SOURCE from '../../../tooling/e2e/app-version-stamp.mjs?raw';
import PROVENANCE_RAW from '../../../tooling/prod-provenance.json?raw';
import {
  E2E_RUN,
  PRODUCTION_STAMPS,
  RELEASED_BUILD,
  isProductionIngest,
  refusesStamp,
} from '../src/lib/build-stamp';

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE PIN. lib/build-stamp.ts restates, for a Worker bundle that cannot
// import tooling/, what tooling/ops/check-prod-provenance.mjs accepts. A
// restatement is a second copy free to drift, so every half of it is held to
// its source here: the Worker refusing what the monitor accepts would drop real
// users' rows, and accepting what the monitor refuses would bring back
// ops-watch 36241509870.
//
// The sources are read as TEXT (`?raw`), never executed: the monitor's module
// graph reads the filesystem and the network, and a test that ran it would be
// testing something else.
// ─────────────────────────────────────────────────────────────────────────────

/** The one `const NAME = /…/;` literal in `source`, or a failure naming it. */
function regexLiteral(source: string, name: string): string {
  const hits = [...source.matchAll(new RegExp(`^const ${name} = /(.+)/;$`, 'gm'))];
  expect(hits.length, `exactly one \`const ${name} = /…/;\` line`).toBe(1);
  return hits[0][1];
}

describe('lib/build-stamp.ts mirrors the provenance monitor', () => {
  it('RELEASED_BUILD is the monitor\'s BUILD_VERSION, byte for byte', () => {
    expect(RELEASED_BUILD.source).toBe(regexLiteral(MONITOR_SOURCE, 'BUILD_VERSION'));
    expect(RELEASED_BUILD.flags).toBe('');
  });

  it('E2E_RUN is app-version-stamp.mjs\'s E2E_RUN_SHAPE, rebuilt from its parts', () => {
    // `stampShape(prefix)` builds the pattern from two exported constants; the
    // test rebuilds it the same way, so a change to either is a change here.
    const digits = STAMP_SOURCE.match(/^export const MAX_RUN_DIGITS = (\d+);$/m)?.[1];
    const sha = STAMP_SOURCE.match(/^export const SHA_LEN = (\d+);$/m)?.[1];
    expect(digits, 'MAX_RUN_DIGITS').toBeDefined();
    expect(sha, 'SHA_LEN').toBeDefined();
    expect(STAMP_SOURCE).toContain(
      'new RegExp(`^${prefix}-(\\\\d{1,${MAX_RUN_DIGITS}})-([0-9a-f]{${SHA_LEN}})$`)',
    );
    expect(STAMP_SOURCE).toMatch(/^export const E2E_RUN_SHAPE = stampShape\('e2e'\);$/m);
    expect(E2E_RUN.source).toBe(`^e2e-(\\d{1,${digits}})-([0-9a-f]{${sha}})$`);
  });

  it('each app_version-graded table takes the monitor\'s resolvers, less store-capture', () => {
    const register = JSON.parse(PROVENANCE_RAW) as {
      databases: Record<string, { tables: Record<string, { marker?: string; resolver: string; alsoResolves?: string[] }> }>;
    };
    const graded: Record<string, string[]> = {};
    for (const table of Object.keys(register.databases.platform_db.tables)) {
      const rule = register.databases.platform_db.tables[table];
      if (rule.marker !== 'app_version') continue;
      graded[table] = [rule.resolver, ...(rule.alsoResolves ?? [])].filter((r) => r !== 'store-capture');
    }
    // Both ways: a new app_version-graded table the Worker does not refuse on
    // is as red as a Worker table the monitor no longer grades.
    expect(PRODUCTION_STAMPS).toEqual(graded);
    // No other database grades app_version today; one that did would need its
    // own ingest route refusing on it, so it is red here until that exists.
    for (const [db, entry] of Object.entries(register.databases)) {
      if (db === 'platform_db') continue;
      for (const [t, rule] of Object.entries(entry.tables)) {
        expect(rule.marker, `${db}.${t}`).not.toBe('app_version');
      }
    }
  });

  it('store-capture is dropped ONLY while the monitor calls a production cap-* consent row a finding', () => {
    expect(MONITOR_SOURCE).toContain("if (id === 'store-capture' && name === 'consent_artifacts') {");
    expect(MONITOR_SOURCE).toContain('why = `a sandbox lane wrote production:');
  });
});

describe('isProductionIngest / refusesStamp', () => {
  it('is production only for MONEY_ENVIRONMENT "live"', () => {
    expect(isProductionIngest({ MONEY_ENVIRONMENT: 'live' })).toBe(true);
    for (const w of ['sandbox', undefined, '', 'Live']) {
      expect(isProductionIngest({ MONEY_ENVIRONMENT: w }), String(w)).toBe(false);
    }
  });

  it('refuses the four measured rows\' stamp in production and nowhere else', () => {
    expect(refusesStamp({ MONEY_ENVIRONMENT: 'live' }, 'events', 'dev')).toBe(true);
    expect(refusesStamp({ MONEY_ENVIRONMENT: 'live' }, 'consent_artifacts', 'dev')).toBe(true);
    expect(refusesStamp({ MONEY_ENVIRONMENT: 'sandbox' }, 'events', 'dev')).toBe(false);
    expect(refusesStamp({}, 'consent_artifacts', 'dev')).toBe(false);
  });

  it('accepts every shape a shipped lane stamps, and refuses the near misses', () => {
    const live = { MONEY_ENVIRONMENT: 'live' };
    for (const v of ['1.0.144+40c0787', '1.0.5+0390db6', '2.13.100000+ABCDEF0']) {
      expect(refusesStamp(live, 'events', v), v).toBe(false);
    }
    for (const v of [null, 'dev', 'c6-localprobe', '1.0.144', '1.0+40c0787', '1.0.144+40c078', ' 1.0.144+40c0787', 'e2e']) {
      expect(refusesStamp(live, 'events', v), String(v)).toBe(true);
    }
    expect(refusesStamp(live, 'events', 'e2e-12-abcdef0')).toBe(true);
    expect(refusesStamp(live, 'consent_artifacts', 'e2e-12-abcdef0')).toBe(false);
    expect(refusesStamp(live, 'consent_artifacts', 'e2e-12-ABCDEF0')).toBe(true);
    expect(refusesStamp(live, 'consent_artifacts', 'cap-5-abcdef0')).toBe(true);
  });
});
