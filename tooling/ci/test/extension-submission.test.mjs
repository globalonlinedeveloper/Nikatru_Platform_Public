// ─────────────────────────────────────────────────────────────────────────────
// extension-submission.test.mjs — the three extension store lanes, and the guard
// that keeps their steps behind the dry-run condition.
//
// TWO SUBJECTS, ONE FILE, because they are two halves of one claim:
//   · extensions/scripts/publish-arming.mjs — the register-driven verdict every
//     extension lane asks before it does anything. Its three answers (`go`,
//     `refuse`, `pending`) are the whole of the fail-closed rule, so each is
//     exercised against a fixture register rather than against the live one,
//     which today would only ever produce `pending`.
//   · tooling/ci/assert-publish-steps-guarded.mjs — the check that every
//     publishing surface in a release job carries `inputs.dry_run != true`
//     (limb 1), and that every STORE publish in every workflow waits for the
//     owner's typed dispatch word (limb 2, PART 3).
//
// 🔴 EVERY MUTATION HERE HAS A GREEN CONTROL FIRST. A red that is red for the
// wrong reason is the failure mode these cases exist to avoid: `shell-16`
// records a guard copied out of tooling/ci dying on LOAD with exit 1, which
// reads exactly like the mutation being caught.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, cpSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseWorkflow, readSteps, stepModel, storePublishSteps, parseResolvedWorkflows } from '../workflow-scan.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-publish-steps-guarded.mjs');
const ARMING = join(REPO, 'extensions', 'scripts', 'publish-arming.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-extsubmit-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;
const write = (root, rel, body) => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
  return p;
};

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — the arming verdict
// ─────────────────────────────────────────────────────────────────────────────

/** A fixture register carrying one extension row, with the two fields the arming
 *  rule reads. Deliberately minimal: `armingOf` takes rows, not files, and a
 *  fixture that mirrored the whole register would drift from it. */
function registerRoot({ served = false, submittable = false, lane = { workflow: '.github/workflows/extensions.yml', job: 'release' } } = {}) {
  const root = join(TMP, `reg${seq++}`);
  write(
    root,
    'tooling/channel-register.json',
    JSON.stringify({ channels: [{ id: 'amo', kind: 'store', surface: 'extension', served, submittable, lane }] }, null, 2),
  );
  return root;
}

async function verdict(root, env) {
  const mod = await import(`file:///${ARMING.split('\\').join('/')}`);
  return mod.publishVerdict({
    channelId: 'amo',
    secrets: [
      { name: 'FIXTURE_KEY', why: 'a fixture credential' },
      { name: 'FIXTURE_SECRET', why: 'a fixture credential' },
    ],
    ownerStep: 'the exact owner step',
    env,
    root,
  });
}

describe('publish-arming — the register decides, and the fail-closed case is the armed one', () => {
  test('GREEN CONTROL: armed row + every credential present → go', async () => {
    const r = await verdict(registerRoot({ submittable: true }), { FIXTURE_KEY: 'k', FIXTURE_SECRET: 's' });
    assert.equal(r.verdict, 'go');
    assert.match(r.lines.join('\n'), /ARMED and CREDENTIALLED/);
  });

  test('armed row + an EMPTY credential → refuse, naming the empty one and the owner step', async () => {
    const r = await verdict(registerRoot({ submittable: true }), { FIXTURE_KEY: 'k', FIXTURE_SECRET: '' });
    assert.equal(r.verdict, 'refuse');
    assert.deepEqual(r.missing, ['FIXTURE_SECRET']);
    const out = r.lines.join('\n');
    assert.match(out, /REFUSED/);
    assert.match(out, /FIXTURE_SECRET/);
    assert.match(out, /OWNER STEP: the exact owner step/);
  });

  test('a whitespace-only credential is EMPTY — a space is not a secret', async () => {
    const r = await verdict(registerRoot({ submittable: true }), { FIXTURE_KEY: '   ', FIXTURE_SECRET: 's' });
    assert.equal(r.verdict, 'refuse');
    assert.deepEqual(r.missing, ['FIXTURE_KEY']);
  });

  test('UNARMED row + an empty credential → pending, printing the owner step, NOT a failure', async () => {
    const r = await verdict(registerRoot({ submittable: false }), { FIXTURE_KEY: '', FIXTURE_SECRET: '' });
    assert.equal(r.verdict, 'pending');
    const out = r.lines.join('\n');
    assert.match(out, /PENDING MANUAL PUBLISH/);
    assert.match(out, /TRIPWIRE, NOT A WAIVER/);
    assert.match(out, /OWNER STEP: the exact owner step/);
  });

  test('`served: true` arms a row even with `submittable: false` — the two limbs are separate', async () => {
    const r = await verdict(registerRoot({ served: true, submittable: false }), { FIXTURE_KEY: '', FIXTURE_SECRET: '' });
    assert.equal(r.verdict, 'refuse');
  });

  test('`submittable: true` with NO lane is NOT armed — a row that emits nothing cannot ship', async () => {
    const r = await verdict(registerRoot({ submittable: true, lane: null }), { FIXTURE_KEY: '', FIXTURE_SECRET: '' });
    assert.equal(r.verdict, 'pending');
  });

  test('credentials present on an UNARMED row is pending, and says a secret is not an authorisation', async () => {
    const r = await verdict(registerRoot({ submittable: false }), { FIXTURE_KEY: 'k', FIXTURE_SECRET: 's' });
    assert.equal(r.verdict, 'pending');
    assert.match(r.lines.join('\n'), /A SECRET IS NOT AN AUTHORISATION/);
  });

  test('COVERAGE LOST when the register has no such row — an absent row is not an unarmed row', async () => {
    const root = join(TMP, `reg${seq++}`);
    write(root, 'tooling/channel-register.json', JSON.stringify({ channels: [] }));
    await assert.rejects(async () => verdict(root, {}), /COVERAGE LOST/);
  });

  test('COVERAGE LOST when no credential names are declared — an empty list is present by vacuity', async () => {
    const mod = await import(`file:///${ARMING.split('\\').join('/')}`);
    assert.throws(
      () => mod.publishVerdict({ channelId: 'amo', secrets: [], ownerStep: 'x', env: {}, root: registerRoot() }),
      /COVERAGE LOST/,
    );
  });

  test('the three live extension rows are declared in the lane table with a named owner step', async () => {
    const mod = await import(`file:///${ARMING.split('\\').join('/')}`);
    assert.deepEqual(Object.keys(mod.LANES).sort(), ['amo', 'chrome-webstore', 'edge-addons']);
    for (const [id, lane] of Object.entries(mod.LANES)) {
      assert.ok(lane.secrets.length > 0, `${id} declares no credential`);
      assert.ok(lane.ownerStep.length > 40, `${id} has no usable owner step`);
      for (const s of lane.secrets) assert.match(s.name, /^[A-Z][A-Z0-9_]+$/, `${id}: ${s.name}`);
    }
  });

  test('every lane credential is declared in the channel register — an unclassified secret cannot enter a lane', async () => {
    const mod = await import(`file:///${ARMING.split('\\').join('/')}`);
    const register = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
    const declared = new Set((register.ciSecretRegister?.nonSigning ?? []).map((e) => e.name));
    for (const lane of Object.values(mod.LANES)) {
      for (const s of lane.secrets) {
        assert.ok(declared.has(s.name), `${s.name} is used by a publish lane and is not in ciSecretRegister.nonSigning`);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 2 — assert-publish-steps-guarded
// ─────────────────────────────────────────────────────────────────────────────

const runGuard = (args) => {
  const r = spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

/** A fixture workflow root. `steps` is a list of {name, if, uses, run}. */
/** ⏱ EXTENDED 2026-09-07 — THE FIXTURE NOW CARRIES A REGISTER, because the
 *  guard's publishing-script domain is DERIVED from it rather than enumerated in
 *  the guard. `scripts` is the set of publishScript values declared on this
 *  fixture's lane; pass `[]` to prove the empty-derivation COVERAGE-LOST limb. */
function workflowRoot(steps, { job = 'release', scripts = ['extensions/scripts/publish-amo.mjs', 'extensions/scripts/publish-cws.mjs', 'extensions/scripts/publish-edge.mjs'] } = {}) {
  const root = join(TMP, `wf${seq++}`);
  const body = [
    'name: Fixture',
    'on: { push: { tags: ["*"] } }',
    'jobs:',
    `  ${job}:`,
    '    runs-on: ubuntu-24.04',
    '    timeout-minutes: 10',
    '    steps:',
  ];
  for (const s of steps) {
    body.push(`      - name: ${s.name}`);
    if (s.if !== undefined) body.push(`        if: ${s.if}`);
    if (s.uses !== undefined) body.push(`        uses: ${s.uses}`);
    if (s.run !== undefined) body.push(`        run: ${s.run}`);
  }
  write(root, '.github/workflows/fixture.yml', `${body.join('\n')}\n`);
  write(
    root,
    'tooling/channel-register.json',
    JSON.stringify(
      {
        channels: scripts.map((p, i) => ({
          id: `fixture-${i}`,
          kind: 'store',
          surface: 'extension',
          served: false,
          submittable: false,
          publishScript: p,
          lane: { workflow: '.github/workflows/fixture.yml', job },
        })),
      },
      null,
      2,
    ),
  );
  return root;
}
/** Twelve ordinary steps plus whatever the case adds — enough to clear MIN_STEPS
 *  so that a case about GUARDING is not silently answered by the floor. */
const filler = (n = 12) => Array.from({ length: n }, (_, i) => ({ name: `filler ${i}`, run: `echo ${i}` }));
const EXEMPT = [
  { name: 'checkout', uses: 'actions/checkout@aaaaaaa' },
  { name: 'node', uses: 'actions/setup-node@bbbbbbb' },
];

describe('assert-publish-steps-guarded — the region is the job, and zero is not a pass', () => {
  test('GREEN CONTROL: the real extensions.yml release job passes and prints its tally', () => {
    const { code, out } = runGuard([]);
    assert.equal(code, 0, out);
    assert.match(out, /step boundaries read; \d+ publishing-surface step\(s\), all \d+ behind an if:/);
  });

  test('GREEN CONTROL: the real job grades at least four publishing surfaces (release, AMO, CWS, Edge)', () => {
    const { out } = runGuard([]);
    const m = out.match(/(\d+) publishing-surface step\(s\)/);
    assert.ok(m !== null, out);
    assert.ok(Number(m[1]) >= 4, `expected at least 4 publishing surfaces, read ${m[1]}\n${out}`);
  });

  test('GREEN CONTROL on a fixture: a guarded publish passes', () => {
    const root = workflowRoot([
      ...EXEMPT,
      ...filler(),
      { name: 'publish', if: "github.event_name == 'push' && inputs.dry_run != true", run: 'gh release create x' },
    ]);
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release', '--limb', 'dry-run']);
    assert.equal(code, 0, out);
  });

  test('an UNGUARDED publishing step FAILS', () => {
    const root = workflowRoot([...EXEMPT, ...filler(), { name: 'publish', run: 'gh release create x' }]);
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release', '--limb', 'dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /UNGUARDED {2}publishing surface/);
  });

  test('an `if:` carrying a `||` is refused even when it CONTAINS the guard', () => {
    const root = workflowRoot([
      ...EXEMPT,
      ...filler(),
      { name: 'publish', if: 'inputs.dry_run != true || true', run: 'gh release create x' },
    ]);
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release', '--limb', 'dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /carries a \|\|/);
  });

  test('an unguarded THIRD-PARTY action is a surface too', () => {
    const root = workflowRoot([...EXEMPT, ...filler(), { name: 'evil', uses: 'someone/else@ccccccc' }, { name: 'publish', if: 'inputs.dry_run != true', run: 'gh release create x' }]);
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release', '--limb', 'dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /third-party action {2}someone\/else/);
  });

  test('each of the three new store scripts is recognised as a publishing surface', () => {
    for (const script of ['publish-amo.mjs', 'publish-cws.mjs', 'publish-edge.mjs']) {
      const root = workflowRoot([...EXEMPT, ...filler(), { name: `submit via ${script}`, run: `node scripts/${script} --tool fullshot` }]);
      const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release', '--limb', 'dry-run']);
      assert.equal(code, 1, `${script} was not graded as a publishing surface\n${out}`);
      assert.match(out, /UNGUARDED {2}publishing surface/);
    }
  });

  test('the arming PREFLIGHT is deliberately NOT a publishing surface — a rehearsal must be able to run it', () => {
    const root = workflowRoot([...EXEMPT, ...filler(), { name: 'preflight', run: 'node scripts/publish-arming.mjs --channel amo' }, { name: 'publish', if: 'inputs.dry_run != true', run: 'gh release create x' }]);
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release', '--limb', 'dry-run']);
    assert.equal(code, 0, out);
    assert.match(out, /1 publishing-surface step\(s\)/);
  });

  test('ZERO publishing surfaces is NOT a pass', () => {
    const root = workflowRoot([...EXEMPT, ...filler()]);
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release', '--limb', 'dry-run']);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /NO publishing surface graded at all/);
    assert.match(out, /ZERO IS NOT A PASS/);
  });

  test('a COLLAPSED region is COVERAGE LOST, not a clean sweep', () => {
    const root = workflowRoot([{ name: 'only one', if: 'inputs.dry_run != true', run: 'gh release create x' }]);
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release', '--limb', 'dry-run']);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /step boundaries and the floor is/);
  });

  test('a job that is not there is COVERAGE LOST — the job IS the region', () => {
    const root = workflowRoot([...EXEMPT, ...filler(), { name: 'publish', if: 'inputs.dry_run != true', run: 'gh release create x' }]);
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'nosuchjob', '--limb', 'dry-run']);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /declares no job "nosuchjob"/);
  });

  test('a workflow that is not there is COVERAGE LOST', () => {
    const { code, out } = runGuard(['--repo-root', TMP, '--workflow', '.github/workflows/absent.yml', '--job', 'release', '--limb', 'dry-run']);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
  });

  test('an EXEMPTION no step uses is a failure — it would pre-authorise whatever takes that name next', () => {
    const root = workflowRoot([
      { name: 'checkout', uses: 'actions/checkout@aaaaaaa' },
      ...filler(),
      { name: 'publish', if: 'inputs.dry_run != true', run: 'gh release create x' },
    ]);
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release', '--limb', 'dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /actions\/setup-node.*exemption list/s);
  });


  // ── THE DOMAIN IS DERIVED, NOT ENUMERATED (added 2026-09-07, review finding) ──
  // The guard used to carry a hand-written alternation naming publish-amo,
  // publish-cws and publish-edge. Measured then: a fourth store's script tested
  // FALSE against it, and the `graded === 0` floor could not fire because the
  // three existing surfaces kept the count non-zero — so the new store's submit
  // step was ungraded, the guard exited 0, and a workflow_dispatch rehearsal
  // would have EXECUTED it. These four cases are the two halves of the repair.

  test('a FOURTH store declared in the register is graded — the hand-written alternation is gone', () => {
    const scripts = [
      'extensions/scripts/publish-amo.mjs',
      'extensions/scripts/publish-cws.mjs',
      'extensions/scripts/publish-edge.mjs',
      'extensions/scripts/publish-operagx.mjs',
    ];
    const root = workflowRoot(
      [...EXEMPT, ...filler(), { name: 'submit to Opera GX', run: 'node scripts/publish-operagx.mjs --tool fullshot' }],
      { scripts },
    );
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release', '--limb', 'dry-run']);
    assert.equal(code, 1, `a declared fourth store was not graded at all:\n${out}`);
    assert.match(out, /UNGUARDED {2}publishing surface/);
    assert.match(out, /publish-operagx\.mjs/);
  });

  test('the same fourth store, GUARDED, passes — so the case above is about the if:, not about the name', () => {
    const scripts = [
      'extensions/scripts/publish-amo.mjs',
      'extensions/scripts/publish-cws.mjs',
      'extensions/scripts/publish-edge.mjs',
      'extensions/scripts/publish-operagx.mjs',
    ];
    const root = workflowRoot(
      [...EXEMPT, ...filler(), { name: 'submit to Opera GX', if: 'inputs.dry_run != true', run: 'node scripts/publish-operagx.mjs --tool fullshot' }],
      { scripts },
    );
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release', '--limb', 'dry-run']);
    assert.equal(code, 0, out);
    assert.match(out, /1 publishing-surface step\(s\)/);
  });

  test('a publish script the register does NOT declare is a finding, not a silent pass', () => {
    const root = workflowRoot([
      ...EXEMPT,
      ...filler(),
      { name: 'submit to Opera GX', if: 'inputs.dry_run != true', run: 'node scripts/publish-operagx.mjs --tool fullshot' },
      { name: 'publish', if: 'inputs.dry_run != true', run: 'gh release create x' },
    ]);
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release', '--limb', 'dry-run']);
    assert.equal(code, 1, `an undeclared publish script passed unnoticed:\n${out}`);
    assert.match(out, /UNDECLARED publish script {2}publish-operagx\.mjs/);
  });

  test('a register that declares NO publishScript for this lane is COVERAGE LOST, never "nothing to grade"', () => {
    const root = workflowRoot([...EXEMPT, ...filler(), { name: 'publish', if: 'inputs.dry_run != true', run: 'gh release create x' }], { scripts: [] });
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release', '--limb', 'dry-run']);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /declares no channel with `publishScript`/);
  });

  // ⏱ 2026-09-24 (EXT-3): the three rows' lane job is `store-publish`, the one job that submits.
  test('the three live extension rows declare their publishScript, so the real derivation is not empty', () => {
    const reg = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
    const declared = reg.channels
      .filter((c) => c?.lane?.workflow === '.github/workflows/extensions.yml' && c?.lane?.job === 'store-publish' && typeof c.publishScript === 'string')
      .map((c) => c.publishScript)
      .sort();
    assert.deepEqual(declared, [
      'extensions/scripts/publish-amo.mjs',
      'extensions/scripts/publish-cws.mjs',
      'extensions/scripts/publish-edge.mjs',
    ]);
  });

  test('the old COMMENT-SENTINEL region is gone from extensions.yml — the defect this guard replaced', () => {
    const yml = readFileSync(join(REPO, '.github', 'workflows', 'extensions.yml'), 'utf8');
    assert.ok(!yml.includes('>>> RELEASE LANE >>>'), 'a comment sentinel is back; the region must be the job');
    assert.match(yml, /assert-publish-steps-guarded\.mjs/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 3 — assert-publish-steps-guarded, LIMB 2: the owner's word
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 MEASURED 2026-09-11 on origin/main d9d3579e: a TAG PUSH reached the Chrome Web
// Store, Edge Add-ons and Firefox AMO submit steps with no typed word, and the Snap
// and Windows lanes passed --confirm as a literal. Limb 1 graded all three extension
// steps GUARDED, correctly — it asks a different question. Every mutation below
// starts from a COPY OF THE REAL TREE, after a green control on the unmutated copy,
// so each red is about its one edit and not about the copy.

/** A copy of everything limb 2 reads: every workflow, the register, and the scripts
 *  whose text the lane-gate property reads. */
function realCopy(mutate = () => {}) {
  const root = join(TMP, `owner${seq++}`);
  cpSync(join(REPO, '.github', 'workflows'), join(root, '.github', 'workflows'), { recursive: true });
  // ⏱ P-A1: the guard follows `uses: ./.github/actions/<x>`, and a reference it
  // cannot follow is COVERAGE LOST — so the copy carries what the workflows call.
  cpSync(join(REPO, '.github', 'actions'), join(root, '.github', 'actions'), { recursive: true });
  cpSync(join(REPO, 'tooling', 'channel-register.json'), join(root, 'tooling', 'channel-register.json'));
  for (const f of readdirSync(join(REPO, 'tooling', 'release')).filter((n) => /^submit-.*[.]mjs$/.test(n))) {
    cpSync(join(REPO, 'tooling', 'release', f), join(root, 'tooling', 'release', f));
  }
  cpSync(join(REPO, 'extensions', 'scripts'), join(root, 'extensions', 'scripts'), { recursive: true });
  mutate(root);
  return root;
}
/** Replace an anchor that MUST be present — a mutation whose anchor moved would
 *  otherwise be a green control wearing a mutation's name. */
const mutateFile = (root, rel, from, to) => {
  const p = join(root, rel);
  const text = readFileSync(p, 'utf8');
  assert.ok(text.includes(from), `the mutation anchor is not in ${rel}: ${from}`);
  writeFileSync(p, text.split(from).join(to));
};
const ownerWord = (root, limb = 'owner-word') => runGuard(['--repo-root', root, '--limb', limb]);
const EXT = '.github/workflows/extensions.yml';
const EDGE_IF = "github.event_name == 'workflow_dispatch' && startsWith(github.ref, 'refs/tags/') && inputs.dry_run != true && inputs.confirm == 'SUBMIT-TO-EDGE-ADDONS'";
/** ⏱ 2026-09-24 (EXT-3): the store steps live in the `store-publish` job, whose own
 *  `if:` also carries the dispatch conjunct — so a case about a step reachable from
 *  push must widen the JOB's condition as well, or the job answers for the step. */
const STORE_JOB_IF = "    if: github.event_name == 'workflow_dispatch' && startsWith(github.ref, 'refs/tags/') && inputs.lane == 'release' && inputs.dry_run != true";

describe("assert-publish-steps-guarded limb 2 — a store publish waits for the owner's typed word", () => {
  test('GREEN CONTROL: the real tree grades at least six store publish steps, every one owner-gated', () => {
    const { code, out } = runGuard([]);
    assert.equal(code, 0, out);
    const m = out.match(/owner-word: (\d+) store publish step\(s\)/);
    assert.ok(m !== null, out);
    assert.ok(Number(m[1]) >= 6, `expected AMO, Chrome, Edge, Play, Snap and Windows at least, read ${m[1]}\n${out}`);
    for (const lane of ['extensions.yml', 'submit-play.yml', 'submit-snap.yml', 'submit-windows-store.yml']) {
      assert.match(out, new RegExp(`OWNER-WORD {2}[.]github/workflows/${lane.split('.').join('[.]')}`), `${lane} was not graded\n${out}`);
    }
    // Snap's lane gate is its script's own; a NOTE for it would mean (d) stopped reading scripts.
    assert.doesNotMatch(out, /NOTE {2}[.]github\/workflows\/submit-snap[.]yml/);
  });

  test('GREEN CONTROL: an unmutated COPY of the tree passes, so every red below is its one edit', () => {
    const { code, out } = ownerWord(realCopy());
    assert.equal(code, 0, out);
  });

  test("(a) a publish condition that names the push event is REACHABLE FROM PUSH", () => {
    const root = realCopy((r) => {
      mutateFile(r, EXT, EDGE_IF, EDGE_IF.replace("'workflow_dispatch'", "'push'"));
      mutateFile(r, EXT, STORE_JOB_IF, "    if: startsWith(github.ref, 'refs/tags/')");
    });
    const { code, out } = ownerWord(root);
    assert.equal(code, 1, out);
    assert.match(out, /NOT OWNER-GATED {2}[.]github\/workflows\/extensions[.]yml:\d+ job "store-publish" step "Submit to Microsoft Edge Add-ons"/);
    assert.match(out, /\(a\) REACHABLE FROM PUSH/);
    assert.match(out, /\(a\) NAMES THE PUSH EVENT/);
  });

  test('THE MEASURED DEFECT: the old tag-push condition fails limb 2 — and limb 1 alone still calls it guarded', () => {
    const root = realCopy((r) => {
      mutateFile(r, EXT, EDGE_IF, "github.event_name == 'push' && inputs.dry_run != true");
      mutateFile(r, EXT, STORE_JOB_IF, "    if: startsWith(github.ref, 'refs/tags/')");
    });
    const two = ownerWord(root);
    assert.equal(two.code, 1, two.out);
    assert.match(two.out, /\(a\) REACHABLE FROM PUSH/);
    assert.match(two.out, /\(b\) NO TYPED OWNER WORD/);
    const one = ownerWord(root, 'dry-run');
    assert.equal(one.code, 0, `limb 1 was expected to pass this shape — it is the reason limb 2 exists\n${one.out}`);
  });

  test('(c) snap handed a LITERAL instead of ${{ inputs.confirm }} is refused', () => {
    const root = realCopy((r) => mutateFile(r, '.github/workflows/submit-snap.yml', 'CONFIRM: ${{ inputs.confirm }}', 'CONFIRM: SUBMIT-TO-SNAP-STORE'));
    const { code, out } = ownerWord(root);
    assert.equal(code, 1, out);
    assert.match(out, /NOT OWNER-GATED {2}[.]github\/workflows\/submit-snap[.]yml/);
    assert.match(out, /\(c\) THE WORD IS NOT HANDED OVER FROM inputs/);
  });

  test('(c) a literal --confirm is refused — the tautology submit-snap.yml shipped', () => {
    const root = realCopy((r) => mutateFile(r, '.github/workflows/submit-snap.yml', '--confirm "$CONFIRM"', '--confirm SUBMIT-TO-SNAP-STORE'));
    const { code, out } = ownerWord(root);
    assert.equal(code, 1, out);
    assert.match(out, /\(c\) LITERAL CONFIRM — --confirm SUBMIT-TO-SNAP-STORE/);
  });

  test('(d) the Windows lane with its lane gate removed, and a script with none, is refused', () => {
    const root = realCopy((r) => {
      const rel = join(r, '.github', 'workflows', 'submit-windows-store.yml');
      const lines = readFileSync(rel, 'utf8').split('\n');
      const at = lines.findIndex((l) => l.includes('$env:GITHUB_ACTIONS -ne'));
      assert.ok(at !== -1, 'the Windows lane gate is not in submit-windows-store.yml');
      let end = at;
      while (lines[end].trim() !== '}') end++;
      lines.splice(at, end - at + 1);
      writeFileSync(rel, lines.join('\n'));
      // A stub without the gate, so this case stays about the YAML the day the script gains its own.
      writeFileSync(join(r, 'tooling', 'release', 'submit-windows-store.mjs'), '// a submission script with no lane gate\n');
    });
    const { code, out } = ownerWord(root);
    assert.equal(code, 1, out);
    assert.match(out, /NOT OWNER-GATED {2}[.]github\/workflows\/submit-windows-store[.]yml/);
    assert.match(out, /\(d\) NO LANE GATE/);
  });

  test('a BRAND-NEW store publish step with none of the properties is refused on all four', () => {
    const root = realCopy((r) =>
      write(
        r,
        '.github/workflows/sneak-publish.yml',
        [
          'name: Sneak publish',
          'on:',
          '  push:',
          "    tags: ['*']",
          'permissions:',
          '  contents: read',
          'jobs:',
          '  ship:',
          '    runs-on: ubuntu-24.04',
          '    timeout-minutes: 10',
          '    steps:',
          '      - name: Upload the snap',
          '        run: snapcraft upload --release=stable app.snap',
          '',
        ].join('\n'),
      ),
    );
    const { code, out } = ownerWord(root);
    assert.equal(code, 1, out);
    assert.match(out, /NOT OWNER-GATED {2}[.]github\/workflows\/sneak-publish[.]yml:\d+ job "ship" step "Upload the snap"/);
    for (const limb of [/\(a\) REACHABLE FROM PUSH/, /\(b\) NO TYPED OWNER WORD/, /\(c\) THE WORD IS NOT HANDED OVER/, /\(d\) NO LANE GATE/]) assert.match(out, limb);
  });

  test("a || in a store publish step's if: is not evidence", () => {
    const root = realCopy((r) => mutateFile(r, EXT, EDGE_IF, `${EDGE_IF} || github.event_name == 'schedule'`));
    const { code, out } = ownerWord(root);
    assert.equal(code, 1, out);
    assert.match(out, /not a plain conjunction/);
  });

  test('a dispatch input whose DEFAULT is the word is typed by nobody', () => {
    const root = realCopy((r) => mutateFile(r, '.github/workflows/submit-play.yml', "default: 'dry-run-only'", "default: 'SUBMIT-TO-PLAY'"));
    const { code, out } = ownerWord(root);
    assert.equal(code, 1, out);
    assert.match(out, /DEFAULTS to 'SUBMIT-TO-PLAY'/);
  });

  test('two stores gated on ONE word is refused — every store takes its own', () => {
    const root = realCopy((r) => mutateFile(r, EXT, "inputs.confirm == 'SUBMIT-TO-EDGE-ADDONS'", "inputs.confirm == 'SUBMIT-TO-CHROME-WEB-STORE'"));
    const { code, out } = ownerWord(root);
    assert.equal(code, 1, out);
    assert.match(out, /SHARED WORD {2}'SUBMIT-TO-CHROME-WEB-STORE' gates 2 store publish steps/);
  });

  test('EMPTY SUBJECT: zero store publish steps is COVERAGE LOST, exit 2 — never a pass', () => {
    const root = realCopy((r) => {
      for (const f of ['extensions.yml', 'submit-play.yml', 'submit-snap.yml', 'submit-windows-store.yml']) rmSync(join(r, '.github', 'workflows', f));
      writeFileSync(join(r, 'tooling', 'channel-register.json'), JSON.stringify({ channels: [] }));
    });
    const { code, out } = ownerWord(root);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — ZERO store publish steps found/);
  });

  test('no workflow to read at all is COVERAGE LOST, exit 2', () => {
    const root = join(TMP, `owner${seq++}`);
    write(root, 'tooling/channel-register.json', JSON.stringify({ channels: [] }));
    const { code, out } = ownerWord(root);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — no workflow parsed/);
  });

  test('a register publishScript that no step invokes is COVERAGE LOST — respelled past the scan', () => {
    const root = realCopy((r) => mutateFile(r, EXT, 'node extensions/scripts/publish-edge.mjs', 'node extensions/scripts/publish_edge.mjs'));
    const { code, out } = ownerWord(root);
    assert.equal(code, 2, out);
    assert.match(out, /declares publishScript extensions\/scripts\/publish-edge[.]mjs and no store publish step in any workflow invokes it/);
  });

  test('a submit lane whose --submit verb is respelled past the scan is COVERAGE LOST', () => {
    const root = realCopy((r) => mutateFile(r, '.github/workflows/submit-play.yml', 'submit-play.mjs --submit', 'submit-play.mjs "--submit"'));
    const { code, out } = ownerWord(root);
    assert.equal(code, 2, out);
    assert.match(out, /channel "android-play" submits through tooling\/release\/submit-play[.]mjs/);
  });

  test('an unknown --limb is COVERAGE LOST, exit 2 — a typo must not run nothing and pass', () => {
    const { code, out } = runGuard(['--limb', 'owner_word']);
    assert.equal(code, 2, out);
    assert.match(out, /names no limb/);
  });
});

// ── P-A1: A PUBLISHING STEP MOVED INTO A LOCAL COMPOSITE ACTION ─────────────
// The dry-run limb reads the job through parseResolvedWorkflows: the calling step
// is replaced by the action's steps, each labelled at its own file and line, and
// the caller's `if:` is carried onto every inlined step that declares none.
describe('assert-publish-steps-guarded — a publish moved into a local composite action', () => {
  const PUB_ACTION = 'name: Pub\nruns:\n  using: composite\n  steps:\n    - name: publish\n      shell: bash\n      run: gh release create x\n';

  test('an UNGUARDED publish inside the composite FAILS, labelled at the action file', () => {
    const root = workflowRoot([...EXEMPT, ...filler(), { name: 'via action', uses: './.github/actions/pub' }]);
    write(root, '.github/actions/pub/action.yml', PUB_ACTION);
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release', '--limb', 'dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /UNGUARDED {2}publishing surface/);
    assert.match(out, /\.github\/actions\/pub\/action\.yml:5 step "publish"/);
  });

  test('the caller step\'s dry-run `if:` guards the composite\'s publish', () => {
    const root = workflowRoot([...EXEMPT, ...filler(), { name: 'via action', if: 'inputs.dry_run != true', uses: './.github/actions/pub' }]);
    write(root, '.github/actions/pub/action.yml', PUB_ACTION);
    const { code, out } = runGuard(['--repo-root', root, '--workflow', '.github/workflows/fixture.yml', '--job', 'release', '--limb', 'dry-run']);
    assert.equal(code, 0, out);
    assert.match(out, /1 publishing-surface step\(s\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXT-3 (2026-09-24) — AMO's first submit carries a metadata payload, the store
// steps run in one environment-bound job, and that job submits the Release's own
// bytes. Every case is written out by hand (assert-no-loop-cases.mjs).
// ─────────────────────────────────────────────────────────────────────────────
const AMO_SCRIPT = join(REPO, 'extensions', 'scripts', 'publish-amo.mjs');
const AMO_META = join(REPO, 'extensions', 'scripts', 'amo-metadata.mjs');
const STORE_ENV = join(REPO, 'extensions', 'scripts', 'lib', 'store-environment.mjs');
const FS_DIR = join(REPO, 'extensions', 'Extension', 'Full_Screen_Shot');

/** A minimal extensions root holding FullShot's metadata sources only, so a case
 *  can break one of them without touching the real tree. */
function metaRoot(mutate = () => {}) {
  const root = join(TMP, `amometa${seq++}`);
  const tool = join(root, 'Extension', 'Full_Screen_Shot');
  for (const rel of ['tool.json', 'LICENSE', 'publish/identity.json', 'store/firefox', 'store/_shared/support-url.txt']) {
    cpSync(join(FS_DIR, rel), join(tool, rel), { recursive: true });
  }
  mutate(tool);
  return root;
}

describe('EXT-3 — the AMO first submit carries the listing, and the store steps run where the owner gates them', () => {
  test('E3-1 the sign argv hands web-ext the metadata file (--amo-metadata) and does not wait on review', async () => {
    const { signArgv } = await import(pathToFileURL(AMO_SCRIPT).href);
    const args = signArgv({ sourceDir: 'src', artifactsDir: 'out', metadataPath: 'out/amo-metadata.json' });
    assert.equal(args[0], 'sign');
    assert.equal(args[args.indexOf('--amo-metadata') + 1], 'out/amo-metadata.json', JSON.stringify(args));
    assert.equal(args[args.indexOf('--channel') + 1], 'listed');
    assert.equal(args[args.indexOf('--approval-timeout') + 1], '0');
  });

  test('E3-2 GREEN CONTROL: the real FullShot payload carries every field a listed first submit needs', async () => {
    const { buildAmoMetadata } = await import(pathToFileURL(AMO_META).href);
    const r = buildAmoMetadata({ toolId: 'fullshot' });
    assert.equal(r.ok, true, JSON.stringify(r.why));
    const p = r.payload;
    assert.equal(p.slug, 'fullshot');
    assert.ok(p.name['en-US'] && p.summary['en-US'] && p.description['en-US']);
    assert.deepEqual(p.categories, { firefox: ['photos-music-videos', 'privacy-security'] });
    assert.equal(p.support_email['en-US'], 'support@nikatru.com');
    assert.equal(p.version.custom_license.name['en-US'], 'PolyForm Shield License 1.0.0');
    assert.match(p.version.custom_license.text['en-US'], /^Required Notice: Copyright Rajasekar Selvam, trading as NIKATRU \(https:\/\/nikatru\.com\)$/m);
    assert.ok(p.version.approval_notes.trim().length > 0, 'reviewer notes are the approval_notes');
  });

  test('E3-3 RED: a LICENSE whose Required Notice is a placeholder refuses the payload', async () => {
    const { buildAmoMetadata } = await import(pathToFileURL(AMO_META).href);
    const root = metaRoot((tool) => {
      const lic = readFileSync(join(tool, 'LICENSE'), 'utf8');
      writeFileSync(join(tool, 'LICENSE'), lic.replace(/^Required Notice: .*$/m, 'Required Notice: Copyright <OWNER LEGAL NAME OR COMPANY> (<OPTIONAL URL>)'));
    });
    const r = buildAmoMetadata({ toolId: 'fullshot', root });
    assert.equal(r.ok, false);
    assert.match(r.why.join('\n'), /LICENSE its Required Notice is still a placeholder/);
  });

  test('E3-4 RED: an empty reviewer note, and a category AMO has no slug for, each refuse by name', async () => {
    const { buildAmoMetadata } = await import(pathToFileURL(AMO_META).href);
    const root = metaRoot((tool) => {
      writeFileSync(join(tool, 'store', 'firefox', 'reviewer-notes.txt'), '\n');
      writeFileSync(join(tool, 'store', 'firefox', 'category.txt'), 'Productivity\n');
    });
    const r = buildAmoMetadata({ toolId: 'fullshot', root });
    assert.equal(r.ok, false);
    const why = r.why.join('\n');
    assert.match(why, /store\/firefox\/reviewer-notes\.txt is empty/);
    assert.match(why, /names "Productivity", which is not an AMO extension category/);
  });

  test('E3-5 publish-amo WITHOUT --submit is a dry run: it prints the payload and the argv, and sends nothing', () => {
    const env = { ...process.env };
    delete env.AMO_JWT_ISSUER;
    delete env.AMO_JWT_SECRET;
    const r = spawnSync(process.execPath, [AMO_SCRIPT, '--tool', 'fullshot', '--artifacts-dir', join(TMP, 'amo-dry')], { encoding: 'utf8', env });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /"approval_notes"/);
    assert.match(r.stdout, /→ {4}web-ext sign --channel listed .* --amo-metadata \S+amo-metadata\.json --approval-timeout 0/);
    assert.match(r.stdout, /^publish-amo: DRY RUN — nothing was sent to addons\.mozilla\.org/m);
    assert.doesNotMatch(r.stdout, /SUBMITTED/);
  });

  test('E3-6 the store-publish job is environment-bound, needs the release, and submits AMO with --submit', () => {
    const wf = parseWorkflow(REPO, '.github/workflows/extensions.yml');
    const job = wf.jobs.get('store-publish');
    assert.ok(job, 'extensions.yml declares a store-publish job');
    assert.ok(job.lines.some((l) => /^ {4}environment: store-publish\s*$/.test(l.text)), 'environment: store-publish');
    assert.ok(job.lines.some((l) => /^ {4}needs: release\s*$/.test(l.text)), 'needs: release');
    const amo = readSteps(job).map(stepModel).find((st) => st.name === 'Submit to Firefox Add-ons (AMO)');
    assert.ok(amo, 'the AMO step is in store-publish');
    assert.match(amo.run, /node extensions\/scripts\/publish-amo\.mjs [^;]*--submit/);
    assert.ok(!wf.jobs.get('release').lines.some((l) => /publish-(?:amo|cws|edge)\.mjs/.test(l.text)), 'no store publisher is left in the release job');
  });

  test('E3-7 requireStorePublishEnvironment refuses outside Actions, a missing environment, and one with no reviewer', async () => {
    const { requireStorePublishEnvironment } = await import(pathToFileURL(STORE_ENV).href);
    const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' };
    const answer = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });
    const outside = await requireStorePublishEnvironment({ env: { GITHUB_TOKEN: 't' }, fetchImpl: answer(200, {}) });
    assert.equal(outside.ok, false);
    assert.match(outside.lines[0], /only inside GitHub Actions/);
    const missing = await requireStorePublishEnvironment({ env, fetchImpl: answer(404, {}) });
    assert.equal(missing.ok, false);
    assert.match(missing.lines[0], /"store-publish" environment does not exist in o\/r/);
    const unguarded = await requireStorePublishEnvironment({ env, fetchImpl: answer(200, { protection_rules: [] }) });
    assert.equal(unguarded.ok, false);
    assert.match(unguarded.lines[0], /carries NO required reviewer/);
    const gated = await requireStorePublishEnvironment({ env, fetchImpl: answer(200, { protection_rules: [{ type: 'required_reviewers', reviewers: [{ id: 1 }] }], can_admins_bypass: false }) });
    assert.equal(gated.ok, true, gated.lines.join('\n'));
  });

  test('E3-8 store-publish downloads and checksum-verifies the Release BEFORE every store step, and submits those bytes, never a fresh pack', () => {
    const wf = parseWorkflow(REPO, '.github/workflows/extensions.yml');
    const job = wf.jobs.get('store-publish');
    assert.ok(job, 'extensions.yml declares a store-publish job');
    const steps = readSteps(job).map(stepModel);
    const download = steps.findIndex((st) => /\bgh release download\b/.test(st.run));
    const verify = steps.findIndex((st) => /\bsha256sum -c\b/.test(st.run));
    const register = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
    const storeLines = storePublishSteps(parseResolvedWorkflows(REPO).workflows, register).filter((x) => x.wf.rel === wf.rel && x.job.name === 'store-publish').map((x) => x.step.n);
    assert.equal(storeLines.length, 3, `three store steps in store-publish, read ${storeLines.length}`);
    const storeIdx = steps.map((st, i) => (storeLines.includes(st.n) ? i : -1)).filter((i) => i !== -1);
    assert.ok(download !== -1, 'a step runs gh release download');
    assert.ok(verify !== -1, 'a step runs sha256sum -c');
    assert.ok(download < Math.min(...storeIdx) && verify < Math.min(...storeIdx), 'download and verify come before every store step');
    for (const i of storeIdx) {
      const run = steps[i].run;
      assert.doesNotMatch(run, /\bdist\//, `${steps[i].name} names dist/, a fresh pack`);
      const pkg = run.match(/--zip\s+"?([^\s"]+)/)?.[1] ?? run.match(/--source-dir\s+"?([^\s"]+)/)?.[1] ?? null;
      assert.ok(pkg !== null && pkg.startsWith('release-assets/'), `${steps[i].name} package argument ${pkg} is not the downloaded Release`);
    }
  });
});
