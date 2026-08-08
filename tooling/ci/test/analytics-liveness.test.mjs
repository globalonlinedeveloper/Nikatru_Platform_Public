// ─────────────────────────────────────────────────────────────────────────────
// analytics-liveness.test.mjs — tooling/ops/check-analytics-liveness.mjs must be
// able to FAIL, and must be able to say "I could not look" as a THIRD thing.
//
// [pipeline 11]E-13 · [ADR 035]. The writer records; this reader judges. The two
// properties that make the judgement worth having, and both have a failing case
// below:
//
//   · IT PARSES TOKENS, NEVER PROSE. A reworded sentence must not move a
//     verdict, and a REORDERED token run must not break one. `grep` over prose
//     is the mistake this repo has a scar from — a `grep '"r2_buckets"'` once
//     matched the template comment explaining why there is no r2_buckets.
//   · EXIT 2 IS NOT EXIT 1. "The rail is provably silent" and "I could not read
//     the row" are different states with different responses, and collapsing
//     them is how an unread instrument starts reading as a healthy one.
//
// 🔴 THE FAILING CASE IS THE PRODUCTION STATE, NOT AN INVENTED ONE. platform_db
// holds THREE granted `consent_artifacts` rows (newest 2026-08-07T17:57:28Z, app
// subly) and `SELECT COUNT(*) FROM events` = 0. `consents>0 && events=0` is
// true today, so the red path below is the system's actual condition.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  judge,
  parseTokens,
  deriveWriterLiterals,
  PORTFOLIO_TARGET,
} from '../../ops/check-analytics-liveness.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const READER = join(REPO, 'tooling/ops/check-analytics-liveness.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-al-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

const NOW = Date.parse('2026-08-08T09:00:00Z');
const RAN = '2026-08-08T06:00:12Z';

/** One portfolio heartbeat row. `detail` is the only interesting field. */
const row = (detail, over = {}) => ({
  job: 'analytics_liveness',
  target: PORTFOLIO_TARGET,
  ok: 1,
  detail,
  ran_at: RAN,
  ...over,
});

/** A register whose cron duty anchors at a wrangler config one directory up from
 *  a `src/`, which is the real shape (services/platform/wrangler.jsonc + src/). */
const CRON_REGISTER = {
  rows: [
    {
      id: 'duty.fixture-cron',
      kind: 'duty',
      mechanism: { substrate: 'cloudflare-cron', anchor: 'services/platform/wrangler.jsonc' },
    },
  ],
};

/** Build a throwaway tree with a register and (optionally) Worker sources, so
 *  each derivation failure has a real filesystem behind it rather than a stub. */
let fixtureSeq = 0;
function fixtureRoot(name, register, sources = {}) {
  const root = join(TMP, `${name}-${fixtureSeq++}`);
  mkdirSync(join(root, 'tooling', 'ops'), { recursive: true });
  writeFileSync(join(root, 'tooling', 'ops', 'register.json'), JSON.stringify(register));
  if (Object.keys(sources).length > 0) {
    const src = join(root, 'services', 'platform', 'src');
    mkdirSync(src, { recursive: true });
    for (const [f, body] of Object.entries(sources)) writeFileSync(join(src, f), body);
  }
  return root;
}

const LIVE = 'events=12 apps=2 consented_apps=2 consents=7 window=24h';
const SILENT_WITH_REACH =
  'events=0 apps=0 consented_apps=1 consents=3 window=24h — the rail is SILENT while consent artifacts ' +
  'landed in the same window — reach is PROVEN, so the events path is what produced nothing.';
const FULLY_SILENT =
  'events=0 apps=0 consented_apps=0 consents=0 window=24h — the rail is SILENT. Cannot yet distinguish a ' +
  'broken rail from no sessions: no independent liveness signal exists (see analyticsLiveness).';

describe('the three verdicts', () => {
  test('FAIL (1) — consents > 0 with events = 0: reach proven, arrivals zero', () => {
    const v = judge([row(SILENT_WITH_REACH)], NOW);
    assert.equal(v.code, 1);
    assert.equal(v.kind, 'silent-with-reach');
    assert.match(v.lines.join(' '), /SILENT WHILE 3 CONSENT ARTIFACT\(S\)/);
  });

  test('PASS (0) — events > 0 is the rail producing, whatever the consent count', () => {
    const v = judge([row(LIVE)], NOW);
    assert.equal(v.code, 0);
    assert.equal(v.kind, 'live');
  });

  test('PASS (0) AND PRINTS — events = 0 AND consents = 0 is the honest third state', () => {
    // [pipeline C-6]: the ambiguity is owner-gated (no app has shipped), so it
    // must PRINT rather than block. A daily red nobody can act on is how an
    // alarm gets muted — measured on 2026-08-07, when `ok: total > 0` shipped
    // and reddened check-heartbeats.mjs on its first real cron run.
    const v = judge([row(FULLY_SILENT)], NOW);
    assert.equal(v.code, 0);
    assert.equal(v.kind, 'ambiguous-silence');
    assert.match(v.lines.join(' '), /NOTHING AND NOBODY/);
  });

  test('one consent is enough — there is NO threshold on the count', () => {
    // The guard against smuggling in a number nobody can derive. The only
    // distinction drawn anywhere in this pair of files is some vs NONE.
    const v = judge([row('events=0 apps=0 consented_apps=1 consents=1 window=24h')], NOW);
    assert.equal(v.code, 1);
  });

  test('events > 0 with zero consent is still a PASS — the rail is what is being judged', () => {
    const v = judge([row('events=4 apps=1 consented_apps=0 consents=0 window=24h')], NOW);
    assert.equal(v.code, 0);
    assert.equal(v.kind, 'live');
  });
});

describe('exit 2 — every way of not being able to look', () => {
  test('an unparseable detail is 2, never 0 and never 1', () => {
    const v = judge([row('the rail is fine, honestly')], NOW);
    assert.equal(v.code, 2);
    assert.equal(v.kind, 'unparseable');
  });

  test('a detail missing ONE token is unparseable — no partial guess', () => {
    // Exactly the shape a silent 200-char truncation would produce.
    const v = judge([row('events=0 apps=0 consented_apps=0 window=24h')], NOW);
    assert.equal(v.code, 2);
    assert.match(v.lines.join(' '), /consents=<missing>/);
  });

  test('a non-integer token is unparseable — "many" is not a count', () => {
    const v = judge([row('events=lots apps=1 consented_apps=1 consents=1 window=24h')], NOW);
    assert.equal(v.code, 2);
  });

  test('NO portfolio row at all is 2 — that row is written unconditionally', () => {
    const v = judge([row(LIVE, { target: 'subly' })], NOW);
    assert.equal(v.code, 2);
    assert.equal(v.kind, 'absent');
  });

  test('an empty result set is 2, not a vacuous pass', () => {
    const v = judge([], NOW);
    assert.equal(v.code, 2);
    assert.equal(v.kind, 'absent');
  });

  test('a non-array answer is 2 — an unreadable answer is a failure, not a pass', () => {
    const v = judge(null, NOW);
    assert.equal(v.code, 2);
    assert.equal(v.kind, 'unreadable');
  });

  test('ok=0 on the newest row is 2 — the WRITER could not run, so nothing was measured', () => {
    // 🔴 NOT exit 1. A liveness query that threw says nothing about the rail,
    // and recording it as "the rail is silent" is the conflation that made the
    // keep-alive report a nightly 401 as success.
    const v = judge([row('liveness query failed: no such table: events', { ok: 0 })], NOW);
    assert.equal(v.code, 2);
    assert.equal(v.kind, 'writer-failed');
  });

  test('an unparseable ran_at is 2', () => {
    const v = judge([row(LIVE, { ran_at: 'yesterday-ish' })], NOW);
    assert.equal(v.code, 2);
  });
});

describe('it parses TOKENS, and tolerates their order', () => {
  test('a reordered token run reaches the same verdict', () => {
    const reordered = 'window=24h consents=3 consented_apps=1 apps=0 events=0 — prose after';
    assert.equal(judge([row(reordered)], NOW).code, 1);
    assert.equal(judge([row(SILENT_WITH_REACH)], NOW).code, 1);
  });

  test('prose after the tokens cannot change the verdict', () => {
    // The same counts with the OPPOSITE story attached still read as red.
    const v = judge([row('events=0 apps=0 consented_apps=1 consents=3 window=24h — everything is completely fine.')], NOW);
    assert.equal(v.code, 1);
  });

  test('FIRST occurrence wins — a later key=value in prose cannot displace a token', () => {
    const t = parseTokens('events=0 apps=0 consented_apps=1 consents=3 window=24h — note: events=999 was a typo');
    assert.equal(t.events, '0');
    assert.equal(t.consents, '3');
  });

  test('the newest portfolio row is the one judged, whatever order they arrive in', () => {
    const older = row(SILENT_WITH_REACH, { ran_at: '2026-08-06T06:00:00Z' });
    const newer = row(LIVE, { ran_at: '2026-08-08T06:00:00Z' });
    assert.equal(judge([older, newer], NOW).code, 0);
    assert.equal(judge([newer, older], NOW).code, 0);
  });

  test('per-app rows are ignored — only the aggregate carries the tokens', () => {
    const perApp = { ...row('2 event(s) in 24h'), target: 'subly' };
    assert.equal(judge([perApp, row(LIVE)], NOW).code, 0);
  });
});

describe('the literals are DERIVED from the writer, not typed twice', () => {
  test('the real tree yields the job name and the portfolio target', () => {
    const { job, portfolioTarget } = deriveWriterLiterals(REPO);
    assert.equal(job, 'analytics_liveness');
    assert.equal(portfolioTarget, PORTFOLIO_TARGET);
  });

  test('COVERAGE LOST when the register names no cloudflare-cron duty', () => {
    // A reader that cannot locate the Worker must not fall back to a guess: it
    // would query a name nothing writes, which reads as "absent" forever.
    const root = fixtureRoot('no-cron', { rows: [{ id: 'x', kind: 'duty', mechanism: { substrate: 'github-actions' } }] });
    assert.throws(() => deriveWriterLiterals(root), /declares no `cloudflare-cron` duty/);
  });

  test('COVERAGE LOST when the job constant is renamed in the Worker', () => {
    // 🔴 THE `_registerInWorkspace` LESSON. A literal shared by two files is
    // DERIVED from one of them; typed into both, the rename lands in one place
    // and the reader queries a job name nothing writes — which returns no row
    // forever, and would read as green the moment the absence limb softened.
    const root = fixtureRoot('renamed', CRON_REGISTER, {
      'scheduled.ts': `export const SOMETHING_ELSE = 'analytics_liveness';\nconst t = '${PORTFOLIO_TARGET}';\n`,
    });
    assert.throws(() => deriveWriterLiterals(root), /COVERAGE LOST[\s\S]*ANALYTICS_LIVENESS_JOB/);
  });

  test('COVERAGE LOST when the portfolio target literal leaves the Worker', () => {
    // The filter would then match no row at all, and "no row" is exit 2 forever
    // — a monitor that cannot see its own subject, reporting a shape rather than
    // a fact.
    const root = fixtureRoot('no-target', CRON_REGISTER, {
      'scheduled.ts': `export const ANALYTICS_LIVENESS_JOB = 'analytics_liveness';\nconst t = '(everything)';\n`,
    });
    assert.throws(() => deriveWriterLiterals(root), /COVERAGE LOST[\s\S]*\(portfolio\)/);
  });

  test('COVERAGE LOST when the register file is not there at all', () => {
    assert.throws(() => deriveWriterLiterals(join(TMP, 'nothing-here')), /does not exist/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// END TO END, through the real process, because the exit CODE is the contract —
// and on Windows `process.exit()` with an open fetch keep-alive handle reports
// 127 instead of the documented code, which would collapse 1 and 2 into one
// number. Spawning is the only way to observe that.
// ─────────────────────────────────────────────────────────────────────────────
describe('the process exit codes are the contract', () => {
  const run = (rows) => {
    const f = join(TMP, `rows-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(f, JSON.stringify(rows));
    return spawnSync(process.execPath, [READER, '--rows-file', f, '--now', '2026-08-08T09:00:00Z'], {
      encoding: 'utf8',
    });
  };

  test('exit 1 on the live production shape: consents landed, events did not', () => {
    const r = run([row(SILENT_WITH_REACH)]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /SILENT WHILE/);
  });

  test('exit 0 on a producing rail', () => {
    const r = run([row(LIVE)]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  test('exit 0 AND the third state PRINTS when nothing and nobody', () => {
    const r = run([row(FULLY_SILENT)]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /NOTHING AND NOBODY/);
  });

  test('exit 2 — and it says COULD NOT LOOK rather than reporting either verdict', () => {
    const r = run([]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /COULD NOT LOOK/);
  });

  test('the offline fixture mode announces itself loudly in the log', () => {
    // A fixture run that looked like a real one is how a monitor gets believed
    // while reading a file somebody wrote.
    const r = run([row(LIVE)]);
    assert.match(r.stdout, /OFFLINE FIXTURE MODE/);
  });
});
