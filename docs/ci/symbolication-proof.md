# `symbolication-proof.yml` — does GlitchTip put an obfuscated Flutter Android crash on the right line?

Rows `O-GLITCHTIP-FLUTTER-SYMBOLICATION-UNPROVEN` (answered) and `O-GLITCHTIP-UPGRADE-SYMBOLICATION`
(open). Dispatch-only. Script: `tooling/ops/symbolication-proof.mjs`; recorded state:
`tooling/ops/symbolication-expectation.json`; test: `tooling/ci/test/symbolication-proof.test.mjs`;
probe: `apps/subscriptiontracker/live_probe/symbolication_crash_probe.dart`.

## 🔴 What a GREEN run means here — and what it does not

**It means reality still equals the RECORDED state, nothing more.** Since run 35470727346 the verdict
does not compare the two readings against an ideal; it compares them against
`tooling/ops/symbolication-expectation.json`, which holds what [ADR 090] recorded:

```json
{ "groundTruth": "match", "sink": "mismatch", "recordedBy": "ADR 090",
  "row": "O-GLITCHTIP-UPGRADE-SYMBOLICATION", "evidence": { "glitchtipVersion": "6.2.6", … } }
```

While `"sink"` reads `"mismatch"`, **a green run of this lane does NOT mean GlitchTip symbolicates
Flutter Android frames** — it means GlitchTip is still getting them wrong in exactly the recorded way.
Every green run prints an unmissable banner built from the register's `broken`, `until` and `row`
fields, so the green can never be read as the capability working, and the register's reader refuses a
row whose `broken` is empty.

*Why it is not simply left red:* the lane had run five times and gone red five times — four for
defects in the proof itself, the last for its real finding. Once that finding is recorded, a check
that stays red for it trains its reader to ignore red; the owner sees "Symbolication proof —
deployment failed" and cannot tell it from a real failure. That is the exact class
[`../verification-discipline.md`](../verification-discipline.md) exists to prevent, so the comparison
moved from an ideal to the record.

| the run reads | vs the register | exit | what the reader must do |
|---|---|---|---|
| ground truth MATCH, sink MISMATCH | as recorded | **0** + banner | nothing; triage native crashes from the kept symbols |
| sink now MATCH | sink changed, good direction | **1** | close `O-GLITCHTIP-UPGRADE-SYMBOLICATION`, amend [ADR 090] with the run id, set `"sink": "match"` |
| ground truth now MISMATCH | our side changed | **1** | a real regression in **our** symbols/decoder — the triage path itself is broken |
| either reading UNAVAILABLE | nothing compared | **2** | read the evidence artifact; never a pass by absence |
| instance is not the recorded GlitchTip version | the record is stale | **2** | re-measure, update `evidence` (+ `sink` if it moved), dispatch again |
| register missing or malformed | nothing to hold the run against | **2** | restore the register |

The instance's version is read **live** on every run (`GET /api/settings/`, no token needed on our
instance) and compared with `evidence.glitchtipVersion`; the token is never printed. The report JSON
in the evidence artifact carries the register, the live version, both readings and the verdict lines.

## What one run does

1. Builds the probe with the release lanes' flags (`--obfuscate --split-debug-info`), for
   `android-x64` only, debug-signed. The probe is an alternate entrypoint in `live_probe/`; no store
   build compiles it.
2. Keeps the probe's symbols as `symbols-symbolication-probe-android-x64`, then uploads them to
   GlitchTip through `tooling/ops/upload-native-symbols.mjs` (symbolication happens at ingest, so
   the debug file must be stored before the event arrives).
3. Boots an emulator from the runner's preinstalled SDK (no third-party action: the repository
   allows `selected` actions only), runs the probe, and captures logcat. The probe initialises the
   real `TelemetryBootstrap`, throws at the line marked `SYMBOLICATION-PROBE-THROW-SITE`, reports it,
   and prints the raw non-symbolic trace between `SYMPROBE|` sentinels.
4. **Ground truth:** `native_stack_traces`' `decode translate` over that raw trace against the
   build's own `.symbols` file (version: `tooling/versions.json` `native_stack_traces`). NOT
   `flutter symbolize`: Flutter 3.47.4's tool pins native_stack_traces 0.6.1, which cannot read the
   single-text-section snapshot (`_kDartSnapshotText`, `vm_dso_base: 0`) its own engine writes
   (run 35463786607: "Cannot locate isolate instructions section in snapshot").
5. **Sink:** the GlitchTip event carrying this run's marker, read back through the API; the frame at
   the throw's address is compared with the marked line. This step runs even when step 4 failed
   (`always()`, once the marker was extracted), and an UNAVAILABLE reading is exit 2, never 0.
6. **Verdict:** both readings, plus the instance's live version, held against
   `tooling/ops/symbolication-expectation.json` — see the table above for every exit.

## Run history

| run | outcome | cause, from the kept evidence |
|---|---|---|
| 35451496350 | boot timed out (124) | `emulator.log`: `Unknown AVD name [probe]` — avdmanager and the emulator used different AVD homes. Fixed by pinning `ANDROID_AVD_HOME`. |
| 35458257697 | no BEGIN line | sentry_flutter's `DebugPrintIntegration` replaces `debugPrint` with a breadcrumb sink in release builds. Fixed by printing through `Zone.root.print`. |
| 35463786607 | ground truth exit 1; no event in GlitchTip | `flutter symbolize` too old for the 3.47.4 snapshot (above). The trace's `build_id` `bf7ded9a01540a5738031d8d50b5dd60` equals the kept `app.android-x64.symbols` note, arch x64 on both; the 0.7.0 decoder, run offline on the kept files, gives `probeThrowSite (…/symbolication_crash_probe.dart:36:3)` — the marked line. Separately, neither this run's event nor the previous one ever reached GlitchTip: the probe called `close()` right after `captureException`, cutting off the native SDK's asynchronous send. The probe no longer closes. |
| 35467695649 | ground truth OK (line 36); verdict exit 2, "no event carries the marker" | The event DID arrive (issue 38, environment `symbolication-probe`, org stats: 1 accepted error that hour, none during the three earlier runs). Its value read `symbolication-probe symprobe-[REDACTED]`: the chassis's `PiiScrubber` rule `\d{10,}` redacted the 16-digit timestamp marker. The probe now mints a letters-only marker, tested against the real scrubber patterns. **Read by hand, that event is the sink's answer:** the throw-site frame (`0x7eb7fbb06c3e`, the trace's first app frame) is UNSYMBOLICATED, and its caller resolved to `new Uint32List` in `typed_data_patch.dart` line 0 (expected `main`, line 65) — a wrong frame, the GitLab issue 491 shape. |
| 35470727346 | verdict exit 1 — **the real finding, not a defect in the proof** | Everything worked: marker `symprobe-bhijifebdibjccbe` survived the scrubber, event `ce8754f619d1408c93e01a371a4938ea` (issue 39) arrived, both readings were taken. GROUND TRUTH **MATCH** — `symbolication_crash_probe.dart:36` (`probeThrowSite`). SINK **MISMATCH** — the frame at the throw address `0x735b1e693c3e` came back `function=null, file=null, line=null`, and its caller again resolved to `new Uint32List`, `typed_data_patch.dart:0`. Recorded as [ADR 090] + row `O-GLITCHTIP-UPGRADE-SYMBOLICATION`, and **turned into `tooling/ops/symbolication-expectation.json`**: from here the lane is red only when a reading CHANGES. The kept evidence of this run is the fixture set in `tooling/ci/test/symbolication-proof.test.mjs`. |

Evidence is uploaded as `symbolication-proof-evidence` on every run, whatever the exit.

## Why the sink is RECORDED as a mismatch on GlitchTip 6.2.6 (source read 2026-09-19, confirmed by run 35470727346)

- The live instance reports `"version": "6.2.6"` (`GET /api/settings/`, re-read 2026-09-20). This is
  the value `evidence.glitchtipVersion` holds, and the verdict re-reads it on every run.
- `sentry_flutter` 9.26.0 (`packages/dart/lib/src/sentry_stack_trace_factory.dart` at tag 9.26.0)
  sends each Dart AOT frame as `instructionAddr: 0x<absolute pc>, platform: native` with **no
  per-frame `image_addr`**; the isolate base goes into one `debug_meta.images` entry.
- GlitchTip v6.2.6 `apps/difs/tasks.py` picks the right debug file by `debug_id`, but
  `apps/difs/stacktrace_processor.py::resolve_native_stacktrace` never reads debug_meta's
  `image_addr`. A frame without its own `image_addr` gets `_estimate_image_base()`: the first frame's
  address slid across 4 KiB-aligned offsets, stopping at the first base under which half the sampled
  frames resolve to *any* symbol. The true offset is not in general a 4 KiB multiple, so frames land
  on real but unrelated functions: the GlitchTip issue 491 symptom (expected
  `NetworkManager.handleError()` line 156, displayed `ColorFloat64.lerp()` line 92).
- Upstream MR !2474 *"fix(difs): Use debug_meta image_addr for native symbolication"* merged
  2026-08-15, after v6.2.6 was tagged (2026-08-07); no release tag exists after v6.2.6 as of
  2026-09-19. Issue 491 is still open.

Measured on the live instance 2026-09-19: no native (Android, iOS or desktop) Flutter event had ever
reached it. Every stack-bearing issue was from the web build. Run 35470727346 sent the first one, and
it came back wrong exactly as the source read predicted.

## When to dispatch it, and how to end the finding

After every GlitchTip upgrade and every `sentry_flutter` bump. Until the register's `"sink"` reads
`"match"`, triage a native Flutter crash from the kept `symbols-*` artefact with
`dart pub global run native_stack_traces:decode translate -d <app.android-*.symbols> -i <trace>`
(the pinned version; `flutter symbolize` on Flutter 3.47.4 cannot read the trace), not from the
GlitchTip frame. Step 4 of this workflow proves that path on every run.

**To close it**, in this order: the box gets a release carrying !2474 → dispatch (it exits **2** on
the version limb, because the record is now stale) → update `evidence.run`, `evidence.event` and
`evidence.glitchtipVersion` in `tooling/ops/symbolication-expectation.json`, and set
`"sink": "match"` if the second dispatch's sink matched → close `O-GLITCHTIP-UPGRADE-SYMBOLICATION`
and amend [ADR 090] with that run id. The lane is then green with no banner, and that green does mean
symbolication works.

```
gh workflow run symbolication-proof.yml --ref <branch>
```
