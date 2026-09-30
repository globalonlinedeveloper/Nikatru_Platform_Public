// workflow-hardening.test.mjs — assert-workflow-hardening.mjs limb 15 (⏱ 2026-09-29,
// audit A-6 and B-10): every SHA pin carries `# vX.Y.Z`, and tooling/ci/action-pins.json
// holds one row per pinned action whose sha/version match and whose runtime is current.
// The limb's older siblings are tested in guards.test.mjs; this file is limb 15's alone.
// Each fixture is three legal workflows of four pins (the scan's fallback floor) plus
// the register, so every other limb is held green and each verdict below is limb 15's.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const GUARD = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'assert-workflow-hardening.mjs');
const REGISTER = 'tooling/ci/action-pins.json';
const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

let ROOT;
before(() => {
  ROOT = mkdtempSync(join(tmpdir(), 'nikatru-hardening-'));
});
after(() => rmSync(ROOT, { recursive: true, force: true }));

/** `files` maps relative path → contents; `null` leaves the path absent. */
function fixture(name, files) {
  const dir = join(ROOT, name);
  mkdirSync(dir, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    if (body === null) continue;
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

function run(dir) {
  const r = spawnSync(process.execPath, [GUARD, dir], { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const wf = (lines) =>
  'name: X\non: push\npermissions:\n  contents: read\njobs:\n  j:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n' +
  lines.map((u) => `      - uses: ${u}\n`).join('');

const ACTIONS = ['o/act0', 'o/act1', 'o/act2', 'o/act3'];
const pinLine = (a) => `${a}@${SHA} # v1.2.3`;
const row = (action, over = {}) => ({ action, sha: SHA, version: 'v1.2.3', using: 'node24', readAt: '2026-09-29', source: 'fixture', ...over });

/** `lines` overrides the four pins of c.yml; `rows` is the register's `pins` (or a raw string). */
function tree(name, { lines = ACTIONS.map(pinLine), rows = ACTIONS.map((a) => row(a)), extra = {} } = {}) {
  const files = {
    '.github/workflows/a.yml': wf(ACTIONS.map(pinLine)),
    '.github/workflows/b.yml': wf(ACTIONS.map(pinLine)),
    '.github/workflows/c.yml': wf(lines),
    [REGISTER]: typeof rows === 'string' || rows === null ? rows : JSON.stringify({ pins: rows }),
    ...extra,
  };
  return fixture(name, files);
}

describe('assert-workflow-hardening limb 15 — version comments and the action pin register', () => {
  test('GREEN CONTROL: every pin `# v1.2.3` with a matching node24 row -> exit 0, and says what it graded', () => {
    const { code, out } = run(tree('l15-ok'));
    assert.equal(code, 0, out);
    assert.match(out, /limb 15 — 12 SHA pin\(s\), each `# vX\.Y\.Z` and matching one of 4 tooling\/ci\/action-pins\.json row\(s\)/);
    assert.match(out, /0 row\(s\) record a runtime nobody read at the SHA/);
  });

  test('A-6: a bare SHA pin (no comment) -> exit 1, naming file:line', () => {
    const { code, out } = run(tree('l15-bare', { lines: [`o/act0@${SHA}`, ...ACTIONS.slice(1).map(pinLine)] }));
    assert.equal(code, 1, out);
    assert.match(out, /\.github\/workflows\/c\.yml:10 `uses: o\/act0@a{40}` carries no version comment/);
  });

  // The row agrees with the pin (`v2` both sides), so the ONE finding is the comment's.
  test('A-6: a major-only comment `# v2` -> exit 1, and it is the only finding', () => {
    const { code, out } = run(
      tree('l15-major', {
        lines: [`o/act9@${SHA} # v2`, ...ACTIONS.slice(1).map(pinLine)],
        rows: [...ACTIONS.map((a) => row(a)), row('o/act9', { version: 'v2' })],
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /c\.yml:10 `uses: o\/act9@a{40}` is commented `# v2`\. Write the full tag/);
    assert.match(out, /✗ 1 workflow hardening problem/);
  });

  test('A-6: a bare pin inside a local composite action (the setup-flutter shape) -> exit 1', () => {
    const composite = `name: S\ndescription: d\nruns:\n  using: composite\n  steps:\n    - uses: o/act0@${SHA}\n`;
    const { code, out } = run(tree('l15-composite', { extra: { '.github/actions/s/action.yml': composite } }));
    assert.equal(code, 1, out);
    assert.match(out, /\.github\/actions\/s\/action\.yml:6 `uses: o\/act0@a{40}` carries no version comment/);
  });

  test('B-10: a row recording runs.using node20 -> exit 1', () => {
    const { code, out } = run(tree('l15-node20', { rows: ACTIONS.map((a) => row(a, a === 'o/act2' ? { using: 'node20' } : {})) }));
    assert.equal(code, 1, out);
    assert.match(out, /pins\[2\] records `o\/act2` at runs\.using `node20`, outside node24, composite, docker/);
  });

  test('B-10: a pin with no row -> exit 1', () => {
    const { code, out } = run(tree('l15-norow', { rows: ACTIONS.slice(0, 3).map((a) => row(a)) }));
    assert.equal(code, 1, out);
    assert.match(out, /`o\/act3` has no row in tooling\/ci\/action-pins\.json/);
  });

  test('B-10: a row for no pin -> exit 1', () => {
    const { code, out } = run(tree('l15-orphan', { rows: [...ACTIONS.map((a) => row(a)), row('o/gone')] }));
    assert.equal(code, 1, out);
    assert.match(out, /has a row for `o\/gone`, which no workflow or composite action pins/);
  });

  test('B-10: a pin moved without its row (sha disagrees) -> exit 1', () => {
    const { code, out } = run(tree('l15-moved', { rows: ACTIONS.map((a) => row(a, a === 'o/act1' ? { sha: OTHER_SHA } : {})) }));
    assert.equal(code, 1, out);
    assert.match(out, /`o\/act1@a{40} # v1\.2\.3` disagrees with its tooling\/ci\/action-pins\.json row \(b{40} v1\.2\.3\)/);
  });

  test('a register that parses to zero rows -> exit 2 (COVERAGE LOST), never 0', () => {
    const { code, out } = run(tree('l15-empty', { rows: [] }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — limb 15 read ZERO rows/);
  });

  test('an unparseable register -> exit 2 (REFUSING)', () => {
    const { code, out } = run(tree('l15-broken', { rows: '{not json' }));
    assert.equal(code, 2, out);
    assert.match(out, /REFUSING TO REPORT — limb 15 cannot read tooling\/ci\/action-pins\.json/);
  });

  test('a fixture root with no register is NOT armed, and says so', () => {
    const { code, out } = run(tree('l15-unarmed', { rows: null, lines: ACTIONS.map((a) => `${a}@${SHA}`) }));
    assert.equal(code, 0, out);
    assert.match(out, /limb 15 — NOT armed: no tooling\/ci\/action-pins\.json under this root/);
  });
});
