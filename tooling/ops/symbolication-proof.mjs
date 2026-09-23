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
// 🔴 THE TWO READINGS ARE COMPARED AGAINST THE RECORDED STATE, NOT AN IDEAL ONE.
// symbolication-expectation.json, beside this file, holds what [ADR 090] records
// as true today: ground truth MATCH, sink MISMATCH, on GlitchTip 6.2.6. The
// first five dispatches were all red — four for defects in the proof itself, the
// last (35470727346) for its real finding — and a check that stays red forever
// for a fact already decided trains its reader to ignore red, which is the class
// docs/verification-discipline.md exists to prevent.
//
// Exit 0 reality EQUALS the record — and when the record still says something is
//        broken, the verdict prints an unmissable banner naming what is broken,
//        why the run is green and which row/ADR ends it. A green run here does
//        NOT mean symbolication works.
// Exit 1 reality DIFFERS from the record, naming which side changed: the sink now
//        MATCHES (good news — close the row, amend the ADR, set "sink": "match"),
//        or the ground truth broke (a regression in our own symbols/decoder).
// Exit 2 COVERAGE LOST: no trace, no event, no token, no frame; a missing or
//        malformed register; or the live instance is no longer the version the
//        record was measured against, which makes the record stale. Never a pass
//        by absence.
//
// Why the sink is recorded as MISMATCH on GlitchTip 6.2.6 (read, not run, at tag
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
//                  --report <json out> [--wait-seconds N] [--expectation <json>]
//                  (needs GLITCHTIP_TOKEN)
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { fetchWithBoundedRetry } from './bounded-retry.mjs';

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

/** Exception values of the newest events the probe sent (value starts "symbolication-probe"). */
export function probeEventValues(events, limit = 3) {
  if (!Array.isArray(events)) return [];
  return events
    .flatMap((e) => exceptionValues(e).map((v) => v.value))
    .filter((v) => typeof v === 'string' && v.startsWith('symbolication-probe'))
    .slice(0, limit);
}

/** Every frame of the first exception, reduced to what triage reads. */
export function allFrames(event) {
  const frames = exceptionValues(event)[0]?.stacktrace?.frames ?? [];
  return frames.map((f) => ({
    function: f.function ?? null,
    file: f.filename ?? f.absPath ?? null,
    line: f.lineNo ?? f.lineno ?? null,
    instructionAddr: f.instructionAddr ?? f.instruction_addr ?? null,
  }));
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

/** The name for one reading. `null` is UNAVAILABLE, which is never a pass. */
export function readingWord(ok) {
  return ok === null ? 'unavailable' : ok ? 'match' : 'mismatch';
}

/** Where the recorded state lives: beside this file, read on every verdict. */
export const EXPECTATION_FILE = 'symbolication-expectation.json';
const RECORDED = new Set(['match', 'mismatch']);
const TEXT_FIELDS = ['recordedBy', 'row', 'broken', 'until'];

/**
 * The recorded state, validated. Every field the verdict PRINTS is required, so
 * a register cannot be stripped to `{}` and keep passing: an expectation nobody
 * can read back is coverage lost, not a default.
 */
export function parseExpectation(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { error: `the register is not JSON: ${e.message}` };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'the register is not a JSON object' };
  for (const side of ['groundTruth', 'sink']) {
    if (!RECORDED.has(raw[side])) {
      return { error: `the register's "${side}" is ${JSON.stringify(raw[side])}; it must be "match" or "mismatch"` };
    }
  }
  for (const k of TEXT_FIELDS) {
    if (typeof raw[k] !== 'string' || raw[k].trim() === '') return { error: `the register's "${k}" is missing or empty` };
  }
  const ev = raw.evidence;
  if (ev === null || typeof ev !== 'object' || Array.isArray(ev)) return { error: 'the register has no "evidence" object' };
  for (const k of ['run', 'event', 'glitchtipVersion']) {
    if (typeof ev[k] !== 'string' || ev[k].trim() === '') return { error: `the register's "evidence.${k}" is missing or empty` };
  }
  return { expectation: raw };
}

const RULE = '═'.repeat(78);

/**
 * The one verdict. It answers "does reality still equal the record?", never
 * "is symbolication correct?" — the second question is what the record holds.
 *
 * 2  the register is unreadable, a reading is UNAVAILABLE, or the live instance
 *    is not the version the record was measured against (the record is stale).
 * 1  a side changed — named, with what to do about it, in both directions.
 * 0  reality equals the record; the banner says what is still broken and why
 *    this green is not the capability working.
 */
export function expectationVerdict({ expectation, truthOk, sinkOk, liveVersion, versionError = null }) {
  const got = { groundTruth: readingWord(truthOk), sink: readingWord(sinkOk) };
  const lines = [];
  const lost = (why) => ({ exit: 2, asRecorded: false, got, lines: [`COVERAGE LOST — ${why}`] });

  const recordedVersion = expectation.evidence.glitchtipVersion;
  if (typeof liveVersion !== 'string' || liveVersion.trim() === '') {
    return lost(
      `the live GlitchTip version could not be read${versionError ? ` (${versionError})` : ''}, so this run cannot be` +
        ` held against a record measured on ${recordedVersion}. The readings were groundTruth=${got.groundTruth}, sink=${got.sink}.`,
    );
  }
  if (liveVersion !== recordedVersion) {
    return lost(
      `THE EXPECTATION IS STALE. ${EXPECTATION_FILE} records GlitchTip ${recordedVersion}; the instance now reports` +
        ` ${liveVersion}. This run read groundTruth=${got.groundTruth}, sink=${got.sink} — RE-MEASURE and update the register` +
        ` (evidence.run, evidence.event, evidence.glitchtipVersion, and "sink" if it now matches), then dispatch again.` +
        ` If the sink now matches, that is ${expectation.until} landing: close ${expectation.row} and amend ${expectation.recordedBy}.`,
    );
  }
  for (const side of ['groundTruth', 'sink']) {
    if (got[side] === 'unavailable') return lost(`the ${side === 'sink' ? 'SINK' : 'GROUND TRUTH'} reading is UNAVAILABLE, so nothing was compared`);
  }

  const changed = ['groundTruth', 'sink'].filter((s) => got[s] !== expectation[s]);
  if (changed.length === 0) {
    const stillBroken = ['groundTruth', 'sink'].filter((s) => expectation[s] === 'mismatch');
    lines.push(RULE);
    if (stillBroken.length === 0) {
      lines.push(`AS RECORDED — both readings MATCH, which is what ${EXPECTATION_FILE} records.`);
      lines.push(`  GlitchTip ${liveVersion} symbolicates this obfuscated Flutter Android frame onto its known line.`);
    } else {
      lines.push('GREEN — AND SYMBOLICATION IS STILL BROKEN. This run matched the RECORDED state, nothing more.');
      lines.push(`  STILL BROKEN: ${expectation.broken}`);
      lines.push(`  WHY THIS RUN IS GREEN: that is recorded in ${expectation.recordedBy} (register: ${EXPECTATION_FILE}).`);
      lines.push('    This proof asserts the RECORDED state, not an ideal one, so it does not stay red for a decided fact.');
      lines.push(`  WHAT ENDS IT: ${expectation.until} — row ${expectation.row}.`);
      if (expectation.triageInstead) lines.push(`  UNTIL THEN: ${expectation.triageInstead}.`);
      lines.push('  🔴 THIS GREEN DOES NOT MEAN GLITCHTIP SYMBOLICATES FLUTTER ANDROID FRAMES.');
    }
    lines.push(`  Recorded on GlitchTip ${recordedVersion} by run ${expectation.evidence.run}, event ${expectation.evidence.event}.`);
    lines.push(RULE);
    return { exit: 0, asRecorded: true, got, lines };
  }

  lines.push(RULE);
  lines.push(`REALITY HAS MOVED AWAY FROM THE RECORD (${EXPECTATION_FILE}, ${expectation.recordedBy}).`);
  for (const side of changed) {
    const label = side === 'sink' ? 'SINK (GlitchTip)' : 'GROUND TRUTH (our symbols + decoder)';
    lines.push(`  ${label}: recorded ${expectation[side].toUpperCase()}, this run ${got[side].toUpperCase()}.`);
    if (side === 'sink' && got.sink === 'match') {
      lines.push(`    GOOD NEWS — GlitchTip ${liveVersion} now names the right line. Nothing is broken here.`);
      lines.push(`    DO THIS: close row ${expectation.row}, amend ${expectation.recordedBy} with this run id, and set`);
      lines.push(`    "sink": "match" in ${EXPECTATION_FILE} (with this run in "evidence"). The next run is then green for real.`);
    } else if (side === 'sink') {
      lines.push('    The sink was recorded as MATCH and no longer is: GlitchTip regressed, or the upload of the');
      lines.push('    debug files did. Read the kept symbolication-proof-evidence artifact before re-recording anything.');
    } else if (got.groundTruth === 'mismatch') {
      lines.push('    A REAL REGRESSION, AND IT IS OURS, NOT GLITCHTIP\'S: the offline decode of our own build against its');
      lines.push('    own .symbols file no longer lands on the marked line. That is the triage path ADR 090 tells everyone');
      lines.push('    to use, so it is the more serious of the two. Suspect the decoder pin (tooling/versions.json');
      lines.push('    native_stack_traces), the snapshot layout, or a moved THROW-SITE marker.');
    } else {
      lines.push('    The ground truth was recorded as MISMATCH and now matches: re-record it before anything relies on it.');
    }
  }
  lines.push('  A change — in either direction — is recorded before the check is allowed to call it normal.');
  lines.push(RULE);
  return { exit: 1, asRecorded: false, got, lines };
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

/**
 * ⏱ 2026-09-21 — BOUNDED RETRY (tooling/ops/bounded-retry.mjs), row
 * O-PAGES-FETCH-TRANSIENT-NOT-RETRIED, sweep clause.
 *
 * 🔴 THE POLL LOOP BELOW LOOKED LIKE A RETRY AND IS NOT ONE. `verdict` calls this
 * every 15 s for up to 300 s waiting for an event to ARRIVE — but a THROWN fetch
 * escapes that loop entirely and lands in the outer `catch`, so ONE dropped TCP
 * connection at any point in a five-minute wait discarded the whole proof run and
 * exited 2. Waiting longer for a thing to appear and asking again after the wire
 * dropped are different questions; only the first was answered here.
 *
 * Nothing about the exit code moves: a read that outlives the plan still throws
 * and is still the caller's COULD NOT LOOK. A 404/403 is an ANSWER and is not
 * re-asked.
 */
async function fetchProjectEvents({ instance, org, project, token }) {
  const url = `${instance}/api/0/projects/${org}/${project}/events/?limit=50`;
  const r = await fetchWithBoundedRetry(({ signal }) => fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal }), {
    describe: (why) => `GET ${url}: ${why}`,
  });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.json();
}

/**
 * The instance's own version string, live. `GET /api/settings/` answers
 * unauthenticated on our instance (measured 2026-09-20: `"version":"6.2.6"`),
 * but the token is sent anyway so a future instance that requires one still
 * answers. The token is never printed, here or anywhere.
 */
async function fetchInstanceVersion({ instance, token }) {
  const url = `${instance}/api/settings/`;
  // ⏱ 2026-09-21 — bounded retry, same plan and same reason as fetchProjectEvents.
  // This one's failure is captured into `versionError` and folded into the verdict
  // rather than thrown, so an un-retried blip did not fail the run — it silently
  // degraded the limb that proves the expectation was measured against the
  // GlitchTip version actually installed, which is worse than a red.
  const r = await fetchWithBoundedRetry(({ signal }) => fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal }), {
    describe: (why) => `GET ${url}: ${why}`,
  });
  if (!r.ok) throw new Error(`GET ${instance}/api/settings/ -> ${r.status}`);
  const j = await r.json();
  if (typeof j?.version !== 'string' || j.version.trim() === '') throw new Error(`${url} answered without a "version" string`);
  return j.version;
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
      expectation: { type: 'string' },
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
    // offline decode failed or never ran. An UNAVAILABLE reading on either side
    // is exit 2 whatever the other side says: nothing was compared, so there is
    // no verdict to give, and "could not look" is never a pass.
    const truthFrames = existsSync(a.symbolized) ? parseSymbolized(readFileSync(a.symbolized, 'utf8')) : [];
    const truth =
      truthFrames.length === 0
        ? { ok: null, why: `UNAVAILABLE — ${a.symbolized} holds no decoded frame (see the ground-truth step)` }
        : sameSite(exp, truthFrames[0]);

    const here = dirname(fileURLToPath(import.meta.url));
    // The record is read and validated BEFORE anything is fetched: a run held
    // against nothing is coverage lost, and finding that out costs no network.
    const expectationPath = a.expectation ?? join(here, EXPECTATION_FILE);
    if (!existsSync(expectationPath)) lost(`${expectationPath} is missing; there is no recorded state to hold this run against`);
    const parsed = parseExpectation(readFileSync(expectationPath, 'utf8'));
    if (parsed.error) lost(`${expectationPath}: ${parsed.error}`);
    const expectation = parsed.expectation;

    const token = process.env.GLITCHTIP_TOKEN;
    if (!token) lost('GLITCHTIP_TOKEN is not set; the sink was not read');
    const gt = JSON.parse(readFileSync(join(here, 'glitchtip-project.json'), 'utf8'));
    const deadline = Date.now() + Number(a['wait-seconds'] ?? 300) * 1000;
    let event = null;
    let seen = [];
    while (event === null) {
      seen = await fetchProjectEvents({ ...gt, token });
      event = findEvent(seen, a.marker);
      if (event !== null) break;
      if (Date.now() > deadline) {
        // Name what DID arrive: run 35467695649's event was there all along,
        // with its marker redacted, and "no event" hid that for a whole run.
        const probes = probeEventValues(seen);
        lost(
          `no GlitchTip event carries ${a.marker} after ${a['wait-seconds'] ?? 300}s` +
            (probes.length
              ? `; probe event(s) that DID arrive carry: ${probes.map((v) => JSON.stringify(v)).join(', ')}`
              : '; no symbolication-probe event arrived at all'),
        );
      }
      await new Promise((r) => setTimeout(r, 15000));
    }
    const frame = crashFrame(event, addr);
    if (!frame) lost(`event ${event.eventID ?? event.id} carries no exception frames`);
    const sink = sameSite(exp, frame);

    // Read LIVE, never assumed: a record measured on one GlitchTip version says
    // nothing about another, and a stale expectation that kept passing would be
    // a green check asserting a fact about software no longer installed.
    let liveVersion = null;
    let versionError = null;
    try {
      liveVersion = await fetchInstanceVersion({ instance: gt.instance, token });
    } catch (e) {
      versionError = e.message;
    }

    const v = expectationVerdict({ expectation, truthOk: truth.ok, sinkOk: sink.ok, liveVersion, versionError });
    const report = {
      marker: a.marker,
      expected: exp,
      groundTruth: { ...truth, frame: truthFrames[0] ?? null },
      sink: { ...sink, frame, eventID: event.eventID ?? event.event_id ?? null, groupID: event.groupID ?? event.group_id ?? null },
      // Every frame as the sink returned it, oldest first, for triage.
      sinkFrames: allFrames(event),
      // What this run was held against, and how it came out.
      expectation: { file: EXPECTATION_FILE, recorded: expectation, read: v.got },
      glitchtip: { version: liveVersion, versionError, recordedVersion: expectation.evidence.glitchtipVersion },
      verdict: { exit: v.exit, asRecorded: v.asRecorded, lines: v.lines },
    };
    writeFileSync(a.report, `${JSON.stringify(report, null, 2)}\n`);
    const word = (ok) => (ok === null ? 'UNAVAILABLE' : ok ? 'MATCH' : 'MISMATCH');
    console.log(`GROUND TRUTH (offline decode): ${word(truth.ok)} — ${truth.why}`);
    console.log(`SINK (GlitchTip ${liveVersion ?? 'version unread'}, event ${report.sink.eventID}): ${word(sink.ok)} — ${sink.why}`);
    console.log(`RECORDED (${EXPECTATION_FILE}, ${expectation.recordedBy}): groundTruth=${expectation.groundTruth}, sink=${expectation.sink}, on GlitchTip ${expectation.evidence.glitchtipVersion}`);
    for (const l of v.lines) (v.exit === 0 ? console.log : console.error)(l);
    process.exit(v.exit);
  } else {
    lost(`unknown subcommand "${cmd}" (expect | extract-trace | verdict)`);
  }
}
