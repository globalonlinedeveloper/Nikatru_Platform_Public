#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-rtl-directional.mjs — no shipped screen hard-wires left and right.
//
// Register row: O-LOCALES-HAND-TYPED-IN-12-PLACES (lane i18n-pipeline, item 4).
// No right-to-left locale ships yet, and that is exactly why this is a guard: a
// layout written `EdgeInsets.only(left: 16)` is correct in every locale we
// test and wrong the day Arabic, Hebrew, Persian or Urdu is added to
// tooling/i18n/locales.json — the inset stays on the left while everything
// else mirrors, and no test that runs today can see it. The audit counted about
// thirty such calls across the app, the design system and the chassis screens.
// The directional forms cost nothing in LTR (they resolve to the same pixels)
// and mirror correctly in RTL.
//
// ── WHAT IT FAILS ON (in every lib/ tree it grades) ─────────────────────────
//   D1  EdgeInsets.only(…left:/right:…)           → EdgeInsetsDirectional.only(start:/end:)
//   D2  EdgeInsets.fromLTRB(a, b, c, d) with a ≠ c → EdgeInsetsDirectional.fromSTEB
//       (a symmetric inset is the same in both directions and passes)
//   D3  Alignment.{center,top,bottom}{Left,Right} → AlignmentDirectional.*Start/*End
//       (except as a gradient's `begin:`/`end:`, where it paints, not lays out)
//   D4  Positioned(…left:/right:…) with different values → PositionedDirectional
//       (left: 0, right: 0 together is a stretch and passes)
//   D5  `textDirection: TextDirection.ltr|rtl` imposed on a subtree (comparing
//       against one, `dir == TextDirection.rtl`, is reading it and passes)
//
// A line may carry `// rtl-ok: <why>` (or the line above may) when a physical
// side is the point — a waveform drawn left to right, a chart axis. The reason
// is printed so a reviewer reads it.
//
// Exit 0 = green. 1 = a finding. 2 = COVERAGE LOST: a tree it grades is missing,
// or it read fewer Dart files than its floor.
//
// Usage: node tooling/ci/assert-rtl-directional.mjs [--root <dir>]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

export const TREES = [
  'packages/design_system/lib',
  'packages/chassis_screens/lib',
  'tooling/bricks/app/__brick__/apps/{{app_id}}/lib',
];
/** Every apps/<id>/lib is graded too (found, not listed). */
export const MIN_FILES = 100;
export const MARKER = 'rtl-ok:';

/** The argument list of the call whose `(` is at `open`, split at top-level commas. */
function argsAt(text, open) {
  let depth = 0;
  let cur = '';
  const out = [];
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      if (depth === 1) continue;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) {
        if (cur.trim()) out.push(cur.trim());
        return out;
      }
    } else if (ch === ',' && depth === 1) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  return out;
}

const stripComments = (src) =>
  src
    .split('\n')
    .map((l) => {
      const i = l.indexOf('//');
      return i === -1 ? l : l.slice(0, i) + ' '.repeat(l.length - i);
    })
    .join('\n');

/** Every finding in one Dart source, as {line, rule, text}. */
export function findHardWired(src) {
  const code = stripComments(src);
  const lines = src.split('\n');
  const lineOf = (i) => code.slice(0, i).split('\n').length;
  const hits = [];
  const push = (i, rule, why) => hits.push({ line: lineOf(i), rule, why });

  for (const m of code.matchAll(/\bEdgeInsets\.only\(/g)) {
    const args = argsAt(code, m.index + m[0].length - 1);
    if (args.some((a) => /^(left|right)\s*:/.test(a))) push(m.index, 'D1', 'EdgeInsets.only(left/right) → EdgeInsetsDirectional.only(start/end)');
  }
  for (const m of code.matchAll(/\bEdgeInsets\.fromLTRB\(/g)) {
    const a = argsAt(code, m.index + m[0].length - 1);
    if (a.length === 4 && a[0].replace(/\s+/g, '') !== a[2].replace(/\s+/g, '')) {
      push(m.index, 'D2', `EdgeInsets.fromLTRB(${a[0]}, …, ${a[2]}, …) is asymmetric → EdgeInsetsDirectional.fromSTEB`);
    }
  }
  for (const m of code.matchAll(/\bAlignment\.(center|top|bottom)(Left|Right)\b/g)) {
    const before = code.slice(Math.max(0, m.index - 40), m.index);
    if (/\b(begin|end)\s*:\s*$/.test(before)) continue;
    push(m.index, 'D3', `Alignment.${m[1]}${m[2]} → AlignmentDirectional.${m[1]}${m[2] === 'Left' ? 'Start' : 'End'}`);
  }
  for (const m of code.matchAll(/\bPositioned\(/g)) {
    const args = argsAt(code, m.index + m[0].length - 1);
    const val = (k) => args.find((x) => new RegExp(`^${k}\\s*:`).test(x))?.replace(/^\w+\s*:\s*/, '');
    const l = val('left');
    const r = val('right');
    if ((l !== undefined || r !== undefined) && l !== r) push(m.index, 'D4', 'Positioned(left/right) → PositionedDirectional(start/end)');
  }
  // Comparing against a direction (`direction == TextDirection.rtl`) is reading
  // it, which is the fix; IMPOSING one on a subtree is the defect.
  for (const m of code.matchAll(/\btextDirection\s*:\s*TextDirection\.(ltr|rtl)\b/g)) push(m.index, 'D5', `textDirection: TextDirection.${m[1]} hard-coded — inherit Directionality.of(context)`);

  return hits.filter((h) => !lines.slice(Math.max(0, h.line - 2), h.line).some((l) => l.includes(MARKER)));
}

function dartFiles(absDir, rel, out) {
  for (const e of listDir(absDir, { withFileTypes: true })) {
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) dartFiles(join(absDir, e.name), r, out);
    else if (e.name.endsWith('.dart') && !/\.g\.dart$|_localizations(_\w+)?\.dart$/.test(e.name)) out.push(r);
  }
  return out;
}

export function check(root, { minFiles = MIN_FILES } = {}) {
  const trees = [...TREES];
  const appsDir = join(root, 'apps');
  if (existsSync(appsDir)) {
    for (const e of listDir(appsDir, { withFileTypes: true })) {
      if (e.isDirectory() && existsSync(join(appsDir, e.name, 'lib'))) trees.push(`apps/${e.name}/lib`);
    }
  }
  const missing = TREES.filter((t) => !existsSync(join(root, t)));
  if (missing.length) return { coverage: `tree(s) ${missing.join(', ')} not found — the domain shrank silently.`, findings: [], files: 0 };
  if (trees.length === TREES.length) return { coverage: 'no apps/<id>/lib found — the shipped app is not graded.', findings: [], files: 0 };
  const findings = [];
  let files = 0;
  for (const t of trees) {
    for (const f of dartFiles(join(root, t), t, [])) {
      files++;
      for (const h of findHardWired(readFileSync(join(root, f), 'utf8'))) findings.push(`${h.rule} ${f}:${h.line} — ${h.why}`);
    }
  }
  if (files < minFiles) return { coverage: `read ${files} Dart file(s); the floor is ${minFiles}.`, findings, files };
  return { coverage: null, findings, files, trees };
}

function main(argv) {
  const root = argv.includes('--root') ? resolve(argv[argv.indexOf('--root') + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const r = check(root);
  if (r.coverage) {
    console.error(`COVERAGE LOST — ${r.coverage}`);
    return 2;
  }
  if (r.findings.length) {
    console.error(`✗ rtl-directional — ${r.findings.length} hard-wired left/right call(s) (a right-to-left locale would not mirror them):`);
    for (const f of r.findings) console.error(`  ${f}`);
    console.error(`  If a physical side is the point, say why with \`// ${MARKER} <why>\` on the line or the one above.`);
    return 1;
  }
  console.log(`ok  rtl-directional — ${r.files} Dart file(s) in ${r.trees.length} tree(s), no hard-wired left/right`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
