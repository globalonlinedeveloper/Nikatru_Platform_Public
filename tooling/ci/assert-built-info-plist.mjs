#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-built-info-plist.mjs — read the two Info.plist keys app.yaml renders
// out of the BUILT Apple bundle, and refuse a bundle that does not carry them
// with the values the renderer says.
//
// O-APPLE-PLIST-KEYS-UNRENDERED. render.mjs writes LSApplicationCategoryType and
// ITSAppUsesNonExemptEncryption into apps/<id>/{ios,macos}/Runner/Info.plist,
// and assert-app-yaml grades those SOURCE files byte for byte. Neither proves
// what Xcode shipped: an `INFOPLIST_KEY_*` build setting or a plist merge can
// override the source file, and App Store review reads the bundle, not the repo.
// So this reads the bundle.
//
// ── WHAT IT READS ────────────────────────────────────────────────────────────
//   · an .app directory — macOS keeps its plist at Contents/Info.plist, iOS at
//     the bundle root, and that layout says which PLIST_KEY_TARGETS rows apply;
//   · an .ipa — the one Payload/<name>.app/Info.plist inside it, through the
//     shared unzip() in apple-signing.mjs; an .ipa is always iOS.
// An XML plist is parsed here. A binary plist (Xcode's output for a built
// bundle) is converted with `plutil -convert xml1` first, and read by the same
// parser; a binary plist on a machine with no plutil is COVERAGE LOST.
//
// ── WHERE THE EXPECTED VALUES COME FROM ──────────────────────────────────────
// render.mjs `plan()`: the Info.plist it plans for the app is parsed, and each
// PLIST_KEY_TARGETS key's value is read out of it. The keys are that table's
// rows, filtered to the bundle's platform; the values are the renderer's output.
// A plan with a problem or a COVERAGE LOST has no expected value to give, so
// that is COVERAGE LOST here too — assert-app-yaml names the cause.
//
// Usage:  node tooling/ci/assert-built-info-plist.mjs --app <id> <bundle>... [--repo-root <dir>]
// Exit 0 = every key present with the rendered value · 1 = a key missing or
// different · 2 = COVERAGE LOST (no bundle, an unreadable plist, no plan).
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan, APPS_DIR, PLIST_KEY_TARGETS } from '../app-yaml/render.mjs';
import { unzip } from './apple-signing.mjs';

/** The plutil binary. An override exists so a test can take plutil away on a
 *  machine that has it; nothing else sets it. */
const PLUTIL = process.env.ASSERT_BUILT_INFO_PLIST_PLUTIL || 'plutil';
const IOS = 'ios/Runner/Info.plist';
const MACOS = 'macos/Runner/Info.plist';
const IPA_PLIST = /^Payload\/[^/]+\.app\/Info\.plist$/;

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) =>
  s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : XML_ENTITIES[e],
  );

/** The ROOT dict of an XML plist, as Map<key, value>: a `<string>` is its text,
 *  `<true/>`/`<false/>` a boolean, anything else `{ element }`. A key seen twice
 *  at the root is listed in `duplicates`. Returns null for text that is not a
 *  plist whose root is a dict. */
export function readPlistXml(xml) {
  const src = xml.replace(/<!--[\s\S]*?-->/g, '');
  const tag = /<(\/?)([A-Za-z][A-Za-z0-9]*)\b[^>]*?(\/?)>/g;
  const LEAVES = new Set(['key', 'string', 'integer', 'real', 'date', 'data']);
  const stack = [];
  const root = new Map();
  const duplicates = [];
  let key = null;
  let sawRoot = false;
  const put = (value) => {
    if (root.has(key)) duplicates.push(key);
    root.set(key, value);
    key = null;
  };
  let m;
  while ((m = tag.exec(src))) {
    const [, close, name, selfClose] = m;
    if (close) {
      if (stack.pop() !== name) return null;
      continue;
    }
    if (stack.length === 0 && name !== 'plist') return null;
    if (stack.length === 1) {
      if (name !== 'dict' || sawRoot) return null;
      sawRoot = true;
    }
    const atRoot = stack.length === 2 && stack[1] === 'dict';
    if (selfClose) {
      if (atRoot && key !== null) put(name === 'true' ? true : name === 'false' ? false : name === 'string' ? '' : { element: name });
      continue;
    }
    if (LEAVES.has(name)) {
      const end = src.indexOf(`</${name}>`, tag.lastIndex);
      if (end === -1) return null;
      const text = decode(src.slice(tag.lastIndex, end));
      tag.lastIndex = end + name.length + 3;
      if (!atRoot) continue;
      if (name === 'key') {
        if (key !== null) return null;
        key = text;
      } else if (key !== null) put(name === 'string' ? text : { element: name, text });
      continue;
    }
    if (atRoot && key !== null) put({ element: name });
    stack.push(name);
  }
  if (stack.length !== 0 || !sawRoot || key !== null) return null;
  return { root, duplicates };
}

const show = (v) => (v === undefined ? '(absent)' : typeof v === 'string' ? `"${v}"` : typeof v === 'boolean' ? `<${v}/>` : JSON.stringify(v));

function main(argv) {
  const lost = [];
  const problems = [];
  const bundles = [];
  let app = null;
  let repoRoot = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--app') app = argv[++i] ?? null;
    else if (a.startsWith('--app=')) app = a.slice('--app='.length);
    else if (a === '--repo-root') repoRoot = argv[++i] ?? null;
    else if (a.startsWith('--repo-root=')) repoRoot = a.slice('--repo-root='.length);
    else if (a.startsWith('--')) lost.push(`unknown option ${a}`);
    else bundles.push(a);
  }
  const ROOT = resolve(repoRoot ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  if (!app) lost.push('no --app <id>: the expected values are that app\'s rendered Info.plist');
  if (bundles.length === 0) lost.push('no bundle path: pass the built .app or .ipa');
  if (lost.length) return finish(lost, problems, []);

  const rendered = plan(ROOT);
  if (rendered.lost.length || rendered.problems.length) {
    return finish(
      [
        `render.mjs plan() reports ${rendered.lost.length} COVERAGE LOST and ${rendered.problems.length} problem(s), so it has no expected value to give. Run node tooling/ci/assert-app-yaml.mjs for the cause.`,
        ...rendered.lost,
        ...rendered.problems,
      ],
      problems,
      [],
    );
  }
  if (!rendered.declarations.some((d) => d.id === app)) {
    return finish([`${APPS_DIR}/${app}/app.yaml is not a declaration render.mjs plans; there is no app "${app}" to compare the bundle to.`], problems, []);
  }

  const oks = [];
  for (const bundle of bundles) {
    const got = readBundle(resolve(bundle));
    if (got.lost) {
      lost.push(`${bundle}: ${got.lost}`);
      continue;
    }
    const sourceRel = `${APPS_DIR}/${app}/${got.target}`;
    const plannedText = rendered.files.get(sourceRel);
    const planned = plannedText === undefined ? null : readPlistXml(plannedText);
    if (planned === null) {
      lost.push(`${bundle}: render.mjs plans no readable ${sourceRel}, so the ${got.target.split('/')[0]} bundle has no expected value.`);
      continue;
    }
    const keys = PLIST_KEY_TARGETS.filter((t) => t.in === got.target).map((t) => t.key);
    if (keys.length === 0) {
      lost.push(`${bundle}: PLIST_KEY_TARGETS names no key for ${got.target}; this guard would check nothing.`);
      continue;
    }
    for (const key of keys) {
      const want = planned.root.get(key);
      if (want === undefined) {
        lost.push(`${bundle}: the rendered ${sourceRel} carries no ${key}, so there is no expected value for it.`);
        continue;
      }
      const have = got.plist.root.get(key);
      if (got.plist.duplicates.includes(key)) {
        problems.push(`${bundle}: ${got.where} carries ${key} more than once; App Store review reads one, and which one is not this guard's to guess.`);
      } else if (have === undefined) {
        problems.push(`${bundle}: ${got.where} has no ${key}; ${sourceRel} renders ${show(want)}. Something between the source plist and the bundle dropped it.`);
      } else if (JSON.stringify(have) !== JSON.stringify(want)) {
        problems.push(`${bundle}: ${got.where} has ${key} = ${show(have)}; ${sourceRel} renders ${show(want)}. A build setting or a plist merge overrode the rendered value.`);
      } else {
        oks.push(`${bundle}: ${key} = ${show(have)}, as ${sourceRel} renders it`);
      }
    }
  }
  return finish(lost, problems, oks);
}

/** { target, where, plist } for a readable bundle, or { lost } saying why not. */
function readBundle(abs) {
  if (!existsSync(abs)) return { lost: 'no such bundle (a missing build, or a glob that matched nothing)' };
  let bytes;
  let target;
  let where;
  if (statSync(abs).isDirectory()) {
    if (!abs.endsWith('.app')) return { lost: 'a directory that is not an .app bundle' };
    if (existsSync(join(abs, 'Contents', 'Info.plist'))) {
      target = MACOS;
      where = 'Contents/Info.plist';
    } else if (existsSync(join(abs, 'Info.plist'))) {
      target = IOS;
      where = 'Info.plist';
    } else return { lost: 'an .app with neither Contents/Info.plist (macOS) nor Info.plist (iOS)' };
    bytes = readFileSync(join(abs, where));
  } else {
    if (!abs.endsWith('.ipa')) return { lost: 'a file that is not an .ipa' };
    const entries = unzip(readFileSync(abs));
    if (entries === null) return { lost: 'an .ipa that is not a readable zip' };
    const hits = entries.filter((e) => IPA_PLIST.test(e.name));
    if (hits.length !== 1) return { lost: `an .ipa with ${hits.length} Payload/*.app/Info.plist member(s); exactly one is the bundle` };
    if (hits[0].bytes === null) return { lost: `${hits[0].name} uses zip method ${hits[0].unsupportedMethod}, which unzip() does not read` };
    target = IOS;
    where = hits[0].name;
    bytes = hits[0].bytes;
  }
  let xml;
  if (bytes.subarray(0, 6).toString('latin1') === 'bplist') {
    const dir = mkdtempSync(join(tmpdir(), 'built-info-plist-'));
    try {
      const file = join(dir, 'Info.plist');
      writeFileSync(file, bytes);
      const r = spawnSync(PLUTIL, ['-convert', 'xml1', '-o', '-', file], { encoding: 'utf8' });
      if (r.error?.code === 'ENOENT') return { lost: `${where} is a binary plist and there is no plutil on this machine to read it` };
      if (r.status !== 0) return { lost: `plutil could not convert ${where} (exit ${r.status}): ${(r.stderr ?? '').trim()}` };
      xml = r.stdout;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } else xml = bytes.toString('utf8');
  const plist = readPlistXml(xml);
  if (plist === null) return { lost: `${where} is not a plist whose root is a dict` };
  return { target, where, plist };
}

function coverageLost(lost) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lost[0]}`);
  for (const l of lost.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-built-info-plist: COVERAGE LOST');
  process.exit(2);
}

function finish(lost, problems, oks) {
  for (const o of oks) console.log(`ok   ${o}`);
  if (lost.length) coverageLost(lost);
  if (problems.length) {
    console.error('');
    for (const p of problems) console.error(`✗ ${p}`);
    console.error(`\nassert-built-info-plist: ${problems.length} problem(s)`);
    return 1;
  }
  console.log(`\nassert-built-info-plist: ok — ${oks.length} rendered key(s) found in the built bundle(s) with the rendered value`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
