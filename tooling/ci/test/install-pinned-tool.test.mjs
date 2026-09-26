// ─────────────────────────────────────────────────────────────────────────────
// install-pinned-tool.test.mjs — one transient network failure must not turn
// main red, and no unverified byte may ever be installed.
//
// The defect this pins: on 2026-09-12 main's "Security — secret and workflow
// scanners" job went red on `wget -q -O … gitleaks_8.30.1_linux_x64.tar.gz`
// (exit 4, network). ci-gate then recorded main as not green and deploy-web
// REFUSED. One re-run fixed it. install-pinned-tool.mjs replaces that step's
// shell with a bounded retry and a checksum-verified cache.
//
//   P1 a download that fails once and then succeeds INSTALLS (the 09-12 failure)
//   P2 a download that never succeeds fails LOUDLY, naming every attempt
//   P3 a cache entry whose sha256 matches the pin skips the network entirely
//   P4 a cache entry whose sha256 does NOT match is discarded, not installed
//   P5 downloaded bytes whose sha256 is wrong are never handed back
//   P6 the retry is BOUNDED — attempts stop at the configured number
//   P7 no workflow step downloads one of these tools any other way
//   P8 a version reaching a URL is rebuilt out of integers; anything else refuses
//   P9 a digest is 64 lowercase hex characters or nothing is verified against it
//   P10 the REAL tooling/versions.json satisfies both
//   G1-G6 glitchtip-cli (⏱ 2026-09-25, O-GLITCHTIP-CLI-INSTALLED-BY-HAND): one entry,
//      three runner platforms, each its own digest, asset and file name; a platform
//      with no pin and a binary that names another version both REFUSE
//   RC1 a re-added glitchtip-cli curl install is refused by P7
//   RC2 a fifth TOOLS member is checked by its own URL (the old ternary mapped it away)
//   RC3 a wrong digest refuses on linux, win32 and darwin — fixture bytes, no network
//
// Mutations run against install-pinned-tool.mjs (predictions written first):
//   · `attempts = 1` forced (the retry loop runs once)              → P1, P6 RED
//   · the cache digest comparison made `if (true)`                  → P4 RED
//   · the post-download digest comparison deleted                   → P5 RED
//   · `throw new PinnedToolUnavailable` after the loop → `return`   → P2 RED
//   · ci.yml's gitleaks step restored to `wget -q -O`               → P7 RED
//   · safeVersion's body replaced by `return String(raw)`           → P8 RED
//     (widening only its regex does NOT: Number() is the barrier, and a
//      version carrying a path segment is NaN either way. Measured, not assumed.)
//
// Run:  node --test tooling/ci/test/install-pinned-tool.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  acquire,
  installPinnedTool,
  PinnedToolUnavailable,
  specFor,
  TOOLS,
  DEFAULT_ATTEMPTS,
  safeVersion,
  safeDigest,
  readVersions,
} from '../install-pinned-tool.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const WORKFLOWS = join(REPO, '.github', 'workflows');

const BYTES = 'the pinned bytes\n';
const DIGEST = createHash('sha256').update(BYTES).digest('hex');

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-pinned-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});
const workDir = () => {
  const d = join(TMP, `w${seq++}`);
  mkdirSync(d, { recursive: true });
  return d;
};

/** A downloader that fails `failFor` attempts and then writes the real bytes.
 *  Counts its calls, so "how many attempts happened" is measured, not assumed. */
function fakeDownload({ failFor = 0, body = BYTES } = {}) {
  const calls = [];
  const fn = ({ url, dest }) => {
    calls.push(url);
    if (calls.length <= failFor) return { ok: false, detail: 'curl exit 6: could not resolve host' };
    writeFileSync(dest, body);
    return { ok: true, detail: 'curl exit 0' };
  };
  fn.calls = calls;
  return fn;
}

const noSleep = () => {};

/** Each TOOLS member's FETCH STEM — the URL a hand install would have to spell, up to the
 *  version, with scheme and host dropped: `gitleaks/gitleaks/releases/download/`,
 *  `glitchtip/glitchtip-cli/-/jobs/artifacts/`. DERIVED from the member's own `url`, on
 *  every platform it pins, so no name is ever mapped onto another tool's host. */
function fetchStems(tools) {
  const stems = new Map();
  for (const [name, spec] of tools) {
    for (const p of spec.platforms ? Object.values(spec.platforms) : [undefined]) {
      const u = spec.url('0.0.0', p);
      const at = u.indexOf('0.0.0');
      if (at < 0) throw new Error(`${name}'s url does not carry its version, so no stem can be derived from it: ${u}`);
      stems.set(u.slice(0, at).replace(/v$/, '').replace(/^https?:\/\/[^/]+\//, ''), name);
    }
  }
  return stems;
}

/** Every non-comment workflow line that spells a member's fetch stem, as `file:line text`.
 *  No wget/curl pre-filter: a hand install puts its URL in a variable one line above the
 *  curl as often as not, and that pre-filter is how a URL line went unread. */
function handInstalls(tools, bodies) {
  const stems = [...fetchStems(tools).keys()];
  const offenders = [];
  for (const [file, body] of bodies) {
    body.split('\n').forEach((line, i) => {
      if (line.trimStart().startsWith('#')) return;
      if (stems.some((s) => line.includes(s))) offenders.push(`${file}:${i + 1} ${line.trim()}`);
    });
  }
  return offenders;
}

describe('install-pinned-tool — a transient failure retries, a real one stops the build', () => {
  test('P1 one failed attempt then a good one INSTALLS (the 2026-09-12 red)', () => {
    const dir = workDir();
    const download = fakeDownload({ failFor: 1 });
    const r = acquire({
      url: 'https://example.invalid/gitleaks.tar.gz',
      digest: DIGEST,
      workPath: join(dir, 'dl'),
      download,
      sleep: noSleep,
    });
    assert.equal(download.calls.length, 2, 'the second attempt must happen');
    assert.equal(r.attempts, 2);
    assert.equal(r.fromCache, false);
    assert.equal(readFileSync(r.path, 'utf8'), BYTES);
  });

  test('P2 a download that never succeeds fails loudly, naming every attempt', () => {
    const dir = workDir();
    const download = fakeDownload({ failFor: 99 });
    assert.throws(
      () =>
        acquire({
          url: 'https://example.invalid/gitleaks.tar.gz',
          digest: DIGEST,
          workPath: join(dir, 'dl'),
          download,
          sleep: noSleep,
        }),
      (e) => {
        assert.ok(e instanceof PinnedToolUnavailable, 'must be the named failure, not a stray TypeError');
        const text = e.lines.join('\n');
        assert.match(text, /failed on all 3 attempt\(s\)/);
        assert.match(text, /attempt 1: curl exit 6/);
        assert.match(text, /attempt 3: curl exit 6/);
        return true;
      },
    );
    assert.equal(download.calls.length, DEFAULT_ATTEMPTS);
  });

  test('P3 a cache entry matching the pin means NO network call at all', () => {
    const dir = workDir();
    const cache = join(dir, 'cache', 'gitleaks.tar.gz');
    mkdirSync(dirname(cache), { recursive: true });
    writeFileSync(cache, BYTES);
    const download = fakeDownload();
    const r = acquire({
      url: 'https://example.invalid/gitleaks.tar.gz',
      digest: DIGEST,
      cachePath: cache,
      workPath: join(dir, 'dl'),
      download,
      sleep: noSleep,
    });
    assert.equal(download.calls.length, 0, 'a verified cache entry must not be re-downloaded');
    assert.equal(r.fromCache, true);
    assert.equal(r.path, cache);
  });

  test('P4 a cache entry whose bytes are WRONG is discarded, never installed', () => {
    const dir = workDir();
    const cache = join(dir, 'cache', 'gitleaks.tar.gz');
    mkdirSync(dirname(cache), { recursive: true });
    writeFileSync(cache, 'bytes nobody pinned\n');
    const download = fakeDownload();
    const r = acquire({
      url: 'https://example.invalid/gitleaks.tar.gz',
      digest: DIGEST,
      cachePath: cache,
      workPath: join(dir, 'dl'),
      download,
      sleep: noSleep,
    });
    assert.equal(r.fromCache, false, 'the poisoned entry must not be trusted');
    assert.equal(download.calls.length, 1, 'it must fall through to the download');
    assert.equal(readFileSync(r.path, 'utf8'), BYTES);
    // and the good bytes replace it, so the next run is a hit again
    assert.equal(readFileSync(cache, 'utf8'), BYTES);
  });

  test('P5 downloaded bytes whose sha256 is wrong are never handed back', () => {
    const dir = workDir();
    const download = fakeDownload({ body: 'bytes nobody pinned\n' });
    assert.throws(
      () =>
        acquire({
          url: 'https://example.invalid/gitleaks.tar.gz',
          digest: DIGEST,
          workPath: join(dir, 'dl'),
          download,
          sleep: noSleep,
        }),
      (e) => {
        assert.match(e.lines.join('\n'), /sha256 [0-9a-f]{64}, expected /);
        return true;
      },
    );
    assert.equal(existsSync(join(dir, 'dl')), false, 'the wrong bytes must not be left on disk');
  });

  test('P6 the retry is BOUNDED — it stops at the configured number', () => {
    const dir = workDir();
    const download = fakeDownload({ failFor: 99 });
    assert.throws(() =>
      acquire({
        url: 'https://example.invalid/gitleaks.tar.gz',
        digest: DIGEST,
        workPath: join(dir, 'dl'),
        attempts: 2,
        download,
        sleep: noSleep,
      }),
    );
    assert.equal(download.calls.length, 2, 'a bound that does not bind is not a bound');
  });
});

describe('install-pinned-tool — no workflow may fetch these tools any other way', () => {
  // 🔴 THE RATCHET. Without this, the next hand to add a scanner writes the same
  // `wget -q -O` and the 2026-09-12 red comes back with nothing to notice it.
  // The check is over the REAL workflow set, so it cannot pass vacuously: it
  // asserts the installer is actually referenced before it judges anything.
  const files = readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml'));
  const bodies = new Map(files.map((f) => [f, readFileSync(join(WORKFLOWS, f), 'utf8')]));

  test('P7 every pinned-tool release URL is fetched through install-pinned-tool.mjs', () => {
    assert.ok(files.length > 5, `expected the real workflow set, found ${files.length} file(s)`);
    const installerUsers = [...bodies].filter(([, b]) => b.includes('install-pinned-tool.mjs')).map(([f]) => f);
    assert.ok(
      installerUsers.length > 0,
      'no workflow calls install-pinned-tool.mjs — the installer is dead code and this check is vacuous',
    );
    assert.ok(fetchStems(TOOLS).size >= TOOLS.size, 'a TOOLS member yielded no fetch stem, so it would be checked for nothing');
    const offenders = handInstalls(TOOLS, bodies);
    assert.deepEqual(
      offenders,
      [],
      `these steps fetch a pinned tool outside install-pinned-tool.mjs, so they have no retry and no cache:\n${offenders.join('\n')}`,
    );
  });

  // ⏱ RE-SCOPED 2026-09-25 (O-GLITCHTIP-CLI-INSTALLED-BY-HAND). It read "the four tools
  // this installer knows are the four ci.yml installs"; glitchtip-cli is a member no
  // ci.yml job runs, and a PR-time download of it for no reader was refused.
  test('P7b every tool this installer knows is installed through it by at least one workflow', () => {
    for (const name of TOOLS.keys()) {
      // A plain substring, not a built regex: the tool names are data, and a
      // regex assembled from data is a sanitiser question nobody should have to
      // answer to check that a step exists.
      const users = [...bodies].filter(([, b]) => b.includes(`install-pinned-tool.mjs ${name} --out`)).map(([f]) => f);
      assert.ok(users.length > 0, `no workflow installs ${name} through the installer — the TOOLS entry is dead`);
    }
    assert.ok(bodies.get('ci.yml')?.includes('install-pinned-tool.mjs gitleaks --out'), 'ci.yml must still install gitleaks through the installer');
  });

  // ⏱ ADDED 2026-09-25. Until then P7 mapped every name to a host through a ternary of
  // the first four, so a fifth member fell through to `google/osv-scanner` and was
  // checked for nothing (measured on the tree before this change: exit 0 with a planted
  // hand install of a fifth tool, and exit 0 with a re-added glitchtip-cli curl).
  test('RC2 a fifth TOOLS member is checked by the URL it declares, not mapped onto another', () => {
    const fifth = new Map([
      ...TOOLS,
      ['fake-tool', { versionKey: 'fake_tool', digestKey: 'fake_tool_sha256', url: (v) => `https://github.com/fake-org/fake-tool/releases/download/v${v}/fake-tool.tar.gz`, archive: 'tar.gz', member: 'fake-tool' }],
    ]);
    const planted = new Map([['x.yml', 'jobs:\n  a:\n    steps:\n      - run: curl -fsSL -o t.tgz https://github.com/fake-org/fake-tool/releases/download/v1.0.0/fake-tool.tar.gz\n']]);
    assert.deepEqual(handInstalls(fifth, planted), ['x.yml:4 - run: curl -fsSL -o t.tgz https://github.com/fake-org/fake-tool/releases/download/v1.0.0/fake-tool.tar.gz']);
    assert.deepEqual(handInstalls(TOOLS, planted), [], 'without the member, the same line is nobody\'s business here');
  });

  test('RC1 a re-added glitchtip-cli curl install in deploy-web.yml is refused, the URL on its own line', () => {
    const real = bodies.get('deploy-web.yml');
    assert.ok(real, 'deploy-web.yml must exist');
    const planted = new Map([[
      'deploy-web.yml',
      `${real}\n      - run: |\n          url="https://gitlab.com/glitchtip/glitchtip-cli/-/jobs/artifacts/v\${ver}/raw/artifacts/glitchtip-cli-linux-x86_64?job=build-linux-x86_64"\n          curl --fail --location --output "\${RUNNER_TEMP}/glitchtip-cli" "$url"\n`,
    ]]);
    const f = handInstalls(TOOLS, planted);
    assert.equal(f.length, 1, f.join('\n'));
    assert.match(f[0], /^deploy-web\.yml:\d+ url="https:\/\/gitlab\.com\/glitchtip\/glitchtip-cli\/-\/jobs\/artifacts\//);
  });
});

describe('install-pinned-tool — the pin is read strictly, because it reaches a URL', () => {
  test('P8 a version is rebuilt out of integers, and anything else refuses', () => {
    assert.equal(safeVersion('8.30.1', 'gitleaks'), '8.30.1');
    assert.equal(safeVersion('0.74.0', 'trivy'), '0.74.0');
    for (const bad of [
      '8.30.1/../../evil',
      '8.30.1?x=1',
      'v8.30.1',
      '8',
      '8.30.1.2.3',
      '8.30.x',
      '',
      null,
      undefined,
      '../../etc',
      '8.30.1 8.30.1',
    ]) {
      assert.throws(
        () => safeVersion(bad, 'gitleaks'),
        (e) => e instanceof PinnedToolUnavailable,
        `${JSON.stringify(bad)} must never reach a download URL`,
      );
    }
  });

  test('P9 a digest is 64 lowercase hex characters or nothing is verified against it', () => {
    const good = 'a'.repeat(64);
    assert.equal(safeDigest(good, 'gitleaks_sha256'), good);
    for (const bad of ['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), '', null, `${'a'.repeat(64)} `]) {
      assert.throws(() => safeDigest(bad, 'gitleaks_sha256'), (e) => e instanceof PinnedToolUnavailable, JSON.stringify(bad));
    }
  });

  test('P10 the real tooling/versions.json satisfies both — this is not a check about fixtures', () => {
    const versions = readVersions();
    for (const [name, spec] of TOOLS) {
      assert.equal(safeVersion(versions[spec.versionKey], spec.versionKey), versions[spec.versionKey], name);
      // A member with `platforms` pins one digest per runner platform, and each must read.
      for (const key of spec.platforms ? Object.values(spec.platforms).map((p) => p.digestKey) : [spec.digestKey]) {
        assert.equal(safeDigest(versions[key], key), versions[key], `${name} ${key}`);
      }
    }
  });
});

// ⏱ ADDED 2026-09-25 (O-GLITCHTIP-CLI-INSTALLED-BY-HAND) — glitchtip-cli, the member with
// one version and three sets of bytes. NO NETWORK: every case serves fixture bytes through
// `download`, and the binary's `--version` through `runVersion`, the installer's own seams.
describe('install-pinned-tool — glitchtip-cli, one entry and three runner platforms', () => {
  const OTHER = createHash('sha256').update('bytes nobody pinned\n').digest('hex');
  const pinned = (digest = DIGEST) => ({
    glitchtip_cli: '1.0.0',
    glitchtip_cli_sha256: digest,
    glitchtip_cli_windows_x86_64_sha256: digest,
    glitchtip_cli_macos_arm64_sha256: digest,
  });
  const reportsPin = () => 'glitchtip-cli 1.0.0';
  const install = ({ platform, versions = pinned(), runVersion = reportsPin }) => {
    const outDir = workDir();
    const download = fakeDownload();
    const r = installPinnedTool({ name: 'glitchtip-cli', outDir, versions, cacheDir: null, attempts: 2, download, sleep: noSleep, platform, runVersion });
    return { r, outDir, download };
  };

  test('G1 linux-x64 installs the linux asset against glitchtip_cli_sha256, as glitchtip-cli', () => {
    const { r, outDir, download } = install({ platform: 'linux-x64' });
    assert.deepEqual(download.calls, ['https://gitlab.com/glitchtip/glitchtip-cli/-/jobs/artifacts/v1.0.0/raw/artifacts/glitchtip-cli-linux-x86_64?job=build-linux-x86_64']);
    assert.equal(r.binary, join(outDir, 'glitchtip-cli'));
    assert.equal(readFileSync(r.binary, 'utf8'), BYTES);
    assert.equal(specFor('glitchtip-cli', 'linux-x64').digestKey, 'glitchtip_cli_sha256');
  });

  test('G2 win32-x64 installs the .exe asset against the windows digest, as glitchtip-cli.exe', () => {
    const { r, outDir, download } = install({ platform: 'win32-x64' });
    assert.deepEqual(download.calls, ['https://gitlab.com/glitchtip/glitchtip-cli/-/jobs/artifacts/v1.0.0/raw/artifacts/glitchtip-cli-windows-x86_64.exe?job=build-windows-x86_64']);
    assert.equal(r.binary, join(outDir, 'glitchtip-cli.exe'));
    assert.equal(specFor('glitchtip-cli', 'win32-x64').digestKey, 'glitchtip_cli_windows_x86_64_sha256');
  });

  test('G3 darwin-arm64 installs the macOS asset against the macOS digest', () => {
    const { r, outDir, download } = install({ platform: 'darwin-arm64' });
    assert.deepEqual(download.calls, ['https://gitlab.com/glitchtip/glitchtip-cli/-/jobs/artifacts/v1.0.0/raw/artifacts/glitchtip-cli-macos-arm64?job=build-macos-arm64']);
    assert.equal(r.binary, join(outDir, 'glitchtip-cli'));
    assert.equal(specFor('glitchtip-cli', 'darwin-arm64').digestKey, 'glitchtip_cli_macos_arm64_sha256');
  });

  test('G4 a runner platform with no pinned bytes REFUSES before any download', () => {
    const download = fakeDownload();
    assert.throws(
      () => installPinnedTool({ name: 'glitchtip-cli', outDir: workDir(), versions: pinned(), download, sleep: noSleep, platform: 'darwin-x64', runVersion: reportsPin }),
      (e) => e instanceof PinnedToolUnavailable && /no pinned bytes for this runner \(darwin-x64\)/.test(e.lines.join('\n')),
    );
    assert.equal(download.calls.length, 0);
  });

  test('G5 bytes that match the digest but name another version REFUSE', () => {
    assert.throws(
      () => install({ platform: 'linux-x64', runVersion: () => 'glitchtip-cli 0.9.0' }),
      (e) => e instanceof PinnedToolUnavailable && /reports "glitchtip-cli 0\.9\.0", not "glitchtip-cli 1\.0\.0"/.test(e.lines.join('\n')),
    );
  });

  test('G6 a binary that cannot report its version at all REFUSES', () => {
    assert.throws(
      () => install({ platform: 'win32-x64', runVersion: () => null }),
      (e) => e instanceof PinnedToolUnavailable && /reports null, not "glitchtip-cli 1\.0\.0"/.test(e.lines.join('\n')),
    );
  });

  test('RC3 linux: a wrong digest in versions.json refuses — the fixture bytes are never installed', () => {
    assert.throws(
      () => install({ platform: 'linux-x64', versions: pinned(OTHER) }),
      (e) => e instanceof PinnedToolUnavailable && /failed on all 2 attempt\(s\)/.test(e.lines.join('\n')) && e.lines.some((l) => l.includes(`expected ${OTHER}`)),
    );
  });

  test('RC3 win32: a wrong digest in versions.json refuses', () => {
    assert.throws(
      () => install({ platform: 'win32-x64', versions: pinned(OTHER) }),
      (e) => e instanceof PinnedToolUnavailable && e.lines.some((l) => l.includes(`expected ${OTHER}`)),
    );
  });

  test('RC3 darwin: a wrong digest in versions.json refuses', () => {
    assert.throws(
      () => install({ platform: 'darwin-arm64', versions: pinned(OTHER) }),
      (e) => e instanceof PinnedToolUnavailable && e.lines.some((l) => l.includes(`expected ${OTHER}`)),
    );
  });
});
