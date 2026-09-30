// ─────────────────────────────────────────────────────────────────────────────
// flutter-stock-assets-injection.test.mjs — a Flutter SDK directory whose NAME
// is a shell command must never run that command (CodeQL #305
// js/shell-command-injection-from-environment, #306
// js/indirect-command-line-injection; review of #1087, finding 7).
//
// The launcher path comes from FLUTTER_ROOT or PATH, and until 2026-09-30 the
// Windows spawn was `spawnSync('cmd.exe', ['/c', exe, ...args])`: cmd.exe
// re-parses its command line, so an SDK under `sdk&echo INJECTED&…` ran
// `echo INJECTED` as a second command. Reproduced by hand that day, and by the
// independent review with four hostile names. The fix:
//   · POSIX   — spawnSync(exe, args): an argument array, no shell at all;
//   · Windows — a `.bat` cannot be spawned without cmd.exe (CVE-2024-27980), so
//               the path travels in NIKATRU_FLUTTER_LAUNCHER and the command
//               line cmd.exe parses is a constant: `""%VAR%" <constant args>"`.
//
// ONE case per platform, each on the REAL referenceApp() against a fake SDK whose
// directory name carries `&echo INJECTED&` and `$(echo INJECTED)`. The fake
// `flutter` prints `LAUNCHER-RAN <args>` and exits 1, so referenceApp throws
// StockAssetsUnavailable with the create's output in it — the launcher RAN, with
// exactly the constant arguments, and INJECTED never printed.
//
// RED CONTROL, run on Windows 2026-09-30 by restoring the old spawn line
// (`spawnSync('cmd.exe', ['/c', exe, ...args], opts)`): this case failed with
// INJECTED in the captured output. Restored; green again.
//
// Run:  node --test "tooling/ci/test/flutter-stock-assets-injection.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { referenceApp, StockAssetsUnavailable } from '../flutter-stock-assets.mjs';

const WIN = process.platform === 'win32';
/** A directory name that is two commands to any shell that parses it. */
const HOSTILE = 'sdk&echo INJECTED&$(echo INJECTED)x';

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-stock-injection-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A fake SDK under the hostile name whose `flutter` reports its arguments and fails. */
function hostileSdk() {
  const sdkRoot = join(TMP, HOSTILE);
  const bin = join(sdkRoot, 'bin');
  mkdirSync(bin, { recursive: true });
  if (WIN) {
    writeFileSync(join(bin, 'flutter.bat'), '@echo off\r\necho LAUNCHER-RAN %*\r\nexit /b 1\r\n');
  } else {
    const p = join(bin, 'flutter');
    writeFileSync(p, '#!/bin/sh\necho "LAUNCHER-RAN $*"\nexit 1\n');
    chmodSync(p, 0o755);
  }
  return sdkRoot;
}

test(`${WIN ? 'Windows (cmd.exe, path via the environment)' : 'POSIX (argument array, no shell)'}: an SDK named "${HOSTILE}" runs the launcher and NOTHING else`, () => {
  const sdkRoot = hostileSdk();
  let err;
  try {
    referenceApp(sdkRoot);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof StockAssetsUnavailable, `expected StockAssetsUnavailable from the failing fake, got ${err?.stack ?? err}`);
  const text = err.lines.join('\n');
  assert.match(text, /LAUNCHER-RAN create --platforms=\S+ --org com\.example --project-name stockref stockref/, `the launcher must run, with the constant arguments:\n${text}`);
  // The directory name itself appears in `sdk = …`; strip that line, and what is
  // left is what the child printed. INJECTED there means a shell ran the name.
  const printed = err.lines.filter((l) => !l.startsWith('sdk = ') && !l.includes(sdkRoot)).join('\n');
  assert.doesNotMatch(printed, /INJECTED/, `a shell parsed the SDK path and ran part of it:\n${text}`);
});
