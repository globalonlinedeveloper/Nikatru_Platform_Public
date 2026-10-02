#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-business-facts.mjs — every business fact a product prints is the entity
// source's, the entity source is the brain's, and no fact is typed anywhere else.
//
// 🔴 WHY THIS EXISTS (rv2-business 007 and 008, train P23).
// Every business fact the products print — the legal name and form, the Udyam
// number in every footer, the registered office on five pages, the phone, the
// seller per rail, each store account's type — was a hand copy that nothing
// compared with the business record. Measured at Public 630dcce4: the Udyam
// number in 26 files, the proprietor's name in 101, a +91 phone in 8. The owner's
// lock (2026-10-01): "Everything whichever applicable it should come from
// pipeline - always lock", so that a change of legal entity is ONE edit to ONE
// source, then `node tooling/entity/render.mjs`.
//
// THE CHAIN.  nikatru/business/public-facts.json   the brain: the business record
//               │  limb BRAIN (this hook; CI cannot read the brain)
//               ▼
//             tooling/house-identity.json         the entity source (`entity`, `people`)
//               │  limb GENERATED (CI and hook)
//               ▼
//             every FACT region, anchored field and generated file
//             tooling/entity/surfaces.json declares, the site footer, the Worker
//             module — and limb LITERALS refuses the same values anywhere else.
//
// THE LIMBS.
//   SHAPE      the source parses; its form is an allowed one; every rendered fact
//              has a value; while the form is a sole proprietorship the founder's
//              name IS the legal name (a proprietorship's legal name is its
//              proprietor's).
//   BRAIN      every source leaf carrying a `brain` path equals that field of
//              public-facts.json, and `supportEmail` equals the brain's. With the
//              brain absent this prints UNREAD and exits 2, unless `--ci` says
//              the brain is not a subject of this run (a GitHub runner has none).
//   GENERATED  every surface is byte-for-byte what the source renders
//              (tooling/entity/render.mjs `renderSurfaces`), and the Worker
//              module is current (tooling/ports/render-entity.mjs).
//   LITERALS   no value `surfaces.json` `literals.values` names — read from the
//              source, never typed — appears in a tracked file outside the
//              source, a FACT region, an anchored field, the footer region of a
//              served page, a generated file, or an `exempt` path.
//   FORM WORDS no word for the current form (`entity.form.wording`) on a printed
//              surface outside a rendered span: a sentence naming the form is one
//              a form change must re-word, so it has to be one the dry run lists.
//   STORES     each store channel the source names carries
//              `accountStatus.accountType` equal to the source's type, and its
//              `accountStatus.note` names that type.
//
// THE RED CONTROLS RUN ON EVERY RUN, in memory, on the real inputs: a FACT region
// whose body is altered must be reported stale, a guarded value injected into a
// scanned file must be reported, the same value inside a FACT region must not be,
// and (with the brain read) a brain value altered must be reported. A control
// that stays green means the limb cannot fail, and the run exits 2.
//
// Findings NEVER print a value: they name the class, the file and the line.
//
// Usage:  node tooling/scripts/assert-business-facts.mjs [--ci] [--root <dir>]
//         node tooling/scripts/assert-business-facts.mjs --sync   copy the brain's values into the source
//         (the brain root: $NIKATRU_BUSINESS_ROOT, else `<workspace anchor>/nikatru`)
// Exit:   0 green · 1 a finding · 2 COVERAGE LOST (a floor, an unreadable input,
//         a red control that stayed green, or the brain UNREAD without --ci).
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ENTITY_SOURCE, SURFACES, entityContext, factRegions, anchoredSpans, REPO_ROOT } from '../entity/facts.mjs';
import { FOOTER_CLOSE, FOOTER_OPEN, isFooterPage, readText, renderSurfaces, trackedTextFiles } from '../entity/render.mjs';
import { renderEntityAt } from '../ports/render-entity.mjs';

const BRAIN_FILE = 'business/public-facts.json';
const MIN_LITERAL_CLASSES = 5;

const argv = process.argv.slice(2);
const CI = argv.includes('--ci');
const SYNC = argv.includes('--sync');
let ROOT = REPO_ROOT;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--root' && argv[i + 1]) ROOT = resolve(argv[++i]);
  else if (!['--ci', '--sync'].includes(argv[i])) { console.error(`✗ business facts — REFUSED: unknown argument ${argv[i]}`); process.exit(2); }
}

const findings = [];
const lost = [];
const notes = [];
const find = (limb, where, what) => findings.push({ limb, where, what });
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function finish() {
  for (const n of notes) console.log(`   ${n}`);
  if (lost.length) {
    console.error(`✗ business facts — COVERAGE LOST (${lost.length}); this run is not evidence:`);
    for (const l of lost) console.error(`   · ${l}`);
  }
  if (findings.length) {
    console.error(`✗ business facts — ${findings.length} finding(s):`);
    for (const f of findings) console.error(`   ${f.limb.padEnd(10)} ${f.where}  ${f.what}`);
  }
  if (lost.length) process.exit(2);
  if (findings.length) process.exit(1);
  console.log('✓ business facts — every printed fact is the entity source\'s, and none is typed elsewhere');
  process.exit(0);
}

// ── INPUTS ───────────────────────────────────────────────────────────────────
let doc, surfaces;
try { doc = JSON.parse(readFileSync(join(ROOT, ENTITY_SOURCE), 'utf8')); } catch (e) { lost.push(`${ENTITY_SOURCE} could not be read (${e.message})`); finish(); }
try { surfaces = JSON.parse(readFileSync(join(ROOT, SURFACES), 'utf8')); } catch (e) { lost.push(`${SURFACES} could not be read (${e.message})`); finish(); }

// ── THE BRAIN ────────────────────────────────────────────────────────────────
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
function brainRoot() {
  if (process.env.NIKATRU_BUSINESS_ROOT) return resolve(process.env.NIKATRU_BUSINESS_ROOT);
  for (let d = ROOT; ; d = dirname(d)) {
    if (isDir(join(d, 'Projects')) && isDir(join(d, 'nikatru'))) return join(d, 'nikatru');
    if (dirname(d) === d) return null;
  }
}

/** Every source leaf with a brain path, as {path, field, value, brainPath}. */
function brainLeaves(source) {
  const out = [];
  const walk = (node, path) => {
    if (!isObj(node)) return;
    if (node.brain !== undefined) {
      if (typeof node.brain === 'string') {
        const field = 'value' in node ? 'value' : 'type';
        out.push({ path: `${path}.${field}`, value: node[field], brainPath: node.brain });
      } else if (isObj(node.brain)) {
        for (const [field, bp] of Object.entries(node.brain)) out.push({ path: `${path}.${field}`, value: node[field], brainPath: bp });
      }
    }
    for (const [k, v] of Object.entries(node)) if (k !== 'brain') walk(v, path ? `${path}.${k}` : k);
  };
  walk(source.entity, 'entity');
  if (isObj(source.supportEmail)) out.push({ path: 'supportEmail.value', value: source.supportEmail.value, brainPath: 'supportEmail.value' });
  return out;
}

/** Brain mismatches for `source` against `brain`, as [{path, brainPath, why}]. */
function brainDiff(source, brain) {
  const out = [];
  for (const l of brainLeaves(source)) {
    const b = get(brain, l.brainPath);
    if (b === undefined) out.push({ ...l, why: `names brain field \`${l.brainPath}\`, which ${BRAIN_FILE} does not carry` });
    else if (b !== l.value) out.push({ ...l, why: `differs from the brain's \`${l.brainPath}\`: no match` });
  }
  return out;
}

const BRAIN = brainRoot();
let brain = null;
if (BRAIN && existsSync(join(BRAIN, BRAIN_FILE))) {
  try { brain = JSON.parse(readFileSync(join(BRAIN, BRAIN_FILE), 'utf8')); } catch (e) { lost.push(`${BRAIN_FILE} in the brain could not be parsed (${e.message})`); }
}

if (SYNC) {
  if (!brain) { console.error(`✗ business facts --sync: UNREAD — no ${BRAIN_FILE} under ${BRAIN ?? '(no workspace anchor found)'}; nothing was written.`); process.exit(2); }
  let n = 0;
  const leaves = brainLeaves(doc);
  for (const l of leaves) {
    const b = get(brain, l.brainPath);
    if (b === undefined || b === l.value) continue;
    const parts = l.path.split('.');
    const leafKey = parts.pop();
    get(doc, parts.join('.'))[leafKey] = b;
    n++;
  }
  if (n) writeFileSync(join(ROOT, ENTITY_SOURCE), `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`business facts --sync: ${n} of ${leaves.length} brain-fed leaf(s) changed in ${ENTITY_SOURCE}.${n ? ' Now run: node tooling/entity/render.mjs' : ''}`);
  process.exit(0);
}

if (brain) {
  for (const d of brainDiff(doc, brain)) find('BRAIN', `${ENTITY_SOURCE} ${d.path}`, d.why);
  // RED CONTROL: one brain-fed leaf altered in a copy of the brain must be reported.
  const probe = brainLeaves(doc).find((l) => typeof l.value === 'string' && l.value);
  if (!probe) lost.push('BRAIN: the source carries no brain-fed leaf, so nothing was compared');
  else {
    const altered = JSON.parse(JSON.stringify(brain));
    const parts = probe.brainPath.split('.');
    const key = parts.pop();
    const holder = get(altered, parts.join('.'));
    if (isObj(holder)) holder[key] = `${probe.value}\u0000`;
    if (!brainDiff(doc, altered).some((d) => d.path === probe.path)) lost.push('BRAIN red control stayed green: an altered brain value was not reported');
  }
  notes.push(`BRAIN      ${brainLeaves(doc).length} source leaf(s) compared with ${join(BRAIN, BRAIN_FILE)}`);
} else if (CI) {
  notes.push('BRAIN      not a subject of this run (--ci: a GitHub runner has no brain); the pre-commit hook reads it');
} else {
  lost.push(`BRAIN UNREAD — no ${BRAIN_FILE} under ${BRAIN ?? '(no ancestor holds both Projects/ and nikatru/)'}. The source cannot be compared with the business record; set NIKATRU_BUSINESS_ROOT, or pass --ci where no brain exists`);
}

// ── SHAPE ────────────────────────────────────────────────────────────────────
const ctx = entityContext(doc);
const e = doc.entity ?? {};
if (!Array.isArray(e.form?.allowed) || !e.form.allowed.includes(e.form?.value)) find('SHAPE', `${ENTITY_SOURCE} entity.form.value`, 'is not one of entity.form.allowed');
for (const [label, v] of [['entity.legalName', ctx.legalName], ['entity.tradeName', ctx.tradeName], ['people.founder.name', ctx.founder.name]]) {
  if (typeof v !== 'string' || !v) find('SHAPE', `${ENTITY_SOURCE} ${label}`, 'has no value');
}
if (e.form?.value === 'sole-proprietorship' && ctx.founder.name !== ctx.legalName) {
  find('SHAPE', `${ENTITY_SOURCE} people.founder.name`, 'differs from entity.legalName while the form is a sole proprietorship, whose legal name is its proprietor\'s');
}
for (const k of ['gstin', 'tan', 'pan']) {
  if (e.registrations?.[k]?.value != null) find('SHAPE', `${ENTITY_SOURCE} entity.registrations.${k}`, 'holds a value: it is never written in the public source (ADR 034)');
}

// ── GENERATED ────────────────────────────────────────────────────────────────
let tracked;
try { tracked = trackedTextFiles(ROOT); } catch (e) { lost.push(e.message); finish(); }
const rendered = renderSurfaces(ROOT, { ctx, surfaces, files: tracked });
for (const err of rendered.errors) find('GENERATED', err.file, err.what);
const staleOf = (map) => [...map].filter(([, v]) => v.current !== v.want).map(([rel]) => rel);
for (const rel of staleOf(rendered.out)) find('GENERATED', rel, `is not what ${ENTITY_SOURCE} renders. Run: node tooling/entity/render.mjs`);
const worker = renderEntityAt(ROOT, { check: true });
if (worker.code === 2) lost.push(worker.msg);
else if (worker.code) find('GENERATED', 'services/platform/src/generated/entity.ts', worker.msg);

let regionCount = 0;
let probeRegion = null;
for (const [rel, v] of rendered.out) {
  if (!/\.html?$/i.test(rel)) continue;
  const { regions } = factRegions(v.current);
  regionCount += regions.length;
  if (!probeRegion && regions.length) probeRegion = { rel, v, r: regions[0] };
}
// RED CONTROL: a FACT region whose body differs from its rendering must read as stale.
if (!probeRegion) lost.push('GENERATED: no FACT region was found, so the red control has nothing to alter');
else {
  const { rel, v, r } = probeRegion;
  const mutated = `${v.current.slice(0, r.bodyStart)}\u0000${v.current.slice(r.bodyStart)}`;
  if (!staleOf(new Map([[rel, { current: mutated, want: v.want }]])).length) lost.push('GENERATED red control stayed green: an altered FACT region was not reported');
}
const anchoredCount = (surfaces.anchored ?? []).reduce((n, a) => n + (a.count ?? 1), 0);
notes.push(`GENERATED  ${rendered.out.size} surface file(s): ${regionCount} FACT region(s), ${anchoredCount} anchored field(s), ${(surfaces.files ?? []).length} generated file(s)`);

// ── LITERALS ─────────────────────────────────────────────────────────────────
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function needleRe(value, match) {
  if (match === 'digits') return new RegExp(`(?<![0-9])${[...value].map(escRe).join('[\\s.-]?')}(?![0-9])`, 'g');
  // A space in a value matches any whitespace run: prose wraps a name across a line break
  // ("…of <given name>\n  <family name>"), and a scan without this missed three pages.
  const body = value.split(/\s+/).map(escRe).join('\\s+');
  if (match === 'word') return new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, 'g');
  return new RegExp(body, 'g');
}
const needles = [];
for (const lv of surfaces.literals?.values ?? []) {
  const value = get(doc, lv.path);
  if (typeof value !== 'string' || !value) continue;
  // `surfaces`: refused only under these path prefixes (a bare year is guarded where it is printed
  // as the business's year, not in every dated file). Absent: refused everywhere.
  const where = Array.isArray(lv.surfaces) && lv.surfaces.length ? lv.surfaces : null;
  const same = needles.find((n) => n.value === value && n.match === (lv.match ?? 'text') && JSON.stringify(n.surfaces) === JSON.stringify(where));
  if (same) { same.classes.push(lv.class); continue; }
  needles.push({ value, match: lv.match ?? 'text', classes: [lv.class], surfaces: where, re: needleRe(value, lv.match) });
}
if (needles.reduce((n, x) => n + x.classes.length, 0) < MIN_LITERAL_CLASSES) {
  lost.push(`LITERALS: only ${needles.length} guarded value(s) resolved from ${SURFACES} \`literals.values\`, under the floor of ${MIN_LITERAL_CLASSES}; a guard over nothing passes everything`);
}
const words = (surfaces.literals?.formWords?.paths ?? []).map((p) => get(doc, p)).filter((w) => typeof w === 'string' && w);
const formRe = words.length ? new RegExp(`(?<![A-Za-z])(?:${[...new Set(words)].sort((a, b) => b.length - a.length).map(escRe).join('|')})(?![A-Za-z])`, 'gi') : null;
const formSurfaces = surfaces.literals?.formWords?.surfaces ?? [];
const formIgnore = surfaces.literals?.formWords?.ignore ?? [];
for (const x of formIgnore) if (!x.path || !x.why) find('FORM WORDS', SURFACES, `a \`formWords.ignore\` entry lacks path or why: ${JSON.stringify(x).slice(0, 120)}`);
const formIgnored = new Set(formIgnore.map((x) => x.path));

const exempt = surfaces.exempt ?? [];
for (const x of exempt) if (!x.path || !x.kind || !x.why) find('LITERALS', SURFACES, `an \`exempt\` entry lacks path, kind or why: ${JSON.stringify(x).slice(0, 120)}`);
const exemptionOf = (rel) => exempt.find((x) => (x.path.endsWith('/') ? rel.startsWith(x.path) : rel === x.path)) ?? null;
// An entry WITH `classes` exempts only those literal classes on its path; the file is still
// scanned for every other guarded value. Without `classes` the whole path is out.
const isExempt = (rel) => { const x = exemptionOf(rel); return x !== null && !Array.isArray(x.classes); };
const knownClasses = new Set((surfaces.literals?.values ?? []).map((v) => v.class));
for (const x of exempt) {
  if (x.classes === undefined) continue;
  if (!Array.isArray(x.classes) || !x.classes.length) find('LITERALS', SURFACES, `the \`exempt\` entry for ${x.path} carries \`classes\` that is not a non-empty list`);
  else for (const c of x.classes) if (!knownClasses.has(c)) find('LITERALS', SURFACES, `the \`exempt\` entry for ${x.path} names class "${c}", which no \`literals.values\` entry carries; it would exempt nothing while reading like an exemption`);
}
const generatedFiles = new Set((surfaces.files ?? []).map((f) => f.file));
const anchoredBy = new Map();
for (const a of surfaces.anchored ?? []) { if (!anchoredBy.has(a.file)) anchoredBy.set(a.file, []); anchoredBy.get(a.file).push(a); }

/** The spans of `text` the renderer owns: FACT region bodies, anchored groups, a served page's footer. */
function ownedSpans(rel, text) {
  const spans = [];
  if (/\.html?$/i.test(rel)) for (const r of factRegions(text).regions) spans.push([r.bodyStart, r.bodyEnd]);
  for (const a of anchoredBy.get(rel) ?? []) { try { for (const s of anchoredSpans(text, a)) spans.push([s.start, s.end]); } catch { /* reported by GENERATED */ } }
  if (isFooterPage(rel)) {
    const a = text.indexOf(FOOTER_OPEN);
    const b = text.indexOf(FOOTER_CLOSE);
    if (a >= 0 && b > a) spans.push([a, b]);
  }
  return spans;
}

/** Literal hits in one file's text, as [{line, what}]. Never carries a value. */
function scan(rel, text) {
  const hits = [];
  const spans = ownedSpans(rel, text);
  const owned = (i, j) => spans.some(([s, t]) => i >= s && j <= t);
  const lineOf = (i) => text.slice(0, i).split('\n').length;
  const exemptClasses = new Set(exemptionOf(rel)?.classes ?? []);
  for (const n of needles) {
    if (n.classes.some((c) => exemptClasses.has(c))) continue;
    if (n.surfaces && !n.surfaces.some((p) => rel.startsWith(p))) continue;
    for (const m of text.matchAll(n.re)) {
      if (!owned(m.index, m.index + m[0].length)) hits.push({ line: lineOf(m.index), what: `carries the ${n.classes.join(' / ')} outside the entity source and its rendered spans` });
    }
  }
  if (formRe && formSurfaces.some((p) => rel.startsWith(p)) && !formIgnored.has(rel)) {
    for (const m of text.matchAll(formRe)) {
      if (!owned(m.index, m.index + m[0].length)) hits.push({ line: lineOf(m.index), what: `names the entity form ("${m[0]}") on a printed surface outside a rendered span`, form: true });
    }
  }
  return hits;
}

let scanned = 0;
for (const rel of tracked) {
  if (rel === ENTITY_SOURCE || generatedFiles.has(rel) || isExempt(rel)) continue;
  const text = readText(ROOT, rel);
  if (text === null) continue;
  scanned++;
  for (const h of scan(rel, text)) find(h.form ? 'FORM WORDS' : 'LITERALS', `${rel}:${h.line}`, h.what);
}
const floors = surfaces.floors ?? {};
if (scanned < (floors.files ?? 0)) lost.push(`LITERALS: ${scanned} file(s) scanned, under the floor of ${floors.files} (${SURFACES} \`floors.files\`)`);
if (regionCount < (floors.regions ?? 0)) lost.push(`GENERATED: ${regionCount} FACT region(s), under the floor of ${floors.regions}`);
if (anchoredCount < (floors.anchored ?? 0)) lost.push(`GENERATED: ${anchoredCount} anchored field(s), under the floor of ${floors.anchored}`);
// RED CONTROL: a guarded value typed into a scanned file is reported; the same value in a FACT region is not.
if (needles.length) {
  const v = needles[0].value;
  if (!scan('docs/__red-control__.md', `before ${v} after\n`).length) lost.push('LITERALS red control stayed green: a typed value was not reported');
  const fact = Object.keys(surfaces.facts ?? {})[0];
  if (fact && scan('docs/__red-control__.html', `<p><!-- FACT:${fact} -->${v}<!-- /FACT:${fact} --></p>\n`).length) lost.push('LITERALS green control failed: a value inside a FACT region was reported');
}
notes.push(`LITERALS   ${scanned} tracked file(s) scanned for ${needles.length} guarded value(s) (${needles.flatMap((n) => n.classes).join(', ')}); ${exempt.length} exempt path(s)`);

// ── STORES ───────────────────────────────────────────────────────────────────
let channels = null;
try { channels = JSON.parse(readFileSync(join(ROOT, 'tooling/channel-register.json'), 'utf8')).channels; } catch (err) { lost.push(`STORES: tooling/channel-register.json could not be read (${err.message})`); }
let storeChecks = 0;
for (const [store, acct] of Object.entries(e.storeAccounts ?? {})) {
  if (store.startsWith('_') || !channels) continue;
  for (const id of acct.channels ?? []) {
    const ch = channels.find((c) => c.id === id);
    if (!ch) { find('STORES', `${ENTITY_SOURCE} entity.storeAccounts.${store}`, `names channel "${id}", which tooling/channel-register.json does not carry`); continue; }
    storeChecks++;
    const st = ch.accountStatus ?? {};
    if (acct.type === 'NOT RECORDED') {
      if (st.accountType) find('STORES', `tooling/channel-register.json ${id}`, 'carries an accountType the source records as NOT RECORDED');
      continue;
    }
    if (st.accountType?.store !== store || st.accountType?.value !== acct.type) find('STORES', `tooling/channel-register.json ${id}`, `accountStatus.accountType is not {store: "${store}", value: the source's type}`);
    if (typeof st.note !== 'string' || !st.note.toLowerCase().includes(String(acct.type).toLowerCase())) find('STORES', `tooling/channel-register.json ${id}`, `accountStatus.note never names the account type "${acct.type}" the source records`);
  }
}
notes.push(`STORES     ${storeChecks} store channel(s) compared with entity.storeAccounts`);

finish();
