#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// render.mjs — the ONE regenerate command for every business fact a surface
// prints. Edit the entity source (tooling/house-identity.json), run this, commit
// what it wrote.
//
//   tooling/house-identity.json ──▶ every FACT region in a tracked HTML file
//                               ├▶ every `anchored` field in tooling/entity/surfaces.json
//                               ├▶ every generated file in `files`
//                               ├▶ the site footer (tooling/sites/chrome.mjs `footer()`)
//                               └▶ services/platform/src/generated/entity.ts
//                                  (tooling/ports/render-entity.mjs)
//
// `--check` writes nothing and exits 1 naming each stale file. The same
// comparison is limb GENERATED of tooling/scripts/assert-business-facts.mjs,
// which runs in CI.
//
// Usage:  node tooling/entity/render.mjs [--check] [--root <dir>]
// Exit 0 = written (or current). 1 = --check found a stale file, or a template
// could not render. 2 = the source, the register or the tree could not be read.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENTITY_SOURCE, SURFACES, applyAnchored, applyFactRegions, entityContext, readJson, renderFile } from './facts.mjs';
import { CHROME_ROOT, SNAPSHOT_PREFIX, footer, spliceRegion } from '../sites/chrome.mjs';
import { renderEntityAt } from '../ports/render-entity.mjs';

const BINARY = /\.(png|jpe?g|gif|ico|icns|webp|avif|ttf|otf|woff2?|zip|pdf|jar|keystore|jks|p12|mp4|webm|mp3|wav|xcf|psd|bin|exe|dll|so|dylib|db|sqlite|gz|tgz|7z|lock)$/i;
export const FOOTER_OPEN = '<!-- CHROME:footer -->';
export const FOOTER_CLOSE = '<!-- /CHROME:footer -->';

/** A served page of the site whose footer region this renders: not a dated snapshot. */
export const isFooterPage = (rel) => rel.startsWith(`${CHROME_ROOT}/`) && /\.html$/.test(rel) && !rel.startsWith(SNAPSHOT_PREFIX);

/** Every tracked text file under `root`, as repo-relative paths. Throws when git cannot list. */
export function trackedTextFiles(root) {
  const r = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ls-files failed in ${root}: ${r.stderr}`);
  return r.stdout.split('\0').filter((f) => f && !BINARY.test(f));
}

export function readText(root, rel) {
  try {
    const t = readFileSync(join(root, rel), 'utf8');
    return t.includes('\u0000') ? null : t;
  } catch { return null; }
}

/** The register and the context for the source under `root`. */
export function loadAll(root) {
  const doc = readJson(root, ENTITY_SOURCE);
  const surfaces = readJson(root, SURFACES);
  return { doc, surfaces, ctx: entityContext(doc) };
}

/**
 * What every surface under `root` should contain, as a map rel -> {current, want}.
 * Only files whose rendering differs from or touches the source are listed:
 * files carrying a FACT region or the footer region, every anchored file, every
 * generated file. `errors` collects refusals (an unknown fact, a moved anchor).
 */
export function renderSurfaces(root, { ctx, surfaces, files } = {}) {
  if (!ctx || !surfaces) ({ ctx, surfaces } = loadAll(root));
  const list = files ?? trackedTextFiles(root);
  const out = new Map();
  const errors = [];
  const anchoredBy = new Map();
  for (const a of surfaces.anchored ?? []) {
    if (!anchoredBy.has(a.file)) anchoredBy.set(a.file, []);
    anchoredBy.get(a.file).push(a);
  }
  const generated = new Map((surfaces.files ?? []).map((f) => [f.file, f]));
  const footerBody = (() => { try { return footer(ctx); } catch (e) { errors.push({ file: 'tooling/sites/chrome.mjs', what: e.message }); return null; } })();
  const tracked = new Set(list);
  for (const rel of [...anchoredBy.keys(), ...generated.keys()]) {
    if (!tracked.has(rel)) errors.push({ file: rel, what: `declared in ${SURFACES} but not a tracked file` });
  }
  for (const rel of list) {
    const isGen = generated.has(rel);
    const anchored = anchoredBy.get(rel);
    const current = readText(root, rel);
    if (current === null) continue;
    // FACT regions live in HTML only, and the footer region in the served site's pages only: the
    // dated policy snapshots under legal/ are frozen records and never re-rendered.
    const html = /\.html?$/i.test(rel);
    const hasRegion = html && (current.includes('<!-- FACT:') || current.includes('<!-- /FACT:'));
    const hasFooter = isFooterPage(rel) && current.includes(FOOTER_OPEN);
    if (!isGen && !anchored && !hasRegion && !hasFooter) continue;
    let want = current;
    try {
      if (isGen) want = renderFile(generated.get(rel), ctx);
      else {
        if (hasRegion) want = applyFactRegions(want, rel, surfaces.facts ?? {}, ctx);
        if (anchored) want = applyAnchored(want, anchored, ctx);
        if (hasFooter && footerBody !== null) want = spliceRegion(want, 'footer', footerBody);
      }
    } catch (e) {
      errors.push({ file: rel, what: e.message });
      continue;
    }
    out.set(rel, { current, want });
  }
  return { out, errors };
}

function main() {
  const argv = process.argv.slice(2);
  let root = process.cwd();
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') check = true;
    else if (argv[i] === '--root' && argv[i + 1] && !argv[i + 1].startsWith('--')) root = argv[++i];
    else { console.error(`render: REFUSED — unknown argument ${argv[i]}`); process.exit(2); }
  }
  root = resolve(root);
  let res;
  try { res = renderSurfaces(root); } catch (e) {
    console.error(`render: COVERAGE LOST — ${e.message}`);
    process.exit(2);
  }
  for (const e of res.errors) console.error(`render: REFUSED — ${e.file}: ${e.what}`);
  const stale = [...res.out].filter(([, v]) => v.current !== v.want).map(([rel]) => rel);
  const worker = renderEntityAt(root, { check });
  if (check) {
    for (const rel of stale) console.error(`render: STALE — ${rel} differs from what ${ENTITY_SOURCE} renders`);
    if (worker.code) console.error(worker.msg);
    const bad = res.errors.length || stale.length || worker.code;
    if (!bad) console.log(`render: ok — ${res.out.size} surface file(s) are what ${ENTITY_SOURCE} renders`);
    process.exit(worker.code === 2 ? 2 : bad ? 1 : 0);
  }
  for (const rel of stale) { writeFileSync(join(root, rel), res.out.get(rel).want); console.log(`render: wrote ${rel}`); }
  console.log(worker.msg);
  console.log(`render: ${stale.length} of ${res.out.size} surface file(s) rewritten from ${ENTITY_SOURCE}`);
  process.exit(res.errors.length || worker.code ? 1 : 0);
}

const IS_MAIN = (() => {
  try { return resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (IS_MAIN) main();
