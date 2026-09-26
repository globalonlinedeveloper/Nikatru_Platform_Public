#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// rehearse-capture-locally.mjs — run `.github/workflows/store-screenshots.yml`'s
// capture job ON THIS LAPTOP, with the same scripts, the same env var NAMES and
// the same order, so a change to the capture is proven here before it is ever
// dispatched.
//
// ── 🔴 WHY THIS EXISTS — THE OWNER'S RULING OF 2026-09-20 ───────────────────
// store-screenshots.yml failed three dispatches in a row (35483690951,
// 35488534460 and one before) on causes that were only visible IN CI: a missing
// TURNSTILE_SITE_KEY, a benign framework exception the runner could not
// classify, and before them a capture that wrote frames a failed run then threw
// away. Each fix cost a dispatch to test, and each dispatch cost minutes and
// usage. The ruling: a change must pass LOCALLY TWICE before it is pushed, and
// a lane that cannot run locally must not be dispatched once per fix.
//
// This lane could not run locally for exactly two reasons, and neither was
// about the capture:
//   1. chromedriver was not installed and not on PATH, so the capture's own
//      probe refused. → tooling/store/local-chromedriver.mjs.
//   2. the vault held no SUPABASE_SERVICE_ROLE_KEY, so no throwaway account
//      could be provisioned. → it is now there, under the name CI uses, read
//      from the Supabase MANAGEMENT API with the SUPABASE_PAT the vault
//      already held. Read docs/ci/store-screenshots.md § How to rehearse
//      locally for what was added and how.
//
// ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
// ⚠️ IT IS NOT A SECOND IMPLEMENTATION OF THE CAPTURE. Every step below shells
// out to the SAME script the workflow runs — provision_user.mjs, then
// capture-play-screenshots.mjs, then purge.mjs — and its only job is to put the
// same environment in front of them. A rehearsal that re-implemented any of
// them would pass while CI failed, which is the failure it exists to prevent.
//
// ⚠️ NOR IS IT A SUBSTITUTE FOR THE DISPATCH. It runs on Windows against a
// Windows Chrome; CI runs ubuntu-24.04 against a Linux Chrome. The differences
// that remain are listed in the doc and are not talked away here.
//
// ── WHAT "TWICE, GREEN" MEANS ───────────────────────────────────────────────
// Run this command, read EXIT 0, run it AGAIN, read EXIT 0. It is not a `--twice`
// flag on purpose: each invocation provisions its OWN throwaway account and
// purges it in a `finally`, so two invocations are two independent runs against
// two accounts — which is the property being proven. One process looping twice
// would share a chromedriver, a resolved pub cache and a warm browser profile,
// and would prove less while looking like more.
//
// Usage:
//   node tooling/store/rehearse-capture-locally.mjs                  # the live rehearsal
//   node tooling/store/rehearse-capture-locally.mjs --app <id>
//   node tooling/store/rehearse-capture-locally.mjs --keep-user      # skip the purge (diagnosis only)
//   node tooling/store/rehearse-capture-locally.mjs --print-plan     # resolve everything, run nothing
//
// Exit 0 = the capture produced every set and exited 0, and the account was purged.
// Exit 1 = something refused; the first line names it.
// Exit 2 = the run could not be SET UP (no vault, no repo variable, no chromedriver)
//          — deliberately not 1, so "I could not rehearse" is never read as
//          "I rehearsed and the capture is broken".
//
// 🔴 NOTHING HERE PRINTS A CREDENTIAL. Every resolved value is reported as a
// name, a length and a short sha256, which is enough to tell two keys apart and
// not enough to use one. The one exception is the throwaway account's ADDRESS,
// which is printed so the purge can be checked by hand — the password never is.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { sandboxBackend, CaptureBackendRefused } from './capture-backend.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(HERE, '..', '..'));

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : dflt;
};
const APP = arg('--app', 'subscriptiontracker');
const KEEP_USER = has('--keep-user');
const PRINT_PLAN = has('--print-plan');

const sha8 = (v) => createHash('sha256').update(String(v)).digest('hex').slice(0, 8);
const shape = (name, v) => `${name.padEnd(26)} len=${String(v).length} sha256:8=${sha8(v)}`;

/** Exit 2, not 1. See the header: a setup that never ran is not a capture that failed. */
const cannotSetUp = (lines) => {
  console.error(`rehearse-capture-locally: CANNOT SET UP — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(2);
};
const refuse = (lines) => {
  console.error(`rehearse-capture-locally: REFUSING — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

// ── 1. the vault ────────────────────────────────────────────────────────────
// 🔴 RESOLVED FROM THE MAIN CHECKOUT, NOT FROM `ROOT`. This is normally run from
// a git worktree, and a worktree has no gitignored `.claude/` — the same reason
// the pre-commit spec-guard runner resolves it through `--git-common-dir`
// (AGENTS.md § How I want Claude to work here). Resolving it relative to ROOT
// would make the rehearsal refuse in exactly the place the work is done.
function vaultPath() {
  const g = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const commonDir = (g.stdout ?? '').trim();
  if (g.status !== 0 || !commonDir) {
    cannotSetUp([
      'git could not name the common git directory, so the vault could not be located.',
      `git rev-parse exited ${g.status ?? 'null'} in ${ROOT}.`,
    ]);
  }
  // `<main checkout>/.git` → `<main checkout>`; a bare or unusual layout is not
  // guessed at, it is reported.
  const mainCheckout = commonDir.replace(/\/?\.git\/?$/, '');
  const p = join(mainCheckout, '.claude', 'secrets.env');
  if (!existsSync(p)) {
    cannotSetUp([
      `the credential vault is not at ${p}.`,
      'It is `.claude/secrets.env` in the MAIN checkout — `.claude/` is gitignored in full, so no worktree',
      'has its own copy. If the main checkout has moved, this is the line that finds it.',
    ]);
  }
  return p;
}

/** 🔴 PARSED ON THE FIRST `=` ONLY, AND NEVER BY SPLITTING THE LINE. The vault
 *  holds free-form pasted notes with no `=` at all as well as values that
 *  contain one; a reader that split on every `=` has already printed a live
 *  value whole into a transcript. A line that does not match the shape
 *  `NAME=…` is not a key and is skipped in silence. */
function readVault(path) {
  const map = new Map();
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) map.set(m[1], m[2].trim().replace(/^["']|["']$/g, ''));
  }
  return map;
}

// ── 2. the three the workflow's own preflight demands ───────────────────────
// Same three names, same fail-closed behaviour, same stated reason. A capture
// missing any of them is a DEMO build — every screen banded "Demo data" and the
// board twelve third-party trademarks — which is a failed run, not a skipped one.
// API_BASE_URL was the fourth until 2026-09-25: the capture now computes the
// sandbox API host itself (tooling/store/capture-backend.mjs) and REFUSES a run
// whose environment sets one, so it is neither read from the vault nor passed.
const REQUIRED_FROM_VAULT = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

/** The repository VARIABLE, read from the repository — the same source
 *  `vars.TURNSTILE_SITE_KEY` is, rather than a second copy in the vault that
 *  could drift from what CI and the shipping web build use. A Turnstile SITE
 *  key is public by construction (it ships inside every web bundle); the secret
 *  half never leaves the auth box, and nothing here can read it. */
function turnstileSiteKey() {
  if (process.env.TURNSTILE_SITE_KEY) return { value: process.env.TURNSTILE_SITE_KEY, from: 'the environment' };
  const slug = spawnSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const repo = (slug.stdout ?? '').trim();
  if (!repo) {
    cannotSetUp([
      'the repository could not be named, so the TURNSTILE_SITE_KEY repository variable could not be read.',
      '`gh repo view` must work here. Set TURNSTILE_SITE_KEY in the environment to bypass this lookup.',
    ]);
  }
  const g = spawnSync('gh', ['variable', 'get', 'TURNSTILE_SITE_KEY', '--repo', repo], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const v = (g.stdout ?? '').trim();
  if (g.status !== 0 || !v) {
    cannotSetUp([
      `the repository variable TURNSTILE_SITE_KEY could not be read from ${repo} (gh exited ${g.status ?? 'null'}).`,
      'Without it the capture refuses: AppConfig.isTurnstileConfigured would be false, TurnstileGate.posture',
      '`misconfigured`, and the run would photograph an app driven through an auth posture the shipping web',
      'build does not have — which is the second of the two exceptions run 35488534460 failed on.',
      'It is a VARIABLE, not a secret. Settings → Secrets and variables → Actions → Variables.',
    ]);
  }
  return { value: v, from: `the ${repo} repository variable (same source as vars.TURNSTILE_SITE_KEY)` };
}

// ── 3. chrome and chromedriver ──────────────────────────────────────────────
function chromeExecutable() {
  if (process.env.CHROME_EXECUTABLE && existsSync(process.env.CHROME_EXECUTABLE)) {
    return process.env.CHROME_EXECUTABLE;
  }
  if (process.platform === 'win32') {
    for (const base of [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]) {
      if (!base) continue;
      const p = join(base, 'Google', 'Chrome', 'Application', 'chrome.exe');
      if (existsSync(p)) return p;
    }
    return null;
  }
  for (const c of ['google-chrome', 'google-chrome-stable', 'chromium-browser']) {
    const w = spawnSync('which', [c], { encoding: 'utf8' });
    const p = (w.stdout ?? '').trim();
    if (p && existsSync(p)) return p;
  }
  return null;
}

// ── 3b. the flutter SDK, AT THE PIN ─────────────────────────────────────────
// 🔴 THE LAPTOP'S OWN `flutter` IS NOT GOOD ENOUGH, AND THAT IS MEASURED, NOT
// FUSSY. `tooling/versions.json` pins the SDK and `pubspec.lock` was regenerated
// ON THAT PIN; the machine's own Flutter was 3.44.9 on 2026-09-20 and
// `flutter pub get --enforce-lockfile` REFUSED under it —
//
//   Would change 7 dependencies …
//   Unable to satisfy `..\..\pubspec.yaml` using `..\..\pubspec.lock`
//
// — which is exactly the seven SDK-constrained packages versions.json names
// (intl, matcher, meta, test, test_api, test_core, vector_math). Dropping the
// flag is NOT the workaround: a plain `pub get` on the OLD SDK writes the OLD
// pins back into the lockfile, which versions.json forbids in capitals because
// twelve release lanes enforce that lock on merge, on tag and on every store
// submission. So a rehearsal on the wrong SDK either cannot start or damages the
// tree, and neither is a rehearsal.
//
// ⚠️ NOTHING GLOBAL. The pinned SDK is expected in its own directory beside the
// chromedriver this file installs, and the machine's `flutter` is left exactly
// where it is — other lanes are driving it at the same time.
function pinnedFlutterVersion() {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'tooling', 'versions.json'), 'utf8')).flutter ?? null;
  } catch {
    return null;
  }
}

function flutterExe() {
  const pin = pinnedFlutterVersion();
  if (!pin) {
    cannotSetUp(['tooling/versions.json declares no `flutter` pin, so no SDK version can be required.']);
  }
  const bat = process.platform === 'win32' ? 'flutter.bat' : 'flutter';

  if (process.env.NIKATRU_FLUTTER && existsSync(process.env.NIKATRU_FLUTTER)) {
    return { path: process.env.NIKATRU_FLUTTER, pin, from: 'NIKATRU_FLUTTER' };
  }
  const isolated = join(
    process.platform === 'win32' ? process.env.LOCALAPPDATA ?? '' : join(process.env.HOME ?? '', '.local', 'share'),
    'nikatru',
    'flutter',
    pin,
    'flutter',
    'bin',
    bat,
  );
  if (existsSync(isolated)) return { path: isolated, pin, from: `the pinned SDK at ${isolated}` };

  // Only if the one on PATH IS the pin. A version check, not a hope.
  const v = spawnSync('flutter', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
  const m = /Flutter\s+([0-9]+\.[0-9]+\.[0-9]+)/.exec(v.stdout ?? '');
  if (m && m[1] === pin) return { path: 'flutter', pin, from: `PATH (already ${pin})` };

  cannotSetUp([
    `this rehearsal needs Flutter ${pin} — the version tooling/versions.json pins and pubspec.lock was ` +
      `resolved on — and ${m ? `the flutter on PATH is ${m[1]}` : 'no flutter could be version-checked on PATH'}.`,
    `It is NOT installed at ${isolated} either.`,
    '',
    'Why the version matters here and nowhere else in a local session: `flutter pub get --enforce-lockfile`',
    'refuses under an older SDK (seven SDK-constrained packages move), and running `pub get` WITHOUT the',
    'flag on an older SDK writes the OLD pins back into pubspec.lock — which twelve release lanes then',
    'enforce on merge, on tag and on every store submission. See tooling/versions.json, the 2026-08-28 note.',
    '',
    `REMEDY: install ${pin} into ${isolated.replace(/[\\/]flutter[\\/]bin[\\/].*$/, '')} (or point NIKATRU_FLUTTER at`,
    'an existing one). docs/ci/store-screenshots.md § How to rehearse locally carries the exact commands and',
    'the sha256 Google publishes for the archive.',
  ]);
}

function chromedriver() {
  if (process.env.CHROMEDRIVER && existsSync(process.env.CHROMEDRIVER)) {
    return { path: process.env.CHROMEDRIVER, from: 'CHROMEDRIVER' };
  }
  // The installer is idempotent: an already-installed matching driver is a
  // no-op that prints its path. CI does this with nanasess/setup-chromedriver,
  // which is Linux-only — that gap is the whole reason this file exists.
  const r = spawnSync(process.execPath, [join(HERE, 'local-chromedriver.mjs'), '--print-path'], {
    encoding: 'utf8',
  });
  const p = (r.stdout ?? '').trim();
  if (r.status !== 0 || !p || !existsSync(p)) {
    cannotSetUp([
      'no chromedriver could be resolved or installed.',
      (r.stderr ?? '').trim() || '(local-chromedriver.mjs printed nothing on stderr)',
    ]);
  }
  return { path: p, from: 'tooling/store/local-chromedriver.mjs' };
}

// ── the plan ────────────────────────────────────────────────────────────────
const vault = readVault(vaultPath());
const missing = REQUIRED_FROM_VAULT.filter((k) => !vault.get(k));
if (missing.length) {
  cannotSetUp([
    `the vault holds no ${missing.join(', ')}.`,
    'These are the THREE names store-screenshots.yml\'s own preflight demands, and it fails closed on them',
    'for a reason worth repeating: without them the app builds in DEMO posture, every screen carries the',
    '"Demo data — sample subscriptions, not your account" banner and the board is twelve third-party',
    'trademarks. That is a store filing nobody can ship, so an absent key is a failed rehearsal rather',
    'than a skipped one.',
    '',
    'docs/ci/store-screenshots.md § How to rehearse locally says where each one legitimately comes from.',
  ]);
}

const turnstile = turnstileSiteKey();
const flutter = flutterExe();
const driver = chromedriver();
const chrome = chromeExecutable();
if (!chrome) {
  cannotSetUp([
    'Chrome could not be located, and `flutter drive --browser-name=chrome` needs it.',
    'Set CHROME_EXECUTABLE to the browser this rehearsal should drive.',
  ]);
}

// The sandbox backend the capture drives and whose databases the purge below
// targets, read from the two wrangler.jsonc `env.sandbox` blocks. A refusal
// here is the one the capture itself would make, found before a throwaway user
// is provisioned.
let SANDBOX;
try {
  SANDBOX = sandboxBackend();
} catch (e) {
  if (!(e instanceof CaptureBackendRefused)) throw e;
  refuse([`the capture backend was refused on limb ${e.limb}.`, e.message]);
}

console.log('── the rehearsal, resolved ────────────────────────────────────────');
console.log(`app                        ${APP}`);
console.log(`vault                      ${vaultPath()}`);
for (const k of REQUIRED_FROM_VAULT) console.log(`  ${shape(k, vault.get(k))}`);
console.log(`  ${shape('TURNSTILE_SITE_KEY', turnstile.value)}  ← ${turnstile.from}`);
console.log(`flutter                    ${flutter.path}  (pin ${flutter.pin}, from ${flutter.from})`);
console.log(`chromedriver               ${driver.path}  (${driver.from})`);
console.log(`CHROME_EXECUTABLE          ${chrome}`);
console.log(`sandbox API                ${SANDBOX['subscriptiontracker-api'].sandboxHost}`);
console.log(`sandbox platform           ${SANDBOX.platform.sandboxHost}`);
console.log('');

if (PRINT_PLAN) {
  console.log('--print-plan: everything resolved, nothing run.');
  process.exit(0);
}

// 🔴 THE PINNED SDK GOES ON THE FRONT OF `PATH`, IT IS NOT PASSED AS A FLAG.
// `capture-play-screenshots.mjs` spawns the bare name `flutter` — correctly, it
// is the name CI has — so the only way to make the capture drive the PIN without
// editing it is to put the pin's `bin` first on the PATH the child inherits.
// Machine-wide nothing changes: this env lives for the length of this process
// and the laptop's own flutter stays exactly where it is.
const pinBin = flutter.path === 'flutter' ? null : dirname(flutter.path);
const baseEnv = {
  ...process.env,
  ...(pinBin ? { PATH: `${pinBin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}` } : {}),
  SUPABASE_URL: vault.get('SUPABASE_URL'),
  SUPABASE_ANON_KEY: vault.get('SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: vault.get('SUPABASE_SERVICE_ROLE_KEY'),
  TURNSTILE_SITE_KEY: turnstile.value,
  CHROMEDRIVER: driver.path,
  CHROME_EXECUTABLE: chrome,
};

/** 🔴 `::add-mask::<value>` IS A MASKING INSTRUCTION ONLY INSIDE GITHUB ACTIONS.
 *  `tooling/e2e/provision_user.mjs` prints two of them — the generated password
 *  and the single-use magic-link token — because in CI the runner reads that
 *  line and redacts the value from every subsequent log line. NOTHING reads it
 *  here, so on a laptop those two lines are the password and the token IN
 *  CLEAR, on stdout, into whatever file the run was redirected to. Measured on
 *  this machine's first rehearsal, 2026-09-20.
 *
 *  ⚠️ IT IS FIXED ON THIS SIDE ON PURPOSE. The provisioner is CI's script and
 *  its behaviour there is correct; changing it to suit a local caller would
 *  weaken the masking CI depends on. So the local caller honours the directive
 *  instead: it reads the values the child declared secret and redacts them from
 *  everything it prints, which is what the runner would have done. */
function maskingWriter(out) {
  const secrets = new Set();
  let tail = '';
  return (chunk) => {
    tail += chunk;
    const lines = tail.split(/\r?\n/);
    tail = lines.pop() ?? '';
    for (const line of lines) {
      const m = /^::add-mask::(.+)$/.exec(line);
      if (m) {
        secrets.add(m[1]);
        out.write('::add-mask::<redacted by the local rehearsal>\n');
        continue;
      }
      let safe = line;
      for (const s of secrets) safe = safe.split(s).join('<redacted>');
      out.write(`${safe}\n`);
    }
  };
}

const step = (name, cmd, args, env, opts = {}) => {
  console.log(`── ${name}`);
  const t0 = Date.now();
  // `mask: true` swaps stdio inheritance for a pipe so the child's output can be
  // filtered before it reaches this process's stdout. Everything else keeps
  // `inherit`, because a piped `flutter drive` would lose its live progress and
  // its interleaving with stderr — and its own output is already redacted by
  // capture-play-screenshots.mjs's define mapper.
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    stdio: opts.mask ? ['ignore', 'pipe', 'pipe'] : (opts.stdio ?? 'inherit'),
    encoding: 'utf8',
    env,
    shell: opts.shell ?? false,
  });
  if (opts.mask) {
    const write = maskingWriter(process.stdout);
    write(`${r.stdout ?? ''}\n`);
    const err = maskingWriter(process.stderr);
    err(`${r.stderr ?? ''}\n`);
  }
  const code = r.status ?? 1;
  console.log(`   ${name}: exit ${code} after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { code, r };
};

// ── 3c. THE PATH IS PROVEN, NOT ASSUMED ─────────────────────────────────────
// Everything below spawns the bare name `flutter` through `baseEnv`. If the
// prepend above did not take — a quoting change, a PATH already carrying another
// Flutter's bin, an env the shell rewrote — the whole rehearsal would silently
// run on the wrong SDK and still print ok, which is precisely the class of
// failure this file exists to stop. So the resolved name is asked its version,
// through the same env the children get.
{
  const v = spawnSync('flutter', ['--version'], {
    encoding: 'utf8',
    env: baseEnv,
    shell: process.platform === 'win32',
  });
  const m = /Flutter\s+([0-9]+\.[0-9]+\.[0-9]+)/.exec(v.stdout ?? '');
  if (!m || m[1] !== flutter.pin) {
    cannotSetUp([
      `the \`flutter\` the children will resolve reports ${m ? m[1] : '(no readable version)'}, not the pin ${flutter.pin}.`,
      `PATH was prefixed with ${pinBin ?? '(nothing — the PATH flutter was already the pin)'}.`,
      'Nothing was run. A rehearsal on an unpinned SDK proves the wrong thing and can write the wrong pins.',
    ]);
  }
  console.log(`── flutter on the children's PATH: ${m[1]} — the pin`);
  console.log('');
}

// ── 4. flutter pub get, the way the workflow does it ────────────────────────
// `--enforce-lockfile` REFUSES to change the lockfile rather than silently
// re-resolving it, which is the only form of `pub get` this repo allows outside
// a deliberate bump — AGENTS.md § Git: a flutter command in a subdirectory
// rewrites the root pubspec.lock and `git add -A` then commits an unreviewed
// pin change. With the flag there is nothing to commit or refuse silently.
const appDir = join(ROOT, 'apps', APP);
{
  // The BARE NAME, resolved through the PATH assembled above — the same way the
  // capture resolves it. Calling the absolute path here and letting the capture
  // resolve a name would be two ways of choosing an SDK, and the day they
  // disagreed the pub get and the drive would run on different Flutters.
  const { code } = step('flutter pub get --enforce-lockfile', 'flutter', ['pub', 'get', '--enforce-lockfile'], baseEnv, {
    cwd: appDir,
    shell: process.platform === 'win32', // flutter is flutter.bat here; see the capture's own note
  });
  if (code !== 0) {
    refuse([
      `flutter pub get --enforce-lockfile exited ${code}.`,
      'The lockfile and the pubspec disagree, so the rehearsal would build a different dependency set from',
      'the one CI builds — which makes anything it proves about the capture unreliable. Resolve the pins',
      'first; do NOT drop the flag: a plain `pub get` on a non-pinned SDK writes the old pins back.',
    ]);
  }
  restoreAnalysisOptions();
}

/** 🔴 EVERY `flutter pub get` ON THIS PIN REWRITES `analysis_options.yaml`, AND
 *  COMMITTING THAT REWRITE FAILS A GUARD. Measured 2026-08-28 and written into
 *  tooling/versions.json: 3.47 appends an `analyzer: exclude:` block for build/
 *  and the platform directories to every one of them — nine files in this
 *  workspace — and `assert-no-gate-weakening.mjs` fails the result, because an
 *  excluded path is not analysed at all. CI never notices: there the pub get and
 *  the guard run in different jobs on different runners.
 *
 *  Locally they are the same tree, so the rehearsal undoes its own side effect
 *  HERE rather than leaving it for whoever runs `git add -A` next. It reverts
 *  ONLY files git reports as modified AND named analysis_options.yaml — never a
 *  blanket checkout, which would silently discard the lane's real work. */
function restoreAnalysisOptions() {
  // No pathspec: git's own glob rules differ enough between versions and shells
  // to make `*analysis_options.yaml` a thing that silently matches nothing. The
  // filter below is done here, where it is readable and certain.
  const s = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  // Porcelain v1 is `XY<space>path`; both columns are read because a rewrite can
  // land staged or unstaged depending on what else the session has done.
  const dirty = (s.stdout ?? '')
    .split(/\r?\n/)
    .filter((l) => l.length > 3 && (l[0] === 'M' || l[1] === 'M'))
    .map((l) => l.slice(3).replace(/^"|"$/g, ''))
    .filter((p) => p.endsWith('analysis_options.yaml'));
  if (!dirty.length) return;
  const r = spawnSync('git', ['checkout', '--', ...dirty], { cwd: ROOT, encoding: 'utf8' });
  console.log(
    `   reverted ${dirty.length} analysis_options.yaml rewritten by pub get (exit ${r.status ?? 'null'}) — ` +
      'see tooling/versions.json, "ONE THING 3.47 DOES THAT YOU MUST NOT COMMIT"',
  );
}

// ── 5. provision, capture, purge ────────────────────────────────────────────
// 🔴 GITHUB_OUTPUT IS SET TO A LOCAL FILE ON PURPOSE. provision_user.mjs writes
// its four outputs there and REFUSES if it is unset, because in CI that file is
// the only channel back to the job. Pointing it at a temp file is what makes the
// unmodified CI script runnable here — the alternative was a local fork of the
// provisioner, which is precisely the second implementation this file refuses to
// become. `CI` itself is NEVER set: this is not a CI run and nothing downstream
// should believe it is.
const scratch = mkdtempSync(join(tmpdir(), 'nk-rehearse-'));
const outFile = join(scratch, 'github-output.txt');
writeFileSync(outFile, '', 'utf8');

// [pipeline B-17, 2026-09-23] THE STAMP AND THE CONSENT LEDGER. The capture
// writes consent rows to PRODUCTION platform_db, and it REFUSES a live run that
// carries neither an APP_VERSION stamp nor a ledger for the purge to read.
// Outside Actions the only stamp tooling/e2e/app-version-stamp.mjs accepts is
// `rehearsal-<10-digit epoch>`: unique per invocation, and deliberately one the
// production provenance monitor refuses, so a rehearsal row the purge below
// misses stays red instead of passing as a CI run's. The ledger lives in
// `scratch`, which is removed only after the purge has read it.
const rehearsalStamp = `rehearsal-${Math.floor(Date.now() / 1000)}`;
const consentLedger = join(scratch, 'store-capture-consent.json');

let provisioned = null;
let captureCode = 1;
try {
  const { code } = step(
    'provision throwaway confirmed user',
    process.execPath,
    [join(ROOT, 'tooling', 'e2e', 'provision_user.mjs')],
    { ...baseEnv, GITHUB_OUTPUT: outFile },
    // See maskingWriter: this is the one step that prints `::add-mask::` lines,
    // which are a no-op outside GitHub Actions and would otherwise put the
    // generated password and the magic-link token in clear into this log.
    { mask: true },
  );
  if (code !== 0) {
    refuse([
      `tooling/e2e/provision_user.mjs exited ${code}, so there is no account to capture with.`,
      'This is the step the vault\'s SUPABASE_SERVICE_ROLE_KEY exists for. Read its output above: a 401 is a',
      'key problem, a 4xx from GoTrue is an account problem.',
    ]);
  }
  const outputs = new Map(
    readFileSync(outFile, 'utf8')
      .split(/\r?\n/)
      .map((l) => /^([a-z_]+)=([\s\S]*)$/.exec(l))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
  provisioned = { email: outputs.get('email'), password: outputs.get('password'), userId: outputs.get('user_id') };
  // 🔴 THROWN, NOT `refuse()`d. `refuse` calls process.exit, and process.exit
  // does not run a `finally` — so exiting here would skip the purge below with
  // a user already created in PRODUCTION Supabase. Anything after the account
  // exists has to leave by the path that cleans up.
  if (!provisioned.email || !provisioned.password || !provisioned.userId) {
    throw new Error(
      'the provisioner exited 0 but did not write email, password and user_id. ' +
        `keys written: ${[...outputs.keys()].join(', ') || '(none)'}`,
    );
  }
  // The ADDRESS, never the password — see the header. It is printed because the
  // purge below has to be checkable by hand if this process is killed.
  console.log(`   account: ${provisioned.email} (id ${provisioned.userId})`);
  console.log('');

  // ── the capture, invoked exactly as the workflow invokes it ───────────────
  const { code: cc } = step(
    'capture the set',
    process.execPath,
    [join(ROOT, 'tooling', 'store', 'capture-play-screenshots.mjs'), '--app', APP],
    {
      ...baseEnv,
      E2E_EMAIL: provisioned.email,
      E2E_PASSWORD: provisioned.password,
      STORE_CAPTURE_APP_VERSION: rehearsalStamp,
      E2E_CONSENT_LEDGER: consentLedger,
    },
  );
  captureCode = cc;
  // `flutter drive` runs its own implicit pub get, so the analysis_options
  // rewrite lands a second time — after the capture, not only after the
  // explicit pub get above.
  restoreAnalysisOptions();
} catch (e) {
  // Printed here and NOT rethrown, so the purge in `finally` still runs and this
  // process still exits with the capture's own code rather than an unhandled
  // rejection's 1-with-a-stack.
  console.error('');
  console.error(`rehearse-capture-locally: REFUSING — ${e.message}`);
  captureCode = 1;
} finally {
  // `always()`, for the same reason the workflow's purge step carries it: this
  // provisions a REAL confirmed user in PRODUCTION Supabase, and a failed run
  // that skipped its cleanup leaves that account behind.
  if (provisioned && !KEEP_USER) {
    console.log('');
    const { code } = step('purge the throwaway user', process.execPath, [join(ROOT, 'tooling', 'e2e', 'purge.mjs')], {
      ...baseEnv,
      E2E_USER_ID: provisioned.userId,
      CLOUDFLARE_ACCOUNT_ID: vault.get('CLOUDFLARE_ACCOUNT_ID') ?? '',
      CLOUDFLARE_API_TOKEN: vault.get('CLOUDFLARE_API_TOKEN') ?? '',
      // The SANDBOX databases the capture wrote into. The consent rows are in
      // platform_db_sandbox, read from its wrangler.jsonc `env.sandbox` block by
      // sandboxBackend(); a database id is not a credential. The seeded
      // subscriptions are in the app's sandbox APP_DB, which purge.mjs resolves
      // itself from E2E_APP_ID (tooling/e2e/backend.mjs, the `env.sandbox` block
      // because a ledger is set). With the ledger the capture wrote, purge.mjs
      // deletes by every drive's install id and by the rehearsal stamp, and it
      // refuses a production id beside a ledger.
      PLATFORM_D1_DATABASE_ID: SANDBOX.platform.sandboxIds['d1:PLATFORM_DB'],
      E2E_APP_ID: APP,
      E2E_CONSENT_LEDGER: consentLedger,
    });
    if (code !== 0) {
      console.error('');
      console.error(`⚠️ THE PURGE EXITED ${code}. The throwaway account ${provisioned.email} (id ${provisioned.userId})`);
      console.error('   may still exist in PRODUCTION Supabase. Delete it before running this again; a rehearsal');
      console.error('   that leaves accounts behind turns into a directory of them.');
    }
  } else if (provisioned && KEEP_USER) {
    console.log('');
    console.log(`⚠️ --keep-user: ${provisioned.email} (id ${provisioned.userId}) was NOT purged. Purge it by hand.`);
  }
  rmSync(scratch, { recursive: true, force: true });
}

console.log('');
if (captureCode === 0) {
  console.log('rehearse-capture-locally: ok — one green run.');
  console.log('   "Twice, green" needs a SECOND invocation of this command, against a fresh account.');
} else {
  console.error(`rehearse-capture-locally: the capture exited ${captureCode}.`);
}
process.exit(captureCode);
