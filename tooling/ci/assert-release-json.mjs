#!/usr/bin/env node
/**
 * assert-release-json.mjs — the record a GitHub Release publishes about itself
 * has to be TRUE OF THE BYTES BESIDE IT, and true of the register that says
 * where those bytes may go.
 *
 * 🔴 WHY A SECOND GUARD AND NOT A LIMB OF assert-release-durable.mjs.
 * That guard grades the WORKFLOW — it reads the YAML and asks whether a lane
 * that uploads an installable also writes something durable. This one grades
 * the OUTPUT — an actual directory, on the runner, holding actual files. They
 * fail at different times (lint time vs release time) and they read different
 * inputs, so one file with both would be a guard that cannot run either half
 * without the other's input. assert-release-durable.mjs limb 2 is extended to
 * require that the lane CALLS this one; this file is what the call does.
 *
 * ⏱ 2026-09-24 — LIMB 9 IS STATIC, AND IT GRADES THE WORKFLOW THAT FEEDS THE
 * RECORD (O-RELEASE-RECORD-GUESSES-CHANNEL-FROM-EXTENSION). release.json now
 * takes each installer's channel from the stamp its build wrote
 * (tooling/ci/stamp-channel.mjs). A stamp is only as true as the `--channel` its
 * step passes, so `--static` reads the workflows and asks, per stamp step, that
 * its `--channel` equal the RELEASE_CHANNEL define of the build it names
 * (`--build-step <id>`); and, per upload the release job downloads, that every
 * installer path is stamped in its job and carries its `.channel.json`. It runs
 * inside `--self-test` too, over the real tree and over two mutations of it, so
 * the two lanes that call the self-test (ci.yml, spec-guards.mjs) grade it.
 *
 * ⏱ 2026-09-24 — LIMB 10 IS STATIC TOO (O-APPS-GOV-IN-CHANNEL-APK). The release
 * job downloads the apps.gov.in .apk only under the UPLOADABLE name that
 * assert-apps-gov-in-apk.mjs exports, so the file the owner uploads is the file
 * the record names, and a NOT-FOR-UPLOAD .apk never reaches a release.
 *
 * Usage:
 *   node tooling/ci/assert-release-json.mjs --dir <release dir> [--repo-root <root>]
 *   node tooling/ci/assert-release-json.mjs --static [--repo-root <root>]
 *   node tooling/ci/assert-release-json.mjs --self-test
 *
 * Exit codes (AGENTS.md convention):
 *   0  the record is true of the directory
 *   1  a finding — the record and the bytes disagree
 *   2  COVERAGE LOST — the run could not look. A missing schema, a missing
 *      manifest or an unreadable register is NOT "no problems found"; it is a
 *      run that asked nothing, and exit 1 would read as a finding about the
 *      release instead of a hole in the check.
 */
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

/**
 * 🔴 EVERY NAME AND EVERY PARSER COMES OUT OF release-manifest.mjs. The emitter
 * and its guard sharing one declaration is the whole reason the drift this
 * guard exists to catch cannot start here: a private `'release.json'` or a
 * second SHA256SUMS parser in this file would be the first thing to go stale,
 * and a stale copy reports ok.
 */
import {
  MANIFEST_NAME,
  RELEASE_JSON_NAME,
  parseManifest,
  assetFiles,
  channelIsOnSurface,
  buildReleaseJson,
  renderManifest,
  installableExtensions,
  BUNDLE_MEMBERS,
  channelStampName,
} from './release-manifest.mjs';
import { validate, SchemaError } from '../app-yaml/schema-validate.mjs';
import { parseAllWorkflows, workflowSteps, RELEASE_CHANNEL_STAMP } from './workflow-scan.mjs';
import { uploadableArtifactName } from './assert-apps-gov-in-apk.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(join(HERE, '..', '..'));  // tooling/ci -> repo root
const SCHEMA_REL = 'contracts/release.schema.json';
const REGISTER_REL = 'tooling/channel-register.json';

/** The sentinel build-platforms.yml's release job synthesises on a run that is
 *  not a tag push (`TAG="${APP}-untagged-$(git rev-parse --short HEAD)"`). The
 *  emit and validate steps are deliberately NOT tag-gated — a step that only
 *  ever runs on the first real release is a step nobody has ever seen run — so
 *  this guard must grade those runs too, and must SAY which comparison it could
 *  not make on them rather than passing quietly. */
const UNTAGGED = /^[a-z0-9][a-z0-9-]*-untagged-[0-9a-f]{7,40}$/;

const sha256Of = (abs) => createHash('sha256').update(readFileSync(abs)).digest('hex');

function coverageLost(msg, ...more) {
  console.error(`✗ ${msg}`);
  for (const m of more) console.error(`  ${m}`);
  process.exit(2);
}

/**
 * Grade one release directory. Returns every finding at once — a guard that
 * stops at the first one turns a broken release into a queue of one-line
 * round trips, and on a release lane every round trip is a re-run.
 *
 * `notes` carries what the run deliberately did NOT check, so the log says so
 * on the face of it. A skipped comparison that prints nothing is the shape of
 * a guard that passes because it looked at nothing.
 */
export function gradeRelease({ dir, schema, register }) {
  const findings = [];
  const notes = [];
  const add = (limb, msg, ...more) => findings.push({ limb, msg, more });

  const recordAbs = join(dir, RELEASE_JSON_NAME);
  let record = null;
  try {
    record = JSON.parse(readFileSync(recordAbs, 'utf8'));
  } catch (e) {
    add(1, `${RELEASE_JSON_NAME} is not valid JSON (${e.message}).`);
    return { findings, notes, record: null };
  }

  // ── limb 1: the record is the shape contracts/release.schema.json declares ──
  for (const p of validate(record, schema)) add(1, `schema: ${p}`);

  const artefacts = Array.isArray(record.artefacts) ? record.artefacts : [];

  // ── limb 2: the record and the directory name the same set, both ways ──────
  // 🔴 BOTH DIRECTIONS. "Every artefact exists" alone passes a release that
  // publishes a file the record never mentions, which is exactly how an
  // unsigned or a leftover build gets downloaded under a signed release's name.
  const { names: onDisk, strays } = assetFiles(dir);
  for (const s of strays) add(2, `${s} is a DIRECTORY inside the release directory, which is flat by construction.`);
  const described = artefacts.map((a) => a?.name).filter((n) => typeof n === 'string');
  const seen = new Set();
  for (const n of described) {
    if (seen.has(n)) add(2, `${n} is described twice. One name, two records, and nothing here can choose.`);
    seen.add(n);
  }
  const publishable = onDisk.filter((n) => n !== RELEASE_JSON_NAME);
  for (const n of described) {
    if (!publishable.includes(n)) add(2, `${RELEASE_JSON_NAME} describes ${n}, which is not in ${dir}.`);
  }
  for (const n of publishable) {
    if (!seen.has(n)) {
      add(
        2,
        `${n} is in the release directory and ${RELEASE_JSON_NAME} does not describe it.`,
        'A published file the record is silent about is a download nobody can check a hash against.',
      );
    }
  }

  // ── limbs 3 and 4: the numbers are true of the bytes ───────────────────────
  for (const a of artefacts) {
    if (typeof a?.name !== 'string') continue;
    const abs = join(dir, a.name);
    if (!existsSync(abs)) continue;  // already limb 2's finding
    const st = statSync(abs);
    if (!(Number(a.size) > 0)) {
      add(3, `${a.name} is described with size ${JSON.stringify(a.size)}.`, 'A zero-byte release asset is a failed build that uploaded anyway.');
    } else if (Number(a.size) !== st.size) {
      add(3, `${a.name}: record says ${a.size} bytes, the file is ${st.size}.`);
    }
    const real = sha256Of(abs);
    if (a.sha256 !== real) add(4, `${a.name}: record says sha256 ${a.sha256}, the bytes hash to ${real}.`);
  }

  // ── limb 5: SHA256SUMS names release.json, and they agree ─────────────────
  // ⚠️ THE ORDER IS THE POINT. release.json is emitted BEFORE the manifest is
  // written, so the manifest covers it. If it does not, the one file describing
  // the release is the one file a downloader cannot verify — and `sha256sum -c`
  // would still print ok, because it only checks what it lists.
  const manifestAbs = join(dir, MANIFEST_NAME);
  if (!existsSync(manifestAbs)) {
    add(5, `${MANIFEST_NAME} does not exist in ${dir}.`, `Run \`release-manifest.mjs --write\` AFTER \`--emit-release-json\`, never before.`);
  } else {
    const { meta, entries } = parseManifest(readFileSync(manifestAbs, 'utf8'));
    const byName = new Map(entries.map((e) => [e.name, e.hash]));
    if (!byName.has(RELEASE_JSON_NAME)) {
      add(
        5,
        `${MANIFEST_NAME} does not list ${RELEASE_JSON_NAME}.`,
        'The manifest was written before the record existed, so the record is unverifiable — and every other',
        'line of the manifest still checks out, which is why this cannot be left to `sha256sum -c`.',
      );
    } else {
      const real = sha256Of(recordAbs);
      if (byName.get(RELEASE_JSON_NAME) !== real) {
        add(5, `${MANIFEST_NAME} records ${byName.get(RELEASE_JSON_NAME)} for ${RELEASE_JSON_NAME}; it hashes to ${real}.`);
      }
    }
    for (const a of artefacts) {
      if (typeof a?.name !== 'string') continue;
      if (!byName.has(a.name)) add(5, `${MANIFEST_NAME} does not list ${a.name}, which ${RELEASE_JSON_NAME} describes.`);
      else if (byName.get(a.name) !== a.sha256) add(5, `${a.name}: manifest ${byName.get(a.name)} vs record ${a.sha256}.`);
    }

    // ── limb 8: the two headers describe the same release ────────────────────
    if (typeof meta.tag === 'string' && meta.tag !== record.tag) add(8, `manifest header says tag ${meta.tag}; the record says ${record.tag}.`);
    if (typeof meta.commit === 'string' && meta.commit !== record.commit) add(8, `manifest header says commit ${meta.commit}; the record says ${record.commit}.`);
    if (typeof meta.app === 'string' && meta.app !== record.unit) add(8, `manifest header says app ${meta.app}; the record says unit ${record.unit}.`);
  }

  // ── limb 6: every channel id is a register row, on this record's surface ───
  // 🔴 SURFACE AND NOT JUST EXISTENCE. `chrome-webstore` is a real channel id
  // and listing it on a Flutter .aab is still a lie; an id that merely exists
  // would let the record offer an artefact to a store that cannot take it.
  const rows = register?.channels ?? [];
  const idsOnSurface = new Set(rows.filter((c) => channelIsOnSurface(c, record.surface)).map((c) => c?.id));
  const allIds = new Set(rows.map((c) => c?.id));
  for (const a of artefacts) {
    for (const id of Array.isArray(a?.channels) ? a.channels : []) {
      if (idsOnSurface.has(id)) continue;
      if (allIds.has(id)) add(6, `${a.name} lists channel ${id}, which is not on the "${record.surface}" surface.`);
      else add(6, `${a.name} lists channel ${id}, which ${REGISTER_REL} does not declare.`);
    }
  }

  // ── limb 7: the versions and the tag tell one story ────────────────────────
  const tagVersion = /-v([0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9]+)?)$/.exec(String(record.tag ?? ''));
  if (tagVersion === null) {
    if (UNTAGGED.test(String(record.tag ?? ''))) {
      notes.push(`limb 7 SKIPPED: tag "${record.tag}" is the untagged-run sentinel and carries no version to compare against. Every other limb ran.`);
    } else {
      add(7, `tag "${record.tag}" is neither <unit>-v<semver> nor the untagged sentinel, so no version comparison is possible.`);
    }
  } else {
    for (const a of artefacts) {
      // The app surface builds with --build-name=<release line>.<run number>, so
      // the package carries 1.0.<run> while the tag names 1.0.0. The MAJOR.MINOR
      // must agree; the third component is the lane's build counter and is not
      // the tag's to dictate. Measured on build-platforms.yml, not assumed.
      const want = tagVersion[1].split('.').slice(0, 2).join('.');
      const got = String(a?.version ?? '').split('.').slice(0, 2).join('.');
      if (want !== got) add(7, `${a.name} is version ${a.version}; the tag says ${tagVersion[1]}. The major.minor must agree.`);
    }
    const min = String(record.minSupported ?? '');
    const cmp = (v) => v.split('.').map(Number);
    const [ma, mi] = cmp(min);
    const [ta, ti] = cmp(tagVersion[1]);
    if (Number.isFinite(ma) && (ma > ta || (ma === ta && mi > ti))) {
      add(7, `minSupported ${min} is newer than the release's own version ${tagVersion[1]}.`, 'A release that does not support itself is not a support window; it is a typo.');
    }
  }

  return { findings, notes, record };
}

/* ────────────────────────────────── CLI ────────────────────────────────── */

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? null : v;
};

function loadSchema(root) {
  const abs = join(root, SCHEMA_REL);
  if (!existsSync(abs)) {
    coverageLost(
      `COVERAGE LOST — ${SCHEMA_REL} does not exist under ${root}.`,
      'The shape of the record is DECLARED there and nowhere else. Falling back on a copy typed into this',
      'guard would mean grading the record against the guard\'s own idea of it, which always agrees.',
    );
  }
  let schema = null;
  try {
    schema = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    coverageLost(`COVERAGE LOST — ${SCHEMA_REL} is not valid JSON (${e.message}).`);
  }
  try {
    // The validator refuses a keyword it does not implement rather than skipping
    // it. Surfacing that here, as COVERAGE LOST, is the difference between "the
    // release is fine" and "the schema quietly checked less than it says".
    validate({}, schema);
  } catch (e) {
    if (e instanceof SchemaError) coverageLost(`COVERAGE LOST — ${SCHEMA_REL} uses a keyword the validator does not implement: ${e.message}`);
    throw e;
  }
  return schema;
}

function loadRegister(root) {
  const abs = join(root, REGISTER_REL);
  if (!existsSync(abs)) coverageLost(`COVERAGE LOST — ${REGISTER_REL} does not exist under ${root}.`, 'The channel ids in the record are graded against it; without it limb 6 asks nothing.');
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    coverageLost(`COVERAGE LOST — ${REGISTER_REL} is not valid JSON (${e.message}).`);
  }
}

function report(dir, { findings, notes }) {
  for (const n of notes) console.log(`⬜ ${n}`);
  if (findings.length === 0) {
    console.log(`ok  ${RELEASE_JSON_NAME} in ${dir} is true of the ${MANIFEST_NAME} and the register beside it`);
    return 0;
  }
  console.error(`✗ ${findings.length} finding(s) in ${dir}/${RELEASE_JSON_NAME}:`);
  for (const f of findings) {
    console.error(`  [limb ${f.limb}] ${f.msg}`);
    for (const m of f.more) console.error(`      ${m}`);
  }
  return 1;
}

function main() {
  const root = resolve(flag('repo-root') ?? DEFAULT_ROOT);
  if (argv.includes('--self-test')) process.exit(selfTest(root));
  if (argv.includes('--static')) process.exit(reportStatic(gradeStampWiring({ root, register: loadRegister(root) })));

  const dir = flag('dir');
  if (dir === null) {
    console.error('Usage: assert-release-json.mjs --dir <release dir> [--repo-root <root>]');
    console.error('       assert-release-json.mjs --static [--repo-root <root>]');
    console.error('       assert-release-json.mjs --self-test');
    process.exit(1);
  }
  const abs = resolve(dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) coverageLost(`COVERAGE LOST — ${abs} is not a directory.`, 'Nothing was graded. A release that did not stage is not a release that passed.');
  if (!existsSync(join(abs, RELEASE_JSON_NAME))) {
    coverageLost(
      `COVERAGE LOST — ${abs} holds no ${RELEASE_JSON_NAME}.`,
      'The emit step did not run, or ran into another directory. Exiting 1 here would report a finding about',
      'the record; there is no record. P4-5 requires one on EVERY release.',
    );
  }
  process.exit(report(abs, gradeRelease({ dir: abs, schema: loadSchema(root), register: loadRegister(root) })));
}

/* ─────────────────────── limb 9: the stamp wiring (static) ─────────────────────── */

const unquoteToken = (t) => t.replace(/^(['"])(.*)\1$/, '$2');
/** `${{ matrix.app }}` and `${{matrix.app}}` are one expression: both become the
 *  compact `${{matrix.app}}`, which also keeps a run line splittable on spaces. */
const normExpr = (s) => String(s).replace(/\$\{\{\s*(.*?)\s*\}\}/g, (all, e) => '${{' + e.replace(/\s+/g, '') + '}}');

/** `uses:` and the `with:` mapping of one step, read from its job's comment-blanked
 *  lines. A `key: |` value is its block lines, trimmed; a scalar is one entry. */
function stepWith(job, step) {
  const lines = job.lines.filter((l) => l.n >= step.first && l.n <= step.last).map((l) => l.text);
  const ind = (t) => t.match(/^ */)[0].length;
  const uses = lines.map((t) => t.match(/^\s*(?:-\s+)?uses:\s*(\S+)/)).find(Boolean)?.[1] ?? null;
  const out = new Map();
  const at = lines.findIndex((t) => /^\s*(?:-\s+)?with:\s*$/.test(t));
  if (at === -1) return { uses, with: out };
  const base = ind(lines[at].replace(/^(\s*)-\s/, '$1  '));
  for (let i = at + 1; i < lines.length; i++) {
    const t = lines[i];
    if (t.trim() === '') continue;
    if (ind(t) <= base) break;
    const m = t.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
    if (!m) continue;
    if (/^[|>][-+]?$/.test(m[2])) {
      const block = [];
      for (let k = i + 1; k < lines.length && (lines[k].trim() === '' || ind(lines[k]) > ind(t)); k++) if (lines[k].trim() !== '') block.push(lines[k].trim());
      out.set(m[1], block);
    } else {
      out.set(m[1], [unquoteToken(m[2])]);
    }
  }
  return { uses, with: out };
}

/** Which artifact names one download step reaches, as a predicate. A `pattern:`
 *  is a glob (`*`, `?`); a `name:` is one exact artifact; neither is every one. */
function downloadReaches(w) {
  const pattern = w.with.get('pattern')?.[0] ?? null;
  const name = w.with.get('name')?.[0] ?? null;
  if (pattern === null && name === null) return () => true;
  const escaped = normExpr(pattern ?? name).replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${pattern === null ? escaped : escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
  return (n) => re.test(normExpr(n));
}

/** A stamp step's `run:` read as stamp-channel.mjs reads its argv. */
function stampCall(runText) {
  const tokens = normExpr(runText).split(/\s+/).filter(Boolean).map(unquoteToken);
  const at = tokens.findIndex((t) => t.endsWith('stamp-channel.mjs'));
  const VALUED = new Set(['--channel', '--build-step', '--run-id', '--repo-root']);
  const opts = new Map();
  const files = [];
  for (let i = at + 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === ';' || t === '&&' || t === '||' || t === '|') break;
    if (VALUED.has(t)) { opts.set(t, tokens[i + 1] ?? null); i++; } else if (!t.startsWith('--')) files.push(normExpr(t));
  }
  return { channel: opts.get('--channel') ?? null, buildStep: opts.get('--build-step') ?? null, files };
}

/**
 * LIMB 9 — every stamp is paired with the build it speaks for, and every
 * installer the release downloads is stamped. Pure over a tree: `{ findings,
 * lost, counts }`. `lost` is COVERAGE LOST (the limb could not look), never a pass.
 *
 *   · A step running `release-manifest.mjs --stage` is a STAGER. Its job's
 *     `download-artifact` `pattern:` (or `name:`) decides which uploads of that
 *     workflow reach the release: those are RELEASE-BOUND.
 *   · In a release-bound upload, a `path:` entry ending in an installer format
 *     (the register's, minus the bundle members `--stage` never lifts) must be
 *     listed again as `<entry>.channel.json`, and a stamp step EARLIER in the same
 *     job must name exactly that entry as a file. Else --stage would meet an
 *     unstamped installer on the release run, a week after the edit that made it.
 *   · A step running `stamp-channel.mjs` must name `--channel` and `--build-step`;
 *     the step with that `id:` must come earlier in its job and pass
 *     `--dart-define=RELEASE_CHANNEL=<the same channel>`. A stamp that disagrees
 *     with its build is the defect this limb exists for, one layer down.
 */
export function gradeStampWiring({ root, register }) {
  const findings = [];
  const lost = [];
  const add = (msg, ...more) => findings.push({ limb: 9, msg, more });
  const counts = { stagers: 0, releaseBound: 0, installerPaths: 0, stampSteps: 0, agiDownloads: 0 };
  const installers = [...installableExtensions(register)].filter((x) => !BUNDLE_MEMBERS.has(x));
  const isInstallerPath = (p) => installers.some((x) => p.toLowerCase().endsWith(x.toLowerCase()));

  const parsed = parseAllWorkflows(root);
  if (parsed.length === 0) {
    lost.push(`no workflow was read under ${root}/.github/workflows, so limb 9 ranged over nothing.`);
    return { findings, lost, counts };
  }
  for (const wf of parsed) {
    const jobs = [...wf.jobs.values()].map((job) => ({ job, steps: workflowSteps(job) }));

    // ── every stamp step, paired with the build it names ──
    for (const { job, steps } of jobs) {
      for (const s of steps) {
        if (!/stamp-channel\.mjs/.test(s.run?.text ?? '')) continue;
        counts.stampSteps++;
        const where = `${wf.rel}:${s.first} (job "${job.name}", step "${s.name ?? s.id ?? '?'}")`;
        const call = stampCall(s.run.text);
        if (call.channel === null || call.buildStep === null) {
          add(`${where} runs stamp-channel.mjs without ${call.channel === null ? '--channel' : '--build-step'}.`, 'Nothing then says which build this stamp speaks for, so nothing can check it.');
          continue;
        }
        const build = steps.find((b) => b.id === call.buildStep);
        if (build === undefined || build.index >= s.index) {
          add(`${where} names --build-step ${call.buildStep}, and no earlier step of job "${job.name}" has that id.`);
          continue;
        }
        const define = RELEASE_CHANNEL_STAMP.exec(build.run?.text ?? '');
        if (define === null) {
          add(`${where} names --build-step ${call.buildStep}, and that step passes no --dart-define=RELEASE_CHANNEL.`);
          continue;
        }
        const built = unquoteToken(define[1]);
        if (built !== call.channel) {
          add(
            `${where} stamps --channel ${call.channel}, and the build it names (${wf.rel}:${build.first}, step "${build.name ?? build.id}") compiled RELEASE_CHANNEL=${built}.`,
            'The record would then offer these bytes to a channel their build was not made for.',
          );
        }
      }
    }

    // ── what the release downloads, and whether each installer in it is stamped ──
    for (const { job, steps } of jobs) {
      if (!steps.some((s) => /release-manifest\.mjs/.test(s.run?.text ?? '') && /(^|\s)--stage(\s|$)/.test(s.run?.text ?? ''))) continue;
      counts.stagers++;
      const downloadSteps = steps.map((s) => ({ s, w: stepWith(job, s) })).filter(({ w }) => /^actions\/download-artifact@/.test(w.uses ?? ''));
      const downloads = downloadSteps.map(({ w }) => w);
      if (downloads.length === 0) {
        lost.push(`${wf.rel} job "${job.name}" stages a release and holds no actions/download-artifact step, so which uploads reach it cannot be read.`);
        continue;
      }
      gradeAppsGovInDownload({ wf, job, downloadSteps, add: (msg, ...more) => findings.push({ limb: 10, msg, more }), counts });
      const reaches = downloads.map(downloadReaches);
      for (const { job: upJob, steps: upSteps } of jobs) {
        for (const u of upSteps) {
          const w = stepWith(upJob, u);
          if (!/^actions\/upload-artifact@/.test(w.uses ?? '')) continue;
          const name = w.with.get('name')?.[0] ?? '';
          if (!reaches.some((r) => r(name))) continue;
          counts.releaseBound++;
          const paths = (w.with.get('path') ?? []).map(normExpr);
          for (const p of paths.filter(isInstallerPath)) {
            counts.installerPaths++;
            const where = `${wf.rel}:${u.first} (job "${upJob.name}", upload "${name}")`;
            if (!paths.includes(channelStampName(p))) {
              add(`${where} ships ${p} and not ${channelStampName(p)}.`, 'The release would download an installer with no stamp beside it, and --stage refuses that (COVERAGE LOST) on the release run.');
            }
            const stamped = upSteps.some((s) => s.index < u.index && /stamp-channel\.mjs/.test(s.run?.text ?? '') && stampCall(s.run.text).files.includes(p));
            if (!stamped) add(`${where} ships ${p}, and no earlier step of job "${upJob.name}" runs stamp-channel.mjs on exactly that path.`);
          }
        }
      }
    }
  }
  if (counts.stagers === 0) lost.push('no workflow runs release-manifest.mjs --stage, so no upload is known to reach a release and limb 9 graded nothing.');
  else if (counts.installerPaths === 0) lost.push('no upload the release job downloads names an installer path, so limb 9 graded nothing: the release would stage nothing.');
  return { findings, lost, counts };
}

/**
 * LIMB 10 — ⏱ 2026-09-24 (O-APPS-GOV-IN-CHANNEL-APK). The release job takes the
 * apps.gov.in .apk only under the one name an owner may upload, the answer of
 * assert-apps-gov-in-apk.mjs `uploadableArtifactName` for the app `${{ matrix.app }}`,
 * imported so the name is typed in one file. For one stager job:
 *   · it downloads exactly one artifact whose name starts as that name does, and
 *     by a `pattern:` equal to it. A `name:` is refused: download-artifact v4.3.0
 *     throws when a named artifact is missing, and this one is missing on every
 *     run until the owner's pin is set (O-APPS-GOV-IN-SIGNING-KEY);
 *   · none of its downloads reaches a NOT-FOR-UPLOAD name (a glob such as
 *     `apps-gov-in-*`, or a download with neither `pattern:` nor `name:`).
 */
function gradeAppsGovInDownload({ wf, job, downloadSteps, add, counts }) {
  const app = normExpr('${{ matrix.app }}');
  const want = normExpr(uploadableArtifactName(app));
  const prefix = want.slice(0, want.indexOf(app));
  const notForUpload = `${want}-NOT-FOR-UPLOAD-release-signed-unpinned`;
  const target = (w) => w.with.get('pattern')?.[0] ?? w.with.get('name')?.[0] ?? null;
  const agi = downloadSteps.filter(({ w }) => normExpr(target(w) ?? '').startsWith(prefix));
  if (agi.length !== 1) {
    add(
      `${wf.rel} job "${job.name}" stages a release and holds ${agi.length} download(s) of an ${prefix}… artifact; it needs exactly one, of ${want}.`,
      'With none, the uploadable .apk never reaches the record; with two, the second one is a name nobody graded.',
    );
  }
  for (const { s, w } of agi) {
    counts.agiDownloads++;
    const where = `${wf.rel}:${s.first} (job "${job.name}")`;
    if (w.with.has('name')) {
      add(
        `${where} downloads the apps.gov.in .apk by \`name:\`.`,
        'download-artifact v4.3.0 throws when a named artifact is missing, and this one is missing on every run until the owner\'s pin is set. Use `pattern:` with the exact name.',
      );
    } else if (normExpr(target(w)) !== want) {
      add(
        `${where} downloads ${target(w)}, and the one apps.gov.in name an owner may upload is ${want} (assert-apps-gov-in-apk.mjs uploadableArtifactName).`,
        'Any other name puts an unpinned or debug-signed .apk into the record under apps-gov-in.',
      );
    }
  }
  for (const { s, w } of downloadSteps) {
    if (downloadReaches(w)(notForUpload)) {
      add(`${wf.rel}:${s.first} (job "${job.name}") downloads ${target(w) ?? 'every artifact of the run'}, which reaches ${notForUpload}: a NOT-FOR-UPLOAD .apk would be staged.`);
    }
  }
}

function reportStatic({ findings, lost, counts }) {
  if (findings.length) {
    console.error(`✗ ${findings.length} finding(s) in the stamp wiring:`);
    for (const f of findings) {
      console.error(`  [limb ${f.limb}] ${f.msg}`);
      for (const m of f.more) console.error(`      ${m}`);
    }
    return 1;
  }
  if (lost.length) {
    for (const l of lost) console.error(`✗ COVERAGE LOST — ${l}`);
    return 2;
  }
  console.log(`ok  limb 9: ${counts.stampSteps} stamp step(s) each paired with its build's RELEASE_CHANNEL; ${counts.installerPaths} installer path(s) in ${counts.releaseBound} release-bound upload(s), each stamped and shipped with its .channel.json; limb 10: ${counts.agiDownloads} apps.gov.in download(s), each of the UPLOADABLE name only`);
  return 0;
}

/* ───────────────────────────── the self test ────────────────────────────── */

/**
 * 🔴 THE NEGATIVES ARE BUILT, NOT CHECKED IN. Twelve fixture directories each
 * needing a byte-correct SHA256SUMS is twelve files that go stale the first
 * time the manifest header gains a line — and a fixture whose manifest no
 * longer parses makes every case fail for the same wrong reason. Each case
 * here starts from a VALID release built by the real emitter and breaks exactly
 * one thing, so a case can only fail for the reason it names.
 *
 * It runs with nothing installed, reaches no network and writes only inside
 * `os.tmpdir()`, which is what lets ci.yml and spec-guards.mjs both call it.
 */
export function selfTest(root) {
  const register = loadRegister(root);
  const schema = loadSchema(root);
  const work = mkdtempSync(join(tmpdir(), 'release-json-selftest-'));
  let failures = 0;
  const cases = [];

  /** Build a valid release directory: three assets, the record, the manifest —
   *  in the lane's own order, through the lane's own functions. */
  const makeValid = (dir, { tag = 'subscriptiontracker-v1.0.0', version = '1.0.0' } = {}) => {
    // ⏱ 2026-09-24 — each installer carries its build's stamp, as `--stage` hands
    // it on (O-RELEASE-RECORD-GUESSES-CHANNEL-FROM-EXTENSION); the archive has none.
    const files = [
      { name: 'subscriptiontracker-v1.0.0-app-release.aab', body: 'aab', channel: 'android-play' },
      { name: 'subscriptiontracker-v1.0.0-app-release.apk', body: 'apk', channel: 'apps-gov-in' },
      { name: 'subscriptiontracker-v1.0.0-linux-x64.tar.gz', body: 'tgz', channel: null },
    ];
    for (const f of files) writeFileSync(join(dir, f.name), f.body);
    const stampOf = (f) => (f.channel === null
      ? null
      : { channel: f.channel, file: f.name.replace(/^subscriptiontracker-v1\.0\.0-/, ''), sha256: sha256Of(join(dir, f.name)), runId: '1' });
    const record = buildReleaseJson({
      app: 'subscriptiontracker',
      surface: 'app',
      tag,
      sha: 'a'.repeat(40),
      runUrl: 'https://github.com/nikatru/x/actions/runs/1',
      notesUrl: 'https://github.com/nikatru/x/releases/tag/t',
      releasedAt: '2026-09-22T10:00:00Z',
      version,
      minSupported: '1.0.0',
      build: '7',
      register,
      treeRoot: root,
      files: files.map((f) => ({ name: f.name, sha256: sha256Of(join(dir, f.name)), size: statSync(join(dir, f.name)).size, stamp: stampOf(f) })),
    });
    return { record, files };
  };

  /** Write the record, then the manifest OVER the directory as it then stands —
   *  the emit-then-write order the lane uses. */
  const seal = (dir, record) => {
    writeFileSync(join(dir, RELEASE_JSON_NAME), `${JSON.stringify(record, null, 2)}\n`);
    const entries = assetFiles(dir).names.map((n) => ({ name: n, hash: sha256Of(join(dir, n)) }));
    writeFileSync(join(dir, MANIFEST_NAME), renderManifest({ app: record.unit, tag: record.tag, sha: record.commit, runUrl: record.runUrl, entries }));
  };

  let n = 0;
  const check = (name, expect, mutate) => {
    const dir = join(work, `case-${String(++n).padStart(2, '0')}`);
    mkdirSync(dir, { recursive: true });
    const { record } = makeValid(dir);
    const sealed = mutate(record, dir);
    if (sealed !== 'already-sealed') seal(dir, record);
    const { findings } = gradeRelease({ dir, schema, register });
    const text = findings.map((f) => `[limb ${f.limb}] ${f.msg}`).join('\n');
    const ok = expect === null ? findings.length === 0 : findings.some((f) => `${f.msg}`.includes(expect) || `limb ${f.limb}` === expect);
    cases.push({ name, ok, findings: findings.length, text });
    if (!ok) failures++;
  };

  check('a valid release passes', null, () => {});
  check('a described artefact that is not there', 'is not in', (r) => { r.artefacts[0].name = 'subscriptiontracker-v1.0.0-ghost.aab'; });
  check('a file the record is silent about', 'does not describe it', (r, dir) => { writeFileSync(join(dir, 'subscriptiontracker-v1.0.0-extra.apk'), 'x'); });
  check('the same name described twice', 'is described twice', (r) => { r.artefacts.push({ ...r.artefacts[0] }); });
  check('a zero-length asset', 'size', (r, dir) => { writeFileSync(join(dir, r.artefacts[0].name), ''); r.artefacts[0].size = 0; });
  check('a size that is not the file size', 'bytes, the file is', (r) => { r.artefacts[0].size = 99999; });
  check('bytes that drifted after the record', 'the bytes hash to', (r, dir) => { seal(dir, r); writeFileSync(join(dir, r.artefacts[0].name), 'drifted'); return 'already-sealed'; });
  check('a sha256 of the wrong length', 'schema:', (r) => { r.artefacts[0].sha256 = 'abc123'; });
  check('a missing sha256', 'schema:', (r) => { delete r.artefacts[0].sha256; });
  check('a missing minSupported', 'schema:', (r) => { delete r.minSupported; });
  check('a version that is not semver', 'schema:', (r) => { r.artefacts[0].version = 'v1'; });
  check('an artefact list with nothing in it', 'schema:', (r) => { r.artefacts = []; });
  check('a property nobody declared', 'schema:', (r) => { r.artefacts[0].signedBy = 'someone'; });
  check('a channel id the register does not declare', 'does not declare', (r) => { r.artefacts[0].channels = ['play-store-eu']; });
  check('a channel id from the other surface', 'is not on the', (r) => { r.artefacts[0].channels = ['chrome-webstore']; });
  check('a version that disagrees with the tag', 'the tag says', (r) => { for (const a of r.artefacts) a.version = '3.4.0'; });
  check('a minSupported newer than the release', 'is newer than the release', (r) => { r.minSupported = '9.9.9'; });
  check('a manifest that never heard of the record', 'does not list release.json', (r, dir) => {
    seal(dir, r);
    const entries = assetFiles(dir).names.filter((x) => x !== RELEASE_JSON_NAME).map((x) => ({ name: x, hash: sha256Of(join(dir, x)) }));
    writeFileSync(join(dir, MANIFEST_NAME), renderManifest({ app: r.unit, tag: r.tag, sha: r.commit, runUrl: r.runUrl, entries }));
    return 'already-sealed';
  });
  check('a manifest header naming another tag', 'manifest header says tag', (r, dir) => {
    seal(dir, r);
    const entries = assetFiles(dir).names.map((x) => ({ name: x, hash: sha256Of(join(dir, x)) }));
    writeFileSync(join(dir, MANIFEST_NAME), renderManifest({ app: r.unit, tag: 'subscriptiontracker-v9.9.9', sha: r.commit, runUrl: r.runUrl, entries }));
    return 'already-sealed';
  });
  check('the untagged sentinel still grades', null, (r) => { r.tag = 'subscriptiontracker-untagged-abc1234'; });

  // ── limbs 9 and 10 (static): the real workflows, then three mutations of build-platforms.yml ──
  // Each mutation is ONE text edit of the real file, anchored on text that must
  // occur exactly once, so a case can only fail for the reason it names. An anchor
  // that moved fails the case, never skips it.
  // LANE-BOUND: build-platforms.yml — ONLY for these three mutation cases, never for the limb. gradeStampWiring
  // finds every workflow that runs `--stage` and grades each; the mutations need real text to break, and
  // the one staging lane today is build-platforms.yml, whose apps.gov.in stamp and Play .apk are the defect.
  const staticCase = (name, expect, mutation) => {
    let tree = root;
    if (mutation !== null) {
      const rel = '.github/workflows/build-platforms.yml';
      const text = readFileSync(join(root, rel), 'utf8');
      const [from, to] = mutation;
      if (text.split(from).length !== 2) {
        cases.push({ name, ok: false, findings: 0, text: `the mutation anchor is not exactly once in ${rel}: ${JSON.stringify(from)}` });
        failures++;
        return;
      }
      tree = join(work, `static-${String(++n).padStart(2, '0')}`);
      mkdirSync(join(tree, '.github', 'workflows'), { recursive: true });
      writeFileSync(join(tree, rel), text.replace(from, () => to));
    }
    const { findings, lost } = gradeStampWiring({ root: tree, register });
    const text = [...findings.map((f) => `[limb ${f.limb}] ${f.msg}`), ...lost.map((l) => `COVERAGE LOST — ${l}`)].join('\n');
    const ok = expect === null ? findings.length === 0 && lost.length === 0 : findings.some((f) => f.msg.includes(expect));
    cases.push({ name, ok, findings: findings.length, text });
    if (!ok) failures++;
  };
  staticCase('limb 9: the real workflows pair every stamp with its build, and stamp every installer the release downloads', null, null);
  staticCase(
    'limb 9: a stamp step saying android-play over the build that compiled apps-gov-in',
    'compiled RELEASE_CHANNEL=apps-gov-in',
    ['--channel apps-gov-in --build-step build_apk_agi', '--channel android-play --build-step build_apk_agi'],
  );
  staticCase(
    'limb 10: the release job downloading the NOT-FOR-UPLOAD apps.gov.in name',
    'the one apps.gov.in name an owner may upload is apps-gov-in-${{matrix.app}}-apk',
    ['          pattern: apps-gov-in-${{ matrix.app }}-apk\n', '          pattern: apps-gov-in-${{ matrix.app }}-apk-NOT-FOR-UPLOAD-release-signed-unpinned\n'],
  );
  staticCase(
    'limb 9: the Play .apk put back into the <app>-* upload the release downloads',
    'flutter-apk/*.apk and not',
    [
      '            apps/${{ matrix.app }}/build/app/outputs/bundle/release/*.aab\n',
      '            apps/${{ matrix.app }}/build/app/outputs/flutter-apk/*.apk\n            apps/${{ matrix.app }}/build/app/outputs/bundle/release/*.aab\n',
    ],
  );

  for (const c of cases) console.log(`${c.ok ? 'pass' : 'FAIL'}  ${c.name}${c.ok ? '' : `\n      got ${c.findings} finding(s):\n${c.text.replace(/^/gm, '      ')}`}`);
  console.log(`\n${cases.length - failures} pass, ${failures} fail`);
  rmSync(work, { recursive: true, force: true });
  return failures === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
