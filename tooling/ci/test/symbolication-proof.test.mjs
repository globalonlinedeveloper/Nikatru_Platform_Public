// ─────────────────────────────────────────────────────────────────────────────
// symbolication-proof.test.mjs — tooling/ops/symbolication-proof.mjs must be
// able to say WRONG, and must never say RIGHT about something it did not read.
//
// The workflow it serves (.github/workflows/symbolication-proof.yml) runs once
// per dispatch against the live crash sink, so its comparison logic has no
// other chance to be exercised before the one run that matters. Every verdict
// limb is driven here from fixtures shaped like the real inputs: a logcat dump,
// `flutter symbolize` output (format read from dart-lang/sdk
// pkg/native_stack_traces: `#<depth padded to 6> <function> (<file>:<line>:<col>)`)
// and a GlitchTip project-events payload (keys as the live API returned them on
// 2026-09-19: entries[type=exception].data.values[].stacktrace.frames[] with
// camelCase `lineNo` / `instructionAddr`).
//
// The real-tree limbs read the actual probe source and the actual workflow, so
// moving the THROW-SITE marker, un-obfuscating the build or giving the lane a
// push/pull_request/schedule trigger turns this file red.
//
// Row O-GLITCHTIP-FLUTTER-SYMBOLICATION-UNPROVEN.
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  THROW_SITE_MARKER,
  crashFrame,
  expectedSite,
  extractTrace,
  findEvent,
  firstIsolateAddr,
  parseSymbolized,
  sameSite,
} from '../../ops/symbolication-proof.mjs';
import { parseWorkflow, workflowEvents } from '../workflow-scan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(ROOT, 'tooling', 'ops', 'symbolication-proof.mjs');
const PROBE = 'apps/subscriptiontracker/live_probe/symbolication_crash_probe.dart';
const WORKFLOW = '.github/workflows/symbolication-proof.yml';

const MARKER = 'symprobe-123-1';
const SOURCE = [
  "import 'x.dart';",
  '',
  "@pragma('vm:never-inline')",
  'void probeThrowSite(String marker) {',
  `  throw SymbolicationProbeError(marker); // ${THROW_SITE_MARKER}`,
  '}',
].join('\n');
const EXPECTED = { file: 'symbolication_crash_probe.dart', line: 5, function: 'probeThrowSite' };

const RAW_TRACE = [
  '*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***',
  "pid: 4242, tid: 4270, name 1.ui",
  "os: android arch: x64 comp: yes sim: no",
  "build_id: 'acb24b7831f4c02bd30f6a731067a516'",
  'isolate_dso_base: 7a1c2e400000, vm_dso_base: 7a1c2e400000',
  'isolate_instructions: 7a1c2e5a0000, vm_instructions: 7a1c2e580000',
  '    #00 abs 00007a1c2e581230 virt 0000000000181230 _kDartVmSnapshotInstructions+0x1230',
  '    #01 abs 00007a1c2e7826d7 virt 00000000003826d7 _kDartIsolateSnapshotInstructions+0x1e26d7',
  '    #02 abs 00007a1c2e7901a0 virt 00000000003901a0 _kDartIsolateSnapshotInstructions+0x1f01a0',
];

const logcat = (lines, marker = MARKER) =>
  [
    '09-19 06:00:00.000  4242  4242 I ActivityManager: Start proc',
    `09-19 06:00:01.000  4242  4270 I flutter : SYMPROBE|BEGIN ${marker}`,
    '09-19 06:00:01.001  4242  4270 I flutter : SYMPROBE|TRACE-BEGIN',
    ...lines.map((l) => `09-19 06:00:01.002  4242  4270 I flutter : SYMPROBE|${l}`),
    '09-19 06:00:01.003  4242  4270 I flutter : SYMPROBE|TRACE-END',
    `09-19 06:00:02.000  4242  4270 I flutter : SYMPROBE|SENT ${marker}`,
  ].join('\n');

const SYMBOLIZED = [
  'Warning: this line is not a frame',
  '#0      probeThrowSite (file:///home/runner/work/x/apps/subscriptiontracker/live_probe/symbolication_crash_probe.dart:5:3)',
  '#1      main (file:///home/runner/work/x/apps/subscriptiontracker/live_probe/symbolication_crash_probe.dart:57:5)',
].join('\n');

const event = (frames, value = `symbolication-probe ${MARKER}`) => ({
  eventID: 'e1',
  groupID: '99',
  message: '',
  metadata: { type: 'xY', value },
  entries: [{ type: 'exception', data: { values: [{ type: 'xY', value, stacktrace: { frames } }] } }],
});
// Sentry order: oldest first, so the throw site is LAST.
const RIGHT = [
  { function: 'main', filename: 'symbolication_crash_probe.dart', lineNo: 57, instructionAddr: '0x7a1c2e7901a0' },
  { function: 'probeThrowSite', filename: 'symbolication_crash_probe.dart', lineNo: 5, instructionAddr: '0x7a1c2e7826d7' },
];
// The GlitchTip #491 shape: a real function, the wrong one.
const WRONG = [
  { function: 'main', filename: 'symbolication_crash_probe.dart', lineNo: 57, instructionAddr: '0x7a1c2e7901a0' },
  { function: 'ColorFloat64.lerp', filename: 'color.dart', lineNo: 92, instructionAddr: '0x7a1c2e7826d7' },
];
const UNSYMBOLICATED = [
  { function: null, filename: null, lineNo: null, instructionAddr: '0x7a1c2e7901a0' },
  { function: null, filename: null, lineNo: null, instructionAddr: '0x7a1c2e7826d7' },
];

describe('expectedSite — the line under test is read from the source, never typed', () => {
  test('finds the one marked throw and its enclosing function', () => {
    assert.deepEqual(expectedSite(SOURCE, 'a/b/symbolication_crash_probe.dart'), EXPECTED);
  });
  test('zero marked throws is an error, not line 0', () => {
    assert.match(expectedSite('void f() {\n  throw 1;\n}', 'x.dart').error, /found 0/);
  });
  test('two marked throws is an error, not the first one', () => {
    const two = `${SOURCE}\nvoid g() {\n  throw 2; // ${THROW_SITE_MARKER}\n}`;
    assert.match(expectedSite(two, 'x.dart').error, /found 2/);
  });
  test('the marker on a line that does not throw does not count', () => {
    assert.match(expectedSite(`void f() {} // ${THROW_SITE_MARKER}`, 'x.dart').error, /found 0/);
  });
});

describe('extractTrace — only this run\'s trace, verbatim, and only an AOT one', () => {
  test('strips the logcat prefix and keeps the VM\'s lines in order', () => {
    const t = extractTrace(logcat(RAW_TRACE), MARKER);
    assert.equal(t.trace, `${RAW_TRACE.join('\n')}\n`);
    assert.equal(t.sent, true);
  });
  test('with no marker given, the LAST BEGIN line names it (the probe mints its own)', () => {
    const twice = `${logcat(RAW_TRACE, 'symprobe-OLD')}\n${logcat(RAW_TRACE)}`;
    const t = extractTrace(twice);
    assert.equal(t.marker, MARKER);
    assert.equal(t.trace, `${RAW_TRACE.join('\n')}\n`);
  });
  test('with no marker given and no BEGIN line, nothing is extracted', () => {
    assert.match(extractTrace('09-19 I flutter : unrelated').error, /the probe did not run/);
  });
  test('another run\'s marker is not this run', () => {
    assert.match(extractTrace(logcat(RAW_TRACE, 'symprobe-OLD'), MARKER).error, /no "BEGIN/);
  });
  test('an unterminated block is refused', () => {
    const cut = logcat(RAW_TRACE).split('\n').filter((l) => !l.includes('TRACE-END')).join('\n');
    assert.match(extractTrace(cut, MARKER).error, /missing or unterminated/);
  });
  test('a SYMBOLIC trace (a build without --split-debug-info) proves nothing and is refused', () => {
    const symbolic = ['#0      probeThrowSite (package:x/y.dart:5:3)', '#1      main (package:x/y.dart:57:5)'];
    assert.match(extractTrace(logcat(symbolic), MARKER).error, /not a split-debug-info AOT build/);
  });
});

describe('the raw trace and the symbolized output', () => {
  test('the throw address is the first ISOLATE frame, not a VM stub', () => {
    assert.equal(firstIsolateAddr(RAW_TRACE.join('\n')), 0x7a1c2e7826d7n);
  });
  test('no isolate frame is null, not a guess', () => {
    assert.equal(firstIsolateAddr(RAW_TRACE.slice(0, 7).join('\n')), null);
  });
  test('flutter symbolize frames parse in printed order and skip non-frames', () => {
    const f = parseSymbolized(SYMBOLIZED);
    assert.equal(f.length, 2);
    assert.deepEqual(
      { function: f[0].function, line: f[0].line },
      { function: 'probeThrowSite', line: 5 },
    );
    assert.equal(sameSite(EXPECTED, f[0]).ok, true);
  });
});

describe('findEvent / crashFrame / sameSite — the sink verdict', () => {
  test('the event is found by this run\'s marker and no other', () => {
    const other = event(RIGHT, 'symbolication-probe symprobe-OLD');
    const mine = event(RIGHT);
    assert.equal(findEvent([other, mine], MARKER), mine);
    assert.equal(findEvent([other], MARKER), null);
  });
  test('a correctly symbolicated event MATCHES, found by address', () => {
    const f = crashFrame(event(RIGHT), 0x7a1c2e7826d7n);
    assert.equal(f.matchedBy, 'address');
    assert.equal(sameSite(EXPECTED, f).ok, true);
  });
  test('the #491 shape — right address, wrong function and line — is a MISMATCH', () => {
    const v = sameSite(EXPECTED, crashFrame(event(WRONG), 0x7a1c2e7826d7n));
    assert.equal(v.ok, false);
    assert.match(v.why, /color\.dart:92/);
  });
  test('an UNSYMBOLICATED frame is a MISMATCH, never a pass', () => {
    const v = sameSite(EXPECTED, crashFrame(event(UNSYMBOLICATED), 0x7a1c2e7826d7n));
    assert.equal(v.ok, false);
    assert.match(v.why, /UNSYMBOLICATED/);
  });
  test('the right line in the wrong FILE is a MISMATCH', () => {
    const frames = [{ ...RIGHT[1], filename: 'other.dart' }];
    assert.equal(sameSite(EXPECTED, crashFrame(event(frames), 0x7a1c2e7826d7n)).ok, false);
  });
  test('with no frame at the address, the LAST frame (Sentry: newest) is compared', () => {
    const f = crashFrame(event(RIGHT), 0x1n);
    assert.equal(f.matchedBy, 'last-frame');
    assert.equal(f.function, 'probeThrowSite');
  });
  test('an event with no frames has no crash frame', () => {
    assert.equal(crashFrame(event([]), null), null);
  });
});

describe('the CLI refuses rather than passes', () => {
  const run = (args, env = {}) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GLITCHTIP_TOKEN: '', ...env },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  test('an unknown subcommand is COVERAGE LOST (2)', () => {
    assert.equal(run(['nope']).code, 2);
  });
  test('verdict without GLITCHTIP_TOKEN is COVERAGE LOST (2), after the offline half is read', () => {
    // The real probe source and a matching symbolized file: the ONLY missing input is the token.
    const exp = expectedSite(readFileSync(join(ROOT, PROBE), 'utf8'), PROBE);
    const d = mkdtempSync(join(tmpdir(), 'symprobe-'));
    try {
      writeFileSync(join(d, 'trace.txt'), RAW_TRACE.join('\n'));
      writeFileSync(join(d, 'sym.txt'), `#0      probeThrowSite (file:///x/symbolication_crash_probe.dart:${exp.line}:3)\n`);
      const r = run([
        'verdict', '--source', join(ROOT, PROBE), '--trace', join(d, 'trace.txt'),
        '--symbolized', join(d, 'sym.txt'), '--marker', 'm', '--report', join(d, 'r.json'),
      ]);
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /GLITCHTIP_TOKEN is not set/);
      assert.equal(existsSync(join(d, 'r.json')), false, 'no report may be written for a run that read no sink');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
  test('a flag given no value is refused by the parser, not bound to the next flag', () => {
    assert.notEqual(run(['expect', '--source']).code, 0);
  });
});

describe('the real tree', () => {
  test('the probe source carries exactly one marked throw site', () => {
    const exp = expectedSite(readFileSync(join(ROOT, PROBE), 'utf8'), PROBE);
    assert.equal(exp.error, undefined, exp.error);
    assert.equal(exp.function, 'probeThrowSite');
  });
  test('the workflow is dispatch-only: it sends a real event to the production sink', () => {
    const wf = parseWorkflow(ROOT, WORKFLOW);
    assert.notEqual(wf, null, `${WORKFLOW} is missing`);
    assert.deepEqual([...workflowEvents(wf)], ['workflow_dispatch']);
  });
  test('the workflow builds THIS probe, obfuscated, and verdicts it with THIS script', () => {
    const wf = parseWorkflow(ROOT, WORKFLOW);
    const text = [...wf.jobs.values()].flatMap((j) => j.logical.map((l) => l.text ?? l)).join('\n');
    assert.match(text, /flutter build apk --release/);
    assert.match(text, /--obfuscate --split-debug-info=/);
    assert.match(text, /-t "\$PROBE_SOURCE"/);
    assert.match(wf.lines.map((l) => l.text).join('\n'), /PROBE_SOURCE: live_probe\/symbolication_crash_probe\.dart/);
    assert.match(text, /tooling\/ops\/symbolication-proof\.mjs verdict/);
  });
});
