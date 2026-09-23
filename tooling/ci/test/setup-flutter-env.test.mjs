// ─────────────────────────────────────────────────────────────────────────────
// setup-flutter-env.test.mjs — no env that reaches .github/actions/setup-flutter
// may be named CHANNEL.
//
// subosito/flutter-action's setup.sh (pinned 1a449444, line 122) reads
//   if [ -z "${CHANNEL:-}" ]; then CHANNEL="${ARR_CHANNEL[0]:-}"; fi
// so an INHERITED `CHANNEL` outranks the `channel: stable` argument our composite
// passes. Every other variable that script consults is initialised to "" before
// its getopts loop; CHANNEL is the one it is not. Store screenshots run
// 35818957977 (2026-09-23) died there — "Unable to determine Flutter version for
// channel: windows-store" — because the desktop capture job set
// `env: CHANNEL: ${{ inputs.channel }}` for its own scripts.
//
// Three places reach the action's shell: the workflow-level `env:`, the job-level
// `env:` of a job that uses the composite, and the `env:` of the step that uses
// it. A `run:` step's own `env:` does not, so it is deliberately NOT reported.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WF_DIR = join(ROOT, '.github', 'workflows');
const USES_SETUP = /^\s*-?\s*uses:\s*\.\/\.github\/actions\/setup-flutter\s*$/;
const FORBIDDEN = 'CHANNEL';

/** Keys of the mapping that opens at `lines[at]` (an `env:` line), read at
 *  exactly `indent` spaces until the first line that is less indented. */
function keysBelow(lines, at, indent) {
  const keys = [];
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim() || /^\s*#/.test(l)) continue;
    const lead = l.match(/^ */)[0].length;
    if (lead < indent) break;
    const m = lead === indent && l.match(/^ *([A-Za-z_][A-Za-z0-9_]*):/);
    if (m) keys.push({ key: m[1], line: i + 1 });
  }
  return keys;
}

/** Every CHANNEL key that reaches the setup-flutter composite in one workflow.
 *  Returns { usesSetup, findings: [{ where, line }] }. */
export function channelLeaks(text) {
  const lines = text.split('\n');
  const findings = [];
  const setupAt = lines.map((l, i) => (USES_SETUP.test(l) ? i : -1)).filter((i) => i !== -1);
  if (!setupAt.length) return { usesSetup: 0, findings };

  const top = lines.findIndex((l) => /^env:\s*$/.test(l));
  if (top !== -1) {
    for (const k of keysBelow(lines, top, 2)) if (k.key === FORBIDDEN) findings.push({ where: 'workflow env', line: k.line });
  }

  const jobsAt = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  for (const s of setupAt) {
    // The job that owns this step: the nearest 2-space key above it, below `jobs:`.
    let jobAt = -1;
    for (let i = s; i > jobsAt; i--) if (/^ {2}[A-Za-z_][A-Za-z0-9_-]*:\s*$/.test(lines[i])) { jobAt = i; break; }
    if (jobAt === -1) continue;
    const job = lines[jobAt].trim().replace(/:$/, '');
    for (let i = jobAt + 1; i < lines.length && !/^ {0,2}\S/.test(lines[i]); i++) {
      if (/^ {4}env:\s*$/.test(lines[i])) {
        for (const k of keysBelow(lines, i, 6)) if (k.key === FORBIDDEN) findings.push({ where: `job ${job} env`, line: k.line });
      }
    }
    // The step itself: from its `- ` line to the next `- ` at the same indent.
    let stepAt = s;
    while (stepAt > jobAt && !/^ *- /.test(lines[stepAt])) stepAt--;
    const dash = lines[stepAt].match(/^ */)[0].length;
    for (let i = stepAt + 1; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim()) continue;
      const lead = l.match(/^ */)[0].length;
      if (lead <= dash) break;
      if (lead === dash + 2 && /^\s*env:\s*$/.test(l)) {
        for (const k of keysBelow(lines, i, dash + 4)) if (k.key === FORBIDDEN) findings.push({ where: `job ${job} setup-flutter step env`, line: k.line });
      }
    }
  }
  return { usesSetup: setupAt.length, findings };
}

const REAL = readdirSync(WF_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ f, text: readFileSync(join(WF_DIR, f), 'utf8') }));
const SS = REAL.find((w) => w.f === 'store-screenshots.yml');

describe('no inherited CHANNEL reaches setup-flutter', () => {
  test('the control: the real tree has setup-flutter users and none of them leaks CHANNEL', () => {
    let users = 0;
    const leaks = [];
    for (const { f, text } of REAL) {
      const r = channelLeaks(text);
      users += r.usesSetup;
      for (const x of r.findings) leaks.push(`${f}:${x.line} (${x.where})`);
    }
    // Not vacuous: a scan that matched no `uses:` line would pass every tree.
    assert.ok(users >= 5, `expected at least 5 setup-flutter steps in .github/workflows, found ${users}`);
    assert.deepEqual(leaks, []);
  });

  test('FAILS on the job-level env that shipped in run 35818957977', () => {
    assert.ok(SS, 'store-screenshots.yml must exist');
    const good = '      STORE_CHANNEL: ${{ inputs.channel }}\n';
    assert.equal(SS.text.split(good).length - 1, 1, 'the desktop job env this case mutates must still be there');
    const bad = SS.text.replace(good, '      CHANNEL: ${{ inputs.channel }}\n');
    assert.notEqual(bad, SS.text, 'the mutation must land');
    const line = SS.text.slice(0, SS.text.indexOf(good)).split('\n').length;
    const { findings } = channelLeaks(bad);
    assert.deepEqual(findings, [{ where: 'job capture-desktop-native env', line }]);
  });

  test('FAILS on a workflow-level CHANNEL and on one set on the setup-flutter step itself', () => {
    const wf = [
      'name: x',
      'env:',
      '  CHANNEL: beta',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-24.04',
      '    steps:',
      '      - uses: ./.github/actions/setup-flutter',
      '        env:',
      '          CHANNEL: windows-store',
      '      - run: echo hi',
      '',
    ].join('\n');
    assert.deepEqual(channelLeaks(wf).findings, [
      { where: 'workflow env', line: 3 },
      { where: 'job build setup-flutter step env', line: 10 },
    ]);
  });

  test('a CHANNEL on a `run:` step, or in a job without setup-flutter, is not reported', () => {
    const wf = [
      'name: x',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-24.04',
      '    steps:',
      '      - uses: ./.github/actions/setup-flutter',
      '      - run: echo "$CHANNEL"',
      '        env:',
      '          CHANNEL: linux-snap',
      '  other:',
      '    runs-on: ubuntu-24.04',
      '    env:',
      '      CHANNEL: ios-appstore',
      '    steps:',
      '      - run: echo "$CHANNEL"',
      '',
    ].join('\n');
    const r = channelLeaks(wf);
    assert.equal(r.usesSetup, 1);
    assert.deepEqual(r.findings, []);
  });
});
