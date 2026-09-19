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
  verdictExit,
  allFrames,
  probeEventValues,
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

// Run 35463786607, verbatim: the layout the Flutter 3.47.4 engine writes. One
// text section (`_kDartSnapshotText`), `vm_dso_base: 0`. The decoded lines are
// what native_stack_traces 0.7.0 `decode translate` printed for this exact
// trace against that run's kept app.android-x64.symbols (build_id equal).
const RUN_35463786607_TRACE = [
  '*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***',
  'pid: 2721, tid: 140221772285176, name 1.ui',
  'os: android arch: x64 comp: yes sim: no',
  "build_id: 'bf7ded9a01540a5738031d8d50b5dd60'",
  'isolate_dso_base: 7f84ce759000, vm_dso_base: 0',
  'isolate_instructions: 7f84ce809000, vm_instructions: 0',
  '    #00 abs 00007f84ce976c3e virt 000000000021dc3e _kDartSnapshotText+0x16dc3e',
  '    #01 abs 00007f84ce9bc44b virt 000000000026344b _kDartSnapshotText+0x1b344b',
  '<asynchronous suspension>',
].join('\n');
const RUN_35463786607_DECODED = [
  '#0      probeThrowSite (/home/runner/work/Nikatru_Platform_Public/Nikatru_Platform_Public/apps/subscriptiontracker/live_probe/symbolication_crash_probe.dart:36:3)',
  '#1      main (/home/runner/work/Nikatru_Platform_Public/Nikatru_Platform_Public/apps/subscriptiontracker/live_probe/symbolication_crash_probe.dart:65:5)',
  '<asynchronous suspension>',
].join('\n');

describe('the single-text-section snapshot layout (Flutter 3.47.4, run 35463786607)', () => {
  test('the throw address is found in a `_kDartSnapshotText` frame', () => {
    assert.equal(firstIsolateAddr(RUN_35463786607_TRACE), 0x7f84ce976c3en);
  });
  test('the decoder\'s absolute-path output parses to the throw site', () => {
    const f = parseSymbolized(RUN_35463786607_DECODED);
    assert.deepEqual({ function: f[0].function, line: f[0].line }, { function: 'probeThrowSite', line: 36 });
    assert.equal(sameSite({ ...EXPECTED, line: 36 }, f[0]).ok, true);
  });
  test('a symbol that is neither app layout is not an app frame', () => {
    assert.equal(firstIsolateAddr('    #00 abs 00007f84ce976c3e virt 0 _kDartSnapshotData+0x10'), null);
  });
});

// Run 35467695649's event, as GlitchTip 6.2.6 returned it (issue 38), trimmed to
// the exception entry. The marker was redacted by the client-side PiiScrubber,
// the throw-site frame (0x7eb7fbb06c3e, the trace's first app frame) came back
// UNSYMBOLICATED, and the caller frame resolved to an unrelated SDK function.
const RUN_35467695649_EVENT = {
  eventID: 'bb67a1047e9b8a84bf144cb1524b',
  groupID: '38',
  platform: 'other',
  entries: [
    {
      type: 'exception',
      data: {
        values: [
          {
            type: 'Dv',
            value: 'symbolication-probe symprobe-[REDACTED]',
            stacktrace: {
              frames: [
                {
                  filename: 'third_party/dart/sdk/lib/_internal/vm/lib/typed_data_patch.dart',
                  function: 'new Uint32List',
                  platform: 'native',
                  instruction_addr: '0x00007eb7fbb4c32f',
                  absPath: 'third_party/dart/sdk/lib/_internal/vm/lib/typed_data_patch.dart',
                  lineNo: 0,
                },
                { platform: 'native', instruction_addr: '0x00007eb7fbb06c3e' },
              ],
            },
          },
        ],
      },
    },
  ],
};

describe('run 35467695649 — the event that arrived with its marker redacted', () => {
  test('the redacted event is NOT found by its marker, and is NAMED by probeEventValues', () => {
    assert.equal(findEvent([RUN_35467695649_EVENT], 'symprobe-1789850523270811'), null);
    assert.deepEqual(probeEventValues([RUN_35467695649_EVENT]), ['symbolication-probe symprobe-[REDACTED]']);
  });
  test('its throw-site frame, matched by address, is UNSYMBOLICATED: a MISMATCH', () => {
    const f = crashFrame(RUN_35467695649_EVENT, 0x7eb7fbb06c3en);
    assert.equal(f.matchedBy, 'address');
    const v = sameSite({ file: 'symbolication_crash_probe.dart', line: 36, function: 'probeThrowSite' }, f);
    assert.equal(v.ok, false);
    assert.match(v.why, /UNSYMBOLICATED/);
  });
  test('allFrames keeps every frame, snake_case address included, for the report', () => {
    const all = allFrames(RUN_35467695649_EVENT);
    assert.equal(all.length, 2);
    assert.equal(all[0].function, 'new Uint32List');
    assert.equal(all[1].instructionAddr, '0x00007eb7fbb06c3e');
  });
});

// The markers must survive the REAL scrubber. Its patterns are read out of
// packages/telemetry/lib/src/pii_scrubber.dart (every `RegExp(r'…' r'…')`), so
// a new rule there is tested here the day it lands.
function scrubberPatterns() {
  const src = readFileSync(join(ROOT, 'packages', 'telemetry', 'lib', 'src', 'pii_scrubber.dart'), 'utf8');
  const out = [];
  for (const m of src.matchAll(/RegExp\(\s*((?:r'[^']*'\s*)+)/g)) {
    out.push(new RegExp([...m[1].matchAll(/r'([^']*)'/g)].map((x) => x[1]).join('')));
  }
  return out;
}
const lettersMarker = (stamp) => `symprobe-${String.fromCharCode(...[...stamp].map((c) => c.charCodeAt(0) + 49))}`;

describe('the probe marker survives the client-side PII scrubber', () => {
  test('the scrubber patterns are read (control: the OLD digit marker IS redacted)', () => {
    const pats = scrubberPatterns();
    assert.ok(pats.length >= 7, `read only ${pats.length} scrubber pattern(s)`);
    assert.ok(pats.some((re) => re.test('symprobe-1789850523270811')), 'no scrubber rule caught the digit marker — the parse is broken');
  });
  test('a letters-only marker matches NO scrubber rule', () => {
    const pats = scrubberPatterns();
    for (const stamp of ['1789850523270811', '9999999999999999', '1000000000000000', '6000000000']) {
      const m = lettersMarker(stamp);
      assert.match(m, /^symprobe-[a-j]+$/);
      for (const re of pats) assert.equal(re.test(m), false, `${re} redacts ${m}`);
    }
  });
  test('the probe mints its marker letters-only (digit + 49 -> a..j)', () => {
    const src = readFileSync(join(ROOT, PROBE), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.match(src, /String\.fromCharCodes\(stamp\.codeUnits\.map\(\(int c\) => c \+ 49\)\)/);
    assert.doesNotMatch(src, /'symprobe-\$\{DateTime/);
  });
  test('the run step prints the SDK / network lines of the app on every run and on failure', () => {
    const raw = readFileSync(join(ROOT, WORKFLOW), 'utf8');
    const step = raw.slice(raw.indexOf('- name: Boot an emulator'), raw.indexOf('- name: Extract the raw trace'));
    assert.match(step, /\(Sentry\|sentry\|TrafficStats\|okhttp\|SSL\|Unknown\[Hh\]ost\|\[Cc\]onnect\)/);
    assert.match(step, /probe_why\(\) \{[\s\S]*? Sentry\|sentry\|/);
  });
  test('extractTrace reads a letters-only marker back', () => {
    const m = lettersMarker('1789850523270811');
    assert.equal(extractTrace(logcat(RAW_TRACE, m)).marker, m);
  });
});

describe('verdictExit — the sink is always reported, and an unavailable half is never a pass', () => {
  test('both MATCH is the only 0', () => assert.equal(verdictExit(true, true), 0));
  test('a sink MISMATCH is 1 even with no ground truth', () => assert.equal(verdictExit(null, false), 1));
  test('a ground-truth MISMATCH is 1', () => assert.equal(verdictExit(false, true), 1));
  test('a sink MATCH with no ground truth is 2, not 0', () => assert.equal(verdictExit(null, true), 2));
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
  // Run 35463786607: `flutter symbolize` (native_stack_traces 0.6.1 inside the
  // 3.47.4 tool) could not read the 3.47.4 engine's snapshot layout.
  test('ground truth decodes with the pinned native_stack_traces, not `flutter symbolize`', () => {
    const raw = readFileSync(join(ROOT, WORKFLOW), 'utf8');
    const code = raw.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    assert.doesNotMatch(code, /flutter symbolize/);
    assert.match(code, /require\('\.\.\/\.\.\/tooling\/versions\.json'\)\.native_stack_traces/);
    assert.match(code, /dart pub global activate native_stack_traces "\$nst"/);
    assert.match(code, /native_stack_traces:decode translate/);
    const pin = JSON.parse(readFileSync(join(ROOT, 'tooling', 'versions.json'), 'utf8')).native_stack_traces;
    assert.match(String(pin), /^\d+\.\d+\.\d+$/, 'tooling/versions.json native_stack_traces must be an exact version');
  });
  test('the verdict runs even when the ground truth failed, once a marker exists', () => {
    const wf = parseWorkflow(ROOT, WORKFLOW);
    const text = wf.lines.map((l) => l.text).join('\n');
    const at = text.indexOf('- name: Verdict');
    assert.ok(at > 0);
    const block = text.slice(at, text.indexOf('- name:', at + 10));
    assert.match(block, /if: \$\{\{ always\(\) && steps\.extract\.outcome == 'success' \}\}/);
    assert.match(text, /id: extract/);
  });
  // Runs 35458257697 and 35463786607: SENT printed, no event ever arrived.
  test('the probe never closes the SDK after capturing (it cut off the native send)', () => {
    const src = readFileSync(join(ROOT, PROBE), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.match(src, /captureException\(/);
    assert.doesNotMatch(src, /\.close\(\)/);
  });
  // Run 35458257697: only "SYMPROBE|SENT" reached logcat. sentry_flutter 9.26.0's
  // DebugPrintIntegration replaces `debugPrint` with a breadcrumb-only sink in
  // release builds and restores it on Sentry.close(), so every line before
  // close vanished.
  test('the probe emits through Zone.root.print, never debugPrint (Sentry swallows it in release)', () => {
    const src = readFileSync(join(ROOT, PROBE), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.match(src, /void _emit\(String line\) => Zone\.root\.print\(/);
    assert.doesNotMatch(src, /\bdebugPrint\s*\(/, 'debugPrint is replaced by sentry_flutter in release builds');
  });
  test('the run step asserts each sub-phase in order and prints a logcat slice on failure', () => {
    const raw = readFileSync(join(ROOT, WORKFLOW), 'utf8');
    const step = raw.slice(raw.indexOf('- name: Boot an emulator'), raw.indexOf('- name: Ground truth'));
    const order = ['pm path "$pkg"', 'no $pkg process is running', 'wait_for "BEGIN', 'wait_for "TRACE', 'wait_for "SENT'];
    let at = -1;
    for (const needle of order) {
      const i = step.indexOf(needle);
      assert.ok(i > at, `sub-phase "${needle}" is missing or out of order`);
      at = i;
    }
    assert.match(step, /probe_why\(\) \{[\s\S]*?grep -E " flutter \*:\|AndroidRuntime\|FATAL\|SYMPROBE/, 'a failed phase does not print the logcat slice');
    assert.doesNotMatch(step, /::warning title=Probe::no SENT line/, 'a missing SENT must fail the step, not warn');
  });
  // Run 35451496350: avdmanager and the emulator disagreed on where AVDs live,
  // the emulator exited ("Unknown AVD name [probe]"), and a bare
  // `timeout 300 adb wait-for-device` died 124 printing nothing.
  test('the boot step pins ANDROID_AVD_HOME for BOTH tools and never waits blind', () => {
    const raw = readFileSync(join(ROOT, WORKFLOW), 'utf8');
    const step = raw.slice(raw.indexOf('- name: Boot an emulator'), raw.indexOf('- name: Ground truth'));
    const home = step.indexOf('export ANDROID_AVD_HOME=');
    assert.ok(home > 0, 'ANDROID_AVD_HOME is not exported in the boot step');
    assert.ok(home < step.indexOf('avdmanager" create avd'), 'ANDROID_AVD_HOME must be set BEFORE avdmanager runs');
    assert.match(step, /emulator" -list-avds \| grep -qx probe/, 'the AVD is not listed back from the emulator side');
    assert.match(step, /kill -0 "\$emu_pid"/, 'a dead emulator is not detected in the wait loop');
    assert.match(step, /tail -n \d+ "\$emu_log"/, 'a failure does not print the emulator log');
    assert.doesNotMatch(step, /^\s*timeout \d+ "\$adb" wait-for-device/m, 'a bare wait-for-device timeout says nothing on failure');
  });
});
