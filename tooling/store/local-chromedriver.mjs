#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// local-chromedriver.mjs — the chromedriver this machine's Chrome can talk to,
// fetched from Google's own Chrome-for-Testing endpoint and checked against the
// checksum Google publishes for the bytes.
//
// ── WHY THIS EXISTS, 2026-09-20 ─────────────────────────────────────────────
// `store-screenshots.yml` installs chromedriver with
// `nanasess/setup-chromedriver`, which runs on Linux runners only. On the
// owner's Windows laptop there was no chromedriver at all, so
// `capture-play-screenshots.mjs` refused at its own probe and the capture could
// not be rehearsed HERE — every change to it had to be proven by DISPATCHING
// the workflow. Three consecutive dispatches (35483690951, 35488534460 and one
// before) failed on causes that were only visible in CI, which is the waste the
// owner's 2026-09-20 ruling names: a change must pass locally twice before it
// is pushed.
//
// ⚠️ SO THIS IS NOT A CONVENIENCE SCRIPT. It is the missing half of a local
// rehearsal, and without it the rehearsal is a document nobody can run.
//
// ── WHAT IT INSTALLS, AND WHERE ─────────────────────────────────────────────
// Into `%LOCALAPPDATA%\nikatru\chromedriver\<version>\chromedriver.exe`
// (`$XDG_DATA_HOME`/`~/.local/share` elsewhere) — a per-VERSION directory
// beside the heavy-run lock this tree already keeps there. Deliberately NOT on
// PATH and deliberately NOT into any toolchain directory: a chromedriver that
// shadows another tool's is a machine-wide change made for one lane, and the
// capture takes `CHROMEDRIVER` as an env var precisely so nothing global has to
// move. `--print-path` emits the path and nothing else, so a caller can do
// `export CHROMEDRIVER="$(node tooling/store/local-chromedriver.mjs --print-path)"`.
//
// ── WHY THE VERSION IS PICKED THE WAY IT IS ─────────────────────────────────
// chromedriver enforces the MAJOR version against the browser it drives and
// nothing finer — a mismatch there fails the session handshake with a message
// that reads like a Flutter error. Chrome-for-Testing does not publish a build
// for every Chrome patch (this machine runs 153.0.8010.48; the catalogue holds
// …47 and …52, not …48), so an exact-patch requirement would make this script
// refuse on a perfectly drivable browser. It therefore resolves the HIGHEST
// catalogued build with the same MAJOR, and prints both versions so the reader
// can see they are not identical rather than assume they are.
//
// ── WHY THE CHECKSUM IS THE ONE IT IS ───────────────────────────────────────
// The Chrome-for-Testing JSON carries urls and no hashes. The bytes live in a
// public Google Cloud Storage bucket whose JSON API DOES publish, per object,
// the size and an MD5 of the stored content — so the check is against Google's
// own record of the object, fetched separately from the object itself. That is
// weaker than a signature (both come from Google over TLS) and it is stated
// here rather than dressed up: it detects a truncated or corrupted download,
// not a compromised bucket. An unverified download would detect neither.
//
// Usage:
//   node tooling/store/local-chromedriver.mjs              # install / reuse, verbose
//   node tooling/store/local-chromedriver.mjs --print-path # the path only, for $(…)
//   node tooling/store/local-chromedriver.mjs --force      # re-download even if present
//
// Exit 0 = a chromedriver matching this machine's Chrome major is installed.
// Exit 1 = it is not, and the reason is on the first line.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const KNOWN_GOOD =
  'https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json';
const GCS_BUCKET = 'chrome-for-testing-public';

const argv = process.argv.slice(2);
const PRINT_PATH_ONLY = argv.includes('--print-path');
const FORCE = argv.includes('--force');

/** Everything this script says goes to stderr under --print-path, so stdout is
 *  exactly one line — a path — and `$(…)` around it cannot pick up a banner. */
const say = (s) => (PRINT_PATH_ONLY ? console.error(s) : console.log(s));
const die = (lines) => {
  console.error(`local-chromedriver: REFUSING — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

// ── which platform's binary ─────────────────────────────────────────────────
// Named by Chrome-for-Testing's own `platform` field, not by node's, because the
// catalogue is what has to be matched. Only the platforms this repo is driven on
// are listed; an unlisted one refuses rather than guessing a filename.
const CFT_PLATFORM = { win32: 'win64', darwin: 'mac-x64', linux: 'linux64' }[process.platform];
if (!CFT_PLATFORM) {
  die([
    `this script has no Chrome-for-Testing platform name for process.platform="${process.platform}".`,
    'Add it beside the three that are listed rather than letting the download url be guessed.',
  ]);
}
const EXE = process.platform === 'win32' ? 'chromedriver.exe' : 'chromedriver';

// ── this machine's Chrome ───────────────────────────────────────────────────
/** 🔴 THE REGISTRY FIRST ON WINDOWS, AND NOT `chrome.exe --version`. Chrome on
 *  Windows detaches immediately and prints its version to a console it has
 *  already left, so `spawnSync(chrome, ['--version'])` returns an EMPTY stdout
 *  and exit 0 — a version probe that succeeds and learns nothing. `BLBeacon\
 *  version` is what the updater writes and is what this machine was measured
 *  from on 2026-09-20 (153.0.8010.48). */
export function localChromeVersion(env = process.env) {
  if (process.platform === 'win32') {
    for (const hive of ['HKCU', 'HKLM']) {
      const q = spawnSync(
        'reg',
        ['query', `${hive}\\Software\\Google\\Chrome\\BLBeacon`, '/v', 'version'],
        { encoding: 'utf8' },
      );
      const m = /version\s+REG_SZ\s+([0-9.]+)/i.exec(q.stdout ?? '');
      if (m) return { version: m[1], from: `${hive}\\Software\\Google\\Chrome\\BLBeacon` };
    }
  }
  const exe = env.CHROME_EXECUTABLE;
  if (exe && existsSync(exe)) {
    const v = spawnSync(exe, ['--version'], { encoding: 'utf8' });
    const m = /([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/.exec(v.stdout ?? '');
    if (m) return { version: m[1], from: 'CHROME_EXECUTABLE --version' };
  }
  for (const c of ['google-chrome', 'google-chrome-stable', 'chromium-browser']) {
    const v = spawnSync(c, ['--version'], { encoding: 'utf8' });
    const m = /([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/.exec(v.stdout ?? '');
    if (m) return { version: m[1], from: `${c} --version` };
  }
  return null;
}

/** Highest catalogued build sharing `major`, with a download for this platform.
 *  Pure over the catalogue so it is testable without a network. */
export function pickBuild(catalogue, major, platform) {
  const cmp = (a, b) => {
    const A = a.split('.').map(Number);
    const B = b.split('.').map(Number);
    for (let i = 0; i < 4; i += 1) if ((A[i] ?? 0) !== (B[i] ?? 0)) return (A[i] ?? 0) - (B[i] ?? 0);
    return 0;
  };
  const rows = (catalogue.versions ?? [])
    .filter((v) => v.version.split('.')[0] === String(major))
    .map((v) => ({ version: v.version, url: (v.downloads?.chromedriver ?? []).find((d) => d.platform === platform)?.url }))
    .filter((v) => v.url)
    .sort((a, b) => cmp(a.version, b.version));
  return rows.length ? rows[rows.length - 1] : null;
}

const dataHome =
  process.platform === 'win32'
    ? process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    : process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
const baseDir = join(dataHome, 'nikatru', 'chromedriver');

async function main() {
  const chrome = localChromeVersion();
  if (!chrome) {
    die([
      'this machine\'s Chrome version could not be established, so no chromedriver major can be matched.',
      'Tried the BLBeacon registry key, $CHROME_EXECUTABLE --version and the three linux command names.',
      'Set CHROME_EXECUTABLE to the browser the capture will drive and run this again.',
    ]);
  }
  const major = chrome.version.split('.')[0];
  say(`Chrome ${chrome.version} (major ${major}) — from ${chrome.from}`);

  const res = await fetch(KNOWN_GOOD);
  if (!res.ok) die([`the Chrome-for-Testing catalogue returned HTTP ${res.status}.`, KNOWN_GOOD]);
  const build = pickBuild(await res.json(), major, CFT_PLATFORM);
  if (!build) {
    die([
      `Chrome-for-Testing publishes no ${CFT_PLATFORM} chromedriver for major ${major}.`,
      'That is a real gap, not a transient one: either this Chrome is newer than the catalogue (wait, or',
      'pin an older Chrome) or the platform name above is wrong.',
    ]);
  }

  const dir = join(baseDir, build.version);
  const exe = join(dir, EXE);
  if (existsSync(exe) && !FORCE) {
    say(`already installed: ${exe}`);
    say(reportDriver(exe, chrome.version));
    if (PRINT_PATH_ONLY) console.log(exe);
    return;
  }

  // ⚠️ THE CHECKSUM IS FETCHED BEFORE THE BYTES, from a different endpoint. If
  // the object's metadata cannot be read, the download does not happen at all —
  // "downloaded, could not verify" is a state this script refuses to be in,
  // because an unverifiable binary that is already on disk gets used.
  const object = encodeURIComponent(`${build.version}/${CFT_PLATFORM}/chromedriver-${CFT_PLATFORM}.zip`);
  const metaRes = await fetch(`https://storage.googleapis.com/storage/v1/b/${GCS_BUCKET}/o/${object}`);
  if (!metaRes.ok) {
    die([
      `the published checksum for chromedriver ${build.version} could not be read (HTTP ${metaRes.status}).`,
      'The bytes are NOT downloaded without it. Google publishes size and an MD5 of the stored object',
      'through the Cloud Storage JSON API; without that record this script has nothing to check a',
      'download against, and an unverified chromedriver is one that gets used anyway.',
    ]);
  }
  const meta = await metaRes.json();
  const expectSize = Number(meta.size);
  const expectMd5 = String(meta.md5Hash ?? '');
  if (!Number.isFinite(expectSize) || expectSize <= 0 || !expectMd5) {
    die([`the object metadata for chromedriver ${build.version} carries no usable size/md5Hash.`]);
  }

  say(`fetching ${build.url}`);
  const zipRes = await fetch(build.url);
  if (!zipRes.ok) die([`the chromedriver download returned HTTP ${zipRes.status}.`, build.url]);
  const bytes = Buffer.from(await zipRes.arrayBuffer());

  const gotMd5 = createHash('md5').update(bytes).digest('base64');
  if (bytes.length !== expectSize || gotMd5 !== expectMd5) {
    die([
      `the downloaded chromedriver does not match the checksum Google publishes for it.`,
      `  size  expected ${expectSize}, got ${bytes.length}`,
      `  md5   expected ${expectMd5}, got ${gotMd5}`,
      'Nothing was written. Re-run; if it repeats, do not work around it.',
    ]);
  }
  say(`verified against the bucket's published record: ${bytes.length} bytes, md5 ${expectMd5}`);

  mkdirSync(dir, { recursive: true });
  const zipPath = join(tmpdir(), `nk-chromedriver-${randomBytes(4).toString('hex')}.zip`);
  writeFileSync(zipPath, bytes);
  try {
    // bsdtar ships in System32 on Windows 10+ and reads zip; `--strip-components=1`
    // drops the archive's own `chromedriver-win64/` wrapper so the exe lands at the
    // path this script prints. tar is used rather than Expand-Archive because a
    // PowerShell hop is a second failure mode for no gain.
    //
    // 🔴 THE ABSOLUTE System32 PATH, NOT THE NAME `tar`, AND THAT IS A MEASURED
    // BUG FIX. A node process launched from this repo's Git-Bash inherits a PATH
    // whose /usr/bin comes first, so bare `tar` resolves to GNU tar, which reads
    // the drive letter in `C:\…\x.zip` as a REMOTE HOST and dies with
    // `tar: Cannot connect to C: resolve failed`, exit 128 — measured here
    // 2026-09-20, after a download that had already verified. bsdtar takes the
    // Windows path as written.
    const un = spawnSync(tarExe(), ['-xf', zipPath, '-C', dir, '--strip-components=1'], { stdio: 'inherit' });
    if (un.status !== 0) {
      die([
        `extracting the chromedriver archive failed (tar exited ${un.status ?? 'null'}).`,
        `archive: ${zipPath} — it is left in place for inspection.`,
      ]);
    }
  } finally {
    rmSync(zipPath, { force: true });
  }

  if (!existsSync(exe)) {
    die([
      `the archive extracted but ${EXE} is not at ${exe}.`,
      'The archive layout changed; look inside it before adjusting --strip-components.',
    ]);
  }
  say(`installed: ${exe}`);
  say(reportDriver(exe, chrome.version));
  if (PRINT_PATH_ONLY) console.log(exe);
}

/** See the note at the call site: bare `tar` is GNU tar under Git-Bash and
 *  cannot open a path with a drive letter. */
function tarExe() {
  if (process.platform !== 'win32') return 'tar';
  const sys32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  return existsSync(sys32) ? sys32 : 'tar';
}

/** The installed binary's OWN account of itself, and the major compared out
 *  loud. A path that exists proves a file, not a working driver. */
function reportDriver(exe, chromeVersion) {
  const v = spawnSync(exe, ['--version'], { encoding: 'utf8' });
  const m = /ChromeDriver ([0-9.]+)/.exec(v.stdout ?? '');
  if (!m) return `  ⚠️ ${EXE} --version printed nothing recognisable (exit ${v.status ?? 'null'})`;
  const same = m[1].split('.')[0] === chromeVersion.split('.')[0];
  return (
    `  ChromeDriver ${m[1]} vs Chrome ${chromeVersion} — major ${same ? 'MATCHES' : 'DIFFERS'}` +
    (same
      ? ' (the patch levels differ and that is expected: Chrome-for-Testing does not publish a build per Chrome patch)'
      : ' — the session handshake will fail; this is the state the capture cannot start in')
  );
}

// Importable for tests without installing anything.
if (!process.env.NIKATRU_LOCAL_CHROMEDRIVER_IMPORT_ONLY) await main();
