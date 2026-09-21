// ─────────────────────────────────────────────────────────────────────────────
// mechanism-claims.test.mjs — assert-mechanism-claims.mjs must be able to FAIL on
// each limb, must refuse when it cannot see its register or the tree, and must
// go red on the REAL seed sentence once its judgement is removed.
//
// Register row O-UNGRADED-MECHANISM-CLAIMS.
//
// ⚠️ Every candidate phrase in this file is assembled from pieces. Written out
// whole, this suite would itself be a candidate site in the tree the guard
// sweeps, and would need a register entry to exist.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-mechanism-claims.mjs');

const SECOND = 'no ' + 'second list';
const DRIFT = 'cannot ' + 'drift';

let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-mechclaims-')); });
after(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

const SHAPES = [
  { id: 'no-second-list', pattern: 'no ' + '(?:second) list', why: 'fixture shape' },
  { id: 'cannot-drift', pattern: 'can' + "(?:not|'t) drift", why: 'fixture shape' },
];
const TEST_FILE = "import { test } from 'node:test';\ntest('the list is read from the record', () => {});\n";

/** A tree with one judged claim, one backlog site and one file with nothing in it. */
const FILES = () => ({
  'tooling/ci/guard.mjs': `// Reads the record, so there is ${SECOND} here.\nconst x = 1;\n`,
  'docs/notes.md': `# Notes\n\nThe two ${DRIFT} apart.\n`,
  'docs/plain.md': '# Plain\n\nNothing to see.\n',
  'tooling/ci/test/guard.test.mjs': TEST_FILE,
});
const REGISTER = () => ({
  shapes: structuredClone(SHAPES),
  claims: [
    {
      file: 'tooling/ci/guard.mjs',
      anchor: `so there is ${SECOND} here`,
      status: 'proven',
      test: 'tooling/ci/test/guard.test.mjs',
      case: 'the list is read from the record',
      proves: 'the case adds a field to the record and expects it compared',
    },
  ],
  backlog: { 'docs/notes.md': 1 },
});

function fixture({ files = FILES(), register = REGISTER(), patch } = {}) {
  const root = join(TMP, `r${seq++}`);
  if (patch) patch({ files, register });
  for (const [rel, body] of Object.entries(files)) {
    if (body === null) continue;
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  if (register !== null) {
    mkdirSync(join(root, 'tooling'), { recursive: true });
    writeFileSync(join(root, 'tooling', 'mechanism-claims.json'), typeof register === 'string' ? register : JSON.stringify(register, null, 2));
  }
  return root;
}
const run = (root, ...extra) => {
  const r = spawnSync(process.execPath, [GUARD, root, ...extra], { cwd: root, encoding: 'utf8', timeout: 120_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout };
};
const git = (root, ...a) => {
  const r = spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
};

describe('assert-mechanism-claims — the happy path', () => {
  test('passes when every site is judged or in the backlog, and prints what it swept', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}mechanism claims/);
    assert.match(out, /swept 4 text file\(s\) by top-level root: docs 2, tooling 2/);
    assert.match(out, /2 candidate site\(s\) in 2 file\(s\): 1 proven, 0 demoted, 1 unjudged in 1 file\(s\)/);
  });

  test('says out loud that the Private corpus is not swept and that no sentence is judged true', () => {
    const { out } = run(fixture());
    assert.match(out, /the Private corpus is NOT swept by this guard/);
    assert.match(out, /never whether a sentence is true/);
  });

  test('a sentence wrapped across comment lines is still one candidate', () => {
    const { code, out } = run(fixture({
      patch: ({ files, register }) => {
        files['tooling/ci/wrapped.mjs'] = '// the set is read, so there is no\n// second list and it is proven below.\n';
        register.claims.push({ file: 'tooling/ci/wrapped.mjs', anchor: 'there is no\n// second list', status: 'demoted', reason: 'fixture' });
      },
    }));
    assert.equal(code, 0, out);
    assert.match(out, /3 candidate site\(s\) in 3 file\(s\): 1 proven, 1 demoted/);
  });

  test('the register is the declaration and is not swept, though it carries every phrase', () => {
    const { code, out } = run(fixture({ patch: ({ register }) => { register._note = `a ${SECOND} and it ${DRIFT}`; } }));
    assert.equal(code, 0, out);
  });

  test('--measure prints the backlog the tree implies and judges nothing', () => {
    const root = fixture({ patch: ({ files }) => { files['docs/more.md'] = `x ${DRIFT} y ${DRIFT}\n`; } });
    const r = run(root, '--measure');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(JSON.parse(r.stdout), { 'docs/more.md': 2, 'docs/notes.md': 1 });
  });
});

describe('assert-mechanism-claims — the limbs fail', () => {
  test('M1: a NEW unjudged claim fails, naming the file, line and shape', () => {
    const { code, out } = run(fixture({ patch: ({ files }) => { files['docs/plain.md'] = `# Plain\n\nThe copies ${DRIFT}.\n`; } }));
    assert.equal(code, 1, out);
    assert.match(out, /M1 docs\/plain\.md has 1 unjudged mechanism claim\(s\) \(cannot-drift at :3\) and its backlog allows 0/);
  });

  test('M1: a second claim in a backlog file exceeds its row', () => {
    const { code, out } = run(fixture({ patch: ({ files }) => { files['docs/notes.md'] += `\nAnd these ${DRIFT} either.\n`; } }));
    assert.equal(code, 1, out);
    assert.match(out, /M1 docs\/notes\.md has 2 unjudged mechanism claim\(s\) \(cannot-drift at :3, cannot-drift at :5\) and its backlog allows 1/);
  });

  test('M1: removing the judgement of a proven claim puts it back in the open', () => {
    const { code, out } = run(fixture({ patch: ({ register }) => { register.claims = []; } }));
    assert.equal(code, 1, out);
    assert.match(out, /M1 tooling\/ci\/guard\.mjs has 1 unjudged mechanism claim\(s\) \(no-second-list at :1\)/);
  });

  test('M2: a backlog row higher than the tree must be lowered', () => {
    const { code, out } = run(fixture({ patch: ({ register }) => { register.backlog['docs/notes.md'] = 3; } }));
    assert.equal(code, 1, out);
    assert.match(out, /M2 docs\/notes\.md now has 1 unjudged candidate\(s\) and its backlog row says 3/);
  });

  test('M2: a backlog file whose claim was reworded must drop its row', () => {
    const { code, out } = run(fixture({ patch: ({ files }) => { files['docs/notes.md'] = '# Notes\n\nThe two are meant to agree.\n'; } }));
    assert.equal(code, 1, out);
    assert.match(out, /M2 docs\/notes\.md now has 0 unjudged candidate\(s\)[\s\S]*lower the row to 0 by removing it/);
  });

  test('M3: a backlog row for a file that is gone fails', () => {
    const { code, out } = run(fixture({ patch: ({ register }) => { register.backlog['docs/gone.md'] = 1; } }));
    assert.equal(code, 1, out);
    assert.match(out, /M3 tooling\/mechanism-claims\.json backlog names docs\/gone\.md, which this sweep did not read/);
  });

  test('M4: an anchor that is no longer in the file fails', () => {
    const { code, out } = run(fixture({ patch: ({ register }) => { register.claims[0].anchor = 'a sentence nobody wrote'; } }));
    assert.equal(code, 1, out);
    assert.match(out, /M4 tooling\/mechanism-claims\.json claims\[0\] \(tooling\/ci\/guard\.mjs\): the anchor is not in the file any more/);
  });

  test('M4: an anchor that appears twice names no single sentence', () => {
    const { code, out } = run(fixture({
      patch: ({ files, register }) => {
        files['tooling/ci/guard.mjs'] += `// again: so there is ${SECOND} here\n`;
        register.backlog['tooling/ci/guard.mjs'] = 1;
      },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /M4 [^\n]*the anchor appears more than once/);
  });

  test('M4: a claim naming a file that does not exist fails', () => {
    const { code, out } = run(fixture({ patch: ({ register }) => { register.claims[0].file = 'tooling/ci/nowhere.mjs'; register.backlog['tooling/ci/guard.mjs'] = 1; } }));
    assert.equal(code, 1, out);
    assert.match(out, /M4 [^\n]*\(tooling\/ci\/nowhere\.mjs\) names a file this sweep did not read/);
  });

  test('M5: an anchor that covers no candidate means the claim is gone', () => {
    const { code, out } = run(fixture({ patch: ({ register }) => { register.claims.push({ file: 'docs/plain.md', anchor: 'Nothing to see.', status: 'demoted', reason: 'x' }); } }));
    assert.equal(code, 1, out);
    assert.match(out, /M5 [^\n]*\(docs\/plain\.md\): the anchor \(lines 3-3\) covers no candidate site/);
  });

  test('M5: two entries judging one site fail', () => {
    const { code, out } = run(fixture({ patch: ({ register }) => { register.claims.push({ file: 'tooling/ci/guard.mjs', anchor: 'Reads the record', status: 'demoted', reason: 'x' }); } }));
    assert.equal(code, 1, out);
    assert.match(out, /M5 [^\n]*claims\[1\][^\n]*and claims\[0\] both cover tooling\/ci\/guard\.mjs:1/);
  });

  test('M6: a proven claim whose test file does not exist fails', () => {
    const { code, out } = run(fixture({ patch: ({ files }) => { files['tooling/ci/test/guard.test.mjs'] = null; } }));
    assert.equal(code, 1, out);
    assert.match(out, /M6 [^\n]*names tooling\/ci\/test\/guard\.test\.mjs as its proof, and that file does not exist/);
  });

  test('M6: a proven claim whose case is not declared in that file fails', () => {
    const { code, out } = run(fixture({ patch: ({ register }) => { register.claims[0].case = 'the list is read from the RECORD'; } }));
    assert.equal(code, 1, out);
    assert.match(out, /M6 [^\n]*declares no test titled exactly that/);
  });

  test('M6: a case title that appears only in a comment is not a declared test', () => {
    const { code, out } = run(fixture({ patch: ({ files }) => { files['tooling/ci/test/guard.test.mjs'] = "// 'the list is read from the record'\nconst x = 1;\n"; } }));
    assert.equal(code, 1, out);
    assert.match(out, /M6 [^\n]*declares no test titled exactly that/);
  });

  test('M6: an escaped quote in a declared title still matches', () => {
    const { code, out } = run(fixture({
      patch: ({ files, register }) => {
        files['tooling/ci/test/guard.test.mjs'] = "import { test } from 'node:test';\ntest('the record\\'s keys are compared', () => {});\n";
        register.claims[0].case = "the record's keys are compared";
      },
    }));
    assert.equal(code, 0, out);
  });

  test('M6: a proven claim that does not say what it proves fails', () => {
    const { code, out } = run(fixture({ patch: ({ register }) => { delete register.claims[0].proves; } }));
    assert.equal(code, 1, out);
    assert.match(out, /M6 [^\n]*is `proven` and has no `proves`/);
  });

  test('M6: a case title that appears only in a COMMENTED-OUT test call is not a declared test', () => {
    const { code, out } = run(fixture({ patch: ({ files }) => { files['tooling/ci/test/guard.test.mjs'] = "import { test } from 'node:test';\n// test('the list is read from the record', () => {});\n"; } }));
    assert.equal(code, 1, out);
    assert.match(out, /M6 [^\n]*declares no test titled exactly that/);
  });

  test('M7: a demoted claim with no reason fails', () => {
    const { code, out } = run(fixture({ patch: ({ register }) => { register.claims[0] = { file: 'tooling/ci/guard.mjs', anchor: `so there is ${SECOND} here`, status: 'demoted' }; } }));
    assert.equal(code, 1, out);
    assert.match(out, /M7 [^\n]*is `demoted` with no `reason`/);
  });

  test('M7: any other status fails', () => {
    const { code, out } = run(fixture({ patch: ({ register }) => { register.claims[0].status = 'trusted'; } }));
    assert.equal(code, 1, out);
    assert.match(out, /M7 [^\n]*has status "trusted"; a claim is `proven` or `demoted`/);
  });
});

describe('assert-mechanism-claims — the git manifest', () => {
  test('in a git checkout an UNTRACKED file is not judged', () => {
    const root = fixture({ patch: ({ files }) => { files['docs/scratch.md'] = `It ${DRIFT}.\n`; } });
    git(root, 'init', '-q');
    git(root, 'add', 'docs/notes.md', 'docs/plain.md', 'tooling');
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /swept 4 tracked text file\(s\)/);
  });

  test('a TRACKED text file the walk cannot reach is COVERAGE LOST', () => {
    const root = fixture({ patch: ({ files }) => { files['build/tracked.md'] = '# tracked\n'; } });
    git(root, 'init', '-q');
    git(root, 'add', '.');
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — git tracks 6 text file\(s\) and this walk opened 5; it never saw 1:[\s\S]*build\/tracked\.md/);
  });
});

describe('assert-mechanism-claims — COVERAGE LOST', () => {
  test('a missing register', () => {
    const { code, out } = run(fixture({ register: null }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — tooling\/mechanism-claims\.json does not exist/);
  });

  test('a register that is not JSON', () => {
    const { code, out } = run(fixture({ register: '{ nope' }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — tooling\/mechanism-claims\.json is not valid JSON/);
  });

  test('a register with no shapes', () => {
    const { code, out } = run(fixture({ patch: ({ register }) => { register.shapes = []; } }));
    assert.equal(code, 2, out);
    assert.match(out, /declares no `shapes`/);
  });

  test('a shape that is not a valid pattern', () => {
    const { code, out } = run(fixture({ patch: ({ register }) => { register.shapes[0].pattern = 'no (second'; } }));
    assert.equal(code, 2, out);
    assert.match(out, /shapes\[0\] \(no-second-list\) is not a valid pattern/);
  });

  test('a backlog row that is not a positive integer', () => {
    const { code, out } = run(fixture({ patch: ({ register }) => { register.backlog['docs/notes.md'] = 0; } }));
    assert.equal(code, 2, out);
    assert.match(out, /backlog\["docs\/notes\.md"\] is 0/);
  });

  test('zero candidate sites while the register records some — the shapes stopped matching', () => {
    const { code, out } = run(fixture({ patch: ({ register }) => { register.shapes = [{ id: 'dead', pattern: 'zzq never written', why: 'x' }]; } }));
    assert.equal(code, 2, out);
    assert.match(out, /found ZERO candidate sites, while tooling\/mechanism-claims\.json records 2/);
  });

  test('a tree with nothing in it but the register', () => {
    const root = join(TMP, `empty${seq++}`);
    mkdirSync(join(root, 'tooling'), { recursive: true });
    writeFileSync(join(root, 'tooling', 'mechanism-claims.json'), JSON.stringify(REGISTER()));
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /no text file under .* besides tooling\/mechanism-claims\.json/);
  });
});

// ⏱ 2026-09-19. The extensions' own runners are `check('<label>', ok)` and
// `expect('<label>', {...})`, not node:test, so five claims they enforce could
// only be demoted. A `harness` field makes such a label citable, but only in a
// file that BINDS that function: a bare `check(` call proves nothing about
// which runner it belongs to.
describe('assert-mechanism-claims — M6 with the extensions harness', () => {
  const LABEL = 'the list is read from the record';
  const SIM = `let FAILS = 0;\nfunction check(label, ok) { if (!ok) FAILS++; }\ncheck('${LABEL}', true);\nprocess.exit(FAILS ? 1 : 0);\n`;
  const withHarness = (body, harness = 'check') => ({ files, register }) => {
    files['tooling/ci/test/guard.test.mjs'] = body;
    register.claims[0].harness = harness;
  };

  test('a check() label in a file that DEFINES check is a citable case', () => {
    const { code, out } = run(fixture({ patch: withHarness(SIM) }));
    assert.equal(code, 0, out);
  });

  test('a check() label in a file that DESTRUCTURES check from a require is a citable case', () => {
    const body = `const H = require('./harness.js');\nconst { check, section } = H;\ncheck('${LABEL}', true);\n`;
    assert.equal(run(fixture({ patch: withHarness(body) })).code, 0);
    const direct = `const { section, check } = require('./harness.js');\ncheck('${LABEL}', true);\n`;
    assert.equal(run(fixture({ patch: withHarness(direct) })).code, 0);
  });

  test('an expect() label in a file that defines expect is a citable case', () => {
    const body = `function expect(label, opts) { return opts; }\nexpect('${LABEL}', { code: 1 });\n`;
    const { code, out } = run(fixture({ patch: withHarness(body, 'expect') }));
    assert.equal(code, 0, out);
  });

  test('M6: a check() call in a file that never binds check is refused', () => {
    const body = `import { run } from './lib.mjs';\ncheck('${LABEL}', true);\n`;
    const { code, out } = run(fixture({ patch: withHarness(body) }));
    assert.equal(code, 1, out);
    assert.match(out, /M6 [^\n]*neither defines `check` nor destructures it/);
  });

  test('M6: a WRONG label is refused — the citation must name a real check', () => {
    const { code, out } = run(fixture({ patch: ({ files, register }) => { withHarness(SIM)({ files, register }); register.claims[0].case = `${LABEL} twice`; } }));
    assert.equal(code, 1, out);
    assert.match(out, /M6 [^\n]*makes no `check\(\.\.\.\)` call labelled exactly that/);
  });

  test('M6: the label under a DIFFERENT callee than the harness named is refused', () => {
    const body = `function check(label, ok) {}\nfunction expect(label, o) {}\nexpect('${LABEL}', {});\n`;
    const { code, out } = run(fixture({ patch: withHarness(body, 'check') }));
    assert.equal(code, 1, out);
    assert.match(out, /M6 [^\n]*makes no `check\(\.\.\.\)` call labelled exactly that/);
  });

  test('M6: a commented-out check() is not a case', () => {
    const body = `function check(label, ok) {}\n// check('${LABEL}', true);\n`;
    const { code, out } = run(fixture({ patch: withHarness(body) }));
    assert.equal(code, 1, out);
    assert.match(out, /M6 [^\n]*makes no `check\(\.\.\.\)` call labelled exactly that/);
  });

  test('M6: a check() label is NOT citable without the harness field — the default stays test / it / describe', () => {
    const { code, out } = run(fixture({ patch: ({ files }) => { files['tooling/ci/test/guard.test.mjs'] = SIM; } }));
    assert.equal(code, 1, out);
    assert.match(out, /M6 [^\n]*declares no test titled exactly that/);
  });

  test('M6: an unknown harness name is refused', () => {
    const { code, out } = run(fixture({ patch: withHarness(SIM, 'assertThat') }));
    assert.equal(code, 1, out);
    assert.match(out, /M6 [^\n]*names the harness "assertThat"/);
  });

  test('REAL FILE: extensions/core/test/settings.node.js is citable with its harness, and only with it', () => {
    // The real sim and its real register entry, cut down to that one file. Its
    // `check` is destructured from core/test/harness.js (`const { check, ... } = H;`).
    const SUBJECT = 'extensions/core/test/settings.node.js';
    const real = JSON.parse(readFileSync(join(REPO, 'tooling', 'mechanism-claims.json'), 'utf8'));
    const own = real.claims.filter((c) => c.file === SUBJECT);
    assert.ok(own.some((c) => c.status === 'proven' && c.harness === 'check'), `the real register no longer cites ${SUBJECT} through its harness; this control lost its subject`);
    const files = { [SUBJECT]: readFileSync(join(REPO, ...SUBJECT.split('/')), 'utf8') };
    const register = (claims) => ({ shapes: real.shapes, backlog: {}, claims });

    const green = run(fixture({ files: { ...files }, register: register(own) }));
    assert.equal(green.code, 0, green.out);

    const noHarness = run(fixture({ files: { ...files }, register: register(own.map(({ harness, ...c }) => c)) }));
    assert.equal(noHarness.code, 1, noHarness.out);
    assert.match(noHarness.out, /M6 [^\n]*declares no test titled exactly that/);

    const wrongLabel = run(fixture({ files: { ...files }, register: register(own.map((c) => ({ ...c, case: `${c.case}.` }))) }));
    assert.equal(wrongLabel.code, 1, wrongLabel.out);
    assert.match(wrongLabel.out, /M6 [^\n]*makes no `check\(\.\.\.\)` call labelled exactly that/);
  });
});

describe('assert-mechanism-claims — the REAL tree', () => {
  test('the real repository is green', () => {
    const r = spawnSync(process.execPath, [GUARD], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /swept \d+ tracked text file\(s\)/);
  });

  test('RED CONTROL: the real seed sentence without its judgement fails M1', () => {
    // The real verify-supabase-templates.mjs and the real register, cut down to
    // that one file. With its claims entry the file is green; with the entry
    // removed, the sentence that shipped false in PR #779 is an unjudged claim.
    const SEED = 'tooling/ops/verify-supabase-templates.mjs';
    const real = JSON.parse(readFileSync(join(REPO, 'tooling', 'mechanism-claims.json'), 'utf8'));
    const text = readFileSync(join(REPO, ...SEED.split('/')), 'utf8');
    const own = real.claims.filter((c) => c.file === SEED);
    assert.ok(own.length >= 1, `the real register no longer judges ${SEED}; this control lost its subject`);
    const proof = own[0].test;
    const files = { [SEED]: text, [proof]: readFileSync(join(REPO, ...proof.split('/')), 'utf8') };
    const base = { shapes: real.shapes, backlog: {} };
    if (real.backlog[SEED]) base.backlog[SEED] = real.backlog[SEED];
    // The proof file is swept too; carry its own judgements and backlog row.
    const proofOwn = real.claims.filter((c) => c.file === proof);
    if (real.backlog[proof]) base.backlog[proof] = real.backlog[proof];

    const green = run(fixture({ files: { ...files }, register: { ...base, claims: [...own, ...proofOwn] } }));
    assert.equal(green.code, 0, green.out);

    const red = run(fixture({ files: { ...files }, register: { ...base, claims: [...proofOwn] } }));
    assert.equal(red.code, 1, red.out);
    // ⏱ 2026-09-21 — :139 → :150. THE LINE MOVED; THE CLAIM DID NOT. The bounded
    // retry (row O-PAGES-FETCH-TRANSIENT-NOT-RETRIED, sweep clause) added eleven
    // comment lines ABOVE this sentence in verify-supabase-templates.mjs.
    //
    // ⚠️ THIS IS THE ONLY ASSERTION IN THE SUITE THAT PINS A REAL FILE'S LINE
    // NUMBER (measured 2026-09-21 across all 233 test files: ten `at :N` pins, and
    // the other nine are into fixtures the test writes itself, where the number is
    // stable by construction). The REGISTER anchors on the sentence TEXT, which is
    // why assert-mechanism-claims.mjs stayed green on the real tree throughout —
    // only this control is positional, so ANY edit anywhere above the sentence
    // reds a control that is otherwise about content.
    assert.match(
      red.out,
      /M1 tooling\/ops\/verify-supabase-templates\.mjs has 1 unjudged mechanism claim\(s\) \(no-second-list at :150\)/,
    );
  });
});
