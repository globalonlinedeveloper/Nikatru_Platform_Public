// ─────────────────────────────────────────────────────────────────────────────
// mail-transport-claims.test.mjs — assert-mail-transport-claims.mjs must FAIL.
//
// It also covers tooling/ops/verify-supabase-templates.mjs, the live half that
// ops-watch.yml now schedules: its no-credential path is the branch the whole
// owner-gating turns on, and with the secret present it is the one branch that
// never runs. [pipeline F-10]
//
// 📌 CONTEXT, because the fixtures below are meaningless without it: on
// 2026-08-03 an audit agent read four repo documents that all agreed Supabase
// Auth was on the provider's own sender, and escalated "no real user can sign
// up" to a 🔴🔴 store-submission blocker. It was false — `smtp_host` reads
// smtp.resend.com and always had — and SUPABASE_PAT sat in the vault the whole
// time. See ADR 029 (Private/knowledge/decisions/029-email-sending-architecture.md).
//
// ⚠️ THE MUTATION RUN AGAINST THE REAL TREE IS THE PROOF, NOT THIS FILE. A
// fixture encodes whatever misunderstanding wrote it — this repo has the receipt:
// assert-seams-wired.mjs shipped with a caller check that matched the function's
// own declaration, and ALL SIX of its fixture tests passed against the broken
// version.
//
// RECORDED MUTATION RUN against the REAL repository: baseline PASS, **6/6
// CAUGHT**, every file restored and hash-verified, final run PASS.
//   M1 `docs/platform/supabase/README.md` — reasserted the stale sentence the
//      incident was built on, in a section naming no correction → CAUGHT, with
//      file:line, pattern id and the section heading.
//   M2 `tooling/mail-transport.json` — mailbox rail flipped to send automated
//      mail → CAUGHT (two machine rails).
//   M3 same file — `smtp_admin_email` moved back to the mailbox domain, the
//      literal pre-2026-08-04 state → CAUGHT.
//   M4 `tooling/ops/verify-supabase-templates.mjs` — repointed at a different
//      file → CAUGHT.
//   M5 a NEW doc carrying the stale claim, i.e. the eighth copy → CAUGHT.
//   M6 the checker MENTIONS the register and hardcodes its expectations → CAUGHT.
//
// 🔬 THAT RUN FOUND TWO REAL BUGS, and both were invisible to fixtures:
//   1. THE REGISTER WAS ANSWERING FOR THE WHOLE REPOSITORY. It necessarily
//      contains every pattern (they are its own `pattern` strings) and a
//      correction marker (`smtp_host` is one), so it matched and satisfied
//      everything single-handedly — making the aggregate non-vacuity check
//      IMPOSSIBLE TO FAIL. A scan that had stopped reading the corpus entirely
//      would still have printed a healthy tree. Caught by the two fixtures below
//      that assert a clean corpus is not a pass and a dead pattern is reported
//      dead. The register is now excluded from the claim scan.
//   2. LIMB C WAS A TEXT MATCH AND THE TEXT MATCH DID NOT WORK. It asked whether
//      the checker's source (comments stripped) named the register. M4 repointed
//      the checker's only real read and the guard STAYED GREEN, because the
//      checker also names the register in its ERROR MESSAGES — and a string
//      literal is not a comment. Stripping literals too is no repair either: the
//      path IS a literal, so the check becomes unsatisfiable and fires on
//      correct input. Limb C now RUNS the checker twice and watches whether
//      removing the register changes its answer.
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

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-mail-transport-claims.mjs');
const LIVE_CHECKER = join(REPO, 'tooling', 'ops', 'verify-supabase-templates.mjs');

let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-mailtx-')); });
after(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

/** A register that satisfies every structural invariant, so each test can break
 *  exactly one thing and attribute the failure to it. */
const GOOD_REGISTER = () => ({
  recordedBy: 'Private/knowledge/decisions/029-email-sending-architecture.md',
  verifiedLiveOn: '2026-08-04',
  rails: [
    { id: 'workspace', domain: 'example.test', role: 'mailbox', sendsAutomatedMail: false },
    { id: 'resend', domain: 'mail.example.test', role: 'machine-mail', sendsAutomatedMail: true },
  ],
  supabaseAuth: {
    transport: 'custom-smtp',
    smtp_host: 'smtp.provider.test',
    smtp_admin_email: 'auth@mail.example.test',
    external_email_enabled: true,
    rate_limit_email_sent: 100,
  },
  supersededTransportClaims: {
    patterns: [
      { id: 'old-transport', pattern: 'flying pigeon', why: 'the superseded rail' },
    ],
    correctionMarkers: [{ marker: 'smtp.provider.test', why: 'names the live host' }],
  },
  liveChecker: { path: 'tooling/ops/checker.mjs', why: 'the live half' },
});

/** The live checker stand-in, modelling the real one's THREE-VALUED exit:
 *  1 = no register (half a check is not a check) · 2 = no credential (a gap, not
 *  a pass) · 0 = compared. Limb C proves the wiring by RUNNING this and watching
 *  whether removing the register changes the answer — a text match could not,
 *  because the real checker names the register in its error messages too. */
const GOOD_CHECKER = `import { existsSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2] ?? process.cwd();
if (!existsSync(join(root, 'tooling', 'mail-transport.json'))) { console.error('no register'); process.exit(1); }
if (!process.env.SUPABASE_PAT) { console.error('no credential'); process.exit(2); }
process.exit(0);
`;

function makeRoot({ register, docs, checker } = {}) {
  const root = join(TMP, `r${seq++}`);
  mkdirSync(join(root, 'tooling', 'ops'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  if (register !== null) {
    writeFileSync(join(root, 'tooling', 'mail-transport.json'), JSON.stringify(register ?? GOOD_REGISTER(), null, 2));
  }
  if (checker !== null) writeFileSync(join(root, 'tooling', 'ops', 'checker.mjs'), checker ?? GOOD_CHECKER);
  // Always at least one document carrying the superseded phrase WITH its
  // correction, so the aggregate non-vacuity check has something to see and the
  // happy path is a real pass rather than a scan over nothing.
  const set = docs ?? {
    'history.md': '# History\n\nWe used to send by flying pigeon. We now use smtp.provider.test.\n',
  };
  for (const [name, body] of Object.entries(set)) writeFileSync(join(root, 'docs', name), body);
  return root;
}

const run = (root) => spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
const out = (r) => `${r.stdout}${r.stderr}`;

describe('assert-mail-transport-claims — the happy path really passes', () => {
  test('a sound register and a corrected document pass', () => {
    const r = run(makeRoot());
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /assert-mail-transport-claims: OK/);
  });

  test('it says out loud that LIVE DRIFT is not checked — green must not read as safe', () => {
    const r = run(makeRoot());
    assert.match(out(r), /DRIFT vs the live Supabase config is NOT checked/);
  });

  test('it says out loud that it enforces presence of a correction, not removal of the claim', () => {
    const r = run(makeRoot());
    assert.match(out(r), /correction is PRESENT, never that a stale claim was removed/);
  });

  test('it reports whether the gitignored private trees were visible at all', () => {
    const r = run(makeRoot());
    assert.match(out(r), /private trees NOT visible/);
  });
});

describe('assert-mail-transport-claims — a claim standing alone FAILS', () => {
  test('FAILS when a document states the superseded transport with no correction in the section', () => {
    const r = run(makeRoot({
      docs: {
        'history.md': '# History\n\nWe used to send by flying pigeon. We now use smtp.provider.test.\n',
        'stale.md': '# Transport\n\nMail goes out by flying pigeon today.\n',
      },
    }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /stale\.md:3/);
    assert.match(out(r), /old-transport/);
  });

  test('the failure names the SECTION, so the fix has an address', () => {
    const r = run(makeRoot({
      docs: {
        'history.md': '# History\n\nflying pigeon, superseded by smtp.provider.test.\n',
        'stale.md': '# Intro\n\nAll fine here.\n\n## How mail is sent\n\nBy flying pigeon.\n',
      },
    }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /## How mail is sent/);
  });

  // 🔴 THE WHOLE POINT OF SECTION-SCOPING. A correction 2,000 lines away in
  // PROJECT_STATE.md is not a correction anybody reading the claim will see.
  test('a correction in a DIFFERENT section does not rescue the claim', () => {
    const r = run(makeRoot({
      docs: {
        'split.md': '# Current\n\nWe use smtp.provider.test.\n\n# Legacy\n\nMail goes by flying pigeon.\n',
      },
    }));
    assert.equal(r.status, 1, out(r));
    // Line 7 of split.md, counted through the unit's own offset — the fixture
    // asserted 6 first and the GUARD was right: `# Legacy` is line 5, the blank
    // is 6, the claim is 7. Worth keeping as a reminder that an off-by-one in a
    // fixture reads exactly like a caught mutation.
    assert.match(out(r), /split\.md:7/);
  });

  test('the SAME section carrying the correction passes — history is allowed, silence is not', () => {
    const r = run(makeRoot({
      docs: {
        'joint.md': '# Legacy\n\nMail went by flying pigeon until we moved to smtp.provider.test.\n',
      },
    }));
    assert.equal(r.status, 0, out(r));
  });

  test('for a non-Markdown file the unit is the whole file, and it says so', () => {
    const r = run(makeRoot({
      docs: {
        'history.md': '# History\n\nflying pigeon → smtp.provider.test.\n',
        'note.txt': 'still on flying pigeon\n',
      },
    }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /the file never states the current one/);
  });

  test('a heading INSIDE a fenced code block does not start a new section', () => {
    // Without fence tracking the `# still flying pigeon` line below would open a
    // section of its own, and the correction above it would stop counting.
    const r = run(makeRoot({
      docs: {
        'fenced.md': '# Setup\n\nWe use smtp.provider.test.\n\n```sh\n# still flying pigeon in the old script\n```\n',
      },
    }));
    assert.equal(r.status, 0, out(r));
  });
});

describe('assert-mail-transport-claims — the architecture is checked STRUCTURALLY', () => {
  test('FAILS when two rails both claim to send automated mail', () => {
    const reg = GOOD_REGISTER();
    reg.rails[0].sendsAutomatedMail = true;
    const r = run(makeRoot({ register: reg }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /2 rail\(s\) carry/);
  });

  test('FAILS when no rail is the mailbox — nothing is kept out of the blast radius', () => {
    const reg = GOOD_REGISTER();
    reg.rails = [reg.rails[1]];
    const r = run(makeRoot({ register: reg }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /no rail is declared as the mailbox/);
  });

  test('FAILS when machine mail and the mailbox share a domain', () => {
    const reg = GOOD_REGISTER();
    reg.rails[1].domain = 'example.test';
    const r = run(makeRoot({ register: reg }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /share the domain/);
  });

  test('FAILS when machine mail is NOT pooled under the organizational domain', () => {
    const reg = GOOD_REGISTER();
    reg.rails[1].domain = 'mail.somewhere-else.test';
    const r = run(makeRoot({ register: reg }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /not a subdomain of the mailbox/);
  });

  // 🔴 THE LITERAL PRE-2026-08-04 STATE. The sender was support@nikatru.com —
  // the mailbox domain — which is the overlap ADR 029 removed.
  test('FAILS when the auth sender sits on the MAILBOX domain', () => {
    const reg = GOOD_REGISTER();
    reg.supabaseAuth.smtp_admin_email = 'support@example.test';
    const r = run(makeRoot({ register: reg }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /not on the machine-mail domain/);
  });

  test('FAILS when the transport claims custom SMTP and names no host', () => {
    const reg = GOOD_REGISTER();
    reg.supabaseAuth.smtp_host = '';
    const r = run(makeRoot({ register: reg }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /not a transport, it is a claim/);
  });

  test('FAILS when external email is disabled while custom SMTP is claimed', () => {
    const reg = GOOD_REGISTER();
    reg.supabaseAuth.external_email_enabled = false;
    const r = run(makeRoot({ register: reg }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /external_email_enabled/);
  });

  test('FAILS on an unrecognised transport rather than deciding nothing', () => {
    const reg = GOOD_REGISTER();
    reg.supabaseAuth.transport = 'carrier-pigeon';
    const r = run(makeRoot({ register: reg }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /expected .*custom-smtp/);
  });

  // NO INVENTED THRESHOLD. The register records what a GET returned; a floor
  // made up here would fire on a value somebody deliberately chose. All that is
  // checked is that a reading was recorded at all.
  test('FAILS when the recorded rate limit is not a number, and PASSES for any number', () => {
    const bad = GOOD_REGISTER();
    bad.supabaseAuth.rate_limit_email_sent = 'lots';
    assert.equal(run(makeRoot({ register: bad })).status, 1);
    const low = GOOD_REGISTER();
    low.supabaseAuth.rate_limit_email_sent = 2;
    assert.equal(run(makeRoot({ register: low })).status, 0);
  });
});

describe('assert-mail-transport-claims — the live half must stay wired to the record', () => {
  test('PASSES when removing the register changes the checker\'s answer', () => {
    const r = run(makeRoot());
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /wiring PROVEN behaviourally/);
  });

  // 🔴 THE MUTATION THE PREVIOUS, TEXT-MATCHING VERSION OF LIMB C MISSED. This
  // checker still MENTIONS the register — in a string it prints — and does not
  // read it. Six fixture tests passed against the version that only grepped.
  test('FAILS when the checker only MENTIONS the register and no longer reads it', () => {
    const r = run(makeRoot({
      checker: `console.error('compared against tooling/mail-transport.json');
if (!process.env.SUPABASE_PAT) process.exit(2);
process.exit(0);
`,
    }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /behaves IDENTICALLY with and without/);
  });

  // An uninformative probe must SAY it is uninformative. Reading "the two runs
  // differed" off a checker that never reaches its credential check would be
  // evidence of nothing dressed as a pass.
  test('REPORTS an uninformative probe rather than treating it as evidence', () => {
    const r = run(makeRoot({ checker: 'process.exit(0);\n' }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /wiring probe could not be run/);
  });

  test('FAILS when the live checker file is gone entirely', () => {
    const r = run(makeRoot({ checker: null }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /does not exist/);
  });

  test('FAILS when the register names no live checker at all', () => {
    const reg = GOOD_REGISTER();
    delete reg.liveChecker;
    const r = run(makeRoot({ register: reg }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /no `liveChecker.path`/);
  });
});

describe('assert-mail-transport-claims — coverage self-checks', () => {
  test('COVERAGE LOST when the register is missing', () => {
    const r = run(makeRoot({ register: null }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the register is not valid JSON', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'tooling', 'mail-transport.json'), '{ not json');
    const r = run(root);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /could not be parsed/);
  });

  test('COVERAGE LOST when no patterns are declared — the scan would clear anything', () => {
    const reg = GOOD_REGISTER();
    reg.supersededTransportClaims.patterns = [];
    const r = run(makeRoot({ register: reg }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /declares no superseded-claim patterns/);
  });

  // Without a marker there is no way to SATISFY the rule, so every legitimate
  // history note becomes a failure — the guard would fire on correct input.
  test('COVERAGE LOST when no correction markers are declared', () => {
    const reg = GOOD_REGISTER();
    reg.supersededTransportClaims.correctionMarkers = [];
    const r = run(makeRoot({ register: reg }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /declares no correction markers/);
  });

  test('COVERAGE LOST when a pattern row is missing its `why`', () => {
    const reg = GOOD_REGISTER();
    reg.supersededTransportClaims.patterns = [{ id: 'x', pattern: 'y' }];
    const r = run(makeRoot({ register: reg }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /missing id\/pattern\/why/);
  });

  test('COVERAGE LOST when no declared pattern matches ANYWHERE — the scan stopped reading', () => {
    const r = run(makeRoot({ docs: { 'clean.md': '# All good\n\nNothing to see.\n' } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /not one of the 1 declared patterns matched/);
  });

  test('an empty corpus is never reported as a pass', () => {
    const r = run(makeRoot({ docs: { 'clean.md': '# All good\n\nNothing.\n' } }));
    assert.doesNotMatch(out(r), /assert-mail-transport-claims: OK/);
  });

  // A pattern falling to zero can be honest — the last historical mention gets
  // edited away — so it PRINTS. Failing it would fire on correct input.
  test('a single dead pattern is PRINTED, not failed', () => {
    const reg = GOOD_REGISTER();
    reg.supersededTransportClaims.patterns.push({ id: 'never-used', pattern: 'zzz-nomatch-zzz', why: 'kept for shape' });
    const r = run(makeRoot({ register: reg }));
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /pattern `never-used` matched NOTHING/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tooling/ops/verify-supabase-templates.mjs — the LIVE half.
//
// ops-watch.yml runs it on a schedule, and the branch it runs MOST is the one a
// credentialled run never reaches: no secret configured. That branch decides
// whether the workflow warns or checks, so it needs a recorded failing case of
// its own. No network is touched — the script exits before any fetch.
// ─────────────────────────────────────────────────────────────────────────────
describe('verify-supabase-templates — the owner-gated branch ops-watch.yml depends on', () => {
  const runChecker = (root, extraEnv = {}) => {
    const env = { ...process.env, ...extraEnv };
    delete env.SUPABASE_PAT;
    delete env.SUPABASE_PROJECT_REF;
    for (const [k, v] of Object.entries(extraEnv)) env[k] = v;
    return spawnSync(process.execPath, [LIVE_CHECKER, root], { encoding: 'utf8', env });
  };

  test('exit 2 — a missing credential is a GAP, and 2 is not 0 and not 1', () => {
    const root = makeRoot();
    // The register must be where the script looks, under the fixture root.
    const r = runChecker(root);
    assert.equal(r.status, 2, out(r));
  });

  test('it says the gap is not a pass, in those words', () => {
    const r = runChecker(makeRoot());
    assert.match(out(r), /real gap, not a pass/);
  });

  test('a missing register is exit 1 — half a check must not report as a whole one', () => {
    const root = makeRoot({ register: null });
    const r = runChecker(root);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /mail-transport\.json/);
  });
});
