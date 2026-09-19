#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// symbolication-proof.mjs: does GlitchTip put an obfuscated Flutter Android
// crash on the RIGHT source line? Row O-GLITCHTIP-FLUTTER-SYMBOLICATION-UNPROVEN.
//
// Driven by .github/workflows/symbolication-proof.yml, which builds
// apps/subscriptiontracker/live_probe/symbolication_crash_probe.dart as an
// obfuscated release APK, uploads its debug files, runs it on an emulator, and
// hands this script three things. Two independent verdicts come out:
//
//   GROUND TRUTH  native_stack_traces' decoder over the raw trace the probe printed to
//                 logcat, against the build's own .symbols file. Its crashing
//                 frame must be the THROW-SITE line of the probe source. This
//                 is also the offline recovery path, proven on every run.
//   SINK          the GlitchTip event carrying this run's marker. Its frame at
//                 the throw's address (the first isolate frame of the raw
//                 trace; the LAST frame if no frame carries that address) must
//                 name the same file and line.
//
// Exit 0 both match. Exit 1 a FINDING: the sink names another line (or the
// ground truth does). Exit 2 COVERAGE LOST: no trace, no event, no token, no
// frame to compare. Never a pass by absence.
//
// Why this is expected to be RED on GlitchTip 6.2.6 (read, not run, at tag
// v6.2.6): apps/difs/stacktrace_processor.py never reads debug_meta's
// image_addr, and sentry_flutter 9.26.0 sends Dart AOT frames with an absolute
// instruction_addr and no per-frame image_addr, so the image base is ESTIMATED
// on a 4 KiB grid. Upstream MR !2474 (merged 2026-08-15, after v6.2.6) reads
// the base from debug_meta. docs/ci/symbolication-proof.md carries the sources.
//
// Subcommands:
//   expect         --source <dart file>
//   extract-trace  --logcat <file> --out <file> --marker-out <file> [--marker <m>]
//   verdict        --source <dart file> --trace <file> --symbolized <file> --marker <m>
//                  --report <json out> [--wait-seconds N]   (needs GLITCHTIP_TOKEN)
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const THROW_SITE_MARKER = 'SYMBOLICATION-PROBE-THROW-SITE';
export const LINE_PREFIX = 'SYMPROBE|';

/** The line the probe throws on, found by its marker; exactly one is allowed. */
export function expectedSite(sourceText, sourceName) {
  const lines = sourceText.split(/\r?\n/);
  const hits = [];
  lines.forEach((l, i) => {
    if (l.includes(`// ${THROW_SITE_MARKER}`) && /\bthrow\b/.test(l)) hits.push(i);
  });
  if (hits.length !== 1) {
    return { error: `expected exactly one throw line carrying // ${THROW_SITE_MARKER}, found ${hits.length}` };
  }
  let fn = null;
  for (let i = hits[0]; i >= 0 && fn === null; i--) {
    const m = /^\s*(?:[\w<>?,\s]+\s)?(\w+)\s*\([^)]*\)\s*(?:async\s*)?\{/.exec(lines[i]);
    if (m && !['if', 'for', 'while', 'switch', 'catch'].includes(m[1])) fn = m[1];
  }
  return { file: basename(sourceName), line: hits[0] + 1, function: fn };
}

/**
 * The raw trace between TRACE-BEGIN and TRACE-END that follows `BEGIN <marker>`.
 * A logcat line is `<date> <time> <pid> <tid> I flutter : SYMPROBE|<text>`; only
 * what follows the prefix is kept, verbatim, so the decoder sees the
 * trace the VM printed.
 *
 * The probe MINTS its marker at run time (no dart-define, so nothing new is
 * compiled into the artifact). With `marker` null the LAST `BEGIN` line names
 * it: a relaunch prints a newer one, and its event is the one to read.
 */
export function extractTrace(logcatText, marker = null) {
  const payload = [];
  for (const raw of logcatText.split(/\r?\n/)) {
    const at = raw.indexOf(LINE_PREFIX);
    if (at >= 0) payload.push(raw.slice(at + LINE_PREFIX.length));
  }
  if (marker === null) {
    const last = payload.filter((l) => /^BEGIN \S+$/.test(l)).pop();
    if (last === undefined) return { error: 'no "BEGIN <marker>" line: the probe did not run' };
    marker = last.slice('BEGIN '.length);
  }
  const begin = payload.lastIndexOf(`BEGIN ${marker}`);
  if (begin < 0) return { error: `no "BEGIN ${marker}" line: the probe did not run, or ran with another marker` };
  const tb = payload.indexOf('TRACE-BEGIN', begin);
  const te = tb < 0 ? -1 : payload.indexOf('TRACE-END', tb);
  if (tb < 0 || te < 0) return { error: 'the TRACE-BEGIN/TRACE-END block is missing or unterminated' };
  const trace = payload.slice(tb + 1, te);
  // A symbolic trace (no --obfuscate/--split-debug-info) proves nothing here.
  if (!trace.some((l) => /^\s*#\d+\s+abs\s+[0-9a-f]+/i.test(l))) {
    return { error: 'the trace carries no "#NN abs <addr>" frame: this build was not a split-debug-info AOT build' };
  }
  return { trace: `${trace.join('\n')}\n`, marker, sent: payload.includes(`SENT ${marker}`) };
}

/**
 * Frames from the decoder's output (native_stack_traces `decode translate`, the
 * format `flutter symbolize` also prints), in printed order (innermost first).
 * A frame line reads `#0      probeThrowSite (file:///.../x.dart:36:3)`; a
 * line without a parsable location is skipped, not guessed at.
 */
export function parseSymbolized(text) {
  const frames = [];
  for (const l of text.split(/\r?\n/)) {
    const m = /^\s*#(\d+)\s+(.+?)\s+\((.+?):(\d+)(?::\d+)?\)\s*$/.exec(l);
    if (m) frames.push({ index: Number(m[1]), function: m[2], file: m[3], line: Number(m[4]) });
  }
  return frames;
}

/** The newest event whose exception value or message carries `marker`. */
export function findEvent(events, marker) {
  if (!Array.isArray(events)) return null;
  for (const e of events) {
    const values = exceptionValues(e);
    const text = [e.message, e.title, e.metadata?.value, ...values.map((v) => v.value)].filter(Boolean);
    if (text.some((t) => String(t).includes(marker))) return e;
  }
  return null;
}

function exceptionValues(event) {
  const entry = (event.entries ?? []).find((x) => x?.type === 'exception');
  const fromEntries = entry?.data?.values;
  const fromRaw = event.exception?.values;
  return Array.isArray(fromEntries) ? fromEntries : Array.isArray(fromRaw) ? fromRaw : [];
}

/**
 * The symbol an app frame is printed against. TWO snapshot layouts exist and
 * the tree has met both: the old one splits VM and isolate instructions
 * (`_kDartIsolateSnapshotInstructions`, with VM stubs under
 * `_kDartVmSnapshotInstructions`), and the one Flutter 3.47.4's engine writes
 * has ONE text section, `_kDartSnapshotText`, with `vm_dso_base: 0` (the VM
 * isolate was removed; native_stack_traces 0.7.0). Run 35463786607's trace was
 * the new layout, and a matcher that knew only the old one found no frame.
 */
export const APP_TEXT_SYMBOLS = ['_kDartSnapshotText', '_kDartIsolateSnapshotInstructions'];

/**
 * The absolute address of the first frame in the app's instructions: the frame
 * that threw. A frame in the old layout's VM instructions (a stub) is skipped,
 * because the app's debug file cannot describe it on either side.
 */
export function firstIsolateAddr(traceText) {
  for (const l of traceText.split(/\r?\n/)) {
    const m = /^\s*#\d+\s+abs\s+([0-9a-f]+)\b.*\s(_kDart\w+)\+0x[0-9a-f]+\s*$/i.exec(l);
    if (m && APP_TEXT_SYMBOLS.includes(m[2])) return BigInt(`0x${m[1]}`);
  }
  return null;
}

/**
 * The crashing frame of the first exception. It is the frame whose address is
 * `addr` when one is given and present; otherwise the LAST frame, because
 * Sentry orders frames oldest first.
 */
export function crashFrame(event, addr = null) {
  const values = exceptionValues(event);
  const frames = values[0]?.stacktrace?.frames;
  if (!Array.isArray(frames) || frames.length === 0) return null;
  const at = (f) => {
    const raw = f?.instructionAddr ?? f?.instruction_addr;
    try {
      return raw == null ? null : BigInt(raw);
    } catch {
      return null;
    }
  };
  const byAddr = addr === null ? undefined : frames.find((f) => at(f) === addr);
  const f = byAddr ?? frames[frames.length - 1];
  return {
    function: f.function ?? null,
    file: f.filename ?? f.absPath ?? f.abs_path ?? null,
    line: f.lineNo ?? f.lineno ?? null,
    instructionAddr: f.instructionAddr ?? f.instruction_addr ?? null,
    frameCount: frames.length,
    matchedBy: byAddr ? 'address' : 'last-frame',
  };
}

/**
 * One exit for the two verdicts. A MISMATCH on either side is the finding (1).
 * Otherwise an UNAVAILABLE ground truth (null) is coverage lost (2), never 0.
 */
export function verdictExit(truthOk, sinkOk) {
  if (truthOk === false || sinkOk === false) return 1;
  if (truthOk === null || sinkOk === null) return 2;
  return 0;
}

/** Same file (by basename) and same line. The function is reported, not required. */
export function sameSite(expected, frame) {
  if (!frame) return { ok: false, why: 'no frame' };
  if (frame.file == null || frame.line == null) {
    return { ok: false, why: `the frame is UNSYMBOLICATED (function=${frame.function}, addr=${frame.instructionAddr})` };
  }
  const file = basename(String(frame.file).replace(/^file:\/\//, ''));
  if (file !== expected.file || Number(frame.line) !== expected.line) {
    return { ok: false, why: `names ${file}:${frame.line} (${frame.function}), expected ${expected.file}:${expected.line} (${expected.function})` };
  }
  return { ok: true, why: `names ${file}:${frame.line} (${frame.function})` };
}

async function fetchProjectEvents({ instance, org, project, token }) {
  const url = `${instance}/api/0/projects/${org}/${project}/events/?limit=50`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.json();
}

const RUN_DIRECTLY =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (RUN_DIRECTLY) {
  const [cmd, ...rest] = process.argv.slice(2);
  const { values: a } = parseArgs({
    args: rest,
    strict: true,
    options: {
      source: { type: 'string' },
      logcat: { type: 'string' },
      marker: { type: 'string' },
      out: { type: 'string' },
      'marker-out': { type: 'string' },
      symbolized: { type: 'string' },
      trace: { type: 'string' },
      report: { type: 'string' },
      'wait-seconds': { type: 'string' },
    },
  });
  const lost = (msg) => {
    console.error(`symbolication-proof: COVERAGE LOST — ${msg}`);
    process.exit(2);
  };
  const need = (...keys) => keys.forEach((k) => a[k] === undefined && lost(`--${k} is required for ${cmd}`));

  if (cmd === 'expect') {
    need('source');
    const exp = expectedSite(readFileSync(a.source, 'utf8'), a.source);
    if (exp.error) lost(exp.error);
    console.log(JSON.stringify(exp));
  } else if (cmd === 'extract-trace') {
    need('logcat', 'out', 'marker-out');
    const t = extractTrace(readFileSync(a.logcat, 'utf8'), a.marker ?? null);
    if (t.error) lost(t.error);
    writeFileSync(a.out, t.trace);
    writeFileSync(a['marker-out'], t.marker);
    console.log(`symbolication-proof: marker ${t.marker}; raw trace written (${t.trace.split('\n').length - 1} lines); probe reported SENT: ${t.sent}`);
  } else if (cmd === 'verdict') {
    need('source', 'trace', 'symbolized', 'marker', 'report');
    const addr = firstIsolateAddr(readFileSync(a.trace, 'utf8'));
    if (addr === null) lost(`the raw trace has no frame in ${APP_TEXT_SYMBOLS.join(' or ')}`);
    const exp = expectedSite(readFileSync(a.source, 'utf8'), a.source);
    if (exp.error) lost(exp.error);
    // The SINK is what the row asks, so it is read and reported even when the
    // offline decode failed or never ran. An unavailable ground truth is never
    // a pass: it makes a sink MATCH exit 2, and a sink MISMATCH still exits 1.
    const truthFrames = existsSync(a.symbolized) ? parseSymbolized(readFileSync(a.symbolized, 'utf8')) : [];
    const truth =
      truthFrames.length === 0
        ? { ok: null, why: `UNAVAILABLE — ${a.symbolized} holds no decoded frame (see the ground-truth step)` }
        : sameSite(exp, truthFrames[0]);

    const token = process.env.GLITCHTIP_TOKEN;
    if (!token) lost('GLITCHTIP_TOKEN is not set; the sink was not read');
    const here = dirname(fileURLToPath(import.meta.url));
    const gt = JSON.parse(readFileSync(join(here, 'glitchtip-project.json'), 'utf8'));
    const deadline = Date.now() + Number(a['wait-seconds'] ?? 300) * 1000;
    let event = null;
    while (event === null) {
      event = findEvent(await fetchProjectEvents({ ...gt, token }), a.marker);
      if (event !== null) break;
      if (Date.now() > deadline) lost(`no GlitchTip event carries ${a.marker} after ${a['wait-seconds'] ?? 300}s`);
      await new Promise((r) => setTimeout(r, 15000));
    }
    const frame = crashFrame(event, addr);
    if (!frame) lost(`event ${event.eventID ?? event.id} carries no exception frames`);
    const sink = sameSite(exp, frame);
    const report = {
      marker: a.marker,
      expected: exp,
      groundTruth: { ...truth, frame: truthFrames[0] ?? null },
      sink: { ...sink, frame, eventID: event.eventID ?? event.event_id ?? null, groupID: event.groupID ?? event.group_id ?? null },
    };
    writeFileSync(a.report, `${JSON.stringify(report, null, 2)}\n`);
    const word = (ok) => (ok === null ? 'UNAVAILABLE' : ok ? 'MATCH' : 'MISMATCH');
    console.log(`GROUND TRUTH (offline decode): ${word(truth.ok)} — ${truth.why}`);
    console.log(`SINK (GlitchTip event ${report.sink.eventID}): ${word(sink.ok)} — ${sink.why}`);
    process.exit(verdictExit(truth.ok, sink.ok));
  } else {
    lost(`unknown subcommand "${cmd}" (expect | extract-trace | verdict)`);
  }
}
