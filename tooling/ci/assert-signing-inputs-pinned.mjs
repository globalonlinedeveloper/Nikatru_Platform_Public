#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-signing-inputs-pinned.mjs — no job that holds a signing key downloads
// a build input it has not checked against a pinned sha256 first.
//
// Finding rv2-security-003 (full review r2, 2026-09-23; low): the Flutter SDK
// and the Gradle distribution were downloaded WITHOUT A DIGEST in the jobs that
// hold the Android upload keystore and the Apple distribution certificate.
// subosito/flutter-action curls the SDK archive and uses the release manifest's
// sha256 only as a cache key; gradle-wrapper.properties carried no
// distributionSha256Sum. A tampered archive served at the pinned URL would have
// run with the keys in its environment and signed a backdoored build, and
// nothing in CI could have noticed.
//
// ── WHAT IS A SIGNING JOB ────────────────────────────────────────────────────
// A job of .github/workflows/*.yml that reads `secrets.<NAME>` where NAME is
// signing material on a channel row of tooling/channel-register.json
// (`channels[].signing.ciSecrets.names`). The register is the authority for
// what is signing material; this guard does not keep a list of its own.
//
// ── WHAT IT ASSERTS, IN EVERY SIGNING JOB (and every local composite it calls) ─
//   D  every `curl` / `wget` / `Invoke-WebRequest` that writes a file is followed,
//      IN THE SAME STEP, by a sha256 check (`sha256sum --check`, `shasum -a 256
//      --check`, `Get-FileHash`) — or the step is tooling/ci/install-pinned-tool.mjs,
//      which verifies by construction. A download piped into a shell or into
//      `tar`/`unzip` is refused outright: nothing can check it before it runs.
//   F  a toolchain installer (`subosito/flutter-action`, any `*/setup-*`, any
//      `*install*` action) is one of: GitHub's first-party setup actions, named
//      below and PRINTED as the gap they are on every run; or subosito in the
//      VERIFIED SHAPE — its `cache` input the literal 'false' (its cache restores
//      an SDK tree over the path, and a tree cannot be checked against an archive
//      digest), its `cache-path` the output of an EARLIER step of the same list
//      that downloads, checks and only then extracts, with no `if:`, no
//      `continue-on-error`, no `set +e` and no `||` after the check. setup.sh at
//      the pinned sha downloads nothing when `<cache-path>/flutter/bin/flutter`
//      already exists (setup.sh:225), so that shape is "verified before use".
//      Anything else is a finding.
//   G  when the job builds Android (`flutter build apk|appbundle|aar`, or
//      `gradlew`), every gradle-wrapper.properties in the tree carries a
//      `distributionSha256Sum` of 64 hex characters beside an https
//      services.gradle.org `distributionUrl`. The wrapper then refuses a
//      distribution whose bytes differ.
//   V  when the job builds Android, every Gradle project beside such a wrapper
//      carries `gradle/verification-metadata.xml` [rv2-security-003 stage (b)]:
//      `<verify-metadata>true</verify-metadata>`, at least one component, a
//      64-lowercase-hex `<sha256>` on EVERY artifact (an md5/sha1-only artifact is
//      a finding), and no `<trust>` rule beyond -sources/-javadoc jars. Neither the
//      project's gradle.properties nor the signing job may turn verification
//      `off` or `lenient` (`org.gradle.dependency.verification`,
//      `--dependency-verification`, `-F`). Gradle then refuses a Maven, Gradle
//      plugin or Flutter engine artefact (io.flutter:*) whose bytes differ — the
//      check itself is Gradle's, measured 2026-10-01: one digit of the
//      flutter_embedding_release sha256 changed and `flutter build apk --release`
//      exited 1, "Dependency verification failed for configuration
//      ':app:releaseRuntimeClasspath'". This limb proves the file is there and
//      cannot be read as "verify nothing"; it cannot tell a well-formed wrong
//      digest from a right one, which is the build's job.
//      ⚠️ REGENERATE IT WITH EVERY FLUTTER, AGP, KOTLIN, GRADLE OR ANDROID-PLUGIN
//      BUMP — the engine artefacts carry the engine hash in their version, so a
//      Flutter bump alone is a new set. On Linux (aapt2 is OS-classified; the
//      Windows host cannot build Android at all, docs/environment.md), from
//      apps/<app>/: `flutter build appbundle --debug` and `flutter build appbundle
//      --release` once each (Flutter writes android/gradlew and the mode's plugin
//      registrant), then in android/ re-run the Gradle command `flutter build -v`
//      prints with `--write-verification-metadata sha256` for bundleDebug,
//      assembleDebug, bundleRelease and assembleRelease (debug and release
//      separately: the registrant differs by mode), with
//      `org.gradle.dependency.verification=lenient` in ~/.gradle/gradle.properties
//      ONLY while generating. Gradle merges into the existing file.
//      APP #2: the brick stamps no android/ today (2026-10-01). Once native
//      folders are stamped (lane syn-p44), the stamped app's — and the brick's
//      own `{{app_id}}/android/gradle/wrapper/` — gradle-wrapper.properties is
//      found by wrapperFiles() like the flagship's, so this limb demands a
//      verification-metadata.xml beside each one with no change here. Stamp the
//      flagship's file with it (same Flutter, AGP, Kotlin and plugin set, same
//      artefacts), and regenerate it in that app the day its set diverges.
//   P  tooling/versions.json binds the Flutter archive digests to the version:
//      `flutter_sha256_version` equals `flutter`, and every runner OS a job that
//      calls ./.github/actions/setup-flutter names by a literal label has its
//      `flutter_<os>_<arch>_sha256`. A Renovate bump of `flutter` alone is RED
//      HERE, at the pull request, instead of at the next signing dispatch.
//
// ── COVERAGE ─────────────────────────────────────────────────────────────────
// Exit 2 — COVERAGE LOST — when the register names no signing secret, when no
// workflow job reads one (zero signing jobs placed), when a composite a signing
// job calls is not on disk, or when a signing job builds Android and the tree
// holds no gradle-wrapper.properties at all (limbs G and V both key on the
// wrapper, so no wrapper is no project to judge). Each of those would otherwise
// print "clean" over nothing.
//
// ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────────
// It does not verify a digest against the network: the values are copied from
// the publisher (Google's releases_<os>.json, services.gradle.org's .sha256)
// and the build itself refuses bytes that disagree. What Gradle fetches after
// install (Maven dependencies, the Flutter engine's io.flutter artefacts) is
// limb V's, through Gradle's own dependency verification. What the Flutter
// TOOL fetches outside Gradle (the engine cache under bin/cache, pub packages)
// is not: pub is pinned by pubspec.lock's sha256, the engine cache by the SDK
// archive limb F verifies.
//
// Usage:  node tooling/ci/assert-signing-inputs-pinned.mjs [repoRoot]
// Exit 0 = clean. Exit 1 = a finding. Exit 2 = COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { joinBlockScalars, parseAllWorkflows, parseWorkflow, workflowSteps } from './workflow-scan.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER_REL = 'tooling/channel-register.json';
const VERSIONS_REL = 'tooling/versions.json';
const SETUP_FLUTTER = './.github/actions/setup-flutter';

/** GitHub's own setup actions. On a hosted runner the pinned majors are served
 *  from the image's tool cache; none of them checks a digest we pin, and that is
 *  printed on every run rather than passed over in silence. */
export const FIRST_PARTY_INSTALLERS = new Map([
  ['actions/setup-java', 'GitHub first-party; JDK 17 is in the hosted image tool cache. No digest of ours is checked.'],
  ['actions/setup-node', 'GitHub first-party; the node major is in the hosted image tool cache. No digest of ours is checked.'],
]);

/** A `uses:` repository that installs a toolchain. */
export const INSTALLER = /^subosito\/flutter-action$|(?:^|\/)setup-[A-Za-z0-9_.-]+$|install/i;

/** A sha256 CHECK, as the shells in this tree write one. */
export const CHECK = /\b(?:sha256sum\s+(?:-c|--check)\b|shasum\s+-a\s*256\s+(?:-c|--check)\b|Get-FileHash\b)/g;
export const DOWNLOAD = /\b(?:curl|wget|Invoke-WebRequest|iwr)\b/g;
export const EXTRACT = /\b(?:tar\s+-?[A-Za-z]*x[A-Za-z]*|unzip|Expand-Archive|7z\s+x)\b/g;
const PINNED_INSTALLER = /(?:^|[\s;])node\s+(?:\S*\/)?tooling\/ci\/install-pinned-tool\.mjs\b/;
/** A step that runs Gradle: `flutter build apk|appbundle|aar`, the release composer
 *  (`tooling/ci/flutter-release-build.mjs <app> <target> <channel>`) with one of those
 *  targets, or gradlew itself — read off the job's comment-blanked logical lines. */
export const ANDROID_BUILD =
  /\bflutter\s+build\s+(?:apk|appbundle|aar)\b|tooling\/ci\/flutter-release-build\.mjs\s+\S+\s+(?:apk|appbundle|aar)\b|(?:^|[\s/])gradlew(?:\.bat)?\b/;
const STEP_OUTPUT = /^\$\{\{\s*steps\.([A-Za-z_][A-Za-z0-9_-]*)\.outputs\.([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}$/;

/** Runner label → the versions.json digest key its Flutter archive needs. */
export function flutterDigestKeyForLabel(label) {
  if (/^ubuntu-/.test(label)) return 'flutter_linux_x64_sha256';
  if (/^windows-/.test(label)) return 'flutter_windows_x64_sha256';
  if (/^macos-.*(?:intel|large)$|^macos-1[0-3]$/.test(label)) return 'flutter_macos_x64_sha256';
  if (/^macos-/.test(label)) return 'flutter_macos_arm64_sha256';
  return null;
}

const unquote = (s) => String(s ?? '').trim().replace(/^(['"])(.*)\1$/, '$2');
const repoOf = (uses) => String(uses ?? '').split('@')[0].split('/').slice(0, 2).join('/');
const indicesOf = (re, text) => [...String(text).matchAll(new RegExp(re.source, 'g'))].map((m) => m.index);
/** The command a match starts, up to the next ` ; ` the block-scalar join inserts, `&&`, or end. */
const commandFrom = (text, at) => {
  const rest = text.slice(at);
  const end = rest.search(/\s;\s|&&/);
  return end === -1 ? rest : rest.slice(0, end);
};

/** The signing secret names, union over every channel row. */
export function signingSecretNames(register) {
  return new Set((register?.channels ?? []).flatMap((c) => c?.signing?.ciSecrets?.names ?? []));
}

/** A composite action's steps, in the same model workflowSteps gives a job: the
 *  file is shifted two columns so its `runs: steps:` sits where a job's does. */
export function compositeSteps(root, rel) {
  const parsed = parseWorkflow(root, rel);
  if (!parsed) return null;
  const lines = parsed.lines.map((l) => ({ n: l.n, text: l.text === '' ? '' : `  ${l.text}` }));
  return { rel, steps: workflowSteps({ lines, logical: joinBlockScalars(lines) }), lines };
}

/** Limb D over one `run:` body. Returns finding strings. */
export function downloadFindings(runText, where) {
  const text = String(runText ?? '');
  if (PINNED_INSTALLER.test(text)) return [];
  const checks = indicesOf(CHECK, text);
  const out = [];
  for (const at of indicesOf(DOWNLOAD, text)) {
    const cmd = commandFrom(text, at);
    const tool = cmd.match(DOWNLOAD)?.[0] ?? 'download';
    if (/\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b|\|\s*(?:tar|unzip|iex|Invoke-Expression)\b/.test(cmd)) {
      out.push(`${where}: \`${tool}\` pipes a download straight into a shell or an extractor, so nothing checks it before it runs. Download to a file, check its sha256 against a pin, then use it.`);
      continue;
    }
    const writes = /^wget\b/.test(cmd) || /\s(?:-o|--output|-O|--remote-name|-OutFile)(?=\s|=|$)|\s>\s*\S/.test(cmd);
    if (!writes) continue;
    if (!checks.some((c) => c > at)) {
      out.push(`${where}: \`${tool}\` downloads a file in a job that holds signing keys, and no sha256 check (\`sha256sum --check\`, \`shasum -a 256 --check\`, \`Get-FileHash\`) follows it in the step. Check it against a digest pinned in ${VERSIONS_REL}, or install it through tooling/ci/install-pinned-tool.mjs.`);
    }
  }
  return out;
}

/** Limb F: is the installer at `steps[i]` subosito in the verified shape? */
export function verifiedSetupFindings(steps, i, where, rawLines) {
  const s = steps[i];
  const out = [];
  const cache = s.with.get('cache');
  if (!cache || unquote(cache.value) !== 'false') {
    out.push(`${where}:${s.first} subosito/flutter-action runs with \`cache\` ${cache ? `\`${cache.value}\`` : 'unset (its default is the action\'s own)'}; it must be the literal 'false' — its cache restores an SDK TREE over the path, and a tree cannot be checked against the archive digest.`);
  }
  const cp = s.with.get('cache-path');
  const m = cp ? String(cp.value).trim().match(STEP_OUTPUT) : null;
  if (!m) {
    out.push(`${where}:${s.first} subosito/flutter-action's \`cache-path\` is ${cp ? `\`${cp.value}\`` : 'unset'}; it must be \`\${{ steps.<id>.outputs.<key> }}\` of the earlier step that downloads, checks and extracts the archive — otherwise setup.sh downloads the archive itself, unchecked.`);
    return out;
  }
  const [, id, key] = m;
  const vi = steps.findIndex((x) => x.id === id);
  if (vi === -1 || vi >= i) {
    out.push(`${where}:${s.first} subosito/flutter-action's \`cache-path\` reads step \`${id}\`, which is ${vi === -1 ? 'not a step of this list' : 'not BEFORE it'}.`);
    return out;
  }
  const v = steps[vi];
  const text = v.run?.text ?? '';
  const at = `${where}:${v.first} (step \`${id}\`, the one subosito's cache-path reads)`;
  if (v.cond !== null) out.push(`${at} carries \`if: ${v.cond}\`; the check must run on every path, or setup.sh downloads unchecked when it is skipped.`);
  const body = (rawLines ?? []).filter((l) => l.n >= v.first && l.n <= v.last).map((l) => l.text).join('\n');
  if (/^\s*continue-on-error:\s*(?!false\b)\S/m.test(body)) out.push(`${at} carries \`continue-on-error\`; a failed check would then hand subosito the path anyway.`);
  if (!text) {
    out.push(`${at} is not a \`run:\` step, so nothing in it checks a digest.`);
    return out;
  }
  if (/\bset\s+\+e\b/.test(text)) out.push(`${at} turns \`set +e\` on, so a failed check does not stop the step.`);
  const checks = indicesOf(CHECK, text);
  const downloads = indicesOf(DOWNLOAD, text);
  const extracts = indicesOf(EXTRACT, text);
  // Every regex metacharacter escaped, not only `-` (CodeQL js/incomplete-sanitization, #540).
  const writes = text.search(new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}=`));
  if (checks.length === 0) {
    out.push(`${at} runs no sha256 check (\`sha256sum --check\` / \`shasum -a 256 --check\`), so the archive it extracts is unverified.`);
    return out;
  }
  for (const c of checks) {
    if (/\|\|/.test(commandFrom(text, c))) out.push(`${at} follows its sha256 check with \`||\`, which lets a mismatch through.`);
  }
  if (downloads.length && Math.max(...downloads) > Math.min(...checks)) out.push(`${at} downloads AFTER its first sha256 check, so the bytes it extracts are not the bytes it checked.`);
  if (extracts.length === 0) out.push(`${at} extracts nothing, so setup.sh finds no SDK at the path and downloads its own, unchecked.`);
  else if (Math.min(...extracts) < Math.min(...checks)) out.push(`${at} extracts BEFORE it checks the archive's sha256.`);
  if (writes === -1) out.push(`${at} never writes the output \`${key}\` subosito's cache-path reads.`);
  else if (writes < Math.min(...checks)) out.push(`${at} writes \`${key}=\` before the check, so the path can exist without verified bytes behind it.`);
  return out;
}

/** Every gradle-wrapper.properties under apps/ and tooling/bricks/. */
export function wrapperFiles(root) {
  const found = [];
  const walk = (rel, depth) => {
    const abs = join(root, rel);
    if (depth > 12 || !existsSync(abs)) return;
    for (const name of listDir(abs)) {
      const child = rel ? `${rel}/${name}` : name;
      if (name === 'gradle-wrapper.properties') found.push(child);
      else if (!/\.[A-Za-z0-9]+$/.test(name) || name.startsWith('{{')) {
        // `ephemeral` / `.plugin_symlinks` / `.symlinks`: what `flutter pub get` links
        // in, gitignored — third-party plugin and example projects nothing here builds.
        // Absent from a CI clone, so skipping them makes a pub-got checkout judge the
        // same set CI does (it found 13 extra wrappers, 2026-10-01).
        if (['node_modules', 'build', '.dart_tool', '.gradle', 'Pods', 'ephemeral', '.plugin_symlinks', '.symlinks'].includes(name)) continue;
        try {
          walk(child, depth + 1);
        } catch {
          // a file with no extension, not a directory
        }
      }
    }
  };
  for (const top of ['apps', 'tooling/bricks']) walk(top, 0);
  return found.sort();
}

/** Limb G over one wrapper file's text. */
export function wrapperFindings(rel, text) {
  const props = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*[#!]/.test(line) || !line.includes('=')) continue;
    const i = line.indexOf('=');
    props.set(line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/\\:/g, ':'));
  }
  const url = props.get('distributionUrl');
  const sum = props.get('distributionSha256Sum');
  const out = [];
  if (!url || !/^https:\/\/services\.gradle\.org\/distributions\/gradle-[0-9A-Za-z.+-]+\.zip$/.test(url)) {
    out.push(`${rel}: distributionUrl ${url ? `\`${url}\`` : 'is missing'}; it must be an https services.gradle.org distribution.`);
  }
  if (!sum || !/^[0-9a-f]{64}$/.test(sum)) {
    out.push(`${rel}: ${sum ? `distributionSha256Sum \`${sum}\` is not 64 lowercase hex` : 'carries no distributionSha256Sum'}, so the wrapper runs whatever bytes it is served. Copy the value from ${url ? `${url}.sha256` : 'the distribution\'s .sha256'}.`);
  }
  return out;
}

/** The Gradle project a wrapper belongs to: `<project>/gradle/wrapper/gradle-wrapper.properties`. */
export const gradleProjectOf = (wrapperRel) => String(wrapperRel).replace(/\/?gradle\/wrapper\/gradle-wrapper\.properties$/, '');
const inProject = (project, rel) => (project ? `${project}/${rel}` : rel);

/** A setting that turns Gradle's dependency verification off or lenient, in a
 *  gradle.properties line or on a command line. */
export const VERIFICATION_OFF =
  /org\.gradle\.dependency\.verification\s*[=:]\s*['"]?(?:off|lenient)\b|--dependency-verification(?:=|\s+)['"]?(?:off|lenient)\b|(?:^|\s)-F\s*['"]?(?:off|lenient)\b/i;

/** Limb V over one verification-metadata.xml. Returns finding strings. */
export function verificationFindings(rel, text) {
  // Comments stripped to a FIXED POINT, then REFUSED if an opener survives: one
  // pass re-forms `<!<!---->--` into a comment and leaves what it hides readable
  // as a listing (CodeQL js/incomplete-multi-character-sanitization, #1154). The
  // same rule as apple-provisioning.mjs parseFlatDict: a parser, not a sanitiser.
  let xml = String(text ?? '');
  for (let prev = null; prev !== xml; ) {
    prev = xml;
    xml = xml.replace(/<!--[\s\S]*?-->/g, '');
  }
  if (xml.includes('<!--')) return [`${rel}: carries an unterminated or re-formed XML comment, so what it hides cannot be told from what it lists — refused, never read around.`];
  const out = [];
  if (!/<verification-metadata\b/.test(xml)) return [`${rel}: is not Gradle dependency-verification metadata (no <verification-metadata> root).`];
  if (!/<verify-metadata>\s*true\s*<\/verify-metadata>/.test(xml)) {
    out.push(`${rel}: <verify-metadata> is not \`true\`, so a .pom or .module Gradle reads is not checked and can redirect what it resolves.`);
  }
  const components = [...xml.matchAll(/<component\b[^>]*>([\s\S]*?)<\/component>/g)];
  if (components.length === 0) out.push(`${rel}: lists no <component>, so every artefact a build resolves is unlisted — strict mode fails it, and any lenient mode passes it unchecked.`);
  let artifacts = 0;
  for (const [, body] of components) {
    for (const a of body.matchAll(/<artifact\b[^>]*\bname="([^"]*)"[^>]*>([\s\S]*?)<\/artifact>/g)) {
      artifacts++;
      const sums = [...a[2].matchAll(/<sha256\b[^>]*\bvalue="([^"]*)"/g)].map((m) => m[1]);
      if (sums.length === 0) out.push(`${rel}: artifact ${a[1]} carries no <sha256> (md5 and sha1 are not a digest this repository accepts).`);
      for (const v of sums) if (!/^[0-9a-f]{64}$/.test(v)) out.push(`${rel}: artifact ${a[1]} has sha256 \`${v}\`, which is not 64 lowercase hex.`);
    }
  }
  if (components.length && artifacts === 0) out.push(`${rel}: its components list no <artifact>, so nothing is checked.`);
  for (const m of xml.matchAll(/<trust\b([^>]*)\/?>/g)) {
    const file = m[1].match(/\bfile="([^"]*)"/)?.[1] ?? '';
    const scoped = /^\.\*-(?:sources|javadoc)\[\.\]jar$/.test(file) && !/\b(?:group|name|version)=/.test(m[1]);
    if (!scoped) out.push(`${rel}: a <trusted-artifacts> rule \`<trust${m[1].replace(/\s*\/$/, '')}/>\` skips verification for whatever it matches; only -sources/-javadoc jars may be trusted.`);
  }
  return out;
}

function main() {
  const findings = [];
  const lost = [];
  const notes = [];

  const register = existsSync(join(ROOT, REGISTER_REL)) ? JSON.parse(readFileSync(join(ROOT, REGISTER_REL), 'utf8')) : null;
  const names = signingSecretNames(register);
  if (names.size === 0) lost.push(`${REGISTER_REL} names no signing secret (channels[].signing.ciSecrets.names) — nothing can be classified as a signing job.`);

  const workflows = parseAllWorkflows(ROOT);
  const signingJobs = [];
  for (const wf of workflows) {
    for (const job of wf.jobs.values()) {
      const reads = new Set();
      for (const l of job.lines) for (const m of l.text.matchAll(/(?<![\w./-])secrets\.([A-Za-z_][A-Za-z0-9_]*)/g)) if (names.has(m[1])) reads.add(m[1]);
      if (reads.size) signingJobs.push({ wf, job, reads });
    }
  }
  if (names.size && signingJobs.length === 0) lost.push(`no job in .github/workflows reads any of the ${names.size} signing secret(s) ${REGISTER_REL} declares — zero signing jobs placed.`);

  const composites = new Map();
  const loadComposite = (uses) => {
    const rel = `${uses.replace(/^\.\//, '').replace(/\/$/, '')}/action.yml`;
    if (!composites.has(rel)) composites.set(rel, compositeSteps(ROOT, rel) ?? compositeSteps(ROOT, rel.replace(/\.yml$/, '.yaml')));
    return { rel, c: composites.get(rel) };
  };

  let judgedSteps = 0;
  let verifiedInstallers = 0;
  const judgedComposites = new Set();
  const judgeList = (steps, where, rawLines, depth) => {
    steps.forEach((s, i) => {
      judgedSteps++;
      if (s.run) findings.push(...downloadFindings(s.run.text, `${where}:${s.run.n}`));
      if (!s.uses) return;
      if (s.uses.startsWith('./')) {
        const { rel, c } = loadComposite(s.uses);
        if (!c) {
          lost.push(`${where}:${s.first} calls \`${s.uses}\`, and ${rel} is not on disk — its steps cannot be judged.`);
          return;
        }
        // One judgement per composite, however many signing jobs call it.
        if (depth < 3 && !judgedComposites.has(rel)) {
          judgedComposites.add(rel);
          judgeList(c.steps, rel, c.lines, depth + 1);
        }
        return;
      }
      const repo = repoOf(s.uses);
      if (!INSTALLER.test(repo)) return;
      if (FIRST_PARTY_INSTALLERS.has(repo)) {
        notes.push(`${where}:${s.first} ${repo} — ${FIRST_PARTY_INSTALLERS.get(repo)}`);
        return;
      }
      if (repo === 'subosito/flutter-action') {
        const f = verifiedSetupFindings(steps, i, where, rawLines);
        findings.push(...f);
        if (f.length === 0) verifiedInstallers++;
        return;
      }
      findings.push(`${where}:${s.first} \`${s.uses}\` installs a toolchain in a job that holds signing keys, and no digest pinned in this tree checks what it installs.`);
    });
  };

  let androidJobs = 0;
  for (const { wf, job, reads } of signingJobs) {
    const where = wf.rel;
    judgeList(workflowSteps(job), where, job.lines, 0);
    const buildsAndroid = job.logical.some((l) => ANDROID_BUILD.test(l.text));
    if (buildsAndroid) androidJobs++;
    if (buildsAndroid) {
      for (const l of job.lines) {
        if (VERIFICATION_OFF.test(l.text.replace(/(^|\s)#.*$/, ''))) findings.push(`${where}:${l.n} turns Gradle dependency verification off or lenient in a job that builds Android with signing keys: \`${l.text.trim()}\`.`);
      }
    }
    notes.push(`${where} job \`${job.name}\` holds ${[...reads].sort().join(', ')}${buildsAndroid ? ' and builds Android' : ''}`);
  }

  const wrappers = wrapperFiles(ROOT);
  if (androidJobs > 0 && wrappers.length === 0) lost.push(`${androidJobs} signing job(s) build Android and the tree holds no gradle-wrapper.properties under apps/ or tooling/bricks/ — the distribution digest cannot be judged.`);
  if (androidJobs > 0) for (const rel of wrappers) findings.push(...wrapperFindings(rel, readFileSync(join(ROOT, rel), 'utf8')));
  // Limb V — Gradle's dependency verification, per project beside a wrapper.
  let verifiedProjects = 0;
  if (androidJobs > 0) {
    for (const rel of wrappers) {
      const project = gradleProjectOf(rel);
      const meta = inProject(project, 'gradle/verification-metadata.xml');
      if (!existsSync(join(ROOT, meta))) {
        findings.push(`${meta}: missing. ${androidJobs} signing job(s) build Android, and without it Gradle fetches every Maven and Flutter engine artefact with no digest, with the keys in the job. Generate it with \`--write-verification-metadata sha256\` (tooling/ci/assert-signing-inputs-pinned.mjs, limb V, says how).`);
      } else {
        const f = verificationFindings(meta, readFileSync(join(ROOT, meta), 'utf8'));
        findings.push(...f);
        if (f.length === 0) verifiedProjects++;
      }
      const props = inProject(project, 'gradle.properties');
      if (existsSync(join(ROOT, props))) {
        readFileSync(join(ROOT, props), 'utf8').split(/\r?\n/).forEach((line, i) => {
          if (!/^\s*[#!]/.test(line) && VERIFICATION_OFF.test(line)) findings.push(`${props}:${i + 1} turns Gradle dependency verification off or lenient: \`${line.trim()}\`.`);
        });
      }
    }
  }

  // Limb P — the digests belong to the version, and every runner that installs has one.
  const versions = existsSync(join(ROOT, VERSIONS_REL)) ? JSON.parse(readFileSync(join(ROOT, VERSIONS_REL), 'utf8')) : null;
  if (!versions?.flutter) lost.push(`${VERSIONS_REL} carries no \`flutter\` version.`);
  else {
    if (versions.flutter_sha256_version !== versions.flutter) {
      findings.push(`${VERSIONS_REL}: the Flutter archive digests are for \`flutter_sha256_version\` ${JSON.stringify(versions.flutter_sha256_version)}, and \`flutter\` is ${JSON.stringify(versions.flutter)}. Copy each archive's sha256 for ${versions.flutter} from https://storage.googleapis.com/flutter_infra_release/releases/releases_<os>.json, then move flutter_sha256_version.`);
    }
    const needed = new Map();
    let unresolved = 0;
    for (const wf of workflows) {
      for (const job of wf.jobs.values()) {
        if (!workflowSteps(job).some((s) => s.uses === SETUP_FLUTTER)) continue;
        const ro = job.lines.map((l) => l.text.match(/^ {4}runs-on:\s*(\S.*?)\s*$/)).find(Boolean)?.[1];
        const label = ro ? unquote(ro) : null;
        const key = label && !label.includes('${{') ? flutterDigestKeyForLabel(label) : null;
        if (!key) {
          unresolved++;
          continue;
        }
        if (!needed.has(key)) needed.set(key, `${wf.rel} job ${job.name} (${label})`);
      }
    }
    for (const [key, who] of needed) {
      if (!/^[0-9a-f]{64}$/.test(String(versions[key] ?? ''))) findings.push(`${VERSIONS_REL}: \`${key}\` is ${versions[key] === undefined ? 'missing' : 'not 64 lowercase hex'}, and ${who} installs Flutter on that runner.`);
    }
    notes.push(`setup-flutter runners: ${[...needed.keys()].join(', ') || 'none'}${unresolved ? `; ${unresolved} job(s) name the runner by an expression and are covered by the composite's own refusal` : ''}`);
  }

  console.log(`assert-signing-inputs-pinned — ${signingJobs.length} signing job(s), ${judgedSteps} step(s) judged, ${verifiedInstallers} verified Flutter install(s), ${wrappers.length} gradle wrapper(s), ${verifiedProjects} verified Gradle project(s)`);
  for (const n of notes) console.log(`  · ${n}`);
  if (lost.length) {
    for (const l of lost) console.log(`COVERAGE LOST — ${l}`);
    return 2;
  }
  if (findings.length) {
    for (const f of findings) console.log(`FAIL — ${f}`);
    return 1;
  }
  console.log('ok — every download in a signing job is checked against a pinned sha256 before use, every gradle wrapper carries distributionSha256Sum, and every Gradle project verifies its dependencies');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main());
}
