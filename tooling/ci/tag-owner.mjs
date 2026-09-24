#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// tag-owner.mjs — which release workflow OWNS a tag, derived from the registers.
//
// Row O-RELEASE-TAG-LANES-CROSS-FIRE. Until this file, the two release lanes
// held two hand-kept globs: build-platforms.yml fired on `*-v*` and
// extensions.yml on `*-v[0-9]+.[0-9]+.[0-9]+` minus `core-v*`. Both match
// `subscriptiontracker-v1.0.0` AND `fullshot-v1.10.1`, so tagging the app
// started the extension's release and tagging the extension started the app's.
//
// Ownership is now DERIVED, and each fact has one home:
//   · product → kind      the product register: PRODUCT_REGISTERS in
//                         contracts/entitlement/bundle.js, read through
//                         readProducts() in tooling/bundle-availability.mjs.
//   · kind → release lane the channel register: the `lane.workflow` of every
//                         tooling/channel-register.json row whose `surface` is
//                         that kind, narrowed to the ONE whose `on: push:`
//                         carries `tags:`. Zero such lanes answers `none` with
//                         its reason; two is refused. A row with `lane: null`
//                         (windows-direct, linux-appimage, apps-gov-in) names
//                         no workflow and contributes nothing.
//   · the version shape   TAG_SHAPES below, per KIND. It says what follows
//                         `<slug>-v`, never which products exist.
//
// Four modes, one derivation:
//   (no flag) | --check [root]   hold both lanes to the derivation: each lane's
//                                `tags:` list equals the generated one, no other
//                                workflow triggers on tags, each lane carries the
//                                job gate, every product's sample tags are owned
//                                by exactly ONE lane's ACTUAL filter, a slug in no
//                                register is owned by none, and every channel id
//                                a lane stamps is a channel of a kind it releases.
//   --write [root]               regenerate each lane's `tags:` list in place.
//   --lane <wf> --tag <t> [--root <root>]
//                                the JOB GATE. A workflow_dispatch on a tag ref
//                                never passes through a tag filter, so the lane
//                                asks this, and it exits 1 unless <wf> owns <t>.
//                                The `<app>-untagged-<sha>` value a non-tag run
//                                synthesises is a no-op (exit 0), exactly as in
//                                assert-app-versioning.mjs.
//
// Exit codes: 0 green; 1 a finding; 2 COVERAGE LOST — a register that could not
// be read, no product at all, or no lane at all. A derivation over an empty set
// would pass everything, which is the one answer it must never give.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { readProducts } from '../bundle-availability.mjs';
import { parseWorkflow, WORKFLOW_DIR, releaseTrigger, refFilterMatches, refFilterToRegExp } from './workflow-scan.mjs';

export const CHANNEL_REGISTER_REL = 'tooling/channel-register.json';

/**
 * What follows `<slug>-v` in a tag, per product KIND — the version shape, never
 * the product list. `samples` are the versions --check and the test feed every
 * lane's ACTUAL filter, one tag per product per sample.
 *
 * · app: `-v*`, because tooling/release/RELEASE-RUNBOOK.md documents
 *   `subscriptiontracker-v1.0.0-rc.1` as matching the trigger. The filter admits
 *   it; whether the version is releasable is assert-app-versioning.mjs's call,
 *   made in the `prepare` job, and it is not this file's.
 * · extension: three or four numeric parts, the shape extensions.yml's filter
 *   has always had (the fourth is the store-only component) — now per tool.
 */
export const TAG_SHAPES = {
  app: { suffixes: ['-v*'], samples: ['1.0.0', '1.0.0-rc.1'] },
  extension: {
    suffixes: ['-v[0-9]+.[0-9]+.[0-9]+', '-v[0-9]+.[0-9]+.[0-9]+.[0-9]+'],
    samples: ['1.10.1', '1.10.1.2'],
  },
};

/** The non-tag value build-platforms.yml synthesises; the same shape assert-app-versioning.mjs skips. */
export const UNTAGGED_REF = /^[A-Za-z0-9._-]+-untagged-[0-9a-f]{7,40}$/;

/** A slug that can be written into a filter as a literal: no filter metacharacter can reach it. */
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** A slug no register may ever hold, used to prove a lane owns nothing it was not given. */
const STRANGER = 'no-such-product';

/**
 * The channel-register rows of one surface that name a lane, as
 * `{ channel, workflow, job }`. The "lanes of surface K" answer, exported so the
 * channel-pairing work imports it instead of re-deriving it. A row with
 * `lane: null` names nothing and is skipped, not refused: it is the register's
 * recorded fact that no job emits that channel's format.
 */
export function lanesOfSurface(register, surface) {
  const rows = Array.isArray(register?.channels) ? register.channels : [];
  const out = [];
  for (const row of rows) {
    if (row?.surface !== surface) continue;
    const lane = row?.lane;
    if (!lane || typeof lane.workflow !== 'string') continue;
    out.push({ channel: row.id, workflow: lane.workflow, job: typeof lane.job === 'string' ? lane.job : null });
  }
  return out;
}

/** The generated `tags:` patterns for a set of products of one kind, sorted by slug. */
export function patternsFor(kind, slugs) {
  const shape = TAG_SHAPES[kind];
  return [...slugs].sort().flatMap((slug) => shape.suffixes.map((s) => `${slug}${s}`));
}

const readJson = (root, rel) => {
  const abs = join(root, rel);
  if (!existsSync(abs)) return { ok: false, why: `${rel} does not exist` };
  try {
    return { ok: true, value: JSON.parse(readFileSync(abs, 'utf8')) };
  } catch (e) {
    return { ok: false, why: `${rel} is not valid JSON (${e.message})` };
  }
};

/**
 * The whole derivation. Returns
 *   { lost: string[], problems: string[], notes: string[], products,
 *     lanes: Map<workflowRel, { kinds: string[], products: {slug, kind}[], patterns: string[] }>,
 *     kindLane: Map<kind, workflowRel | null>, register }
 * `lost` is COVERAGE LOST; `problems` are findings. Pure over `root`.
 */
export function derive(root) {
  const lost = [];
  const problems = [];
  const notes = [];
  const { products, problems: productProblems } = readProducts(root);
  for (const p of productProblems) lost.push(p);
  if (products.length === 0 && productProblems.length === 0) {
    lost.push('the product registers were read and hold no product at all, so no tag has an owner to derive');
  }
  const reg = readJson(root, CHANNEL_REGISTER_REL);
  const lanes = new Map();
  const kindLane = new Map();
  if (!reg.ok) {
    lost.push(`${reg.why} — kind-to-lane cannot be derived without it`);
    return { lost, problems, notes, products, lanes, kindLane, register: null };
  }
  const kinds = [...new Set(products.map((p) => p.kind))].sort();
  for (const kind of kinds) {
    const named = [...new Set(lanesOfSurface(reg.value, kind).map((l) => l.workflow))].sort();
    const tagged = named.filter((rel) => {
      const wf = existsSync(join(root, rel)) ? parseWorkflow(root, rel) : null;
      return wf !== null && releaseTrigger(wf) !== null;
    });
    if (tagged.length === 0) {
      kindLane.set(kind, null);
      notes.push(
        `kind "${kind}": none — ${named.length ? `its channel rows name ${named.join(', ')}, and none of them triggers on \`push: tags:\`` : `no ${CHANNEL_REGISTER_REL} row of surface "${kind}" names a lane`}`,
      );
      continue;
    }
    if (tagged.length > 1) {
      problems.push(
        `kind "${kind}" has ${tagged.length} tag-triggered lanes (${tagged.join(', ')}). A tag can start only one release, so the register would have two answers for every ${kind} tag. Take the tags trigger off all but one.`,
      );
      kindLane.set(kind, null);
      continue;
    }
    if (!TAG_SHAPES[kind]) {
      problems.push(`kind "${kind}" releases through ${tagged[0]} and TAG_SHAPES in tooling/ci/tag-owner.mjs declares no version shape for it, so no filter can be generated`);
      kindLane.set(kind, null);
      continue;
    }
    kindLane.set(kind, tagged[0]);
    if (!lanes.has(tagged[0])) lanes.set(tagged[0], { kinds: [], products: [], patterns: [] });
    lanes.get(tagged[0]).kinds.push(kind);
  }
  for (const p of products) {
    if (!SLUG.test(p.slug)) {
      problems.push(`${p.register} holds slug "${p.slug}", which is not [a-z0-9-] — it cannot be written into a tag filter as a literal`);
      continue;
    }
    const lane = kindLane.get(p.kind);
    if (!lane) {
      notes.push(`product "${p.slug}" (${p.kind}) has no tag lane, so no tag can start a release for it`);
      continue;
    }
    lanes.get(lane).products.push({ slug: p.slug, kind: p.kind });
  }
  for (const [rel, lane] of lanes) {
    lane.patterns = lane.kinds.flatMap((k) => patternsFor(k, lane.products.filter((p) => p.kind === k).map((p) => p.slug)));
    if (lane.patterns.length === 0) {
      problems.push(`${rel} is the release lane of ${lane.kinds.join(', ')} and no product of that kind has a writable slug, so its generated filter would be empty`);
    }
  }
  if (lanes.size === 0 && lost.length === 0) {
    lost.push('no product kind resolved to a tag-triggered lane, so every tag would be owned by nothing and this check would hold nothing');
  }
  return { lost, problems, notes, products, lanes, kindLane, register: reg.value };
}

/** The derived lanes that select `tag`, by the GENERATED patterns (the register's answer). */
export function derivedOwners(d, tag) {
  return [...d.lanes].filter(([, l]) => refFilterMatches(l.patterns, tag)).map(([rel]) => rel);
}

/** Every workflow with a `push: tags:` trigger, as `[rel, { wf, trigger }]`. */
export function tagTriggeredWorkflows(root) {
  const dir = join(root, WORKFLOW_DIR);
  if (!existsSync(dir)) return [];
  return listDir(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => {
      const rel = `${WORKFLOW_DIR}/${f}`;
      const wf = parseWorkflow(root, rel);
      return [rel, { wf, trigger: wf ? releaseTrigger(wf) : null }];
    })
    .filter(([, v]) => v.trigger !== null);
}

/** The lanes whose ACTUAL `tags:` list (as parsed from the file) selects `tag`. */
export function actualOwners(actual, tag) {
  return actual.filter(([, v]) => refFilterMatches(v.trigger.items.map((i) => i.pattern), tag)).map(([rel]) => rel);
}

const GENERATED_WHY = '# why: GENERATED by tooling/ci/tag-owner.mjs --write from the product registers. Never hand-edit.';

/**
 * The file text with its `tags:` list replaced by `patterns`, in block form.
 * Replaces the `tags:` key line through its last item; a flow list is one line.
 */
export function rewriteTags(text, wf, patterns) {
  const t = releaseTrigger(wf);
  if (t === null) return null;
  const lines = text.split('\n');
  const keyLine = lines[t.line - 1];
  const indent = keyLine.match(/^ */)[0];
  const last = Math.max(t.line, ...t.items.map((i) => i.n));
  const block = [`${indent}tags:`, `${indent}  ${GENERATED_WHY}`, ...patterns.map((p) => `${indent}  - '${p}'`)];
  lines.splice(t.line - 1, last - t.line + 1, ...block);
  return lines.join('\n');
}

/** Channel ids a workflow stamps: `RELEASE_CHANNEL=<id>` and `--channel <id>`, in code lines only. */
export function stampedChannels(wf) {
  const out = [];
  for (const { n, text } of wf.lines) {
    for (const m of text.matchAll(/RELEASE_CHANNEL=([a-z0-9][a-z0-9-]*)/g)) out.push({ n, id: m[1] });
    for (const m of text.matchAll(/--channel[= ]+['"]?([a-z0-9][a-z0-9-]*)/g)) out.push({ n, id: m[1] });
  }
  return out;
}

/** Every finding --check makes, over a derivation `d`. */
export function checkFindings(root, d) {
  const problems = [...d.problems];
  const actual = tagTriggeredWorkflows(root);
  const actualRels = new Set(actual.map(([rel]) => rel));

  for (const [rel, { trigger }] of actual) {
    if (!d.lanes.has(rel)) {
      problems.push(
        `${rel}:${trigger.line} triggers on \`push: tags:\` and no product kind releases through it (no ${CHANNEL_REGISTER_REL} row of a product's surface names it). A tag trigger the registers do not derive is a hand-kept glob.`,
      );
    }
  }
  for (const [rel, lane] of d.lanes) {
    if (!actualRels.has(rel)) {
      problems.push(`${rel} is the derived release lane of ${lane.kinds.join(', ')} and has no \`push: tags:\` trigger`);
      continue;
    }
    const { wf, trigger } = actual.find(([r]) => r === rel)[1];
    const have = trigger.items.map((i) => i.pattern);
    if (have.join('\n') !== lane.patterns.join('\n')) {
      problems.push(
        `${rel}:${trigger.line} \`tags:\` is [${have.map((p) => `'${p}'`).join(', ')}], and the registers derive [${lane.patterns.map((p) => `'${p}'`).join(', ')}]. Run \`node tooling/ci/tag-owner.mjs --write\` and commit what it writes.`,
      );
    }
    const code = wf.lines.map((l) => l.text).join('\n');
    if (!code.includes(`tag-owner.mjs --lane ${rel}`)) {
      problems.push(
        `${rel} carries no job gate (\`node tooling/ci/tag-owner.mjs --lane ${rel} --tag …\`). A workflow_dispatch on a tag ref never passes through the tag filter, so without it this lane releases any tag it is dispatched on.`,
      );
    }
    for (const { n, id } of stampedChannels(wf)) {
      const row = (Array.isArray(d.register?.channels) ? d.register.channels : []).find((c) => c?.id === id);
      if (!row) {
        problems.push(`${rel}:${n} stamps channel "${id}", which no ${CHANNEL_REGISTER_REL} row declares`);
      } else if (!lane.kinds.includes(row.surface)) {
        problems.push(
          `${rel}:${n} stamps channel "${id}" (surface "${row.surface}") in the release lane of ${lane.kinds.join(', ')}. A tag of this lane would build and ship a ${row.surface} channel it does not own.`,
        );
      }
    }
  }

  // Ownership, on the ACTUAL filters: every product's sample tags have exactly one owner.
  const probe = (tag, want) => {
    const owners = actualOwners(actual, tag);
    const w = want === null ? [] : [want];
    if (owners.join('\n') === w.join('\n')) return;
    if (owners.length > 1) problems.push(`${owners.length === 2 ? 'two' : owners.length} lanes own ${tag}: ${owners.join(', ')}`);
    else if (owners.length === 0) problems.push(`${tag} reaches no lane (the registers give it to ${want})`);
    else problems.push(`${tag} is owned by ${owners[0]}, and the registers give it to ${want ?? 'no lane'}`);
  };
  for (const p of d.products) {
    const want = d.kindLane.get(p.kind) ?? null;
    const shape = TAG_SHAPES[p.kind];
    if (!shape || !SLUG.test(p.slug)) continue;
    for (const v of shape.samples) probe(`${p.slug}-v${v}`, want);
  }
  for (const shape of Object.values(TAG_SHAPES)) {
    for (const v of shape.samples) probe(`${STRANGER}-v${v}`, null);
  }
  return problems;
}

/**
 * What kind of ref a release run was handed, read with THIS file's grammar:
 *   · `untagged` — the `<app>-untagged-<sha>` value a non-tag run synthesises
 *                  (UNTAGGED_REF); `slug` is the part before `-untagged-`.
 *   · `release`  — `<slug>-v<version>`, split at the LAST `-v`, the same split
 *                  assert-app-versioning.mjs makes.
 *   · `invalid`  — anything else, an empty string included. A caller that gates
 *                  a release treats it as a release: an unreadable ref fails
 *                  closed, never open.
 * Returns `{ kind, slug, version }`; `slug` and `version` are null where the
 * kind has none. Its caller is release-manifest.mjs `--stage`, which refuses a
 * native installer on a release ref while no row that installer serves can sign
 * in (O-BOXA-CAPTCHA-REFUSES-NATIVE-SIGN-IN), and only warns on an untagged one.
 */
export function releaseTagOf(tag) {
  if (typeof tag !== 'string' || tag === '') return { kind: 'invalid', slug: null, version: null };
  if (UNTAGGED_REF.test(tag)) {
    return { kind: 'untagged', slug: tag.slice(0, tag.lastIndexOf('-untagged-')), version: null };
  }
  const m = /^(.+)-v(.+)$/.exec(tag);
  if (m) return { kind: 'release', slug: m[1], version: m[2] };
  return { kind: 'invalid', slug: null, version: null };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function coverageLost(lines) {
  for (const l of lines) console.error(`COVERAGE LOST — tag-owner: ${l}`);
  process.exit(2);
}

function main(argv) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? null : argv[i + 1] ?? '';
  };
  const valued = new Set(['--lane', '--tag', '--root']);
  const positional = argv.filter((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1]));
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(flag('--root') ?? positional[0] ?? join(here, '..', '..'));

  const lane = flag('--lane');
  const tag = flag('--tag');
  if (lane !== null || tag !== null) {
    if (!lane || !tag) {
      console.error('✗ the job gate needs both --lane <workflow path> and --tag <tag>');
      process.exit(1);
    }
    if (UNTAGGED_REF.test(tag)) {
      console.log(`⬜ "${tag}" is the <app>-untagged-<sha> value a NON-tag run synthesises — it names no product, so there is no owner to check`);
      process.exit(0);
    }
    const d = derive(root);
    if (d.lost.length) coverageLost(d.lost);
    for (const p of d.problems) console.error(`✗ ${p}`);
    if (d.problems.length) process.exit(1);
    if (!d.lanes.has(lane)) {
      console.error(`✗ ${lane} is not a release lane: the registers derive ${[...d.lanes.keys()].join(', ')}`);
      process.exit(1);
    }
    const owners = derivedOwners(d, tag);
    if (owners.length === 1 && owners[0] === lane) {
      console.log(`✓ ${tag} is ${lane}'s: it releases ${d.lanes.get(lane).kinds.join(', ')} (${d.lanes.get(lane).patterns.join(', ')})`);
      process.exit(0);
    }
    if (owners.length === 0) {
      console.error(`✗ ${tag} is no product's tag: no register row's slug and version shape produce it (${[...d.lanes.values()].flatMap((l) => l.patterns).join(', ')}). Nothing is released for it.`);
    } else if (owners.length === 1) {
      console.error(`✗ ${tag} belongs to ${owners[0]}, not to ${lane}. This run stops before it builds another product's release.`);
    } else {
      console.error(`✗ ${tag} is claimed by ${owners.length} lanes (${owners.join(', ')}); the derivation itself is ambiguous`);
    }
    process.exit(1);
  }

  const d = derive(root);
  if (d.lost.length) coverageLost(d.lost);

  if (argv.includes('--write')) {
    for (const p of d.problems) console.error(`✗ ${p}`);
    if (d.problems.length) process.exit(1);
    for (const [rel, l] of d.lanes) {
      const abs = join(root, rel);
      const wf = parseWorkflow(root, rel);
      const next = wf ? rewriteTags(readFileSync(abs, 'utf8'), wf, l.patterns) : null;
      if (next === null) {
        console.error(`✗ ${rel} has no \`push: tags:\` list to rewrite`);
        process.exit(1);
      }
      writeFileSync(abs, next);
      console.log(`wrote ${rel}: ${l.patterns.join(', ')}`);
    }
    process.exit(0);
  }

  // Validate every generated pattern with the one reader before trusting it.
  for (const l of d.lanes.values()) for (const p of l.patterns) refFilterToRegExp(p);
  const problems = checkFindings(root, d);
  for (const n of d.notes) console.log(`⬜ ${n}`);
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(1);
  }
  const summary = [...d.lanes].map(([rel, l]) => `${rel} ← ${l.products.map((p) => p.slug).join(', ')}`).join('; ');
  console.log(`✓ tag-owner: ${d.products.length} product(s), ${d.lanes.size} release lane(s), each tag owned once — ${summary}`);
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
