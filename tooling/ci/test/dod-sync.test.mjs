// ─────────────────────────────────────────────────────────────────────────────
// dod-sync.test.mjs — the two LOCAL halves of stage 6 must be able to FAIL too.
//
// [pipeline N-1 · N-9] `tooling/scripts/check-dod-sync.mjs` and
// `tooling/scripts/check-selection-record.mjs` are deliberately NOT in
// `tooling/ci/`: both read `company/`, which is gitignored, so a CI guard could
// never once execute against its own subject. They are still checks, and a check
// nobody feeds bad input to has only ever run against valid input.
//
// 🔴 REAL-TREE FIRST, as everywhere else here. Ten mutations of the actual
// register / one-pager / MASTER_PLAN §4 were run before this file existed — all
// ten caught, all restored byte-identically: a register row deleted · a lettered
// item added to §4 with no register row · the page disagreeing with the register
// on enforced-by · a dated cut creeping back into the page's ITEMS section · a
// cut's date deleted from the page · the register emptied · the page losing the
// `## Cuts honoured` heading that BOUNDS the cut scan · §4's heading renamed ·
// the page deleted outright · a cut with no detectable phrase.
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

const TOOLING = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SYNC = join(TOOLING, 'scripts', 'check-dod-sync.mjs');
const SELECTION = join(TOOLING, 'scripts', 'check-selection-record.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-dodsync-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;
function fixture(files) {
  const dir = join(TMP, `f${seq++}`);
  for (const [rel, body] of Object.entries(files)) {
    if (body === null) continue;
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}
const run = (script, cwd, args = []) => {
  const r = spawnSync(process.execPath, [script, cwd, ...args], { encoding: 'utf8', cwd });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

const REGISTER = {
  humanReviewRows: ['four-states'],
  items: [
    { id: 'A', title: 'Screens', enforcedBy: 'guard', check: 'assert-screen-set.mjs' },
    { id: 'B', title: 'Four states', enforcedBy: 'human', check: 'four-states' },
  ],
  // TWO cuts, deliberately: with one, removing its phrase empties the scan and
  // the COVERAGE LOST branch fires first, so the per-cut "this cut has nothing to
  // look for" message would never be reachable. Both branches are real and both
  // need a case.
  cuts: [
    { id: 'golden-matrix', what: 'the golden matrix', decided: '2026-07-25', by: '39-CHASSIS', pageMustNotContain: 'Alchemist', why: 'unaffordable' },
    { id: 'coverage-percentage', what: 'the >=80% number', decided: '2026-07-26', by: '39-CHASSIS', pageMustNotContain: '80%', why: 'gameable' },
  ],
};

const PLAN = `# Master plan

## 3. Something else

## 4. Per-app production checklist = reusable Definition of Done

**A. Complete screen set** [brick]: things.

**B. Every state, every data screen** [CI]: four states.

**Enforcement:** every item maps to a file or a lane.

## 5. Next section
`;

const PAGE = `# Definition of Done

## The items

| id | item | enforced-by | where |
|---|---|---|---|
| **A** | Complete screen set | \`guard\` | assert-screen-set.mjs |
| **B** | Four states | \`human\` | the four-states row |

## Cuts honoured — dated, with the decision that made them

| cut | decided | by |
|---|---|---|
| the golden matrix | 2026-07-25 | 39-CHASSIS |
| the coverage percentage | 2026-07-26 | 39-CHASSIS |
`;

const build = ({ register = REGISTER, plan = PLAN, page = PAGE } = {}) => fixture({
  'tooling/dod-register.json': register === null ? null : JSON.stringify(register, null, 2),
  'company/MASTER_PLAN.md': plan,
  'company/requirements/definition-of-done.md': page,
});

describe('check-dod-sync', () => {
  test('passes when the register, the one-pager and MASTER_PLAN §4 agree', () => {
    const { code, out } = run(SYNC, build());
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}DoD sync/);
    // It must SAY what it could not check, because the whole point of the split
    // is that CI cannot read the private half at all.
    assert.match(out, /company\/ is gitignored/);
  });

  test('FAILS when §4 gains a lettered item the register does not carry', () => {
    const plan = PLAN.replace('**Enforcement:**', '**C. Adaptive** [brick]: five classes.\n\n**Enforcement:**');
    const { code, out } = run(SYNC, build({ plan }));
    assert.equal(code, 1, 'the two documents drifted once already; this is the shape that stops it');
    assert.match(out, /MASTER_PLAN §4 declares item C and tooling\/dod-register\.json has no row for it/);
  });

  test('FAILS when the register invents an item §4 does not declare', () => {
    const register = structuredClone(REGISTER);
    register.items.push({ id: 'Z', title: 'Invented', enforcedBy: 'human', check: 'four-states' });
    const { code, out } = run(SYNC, build({ register }));
    assert.equal(code, 1);
    assert.match(out, /which is not a lettered item in MASTER_PLAN §4/);
  });

  test('FAILS when the one-pager and the register disagree on enforced-by', () => {
    const page = PAGE.replace('| **A** | Complete screen set | `guard` |', '| **A** | Complete screen set | `human` |');
    const { code, out } = run(SYNC, build({ page }));
    assert.equal(code, 1, 'neither document may be the sole authority');
    assert.match(out, /the register says enforced-by `guard` and the one-pager says `human`/);
  });

  test('FAILS when a dated cut reappears in the page\'s ITEMS section', () => {
    const page = PAGE.replace('## Cuts honoured', 'Goldens are produced with Alchemist.\n\n## Cuts honoured');
    const { code, out } = run(SYNC, build({ page }));
    assert.equal(code, 1);
    assert.match(out, /has reappeared in the one-pager's ITEMS section/);
  });

  // …and the other direction, which is what makes the bounded scan honest: the
  // page is REQUIRED to keep listing its cuts, so an unbounded scan would read
  // the honest cut list as five re-adopted items.
  test('the page listing its cuts BELOW the heading is not a re-adoption', () => {
    const { code } = run(SYNC, build());
    assert.equal(code, 0);
  });

  test('FAILS when a cut\'s date vanishes from the page\'s cut list', () => {
    const page = PAGE.replace('| the golden matrix | 2026-07-25 |', '| the golden matrix | a while ago |');
    const { code, out } = run(SYNC, build({ page }));
    assert.equal(code, 1, 'a cut whose reasoning is not on the page will be re-litigated from memory');
    assert.match(out, /appears nowhere in the one-pager's cut list/);
  });

  test('COVERAGE LOST when the page loses the heading that BOUNDS the cut scan', () => {
    const page = PAGE.replace('## Cuts honoured — dated, with the decision that made them', '## Notes');
    const { code, out } = run(SYNC, build({ page }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the register is emptied of items', () => {
    const { code, out } = run(SYNC, build({ register: { ...REGISTER, items: [] } }));
    assert.equal(code, 1, 'an empty register makes every set comparison vacuously true');
    assert.match(out, /declares no items/);
  });

  test('COVERAGE LOST when §4 cannot be located in MASTER_PLAN', () => {
    const { code, out } = run(SYNC, build({ plan: PLAN.replace('## 4. Per-app', '## Four. Per-app') }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });

  test('REFUSES rather than reporting ok when the private tree is unreadable', () => {
    const dir = build();
    rmSync(join(dir, 'company/requirements/definition-of-done.md'));
    const { code, out } = run(SYNC, dir);
    assert.equal(code, 1, 'silence about an unperformed check is how apparent coverage inflates');
    assert.match(out, /NOTHING was cross-checked/);
  });

  test('FAILS when a cut carries no detectable phrase, so nothing stops it returning', () => {
    const register = structuredClone(REGISTER);
    delete register.cuts[0].pageMustNotContain;
    const { code, out } = run(SYNC, build({ register }));
    assert.equal(code, 1, 'a cut with no detectable form is a cut nobody is watching');
    assert.match(out, /has no `pageMustNotContain` phrase/);
  });

  test('COVERAGE LOST when NO cut carries a phrase — the scan would examine nothing', () => {
    const register = structuredClone(REGISTER);
    for (const c of register.cuts) delete c.pageMustNotContain;
    const { code, out } = run(SYNC, build({ register }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /NONE carried a phrase to look for/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline N-9] The half CI structurally cannot do. `assert-app-dod.mjs` checks
// that the four selection fields are THERE and prints that it cannot resolve
// them; this resolves them, because it runs where both trees are readable.
describe('check-selection-record', () => {
  const dod = (over = {}) => JSON.stringify({
    app: 'probe',
    status: 'stamped',
    selection: { record: '', sha256: '', decided: '', decidedBy: '', gates: {} },
    ...over,
  }, null, 2);

  const tree = ({ record = dod(), companyFile = null, companyDecoy = false } = {}) => fixture({
    'pubspec.yaml': 'name: fixture\nworkspace:\n  - apps/subly\n  - apps/probe\n',
    'apps/probe/dod.json': record,
    ...(companyFile === null ? {} : { 'company/app-selection/probe.md': companyFile }),
    // A company/ that EXISTS but does not hold the target — see the resolve case.
    ...(companyDecoy ? { 'company/README.md': '# private tree\n' } : {}),
  });

  test('passes, and says so, when nothing is linked yet', () => {
    const { code, out } = run(SELECTION, tree());
    assert.equal(code, 0, out);
    assert.match(out, /no selection record linked yet/);
  });

  test('FAILS when the linked record does not resolve', () => {
    const record = dod({ selection: { record: 'company/app-selection/probe.md', sha256: 'x', decided: '2026-07-30', decidedBy: 'owner', gates: {} } });
    // 🔴 THE FIXTURE NOW SHIPS A company/ THAT DOES NOT CONTAIN THE TARGET, and
    // the distinction is the whole point. "company/ is absent" and "the link
    // points at nothing" used to be the same fixture, and they are not the same
    // fact: the first is every CI checkout (company/ is gitignored) and must
    // print, the second is a real defect and must fail. Modelling the defect as
    // an absent tree meant wiring this script into CI would have failed every
    // run the moment one app carried a link.
    const { code, out } = run(SELECTION, tree({ record, companyFile: null, companyDecoy: true }));
    assert.equal(code, 1, 'CI can only see that the string is there — this is the run that finds out if it points at anything');
    assert.match(out, /does not resolve/);
  });

  test('FAILS when the record on disk is not the one that was signed', () => {
    const body = 'G1b: meaningfully different because …\n';
    const record = dod({ selection: { record: 'company/app-selection/probe.md', sha256: 'deadbeef', decided: '2026-07-30', decidedBy: 'owner', gates: {} } });
    const { code, out } = run(SELECTION, tree({ record, companyFile: body }));
    assert.equal(code, 1);
    assert.match(out, /The gate answers the owner signed are not the gate answers on disk/);
  });

  test('passes when the sha256 really matches the file in company/', async () => {
    const body = 'G1b: meaningfully different because …\n';
    const { createHash } = await import('node:crypto');
    const sha = createHash('sha256').update(Buffer.from(body)).digest('hex');
    const record = dod({ selection: { record: 'company/app-selection/probe.md', sha256: sha, decided: '2026-07-30', decidedBy: 'owner', gates: {} } });
    const { code, out } = run(SELECTION, tree({ record, companyFile: body }));
    assert.equal(code, 0, out);
    assert.match(out, /1 linked record\(s\) resolved and hashed as claimed/);
  });

  test('🔴 RE-POINTED — every app exempt PRINTS, and does NOT redden CI', () => {
    // This case asserted exit 1 from 2026-08-05 to 2026-08-06, and the exit 1
    // was why the script was wired into NOTHING: `grep check-selection-record
    // .github/workflows/*.yml` returned no hit, so N-9's sha256 half was
    // enforced by nothing at all. Read the requirement's sentence — "no app
    // ENTERS the factory without passing the three selection gates". Its subject
    // is an app entering; `apps/subly` predates the gates and is exempt by name;
    // nothing has entered since. An empty non-exempt set is the requirement
    // SATISFIED, and failing on it is what got the guard left unwired.
    //
    // What must not happen is the empty set being taken on trust, and it is not:
    // the two cases below are the floors that make the emptiness checkable, and
    // both are still exit 1.
    const dir = fixture({ 'pubspec.yaml': 'name: fixture\nworkspace:\n  - apps/subly\n' });
    const { code, out } = run(SELECTION, dir);
    assert.equal(code, 0, out);
    assert.match(out, /NO APP HAS ENTERED THE FACTORY SINCE THE GATES EXISTED/);
    assert.match(out, /NOTHING VERIFIED/, 'it must never dress an empty run up as work done');
  });

  test('🔴 …but a STALE EXEMPTION is still COVERAGE LOST', () => {
    const dir = fixture({ 'pubspec.yaml': 'name: fixture\nworkspace:\n  - apps/sublite\n' });
    const { code, out } = run(SELECTION, dir);
    assert.equal(code, 1, 'an exemption that names no real app makes "0 non-exempt" meaningless');
    assert.match(out, /COVERAGE LOST/);
  });

  test('🔴 …and so is an app on disk the workspace does not list', () => {
    const dir = fixture({
      'pubspec.yaml': 'name: fixture\nworkspace:\n  - apps/subly\n',
      'apps/ghost/pubspec.yaml': 'name: ghost\n',
    });
    const { code, out } = run(SELECTION, dir);
    assert.equal(code, 1, 'an app the workspace does not list is an app no selection record is demanded for');
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /apps\/ghost/);
  });
});
