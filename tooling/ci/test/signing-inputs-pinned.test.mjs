// ─────────────────────────────────────────────────────────────────────────────
// signing-inputs-pinned.test.mjs — assert-signing-inputs-pinned.mjs refuses an
// unchecked download in a job that holds a signing key (rv2-security-003).
//
//   S0  the control: a COPY OF THE REAL TREE passes, with the Flutter install
//       counted as verified and the wrapper counted
//   D1  a signing job with a bare `curl -o` download -> exit 1, naming the step
//   D2  the same download followed by `sha256sum --check` -> exit 0
//   D3  `curl … | bash` -> exit 1 even with a check after it
//   D4  the same bare download in a job that holds NO signing secret -> exit 0
//   G1  a signing job that builds an apk, wrapper without distributionSha256Sum -> exit 1
//   G2  the same wrapper with a 64-hex sum -> exit 0
//   C1  no signing secret in the register -> exit 2
//   C2  signing secrets no job reads -> exit 2 (zero signing jobs placed)
//   C3  a signing job that builds Android and no wrapper in the tree -> exit 2
//   C4  a composite a signing job calls is not on disk -> exit 2
//   R*  the REAL tree, mutated one way at a time (each anchor asserted to exist
//       exactly once first, so a moved anchor fails loudly instead of passing):
//       R1 the real wrapper loses distributionSha256Sum
//       R2 the composite's sha256 check is stripped
//       R3 subosito's cache is handed back to `${{ inputs.cache }}`
//       R4 subosito's cache-path no longer names the verifying step
//       R5 the check is moved AFTER the extraction
//       R6 the check is followed by `|| true`
//       R7 the verifying step gains an `if:`
//       R8 `flutter` bumped in versions.json without its digests (a Renovate PR)
//       R9 a runner's digest deleted
//
// Run:  node --test tooling/ci/test/signing-inputs-pinned.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-signing-inputs-pinned.mjs');
const ACTION_REL = '.github/actions/setup-flutter/action.yml';
const WRAPPER_REL = 'apps/subscriptiontracker/android/gradle/wrapper/gradle-wrapper.properties';

const made = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8', timeout: 120_000 });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'signing-inputs-'));
  made.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

/** A copy of exactly what the guard reads from the real tree. */
function realCopy() {
  const root = mkdtempSync(join(tmpdir(), 'signing-inputs-real-'));
  made.push(root);
  cpSync(join(REPO, '.github'), join(root, '.github'), { recursive: true });
  for (const rel of ['tooling/channel-register.json', 'tooling/versions.json']) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    cpSync(join(REPO, rel), join(root, rel));
  }
  for (const app of readdirSync(join(REPO, 'apps'))) {
    const rel = `apps/${app}/android/gradle/wrapper/gradle-wrapper.properties`;
    if (!existsSync(join(REPO, rel))) continue;
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    cpSync(join(REPO, rel), join(root, rel));
  }
  return root;
}

/** Replace `from` (which must occur exactly once) in `rel` under `root`. */
function mutate(root, rel, from, to) {
  const p = join(root, rel);
  const text = readFileSync(p, 'utf8');
  assert.equal(text.split(from).length - 1, 1, `the anchor must appear exactly once in ${rel}: ${from}`);
  writeFileSync(p, text.replace(from, () => to));
}

const REGISTER = JSON.stringify({ channels: [{ id: 'x', signing: { ciSecrets: { names: ['SIGN_KEY'] } } }] });
const VERSIONS = JSON.stringify({ flutter: '1.0.0', flutter_sha256_version: '1.0.0' });
const SUM = 'a'.repeat(64);

const workflow = (steps, secret = 'SIGN_KEY') => `name: w
on: workflow_dispatch
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - name: key
        env:
          K: \${{ secrets.${secret} }}
        run: echo ok
${steps}
`;
const runStep = (body) => `      - name: step\n        run: |\n${body.split('\n').map((l) => `          ${l}`).join('\n')}`;
const fixture = (steps, extra = {}, secret) =>
  tree({ 'tooling/channel-register.json': REGISTER, 'tooling/versions.json': VERSIONS, '.github/workflows/w.yml': workflow(steps, secret), ...extra });
const WRAPPER_OK = `distributionBase=GRADLE_USER_HOME\ndistributionSha256Sum=${SUM}\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-9.8.0-all.zip\n`;
const WRAPPER_BARE = 'distributionBase=GRADLE_USER_HOME\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-9.8.0-all.zip\n';

describe('assert-signing-inputs-pinned', () => {
  test('S0 the control: a copy of the REAL tree passes, the Flutter install counted as verified', () => {
    const { code, out } = run(realCopy());
    assert.equal(code, 0, out);
    assert.match(out, /[1-9]\d* signing job\(s\)/);
    assert.match(out, /1 verified Flutter install\(s\), [1-9]\d* gradle wrapper\(s\)/);
    assert.match(out, /^ok — /m);
  });

  test('D1 a bare curl download in a signing job -> exit 1, naming the step', () => {
    const { code, out } = run(fixture(runStep('curl -sSL -o tool.tgz https://example.com/tool.tgz\ntar -xzf tool.tgz')));
    assert.equal(code, 1, out);
    assert.match(out, /w\.yml:\d+: `curl` downloads a file in a job that holds signing keys, and no sha256 check/);
  });

  test('D2 the same download followed by sha256sum --check -> exit 0', () => {
    const { code, out } = run(fixture(runStep(`curl -sSL -o tool.tgz https://example.com/tool.tgz\necho "${SUM}  tool.tgz" | sha256sum --check\ntar -xzf tool.tgz`)));
    assert.equal(code, 0, out);
  });

  test('D3 a download piped into bash -> exit 1, even with a check after it', () => {
    const { code, out } = run(fixture(runStep(`curl -sSL https://example.com/install.sh | bash\necho "${SUM}  x" | sha256sum --check`)));
    assert.equal(code, 1, out);
    assert.match(out, /pipes a download straight into a shell/);
  });

  test('D4 the same bare download in a job that holds NO signing secret is not this guard\'s business', () => {
    const root = fixture(runStep('curl -sSL -o tool.tgz https://example.com/tool.tgz'), {}, 'OTHER');
    writeFileSync(join(root, '.github/workflows/s.yml'), workflow('      - run: echo signed'));
    const { code, out } = run(root);
    assert.equal(code, 0, out);
  });

  test('G1 a signing job building an apk, wrapper without distributionSha256Sum -> exit 1', () => {
    const { code, out } = run(fixture(runStep('flutter build apk --release'), { 'apps/a/android/gradle/wrapper/gradle-wrapper.properties': WRAPPER_BARE }));
    assert.equal(code, 1, out);
    assert.match(out, /apps\/a\/android\/gradle\/wrapper\/gradle-wrapper\.properties: carries no distributionSha256Sum/);
    assert.match(out, /gradle-9\.8\.0-all\.zip\.sha256/);
  });

  test('G2 the same wrapper carrying a 64-hex distributionSha256Sum -> exit 0', () => {
    const { code, out } = run(fixture(runStep('flutter build apk --release'), { 'apps/a/android/gradle/wrapper/gradle-wrapper.properties': WRAPPER_OK }));
    assert.equal(code, 0, out);
  });

  test('C1 a register that names no signing secret -> exit 2', () => {
    const root = fixture(runStep('echo hi'));
    writeFileSync(join(root, 'tooling/channel-register.json'), JSON.stringify({ channels: [{ id: 'x' }] }));
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — tooling\/channel-register\.json names no signing secret/);
  });

  test('C2 signing secrets that no job reads -> exit 2, zero signing jobs placed', () => {
    const { code, out } = run(fixture(runStep('echo hi'), {}, 'OTHER'));
    assert.equal(code, 2, out);
    assert.match(out, /zero signing jobs placed/);
  });

  test('C3 a signing job that builds Android and no gradle wrapper in the tree -> exit 2', () => {
    const { code, out } = run(fixture(runStep('flutter build appbundle --release')));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — 1 signing job\(s\) build Android and the tree holds no gradle-wrapper\.properties/);
  });

  test('C4 a composite a signing job calls that is not on disk -> exit 2', () => {
    const { code, out } = run(fixture('      - uses: ./.github/actions/missing'));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — .*calls `\.\/\.github\/actions\/missing`/);
  });
});

describe('assert-signing-inputs-pinned — the REAL tree, mutated', () => {
  const CHECK_LINE =
    "        if command -v sha256sum >/dev/null 2>&1; then printf '%s  %s\\n' \"$ARCHIVE_SHA256\" \"$ARCHIVE_FILE\" | sha256sum --check; else printf '%s  %s\\n' \"$ARCHIVE_SHA256\" \"$ARCHIVE_FILE\" | shasum -a 256 --check; fi\n";
  const EXTRACT_LINE = '        case "$ARCHIVE_FILE" in *.zip) unzip -q -o "$ARCHIVE_FILE" -d "$SDK_ROOT" ;; *) tar -xJf "$ARCHIVE_FILE" -C "$SDK_ROOT" ;; esac\n';

  const redOn = (name, rel, from, to, expect) =>
    test(name, () => {
      const root = realCopy();
      mutate(root, rel, from, to);
      const { code, out } = run(root);
      assert.equal(code, 1, out);
      assert.match(out, expect);
    });

  redOn('R1 the real wrapper loses distributionSha256Sum -> exit 1', WRAPPER_REL, readFileSync(join(REPO, WRAPPER_REL), 'utf8').match(/^distributionSha256Sum=.*\n/m)?.[0] ?? '<absent>', '', /carries no distributionSha256Sum/);
  redOn('R2 the composite\'s sha256 check stripped -> exit 1', ACTION_REL, CHECK_LINE, '', /runs no sha256 check/);
  redOn('R3 subosito\'s cache handed back to the input -> exit 1', ACTION_REL, "        cache: 'false'\n", '        cache: ${{ inputs.cache }}\n', /runs with `cache` `\$\{\{ inputs\.cache \}\}`; it must be the literal 'false'/);
  redOn('R4 subosito\'s cache-path no longer names the verifying step -> exit 1', ACTION_REL, '        cache-path: ${{ steps.sdk.outputs.root }}\n', '        cache-path: ${{ steps.archive.outputs.root }}\n', /extracts nothing|runs no sha256 check/);
  redOn('R5 the check moved AFTER the extraction -> exit 1', ACTION_REL, CHECK_LINE + '        rm -rf "$SDK_ROOT"\n        mkdir -p "$SDK_ROOT"\n' + EXTRACT_LINE, '        rm -rf "$SDK_ROOT"\n        mkdir -p "$SDK_ROOT"\n' + EXTRACT_LINE + CHECK_LINE, /extracts BEFORE it checks/);
  redOn('R6 the check followed by `|| true` -> exit 1', ACTION_REL, 'shasum -a 256 --check; fi\n', 'shasum -a 256 --check || true; fi\n', /follows its sha256 check with `\|\|`/);
  redOn('R7 the verifying step gains an `if:` -> exit 1', ACTION_REL, '    - id: sdk\n      shell: bash\n', "    - id: sdk\n      if: ${{ inputs.cache != 'true' }}\n      shell: bash\n", /carries `if: /);

  test('R8 `flutter` bumped without its digests (the Renovate PR) -> exit 1, naming where to copy them from', () => {
    const root = realCopy();
    const v = JSON.parse(readFileSync(join(REPO, 'tooling/versions.json'), 'utf8')).flutter;
    mutate(root, 'tooling/versions.json', `"flutter": "${v}",`, '"flutter": "99.0.0",');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /digests are for `flutter_sha256_version` "[\d.]+", and `flutter` is "99\.0\.0".*releases_<os>\.json/);
  });

  test('R9 a runner\'s digest deleted -> exit 1, naming the job that installs there', () => {
    const root = realCopy();
    const text = readFileSync(join(root, 'tooling/versions.json'), 'utf8');
    const line = text.match(/^ {2}"flutter_macos_arm64_sha256": "[0-9a-f]{64}",\n/m)?.[0];
    assert.ok(line, 'the macOS arm64 digest line must be present to delete');
    writeFileSync(join(root, 'tooling/versions.json'), text.replace(line, ''));
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /`flutter_macos_arm64_sha256` is missing, and .* installs Flutter on that runner/);
  });
});
