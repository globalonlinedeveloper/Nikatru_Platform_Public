// ─────────────────────────────────────────────────────────────────────────────
// submit-lanes-take-dry-run-bytes.test.mjs — a confirmed submit job ships the bytes
// its dry-run job built and checked, verified by a sha256 that job emitted: one
// compile per dispatch.
//
// Register row O-SUBMIT-REBUILDS-WHAT-THE-DRY-RUN-BUILT (P-27; C2 closes its second
// and third sentences, and the row's first clause stays open until C6c). Until
// 2026-09-25 submit-play.yml and submit-windows-store.yml each compiled the app
// TWICE per dispatch — once in `dry-run`, once again in `submit` — so the bundle the
// store received was not the bytes the dry run had graded, and an obfuscated
// rebuild shipped with a mapping from a different compile.
//
// THE DOMAIN IS READ, NOT LISTED: every `.github/workflows/submit-*.yml`, and in each
// every job whose `run:` invokes `node tooling/release/submit-<x>.mjs --submit`. For
// each such job this file FAILS when:
//   (1) a step rebuilds or repacks — `flutter build`, `msix:create` or
//       `snapcraft pack`. A tooling/ci/flutter-release-build.mjs build call IS a
//       `flutter build` (⏱ 2026-09-26, O-FLUTTER-BUILD-TYPED-PER-LINE), read with
//       workflow-scan.mjs's composerCallArgs, the parse the census reads it with;
//   (2) no step checks a `sha256sum --check` against `${{ needs.<job>.outputs.<o> }}`
//       passed through `env:` (workflow-scan.mjs sha256HandOffs);
//   (3) that output does not resolve — <job> is not in `needs:`, declares no such
//       output, or its output names a step id nothing carries or that writes no
//       `<key>=` to $GITHUB_OUTPUT;
//   (4) the job does not download an artifact whose name is that same job's output,
//       or the check runs after the download's consumer, the `--submit` step.
//
// ONE RECORDED EXCEPTION, AND IT RETIRES ITSELF: submit-snap.yml. Its script,
// tooling/release/submit-snap.mjs PG-5(c), REFUSES `--submit` unless the SAME job
// runs `snapcraft pack` before it ("this job built the bytes it is sending"), and the
// C2 brief forbids changing a submit script. The exception holds only while that
// script still carries the needle; delete PG-5(c) and this file starts failing the
// snap lane until it takes its dry run's bytes too. It is also held load-bearing:
// the exception fails if the snap submit job stops packing.
//
// Run:  node --single-threaded --test tooling/ci/test/submit-lanes-take-dry-run-bytes.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  WORKFLOW_DIR,
  composerCallArgs,
  joinShellContinuations,
  jobOutputs,
  parseWorkflow,
  sha256HandOffs,
  shellSegments,
  workflowSteps,
} from '../workflow-scan.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const SUBMIT = /(?:^|\s)node\s+(?:-\S+\s+)*tooling\/release\/submit-[a-z-]+\.mjs(?:\s+\S+)*?\s+--submit(?=\s|$)/;
/** A composer call that builds (`--print` and `--emit-env` build nothing). A call
 *  the composer would refuse still asks for a build, so its throw counts too. */
const composesBuild = (seg) => {
  try {
    return composerCallArgs(seg) !== null;
  } catch {
    return true;
  }
};
const REBUILDS = [
  ['flutter build', { test: (seg) => /(?:^|\s)flutter\s+build(?=\s|$)/.test(seg) || composesBuild(seg) }],
  ['msix:create', /(?:^|\s)msix:create(?=\s|$)/],
  ['snapcraft pack', /(?:^|\s)snapcraft\s+pack(?=\s|$)/],
];
const DOWNLOAD = /^actions\/download-artifact@/;
const NEEDS_OUTPUT = /^\$\{\{\s*needs\.([A-Za-z_][A-Za-z0-9_-]*)\.outputs\.([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}$/;

// The one exception. `needle` is read out of `script` on every run: gone, and the
// exception no longer applies.
const EXCEPTIONS = new Map([
  [
    `${WORKFLOW_DIR}/submit-snap.yml`,
    {
      script: 'tooling/release/submit-snap.mjs',
      needle: "const PACK_VERB = 'snapcraft pack';",
      why: 'submit-snap.mjs PG-5(c) refuses --submit unless the same job packs, and the C2 brief forbids editing a submit script',
    },
  ],
]);

const segmentsOf = (step) => shellSegments(joinShellContinuations(step.run?.text ?? ''));

/** Every submitting job in one workflow, graded: `{ rel, job, excepted, findings: string[] }`. */
function gradeWorkflow(root, rel) {
  const wf = parseWorkflow(root, rel);
  const out = [];
  if (wf === null) return out;
  const exception = EXCEPTIONS.get(rel);
  const excepted = exception !== undefined && (readFileSyncOrNull(join(root, exception.script)) ?? '').includes(exception.needle);
  for (const [name, job] of wf.jobs) {
    const steps = workflowSteps(job);
    const submitStep = steps.find((s) => segmentsOf(s).some((seg) => SUBMIT.test(seg)));
    if (!submitStep) continue;
    const findings = [];
    const where = `${rel} job "${name}"`;
    for (const s of steps) {
      for (const [verb, re] of REBUILDS) {
        if (segmentsOf(s).some((seg) => re.test(seg))) findings.push(`${where} rebuilds: line ${s.first} runs \`${verb}\``);
      }
    }
    const handOffs = sha256HandOffs(wf, name);
    if (handOffs.length === 0) {
      findings.push(`${where} runs --submit and checks no sha256 its dry-run job emitted (\`sha256sum --check\` reading \${{ needs.<job>.outputs.<o> }} through env:)`);
    }
    for (const h of handOffs) {
      if (h.resolved === null) findings.push(`${where} line ${h.step.first}: needs.${h.from}.outputs.${h.output} does not resolve — ${h.why}`);
      if (h.step.index > submitStep.index) findings.push(`${where} checks the sha256 at line ${h.step.first}, AFTER the --submit step at line ${submitStep.first}`);
      const producer = wf.jobs.get(h.from);
      const download = steps.find((s) => {
        if (!DOWNLOAD.test(s.uses ?? '')) return false;
        const m = String(s.with.get('name')?.value ?? '').match(NEEDS_OUTPUT);
        return m !== null && m[1] === h.from && producer !== undefined && jobOutputs(producer).has(m[2]);
      });
      if (!download) findings.push(`${where} downloads no artifact named by an output of job "${h.from}", so the sha256 checks bytes nothing handed over`);
      else if (download.index > h.step.index) findings.push(`${where} checks the sha256 at line ${h.step.first} before the download at line ${download.first}`);
    }
    out.push({ rel, job: name, excepted, findings });
  }
  return out;
}

function readFileSyncOrNull(p) {
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

/** The whole domain: every submit-*.yml under `root`. */
function gradeTree(root) {
  const dir = join(root, WORKFLOW_DIR);
  const files = readdirSync(dir).filter((f) => /^submit-.*\.ya?ml$/.test(f)).sort();
  return files.flatMap((f) => gradeWorkflow(root, `${WORKFLOW_DIR}/${f}`));
}

const blocking = (graded) => graded.filter((g) => !g.excepted).flatMap((g) => g.findings);

// ── fixtures: the REAL workflows, copied and mutated ─────────────────────────
let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-submit-bytes-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

const real = (rel) => readFileSync(join(REPO, rel), 'utf8');
const PLAY = `${WORKFLOW_DIR}/submit-play.yml`;
const SNAP = `${WORKFLOW_DIR}/submit-snap.yml`;
const WINDOWS = `${WORKFLOW_DIR}/submit-windows-store.yml`;
const SNAP_SCRIPT = 'tooling/release/submit-snap.mjs';

/** A tree holding the three real submit lanes and the snap script, with `edits` applied as
 *  `rel → (text) => text`. Every edit must change its file, or the fixture proves nothing. */
function tree(edits = {}) {
  const root = join(TMP, `t${++seq}`);
  mkdirSync(join(root, WORKFLOW_DIR), { recursive: true });
  mkdirSync(join(root, 'tooling', 'release'), { recursive: true });
  for (const rel of [PLAY, SNAP, WINDOWS, SNAP_SCRIPT]) {
    const before = real(rel);
    const after = edits[rel] ? edits[rel](before) : before;
    if (edits[rel]) assert.notEqual(after, before, `the mutation of ${rel} changed nothing`);
    writeFileSync(join(root, rel), after);
  }
  return root;
}

/** Replace exactly one occurrence of `from`, or fail the fixture. */
const once = (from, to) => (text) => {
  const parts = text.split(from);
  assert.equal(parts.length, 2, `expected exactly one ${JSON.stringify(from.slice(0, 60))}`);
  return parts.join(to);
};

describe('a confirmed submit job ships the dry-run job\'s bytes (O-SUBMIT-REBUILDS-WHAT-THE-DRY-RUN-BUILT)', () => {
  test('the REAL tree: every submitting job takes its dry-run job\'s bytes by sha256, the snap exception aside', () => {
    const graded = gradeTree(REPO);
    const lanes = graded.map((g) => `${g.rel}#${g.job}`);
    assert.ok(lanes.includes(`${PLAY}#submit`), `the domain lost submit-play.yml#submit: ${lanes.join(', ')}`);
    assert.ok(lanes.includes(`${WINDOWS}#submit`), `the domain lost submit-windows-store.yml#submit: ${lanes.join(', ')}`);
    assert.ok(graded.filter((g) => !g.excepted).length >= 2, 'fewer than two submitting jobs graded');
    assert.deepEqual(blocking(graded), []);
  });

  test('the snap exception is still load-bearing: its script demands the pack, and its submit job packs', () => {
    const snap = gradeWorkflow(REPO, SNAP);
    assert.equal(snap.length, 1, 'submit-snap.yml no longer has exactly one submitting job');
    assert.equal(snap[0].excepted, true, `${SNAP_SCRIPT} no longer carries ${EXCEPTIONS.get(SNAP).needle}: take the dry run's bytes in submit-snap.yml and delete the exception`);
    assert.ok(snap[0].findings.some((f) => /rebuilds: .*`snapcraft pack`/.test(f)), `submit-snap.yml#submit no longer packs, so the exception excuses nothing: delete it\n${snap[0].findings.join('\n')}`);
  });

  test('RC2 FAILS when submit-play.yml#submit builds the bundle again (the closes\' own control)', () => {
    const root = tree({
      [PLAY]: once(
        '      - name: Take the dry-run job\'s bundle\n',
        '      - name: Build the app bundle\n        working-directory: apps/subscriptiontracker\n        run: flutter build appbundle --release --build-number=${{ github.run_number }}\n      - name: Take the dry-run job\'s bundle\n',
      ),
    });
    const f = blocking(gradeTree(root));
    assert.equal(f.length, 1, f.join('\n'));
    assert.match(f[0], /submit-play\.yml job "submit" rebuilds: line \d+ runs `flutter build`/);
  });

  test('RC3 FAILS when the sha256sum --check line is deleted from submit-windows-store.yml#submit', () => {
    const root = tree({
      [WINDOWS]: once('          printf \'%s  %s\\n\' "$EXPECTED_SHA256" "$MSIX" | sha256sum --check --strict -\n', ''),
    });
    const f = blocking(gradeTree(root));
    assert.equal(f.length, 1, f.join('\n'));
    assert.match(f[0], /submit-windows-store\.yml job "submit" runs --submit and checks no sha256 its dry-run job emitted/);
  });

  test('RC4 FAILS when the windows dry-run job\'s `id: bytes` is renamed: the output resolves to no step', () => {
    const root = tree({ [WINDOWS]: once('        id: bytes\n', '        id: hashed\n') });
    const f = blocking(gradeTree(root));
    assert.equal(f.length, 1, f.join('\n'));
    assert.match(f[0], /needs\.dry-run\.outputs\.sha256 does not resolve — job "dry-run" output "sha256" names step id "bytes", and no step of that job has it/);
  });

  test('FAILS when the sha256 is interpolated into run: instead of passed through env:', () => {
    const root = tree({
      [PLAY]: (t) =>
        once('          printf \'%s  %s\\n\' "$EXPECTED_SHA256" "$AAB" | sha256sum --check --strict -\n', '          printf \'%s  %s\\n\' "${{ needs.dry-run.outputs.sha256 }}" "$AAB" | sha256sum --check --strict -\n')(
          once('          EXPECTED_SHA256: ${{ needs.dry-run.outputs.sha256 }}\n          AAB:', '          AAB:')(t),
        ),
    });
    const f = blocking(gradeTree(root));
    assert.ok(f.some((x) => /submit-play\.yml job "submit" runs --submit and checks no sha256/.test(x)), f.join('\n'));
  });

  test('FAILS when the dry-run job is dropped from the submit job\'s needs:', () => {
    const root = tree({ [PLAY]: once('    needs: [gate, dry-run]\n', '    needs: [gate]\n') });
    const f = blocking(gradeTree(root));
    assert.ok(f.some((x) => /needs\.dry-run\.outputs\.sha256 does not resolve — job "dry-run" is not in job "submit"'s needs:/.test(x)), f.join('\n'));
  });

  test('FAILS when the check sits after the --submit step', () => {
    const root = tree({
      [WINDOWS]: (t) => {
        const start = t.indexOf('      # why: the value arrives through env:, never interpolated into run: (zizmor). bash,');
        const end = t.indexOf('      # why: the mapping of the package above is the dry-run job\'s');
        assert.ok(start > 0 && end > start, 'the windows check step moved');
        const block = t.slice(start, end);
        const moved = t.slice(0, start) + t.slice(end);
        return once('      # why: `shell: bash` is load-bearing (2026-09-23).', `${block}      # why: \`shell: bash\` is load-bearing (2026-09-23).`)(moved);
      },
    });
    const f = blocking(gradeTree(root));
    assert.ok(f.some((x) => /submit-windows-store\.yml job "submit" checks the sha256 at line \d+, AFTER the --submit step/.test(x)), f.join('\n'));
  });

  test('FAILS when the download names an artifact no output of the dry-run job carries', () => {
    const root = tree({ [PLAY]: once('          name: ${{ needs.dry-run.outputs.artifact }}\n', '          name: subscriptiontracker-android-play-aab-release-signed\n') });
    const f = blocking(gradeTree(root));
    assert.equal(f.length, 1, f.join('\n'));
    assert.match(f[0], /submit-play\.yml job "submit" downloads no artifact named by an output of job "dry-run"/);
  });

  test('the snap exception EXPIRES when submit-snap.mjs stops demanding the pack', () => {
    const root = tree({ [SNAP_SCRIPT]: once("const PACK_VERB = 'snapcraft pack';", "const PACK_VERB = 'snapcraft  pack';") });
    const f = blocking(gradeTree(root));
    assert.ok(f.some((x) => /submit-snap\.yml job "submit" rebuilds: line \d+ runs `flutter build`/.test(x)), f.join('\n'));
    assert.ok(f.some((x) => /submit-snap\.yml job "submit" runs --submit and checks no sha256/.test(x)), f.join('\n'));
  });
});
