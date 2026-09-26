// ─────────────────────────────────────────────────────────────────────────────
// signing-seam.test.mjs — tooling/ci/signing-seam.mjs must be able to say NO.
//
// Every signing adapter trusts these primitives to refuse: a partial secret set,
// a base64 value that truncated on paste, a key that is the wrong file, a path
// that would put key material in the workspace, a value that would inject a line
// into $GITHUB_ENV. So each primitive is tested with the input that must be
// REFUSED beside the one that must pass — a primitive shown only passing proves
// it can pass. The adapters' own behaviour (apple's endings, its messages) is
// tested in their own files; this file owns the primitives.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  decideSecretSet,
  decodeKey,
  exportEnv,
  newlineOffenders,
  placeKey,
  releaseLane,
  releaseSignal,
} from '../signing-seam.mjs';
import { REGISTER, releaseGapVerdict } from '../channel-arming.mjs';

function scratch() {
  return mkdtempSync(join(tmpdir(), 'signing-seam-'));
}

const SUB = '.github/workflows/submit-fixture.yml';
const LANE = { workflow: '.github/workflows/build-platforms.yml', job: 'fixture' };

describe('signing-seam · decideSecretSet (all or none)', () => {
  const NAMES = ['KEY_A', 'KEY_B', 'KEY_C'];

  test('every name carrying a value is `all`', () => {
    assert.deepEqual(decideSecretSet(NAMES, { KEY_A: 'a', KEY_B: 'b', KEY_C: 'c' }), {
      kind: 'all',
      supplied: NAMES,
      missing: [],
    });
  });

  test('no name carrying a value is `none`', () => {
    assert.deepEqual(decideSecretSet(NAMES, {}), { kind: 'none', supplied: [], missing: NAMES });
    assert.equal(decideSecretSet(NAMES, undefined).kind, 'none');
  });

  test('🔴 one name missing is `partial`, and the missing one is named', () => {
    const d = decideSecretSet(NAMES, { KEY_A: 'a', KEY_C: 'c' });
    assert.equal(d.kind, 'partial');
    assert.deepEqual(d.missing, ['KEY_B']);
    assert.deepEqual(d.supplied, ['KEY_A', 'KEY_C']);
  });

  test('🔴 a value that is only whitespace counts as ABSENT — an empty secret expands to a blank line', () => {
    const d = decideSecretSet(NAMES, { KEY_A: 'a', KEY_B: ' \n\t', KEY_C: 'c' });
    assert.equal(d.kind, 'partial');
    assert.deepEqual(d.missing, ['KEY_B']);
  });

  test('🔴 an empty name list is refused — over zero names the law would answer `all`', () => {
    assert.throws(() => decideSecretSet([], {}), TypeError);
    assert.throws(() => decideSecretSet(undefined, {}), TypeError);
  });
});

describe('signing-seam · releaseSignal (the ref half)', () => {
  test('a TAG push is a release lane', () => {
    const s = releaseSignal({ gitRef: 'refs/tags/fixture-v1.0.0', label: 'Fixture' });
    assert.equal(s.required, true);
    assert.deepEqual(s.reasons, ['the run is a TAG push (refs/tags/fixture-v1.0.0)']);
  });

  test('the declared submission workflow is a release lane, on any branch', () => {
    const s = releaseSignal({
      gitRef: 'refs/heads/some-branch',
      workflowRef: `owner/repo/${SUB}@refs/heads/some-branch`,
      submissionWorkflows: [SUB],
      label: 'Fixture',
    });
    assert.equal(s.required, true);
    assert.deepEqual(s.reasons, [`this is a declared Fixture submission workflow (${SUB})`]);
    assert.deepEqual(s.blind, []);
  });

  test('a branch push of another workflow is NOT a release lane', () => {
    const s = releaseSignal({
      gitRef: 'refs/heads/main',
      workflowRef: 'owner/repo/.github/workflows/build-platforms.yml@refs/heads/main',
      submissionWorkflows: [SUB],
      label: 'Fixture',
    });
    assert.equal(s.required, false);
    assert.deepEqual(s.reasons, []);
  });

  test('🔴 a BRANCH named after the submission workflow does not make a release — only the path before `@` is read', () => {
    const s = releaseSignal({
      gitRef: `refs/heads/${SUB}`,
      workflowRef: `owner/repo/.github/workflows/build-platforms.yml@refs/heads/${SUB}`,
      submissionWorkflows: [SUB],
      label: 'Fixture',
    });
    assert.equal(s.required, false);
  });

  test('🔴 a workflow whose file name merely ENDS the same way is not the declared one', () => {
    const s = releaseSignal({
      workflowRef: 'owner/repo/.github/workflows/not-submit-fixture.yml@refs/heads/main',
      submissionWorkflows: [SUB],
      label: 'Fixture',
    });
    assert.equal(s.required, false);
  });

  test('no declared workflow is PRINTED as a blind limb, naming the label and the register', () => {
    const s = releaseSignal({ workflowRef: 'owner/repo/x.yml@refs/heads/main', label: 'Fixture' });
    assert.equal(s.required, false);
    assert.equal(s.blind.length, 1);
    assert.match(s.blind[0], /^no Fixture row in /);
    assert.ok(s.blind[0].includes(REGISTER));
    assert.match(s.blind[0], /limb \(b\) contributed nothing/);
  });

  test('an unset GITHUB_WORKFLOW_REF is PRINTED as a blind limb when a workflow is declared', () => {
    const s = releaseSignal({ submissionWorkflows: [SUB], label: 'Fixture' });
    assert.deepEqual(s.blind, ['GITHUB_WORKFLOW_REF is unset (not a GitHub job), so limb (b) could not be evaluated.']);
  });

  test('refuses to run with no label — its messages would name nobody', () => {
    assert.throws(() => releaseSignal({ gitRef: 'refs/tags/x' }), TypeError);
  });
});

describe('signing-seam · releaseLane (the ref AND the register)', () => {
  const armedRow = { id: 'fixture-a', submittable: true, served: false, lane: LANE, submission: { workflow: SUB } };
  const unarmedRow = { id: 'fixture-b', submittable: true, served: false, lane: null, submission: { workflow: SUB } };

  test('a tag push over an ARMED row must sign', () => {
    const r = releaseLane({ rows: [armedRow], gitRef: 'refs/tags/fixture-v1', label: 'Fixture' });
    assert.equal(r.lane.required, true);
    assert.equal(r.gap.fatal, true);
    assert.equal(r.mustSign, true);
  });

  test('🔴 a tag push over an UNARMED row need not sign — the register, not the ref alone, decides', () => {
    const r = releaseLane({ rows: [unarmedRow], gitRef: 'refs/tags/fixture-v1', label: 'Fixture' });
    assert.equal(r.lane.required, true);
    assert.equal(r.gap.fatal, false);
    assert.equal(r.mustSign, false);
  });

  test('a branch push over an armed row need not sign', () => {
    const r = releaseLane({
      rows: [armedRow],
      gitRef: 'refs/heads/main',
      workflowRef: 'owner/repo/.github/workflows/build-platforms.yml@refs/heads/main',
      label: 'Fixture',
    });
    assert.equal(r.mustSign, false);
  });

  test('ONE armed row of two is enough — one identity signs both', () => {
    const r = releaseLane({ rows: [unarmedRow, armedRow], gitRef: 'refs/tags/fixture-v1', label: 'Fixture' });
    assert.equal(r.mustSign, true);
    assert.deepEqual(r.gap.armed.map((a) => a.id), ['fixture-a']);
  });

  test("the submission limb reads the rows' own `submission.workflow`", () => {
    const r = releaseLane({ rows: [armedRow], workflowRef: `owner/repo/${SUB}@refs/heads/main`, label: 'Fixture' });
    assert.equal(r.lane.required, true);
    assert.equal(r.mustSign, true);
  });

  test("`gap` IS channel-arming's verdict over the same rows, not a restatement of it", () => {
    const rows = [unarmedRow, armedRow];
    assert.deepEqual(releaseLane({ rows, label: 'Fixture' }).gap, releaseGapVerdict(rows));
  });

  test('🔴 no rows is refused — a verdict over none arms nothing and would read as a pass', () => {
    assert.throws(() => releaseLane({ rows: [], gitRef: 'refs/tags/x', label: 'Fixture' }), TypeError);
    assert.throws(() => releaseLane({ gitRef: 'refs/tags/x', label: 'Fixture' }), TypeError);
    assert.throws(() => releaseLane({ rows: [null], gitRef: 'refs/tags/x', label: 'Fixture' }), TypeError);
  });
});

describe('signing-seam · decodeKey', () => {
  const DER = Buffer.from([0x30, 0x82, 0x01, 0x0a, 0x02, 0x01]);

  test('valid base64 of a DER file passes a 0x30 magic check and returns the bytes', () => {
    const d = decodeKey(DER.toString('base64'), { name: 'KEY_A', magic: [[0x30]] });
    assert.equal(d.problem, null);
    assert.deepEqual(d.bytes, DER);
    assert.equal(d.found, '0x30');
  });

  test('line breaks inside the value are stripped, as a wrapped paste carries them', () => {
    const b64 = DER.toString('base64');
    const d = decodeKey(`${b64.slice(0, 4)}\n${b64.slice(4)}\n`, { name: 'KEY_A', magic: [[0x30]] });
    assert.equal(d.problem, null);
    assert.deepEqual(d.bytes, DER);
  });

  test('🔴 whitespace only is `empty`, and its message says it passed the presence check', () => {
    const d = decodeKey(' \n ', { name: 'KEY_A' });
    assert.equal(d.problem, 'empty');
    assert.equal(d.bytes, null);
    assert.deepEqual(d.lines, ['KEY_A is whitespace only after trimming — it passed the presence check and carries nothing.']);
  });

  test('🔴 a value that decodes but does not round-trip is `not-base64` — the silent truncation', () => {
    // 'MAB' decodes to two bytes that re-encode as 'MAA'; Buffer.from does not throw.
    const d = decodeKey('MAB', { name: 'KEY_A', magic: [[0x30]] });
    assert.equal(d.problem, 'not-base64');
    assert.equal(d.bytes, null);
    assert.match(d.lines[0], /^FAIL KEY_A is not valid base64 \(it decodes to 2 byte\(s\) and does not round-trip\)\.$/);
  });

  test('🔴 the wrong file is `magic`, and the leading byte found is named', () => {
    const d = decodeKey(Buffer.from('<html>').toString('base64'), { name: 'KEY_A', magic: [[0x30]] });
    assert.equal(d.problem, 'magic');
    assert.equal(d.bytes, null);
    assert.equal(d.found, '0x3c');
    assert.match(d.lines.join('\n'), /Expected 0x30; found 0x3c\./);
  });

  test('a list of magics is a list of ALTERNATIVES', () => {
    const jks = Buffer.from([0xfe, 0xed, 0xfe, 0xed, 0x00, 0x00]);
    const d = decodeKey(jks.toString('base64'), { name: 'KEY_A', magic: [[0x30], [0xfe, 0xed, 0xfe, 0xed]] });
    assert.equal(d.problem, null);
    assert.equal(d.found, '0xfeedfeed');
  });

  test('🔴 a file SHORTER than the magic does not match it', () => {
    const d = decodeKey(Buffer.from([0xfe, 0xed]).toString('base64'), { name: 'KEY_A', magic: [[0xfe, 0xed, 0xfe, 0xed]] });
    assert.equal(d.problem, 'magic');
  });

  test('no magic is no structural check', () => {
    const d = decodeKey(Buffer.from('<html>').toString('base64'), { name: 'KEY_A' });
    assert.equal(d.problem, null);
    assert.equal(d.found, null);
  });

  test('🔴 no part of the value reaches a message', () => {
    const encoded = Buffer.from('fixture-value').toString('base64');
    for (const raw of [`${encoded}!`, encoded]) {
      const d = decodeKey(raw, { name: 'KEY_A', magic: [[0x30]] });
      assert.notEqual(d.problem, null);
      assert.ok(!d.lines.join('\n').includes(encoded.slice(0, 8)), `a message carried the value: ${d.lines.join(' | ')}`);
      assert.ok(!d.lines.join('\n').includes('fixture-value'));
    }
  });

  test('a malformed magic argument is refused rather than read as "no check"', () => {
    assert.throws(() => decodeKey('MA==', { magic: [] }), TypeError);
    assert.throws(() => decodeKey('MA==', { magic: [[]] }), TypeError);
    assert.throws(() => decodeKey('MA==', { magic: 0x30 }), TypeError);
  });
});

describe('signing-seam · placeKey', () => {
  test('writes the bytes to an absolute path, creating the parent', () => {
    const dir = scratch();
    try {
      const target = join(dir, 'nested', 'key.p12');
      assert.equal(placeKey(target, Buffer.from([0x30, 0x01])), null);
      assert.deepEqual(readFileSync(target), Buffer.from([0x30, 0x01]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('🔴 a RELATIVE path is refused and nothing is written', () => {
    const rel = `placeKey-refused-${process.pid}-${Date.now()}.bin`;
    const lines = placeKey(rel, Buffer.from([0x30]));
    assert.ok(Array.isArray(lines) && lines.length > 0);
    assert.match(lines[0], /not absolute/);
    assert.equal(existsSync(rel), false);
  });

  test('🔴 zero bytes are refused — an empty key file is a key that is not there', () => {
    const dir = scratch();
    try {
      const target = join(dir, 'key.p12');
      assert.match(placeKey(target, Buffer.alloc(0))[0], /zero bytes/);
      assert.equal(existsSync(target), false);
      assert.match(placeKey(target, 'MA==')[0], /non-byte value/);
      assert.equal(existsSync(target), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('🔴 a file ALREADY at the path ends at the requested mode, not its old one', { skip: process.platform === 'win32' && 'POSIX modes' }, () => {
    const dir = scratch();
    try {
      const target = join(dir, 'key.p12');
      writeFileSync(target, 'old', { mode: 0o644 });
      assert.equal(placeKey(target, Buffer.from([0x30])), null);
      assert.equal(statSync(target).mode & 0o777, 0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('signing-seam · newlineOffenders', () => {
  test('names each key whose value carries \\n or \\r, and only those', () => {
    assert.deepEqual(newlineOffenders({ A: 'fine', B: 'two\nlines', C: 'cr\r', D: 7 }), ['B', 'C']);
    assert.deepEqual(newlineOffenders({ A: 'fine', D: 7 }), []);
  });
});

describe('signing-seam · exportEnv', () => {
  const noFail = () => assert.fail('fail() was called on a clean export');

  test('appends every pair in ONE write, after what the file already holds', () => {
    const dir = scratch();
    try {
      const env = join(dir, 'github-env');
      writeFileSync(env, 'EARLIER=1\n');
      assert.equal(exportEnv({ A: 'x', B: 'y' }, env, { fail: noFail }), true);
      assert.equal(readFileSync(env, 'utf8'), 'EARLIER=1\nA=x\nB=y\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('🔴 a value with a line break goes to fail(), naming the key, and NOTHING is written', () => {
    const dir = scratch();
    try {
      const env = join(dir, 'github-env');
      writeFileSync(env, 'EARLIER=1\n');
      const failed = [];
      const wrote = exportEnv({ A: 'x', B: 'y\nINJECTED=1' }, env, { fail: (lines) => failed.push(lines) });
      assert.equal(wrote, false);
      assert.equal(failed.length, 1);
      assert.match(failed[0][0], /^FAIL the value for B contains a line break/);
      assert.ok(!failed[0].join('\n').includes('INJECTED'), 'the refusal printed the value');
      assert.equal(readFileSync(env, 'utf8'), 'EARLIER=1\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('no $GITHUB_ENV is PRINTED, with what would have been exported and who refuses without it', () => {
    const logged = [];
    const wrote = exportEnv({ A: 'x', B: 'y' }, null, {
      fail: noFail,
      unexported: ['   fixture-verify.mjs refuses to run without A.'],
      log: (l) => logged.push(l),
    });
    assert.equal(wrote, false);
    assert.deepEqual(logged, [
      '',
      '⬜ NOT EXPORTED — no $GITHUB_ENV and no --github-env, so nothing was written for later',
      '   steps. Outside a GitHub job that is expected. Inside one it is a wiring fault, and',
      '   fixture-verify.mjs refuses to run without A.',
      '   would export: A',
      '   would export: B',
    ]);
    assert.ok(!logged.join('\n').includes('=x'), 'a value was printed');
  });

  test('🔴 a BLANK path is unset, not a file to open — no ENOENT after the posture was printed', () => {
    const logged = [];
    assert.equal(exportEnv({ A: 'x' }, '  ', { fail: noFail, log: (l) => logged.push(l) }), false);
    assert.match(logged.join('\n'), /NOT EXPORTED/);
    assert.equal(logged[2], '   steps. Outside a GitHub job that is expected. Inside one it is a wiring fault.');
  });

  test('refuses to run without a fail() — a refusal with nowhere to go is a skip', () => {
    assert.throws(() => exportEnv({ A: 'x\n' }, null), TypeError);
  });
});
