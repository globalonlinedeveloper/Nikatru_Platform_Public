// ─────────────────────────────────────────────────────────────────────────────
// codeql-lite.test.mjs — tooling/ci/assert-codeql-lite.mjs (lane codeql-lite).
//
// One red and one green fixture per CodeQL rule the guard pre-empts. The race red
// control is the real #1189 line (alert 602, tooling/store/listing-qa.mjs), and its
// green is the try/ENOENT form that PR shipped. Then: the allow comment, the diff
// scope (a pre-existing shape on an unchanged line is not this change's), a
// Windows-style path, COVERAGE LOST (exit 2) for each way the guard can fail to
// see, and the real tree — its own change clean, and every tracked file tokenized.
//
// Run:  node --test tooling/ci/test/codeql-lite.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path, { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { analyse, applyAllows, changedLines, dangerousOpener, parseArgs, RULES, toRepoRel, tokenize, TokenizeError, unquoteGitPath, grade, CODE_FILE, CODEQL_CONFIG_REL } from '../assert-codeql-lite.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-codeql-lite.mjs');
const FS = "import { existsSync, readFileSync, writeFileSync, openSync, mkdtempSync, statSync } from 'node:fs';\nimport { join } from 'node:path';\nimport { tmpdir } from 'node:os';\n";
/** The rules a source trips, its imports used so the unused-import rule stays out of the way. */
const rulesOf = (src) => analyse(`${FS}${src}\nexport const _use = [existsSync, readFileSync, writeFileSync, openSync, mkdtempSync, statSync, join, tmpdir];\n`).map((f) => f.rule);
const run = (args, cwd = REPO) => spawnSync(process.execPath, [GUARD, ...args], { cwd, encoding: 'utf8' });

describe('js/file-system-race', () => {
  test('red control: the real #1189 code — alert 602 was the WRITE on listing-qa.mjs:105, after existsSync on :100', () => {
    const src = [
      'function main() {',
      '  const sheetAbs = join(ROOT, sheetRel);',
      "  const previous = existsSync(sheetAbs) ? readSheet(readFileSync(sheetAbs, 'utf8')) : null;",
      "  if (argv.includes('--sheet')) {",
      '    writeFileSync(sheetAbs, sheetText(r, previous));',
      '  }',
      '}',
    ].join('\n');
    const f = analyse(`${FS}${src}\nexport const _u = [openSync, mkdtempSync, statSync, tmpdir];`).filter((x) => x.rule === RULES.race);
    assert.deepEqual(f.map((x) => x.line), [8], 'the write, and only the write: exists-then-READ is not reported');
    assert.match(f[0].message, /existsSync\(\) checked on line 6/);
  });

  test('red: a stat through the fs namespace, then a read of the same path in the same function', () => {
    assert.ok(analyse("import fs from 'node:fs';\nfunction f(p) { if (!fs.statSync(p).isFile()) return null; return fs.readFileSync(p, 'utf8'); }").some((x) => x.rule === RULES.race));
  });

  test('green: the try/ENOENT form #1189 shipped, and the exclusive write #1148 shipped', () => {
    const src = "const readOrNull = (abs) => { try { return readFileSync(abs, 'utf8'); } catch (err) { if (err && err.code === 'ENOENT') return null; throw err; } };\nfunction f(p) { try { writeFileSync(p, 'x', { flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; } }";
    assert.deepEqual(rulesOf(src), []);
  });

  test('green: existsSync then a READ — CodeQL does not report it (fs-spy-preload.mjs measured it)', () => {
    assert.deepEqual(rulesOf("function f(p) { if (!existsSync(p)) return null; return readFileSync(p, 'utf8'); }"), []);
  });

  test('green: a check that does not dominate the write (gen-start-here.mjs: the check is inside if (CHECK) { … exit })', () => {
    assert.deepEqual(rulesOf("if (CHECK) {\n  const on = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;\n  process.exit(on === card ? 0 : 1);\n}\nwriteFileSync(OUT, card, 'utf8');"), []);
  });

  test('green: a check in an expression-bodied arrow, the write outside it (render-platform-app-block.mjs)', () => {
    assert.deepEqual(rulesOf("function f(root, targets) {\n  const differ = targets.filter(([rel, text]) => !existsSync(join(root, rel)));\n  for (const [rel, text] of differ) writeFileSync(join(root, rel), text);\n}"), []);
  });

  test('green: a descriptor is not a path — openSync, fstatSync(fd), readFileSync(fd) is the fixed shape', () => {
    assert.deepEqual(rulesOf("import { fstatSync } from 'node:fs';\nfunction f(p) { const fd = openSync(p, 'r'); const n = fstatSync(fd).size; return readFileSync(fd, 'utf8') + n; }"), []);
  });

  test('green: a check and a use in DIFFERENT functions, or of different paths', () => {
    assert.deepEqual(rulesOf('function a(p) { return statSync(p); }\nfunction b(p) { return writeFileSync(p, 1); }'), []);
    assert.deepEqual(rulesOf('function a(p, q) { if (existsSync(p)) return writeFileSync(q, 1); }'), []);
  });
});

describe('js/regex/missing-regexp-anchor', () => {
  test('red: a tested URL regex with neither ^ nor $', () => {
    assert.deepEqual(rulesOf("const ok = /https?:\\/\\/nikatru\\.com/.test(url);"), [RULES.anchor]);
  });

  test('red: ^ binds to the first alternative only', () => {
    assert.deepEqual(rulesOf("const ok = /^https:\\/\\/a\\.example\\.com|b\\.example\\.com/.test(u);"), [RULES.anchor]);
  });

  test('green: the same URL regex anchored, and the ^a|b$ trim idiom in a replace', () => {
    assert.deepEqual(rulesOf("const ok = /^https?:\\/\\/nikatru\\.com(?:\\/|$)/.test(url);"), []);
    assert.deepEqual(rulesOf("const t = s.replace(/^-+|-+$/g, '');"), []);
  });

  test('green: a message assertion that merely names a host', () => {
    assert.deepEqual(rulesOf("const ok = /glitchtip\\.nikatru\\.com CNAME proxied=false/.test(f);"), []);
  });
});

// The post-merge review of #1199: `--all` on main gave 13 findings, each a line CodeQL
// analysed and never flagged. Each green below is one of those lines (or its exact shape);
// each red is the nearest shape CodeQL DOES flag, so the fix cannot be "flag nothing".
describe('review item 1a — file-system-race: a SHORT-CIRCUITED check in an `if` that falls through decides nothing', () => {
  const elf = (body) => `function f(rel) {\n  const abs = resolve(ROOT, rel);\n  if (!existsSync(abs) || !statSync(abs).isFile()) {\n    ${body}\n  }\n  const buf = readFileSync(abs);\n  return buf;\n}`;

  test('green: assert-elf-page-alignment.mjs:300→308 and assert-android-vapt-manifest.mjs:165→171 — the body calls coverageLost() and falls through', () => {
    assert.deepEqual(rulesOf(elf("coverageLost([`${rel} does not exist`]);")), []);
    assert.deepEqual(rulesOf("if (!existsSync(abs) || !statSync(abs).isFile()) {\n  coverageLost(['x']);\n}\nconst zipBuf = readFileSync(abs);"), []);
  });

  test('red: the same check whose body LEAVES (return, throw, continue) — the read is on the checked branch', () => {
    assert.deepEqual(rulesOf(elf('return null;')), [RULES.race]);
    assert.deepEqual(rulesOf(elf("coverageLost(['x']);\n    throw new Error('gone');")), [RULES.race]);
    assert.deepEqual(rulesOf("for (const p of ps) { if (!statSync(p).isFile()) continue; writeFileSync(p, 'x'); }"), [RULES.race]);
    assert.deepEqual(rulesOf("function f(p) { if (!statSync(p).isFile()) return; else log(p); writeFileSync(p, 'x'); }"), [RULES.race]);
  });

  test('red: the use INSIDE the checked branch, and a non-if check (the #1189 ternary) still count', () => {
    assert.deepEqual(rulesOf("function f(p) { if (statSync(p).isFile()) { writeFileSync(p, 'x'); } }"), [RULES.race]);
    assert.deepEqual(rulesOf("function f(p) { if (!existsSync(p)) { log(p); } else { writeFileSync(p, 'x'); } }"), [RULES.race]);
    assert.deepEqual(rulesOf("function f(p) { const s = statSync(p); log(s); writeFileSync(p, 'x'); }"), [RULES.race]);
  });

  test('green: a last statement that only CONTAINS a return (a nested if) does not leave — for a short-circuited check', () => {
    assert.deepEqual(rulesOf("function f(p) { if (x || !statSync(p).isFile()) { if (y) { return 1; } log(p); } readFileSync(p, 'utf8'); }"), []);
  });

  test('red (PR #1203 review F1): a check that is the whole condition dominates the code after the `if`, whatever the body does', () => {
    assert.deepEqual(rulesOf("function f(p) { if (!existsSync(p)) { if (x) { return 1; } log(p); } writeFileSync(p, 'x'); }"), [RULES.race], 'the old nested-return green, exists → write');
    assert.deepEqual(rulesOf("if (existsSync(p)) { log(p); }\nwriteFileSync(p, 'x');"), [RULES.race]);
  });

  test('red: alerts 271, 86 and 71 — exists, an `if` that falls through, then a WRITE of the same path', () => {
    // #271 tooling/scripts/check-agent-docs.mjs:377
    assert.deepEqual(rulesOf("function main() {\n  let baseline = {};\n  if (existsSync(BASELINE_PATH)) {\n    try { baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')); } catch { baseline = {}; }\n  }\n  if (WRITE_BASELINE) {\n    writeFileSync(BASELINE_PATH, JSON.stringify(baseline));\n  }\n}"), [RULES.race]);
    // #86 tooling/scripts/provision-backend.mjs:406
    assert.deepEqual(rulesOf("function f(cfgPath, cfgText) {\n  if (!existsSync(cfgPath)) {\n    die(['no config at', cfgPath]);\n  }\n  writeFileSync(cfgPath, cfgText);\n}"), [RULES.race]);
    // #71 extensions/scripts/gen-catalog.mjs:152
    assert.deepEqual(analyse("import fs from 'node:fs';\nfunction f(fileAbs, after) {\n  if (!fs.existsSync(fileAbs)) die(`missing ${fileAbs}`);\n  fs.writeFileSync(fileAbs, after, 'utf8');\n}").map((x) => x.rule), [RULES.race]);
  });

  test('the discriminator is the operand: the same check leftmost is red, behind `||`/`&&`/`?:` it is green', () => {
    assert.deepEqual(rulesOf("function f(p) { if (existsSync(p) || x) { log(p); } writeFileSync(p, 'x'); }"), [RULES.race]);
    assert.deepEqual(rulesOf("function f(p) { if (x || existsSync(p)) { log(p); } writeFileSync(p, 'x'); }"), []);
    assert.deepEqual(rulesOf("function f(p) { if (x && existsSync(p)) { log(p); } writeFileSync(p, 'x'); }"), []);
    assert.deepEqual(rulesOf("function f(p) { if (x ? existsSync(p) : y) { log(p); } writeFileSync(p, 'x'); }"), []);
    assert.deepEqual(rulesOf("function f(p) { if (g(x || y) && existsSync(p)) { log(p); } writeFileSync(p, 'x'); }"), [], 'an operator inside a call is not the condition\'s');
    assert.deepEqual(rulesOf("function f(p) { if (existsSync(p) && g(x || y)) { log(p); } writeFileSync(p, 'x'); }"), [RULES.race], 'nor is one after the check');
  });
});

describe('review item 1b/3 — missing-regexp-anchor: never one whose other alternatives anchor themselves, nor one whose anchored alternative spells no letter', () => {
  test('green: the alternations main carried, each with another alternative anchoring the same end (capture.js, package.node.js, verify-*.node.js, assert-signing-inputs-pinned.mjs)', () => {
    for (const re of [
      '/\\b(load|show)\\s+(more|older)\\b|\\b(more|older)\\s+(comments|replies)\\b|^\\s*(more)/i',
      '/(^|\\/)(node_modules|test|publish|\\.[^/]*)(\\/|$)|DELETE-ME|\\.md$|\\.zip$/',
      '/REPLACE|\\.example$|^$/',
      '/^subosito\\/flutter-action$|(?:^|\\/)setup-[A-Za-z0-9_.-]+$|install/i',
    ]) assert.deepEqual(rulesOf(`const ok = ${re}.test(url);`), [], re);
  });

  test('green: skeleton-sim.node.js:4119 — the one-sided anchored alternative `^\\*:\\/\\/\\*$` spells no letter', () => {
    assert.deepEqual(analyse('export const wide = (url) => /<all_urls>|^\\*:\\/\\/\\*\\/|^\\*:\\/\\/\\*$/.test(url);'), []);
    assert.deepEqual(analyse('export const wide = (url) => /<all_urls>|^\\*:\\/\\/\\*\\/|^https:\\/\\/\\*$/.test(url);').map((x) => x.rule), [RULES.anchor], 'red control: the same alternative spelling https');
  });

  test('red: CodeQL is per DIRECTION — a leading `(?:^|\\/)` does not excuse a `$` on the last alternative (alert 617, on this very guard)', () => {
    assert.deepEqual(rulesOf("const t = /(?:^|\\/)(?:test|tests)\\/|\\.(?:test|spec)\\.[^/]+$/i.test(url);"), [RULES.anchor]);
    assert.deepEqual(rulesOf("const t = /(?:(?:^|\\/)(?:test|tests)\\/.*|\\.(?:test|spec)\\.[^/]+)$/i.test(url);"), [], 'the grouped fix');
  });

  test('red (PR #1203 review F2): CodeQL\'s precedence check is not about URLs — alerts 45, 49, 57 and this guard\'s own pre-96dea14 TEST_FILE (617)', () => {
    assert.deepEqual(rulesOf("const PLACEHOLDER_ID = /REPLACE-WITH-YOUR-DOMAIN|\\.example$/i;"), [RULES.anchor], 'alert 45: not even tested');
    assert.deepEqual(rulesOf("const placeholder = /REPLACE|\\.example$/i.test(gid);"), [RULES.anchor], 'alert 49');
    assert.deepEqual(rulesOf("const IS_TEST_PATH = /(^|\\/)(tests?|integration_test)\\/|(_|\\.)test\\.[a-z]+$/;\nexport const t = (p) => IS_TEST_PATH.test(p);"), [RULES.anchor], 'alert 57');
    assert.deepEqual(rulesOf("export const TEST_FILE = /(?:^|\\/)(?:test|tests|__tests__)\\/|\\.(?:test|spec)\\.[^/]+$/i;"), [RULES.anchor], 'alert 617');
    assert.deepEqual(rulesOf("const t = s.replace(/REPLACE|\\.example$/i, '');"), [], 'green control: a replace pattern is out of the precedence check');
  });

  test('green: #1176 refund.mjs:210 — the one-sided anchored alternative `^[A-Za-z]:[\\\\/]` spells no letter, whatever the subject is named', () => {
    assert.deepEqual(rulesOf("const absolute = /^[A-Za-z]:[\\\\/]|\\\\/.test(p);"), []);
    assert.deepEqual(rulesOf("const absolute = /^[A-Za-z]:[\\\\/]|\\\\/.test(redirectUrl);"), [], 'a URL-named subject changes nothing (review F2: the old red encoded a guess)');
  });

  test('red: a one-sided anchor on an alternative that spells text, or a host with no anchor at all', () => {
    assert.deepEqual(rulesOf("const ok = /^https:\\/\\/a\\.example\\.com|b\\.example\\.com/.test(u);"), [RULES.anchor]);
    assert.deepEqual(rulesOf("const ok = origin.match(/^staging|preview$/);").length, 0, 'both ends anchored is the trim idiom');
    assert.deepEqual(rulesOf("const ok = origin.match(/^staging|preview/);"), [RULES.anchor]);
  });

  test('red (PR #1203 review F2): a test file and an assertion are graded too — 16 of 29 fixed anchor alerts are in tests; alerts 44 and 51', () => {
    assert.deepEqual(analyse('export const ok = (body) => /https?:\\/\\/nikatru\\.com/.test(body);').map((x) => x.rule), [RULES.anchor]);
    assert.deepEqual(analyse("import assert from 'node:assert';\nassert.ok(/app\\.example\\.com/.test(pop.text()), pop.text());").map((x) => x.rule), [RULES.anchor], 'alert 44, background-sim.node.js:4720');
    assert.deepEqual(analyse("import assert from 'node:assert';\nassert.ok(/localeCompare|sort\\(\\)\\s*$/.test(src));").map((x) => x.rule), [RULES.anchor], 'alert 51');
    assert.deepEqual(analyse("import assert from 'node:assert';\nassert.ok(/^(?:localeCompare|sort\\(\\)\\s*)$/.test(src));"), [], 'green control: the grouped fix');
  });
});

describe('review item 1c/3 — multi-character sanitization: only a removal that can re-form the token', () => {
  test('green: apple-provisioning.mjs:369 `<string>…</string>` cannot rebuild <script', () => {
    assert.deepEqual(rulesOf("const rest = inner.replace(/<string>[^<]*<\\/string>/g, '');"), []);
  });

  test('green: assert-modal-detection.mjs:814 — a removal to the END of the string leaves nothing after it to splice', () => {
    assert.deepEqual(rulesOf("const type = arg.trim().replace(/<[\\s\\S]*$/, '').trim();"), []);
  });

  test('green: legal-text-parity.test.mjs:461 — a comment removal that spells its own text (email_off)', () => {
    assert.deepEqual(rulesOf("const t = s.replace(/<!--\\s*\\/?\\s*email_off\\s*-->/gi, '');"), []);
  });

  test('red: the shapes that DO re-form — a tag wildcard, script/style by name, a bare comment, and (item 3) </?style', () => {
    assert.deepEqual(rulesOf("const t = h.replace(/<\\/?style[^>]*>/gi, '');"), [RULES.multi]);
    assert.deepEqual(rulesOf("const t = h.replace(/<script\\b[^<]*>/gi, '');"), [RULES.multi]);
    assert.deepEqual(rulesOf("const t = h.replace(/<(?:script|style)[^>]*>/gi, '');"), [RULES.multi]);
    assert.deepEqual(rulesOf("const t = h.replace(/<[\\s\\S]*?>/g, '');"), [RULES.multi]);
    assert.equal(dangerousOpener('<\\/?style[^>]*>', 'gi'), '<script');
    assert.equal(dangerousOpener('<[\\s\\S]*$', 'm'), '<script', 'with m, $ is a line end: text follows');
  });
});

describe('js/incomplete-hostname-regexp', () => {
  test('red: an unescaped dot in a host, as a literal and as new RegExp', () => {
    assert.deepEqual(rulesOf("const ok = /^https:\\/\\/api.nikatru\\.com$/.test(u);"), [RULES.hostRe]);
    assert.deepEqual(rulesOf("const re = new RegExp('^(www|api).nikatru.com$');"), [RULES.hostRe]);
  });

  test('green: every dot escaped', () => {
    assert.deepEqual(rulesOf("const ok = /^https:\\/\\/api\\.nikatru\\.com$/.test(u);"), []);
  });
});

describe('js/incomplete-url-substring-sanitization', () => {
  test('red: includes of a host, and of a const naming a URL (the #579 shape)', () => {
    assert.deepEqual(rulesOf("const ok = url.includes('nikatru.com');"), [RULES.urlSub]);
    assert.deepEqual(rulesOf("const API = 'https://api.nikatru.com';\nconst ok = args.includes(API);"), [RULES.urlSub]);
  });

  test('red: startsWith a URL with no closing slash', () => {
    assert.deepEqual(rulesOf("const ok = u.startsWith('https://nikatru.com');"), [RULES.urlSub]);
  });

  test('red: indexOf compared with -1 is an inclusion test', () => {
    assert.deepEqual(rulesOf("if (u.indexOf('https://nikatru.com') !== -1) ok();"), [RULES.urlSub]);
  });

  test('green: an indexOf stored for later, or searched in a loop, is no check (auth-callbacks.test.mjs, assert-ads-declarations.mjs)', () => {
    assert.deepEqual(rulesOf("const i = list.indexOf('https://nikatru.com/app/connect');\nfor (let j = t.indexOf('microsoft.com/'); j !== -1; j = t.indexOf('microsoft.com/', j + 1)) n++;"), []);
  });

  test('green: startsWith with the slash, endsWith with the leading dot, and a file name', () => {
    assert.deepEqual(rulesOf("const ok = u.startsWith('https://nikatru.com/') && h.endsWith('.nikatru.com') && f.endsWith('package.json');"), []);
  });
});

describe('js/incomplete-sanitization', () => {
  test('red: replace with a STRING replaces only the first quote', () => {
    assert.deepEqual(rulesOf("const e = s.replace('\"', '&quot;');"), [RULES.sanit]);
  });

  test('red: a non-global regex of a meta-character', () => {
    assert.deepEqual(rulesOf("const e = s.replace(/</, '&lt;');"), [RULES.sanit]);
  });

  test('red: a quote escaped with a backslash while the backslash is not', () => {
    assert.deepEqual(rulesOf("const e = s.replace(/\"/g, '\\\\\"');"), [RULES.sanit]);
  });

  test('red: a markdown cell escapes | before backslashes are (alert 581), and a regex escape misses the backslash (#540)', () => {
    assert.deepEqual(rulesOf("const esc = (s) => String(s).replace(/\\|/g, '\\\\|');"), [RULES.sanit]);
    assert.deepEqual(rulesOf("const re = key.replace(/[.*+?^${}()|[\\]-]/g, '\\\\$&');"), [RULES.sanit]);
  });

  test('green: replaceAll, a /g regex, and backslashes escaped first (ledger.mjs, assert-analytics-contract.mjs)', () => {
    assert.deepEqual(rulesOf("const a = s.replaceAll('\"', '&quot;');\nconst b = s.replace(/</g, '&lt;');\nconst c = s.replace(/\\\\/g, '\\\\\\\\').replace(/\"/g, '\\\\\"');"), []);
    assert.deepEqual(rulesOf("const esc = (s) => String(s).replace(/\\\\/g, '\\\\\\\\').replace(/\\|/g, '\\\\|');\nconst re = n.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');"), []);
  });

  test('green: a number parse dropping a % (box-declaration.mjs, merged unflagged in #1148)', () => {
    assert.deepEqual(rulesOf("const pct = Number.parseFloat(String(cpu).replace('%', ''));"), []);
  });
});

describe('js/incomplete-multi-character-sanitization', () => {
  test('red: stripping tags or comments once', () => {
    assert.deepEqual(rulesOf("const t = html.replace(/<[^>]*>/g, '');"), [RULES.multi]);
    assert.deepEqual(rulesOf("const t = html.replace(/<!--[\\s\\S]*?-->/g, '');"), [RULES.multi]);
  });

  test('red: removing ../ once', () => {
    assert.deepEqual(rulesOf("const t = p.replace(/\\.\\.\\//g, '');"), [RULES.multi]);
  });

  test('green: escaping instead of stripping', () => {
    assert.deepEqual(rulesOf("const t = html.replace(/</g, '&lt;').replace(/>/g, '&gt;');"), []);
  });

  test('green: the same removal repeated to a fixed point (apple-provisioning.mjs, stamp-native.mjs)', () => {
    assert.deepEqual(rulesOf("let x = s;\nfor (let prev = null; prev !== x; ) {\n  prev = x;\n  x = x.replace(/<!--[\\s\\S]*?-->/g, '');\n}"), []);
    assert.deepEqual(rulesOf("let out = s; let prev;\ndo {\n  prev = out;\n  out = out.replace(/<[^>]+>/g, '');\n} while (out !== prev);"), []);
  });

  test('green: a specific tag that cannot re-form <script, <!-- or ../ (discovery-surface.test.mjs, policy-archive.test.mjs)', () => {
    assert.deepEqual(rulesOf("const a = h.replace(/<meta property=\"og:image:width\"[^>]*>\\n/, '');\nconst b = t.replace(/<p>x\\.<\\/p>/, '');"), []);
  });

  test('green: a later replace in the same chain strips the same opener again (text-reductions.mjs)', () => {
    assert.deepEqual(rulesOf("const v = s\n  .replace(/<!-- \\/?FACT:[a-z0-9-]+ -->/g, '')\n  .replace(/<!--[\\s\\S]*?-->/g, ' ');"), []);
  });
});

describe('js/insecure-temporary-file', () => {
  test('red: a predictable name in tmpdir, directly and through a const', () => {
    assert.deepEqual(rulesOf("writeFileSync(join(tmpdir(), 'state.json'), '{}');"), [RULES.tmp]);
    assert.deepEqual(rulesOf("const P = join(tmpdir(), 'nikatru-lock');\nfunction f() { writeFileSync(P, 'x'); }"), [RULES.tmp]);
  });

  test('green: inside a mkdtemp directory, or opened exclusively', () => {
    assert.deepEqual(rulesOf("const dir = mkdtempSync(join(tmpdir(), 'x-'));\nwriteFileSync(join(dir, 'state.json'), '{}');"), []);
    assert.deepEqual(rulesOf("writeFileSync(join(tmpdir(), 'state.json'), '{}', { flag: 'wx' });"), []);
  });
});

describe('js/unused-local-variable — imports (#1187)', () => {
  test('red: a fix left existsSync imported and unused', () => {
    const f = analyse("import { existsSync, readFileSync } from 'node:fs';\nexport const x = readFileSync('a');");
    assert.deepEqual(f.map((x) => [x.line, x.rule]), [[1, RULES.unused]]);
    assert.match(f[0].message, /existsSync/);
  });

  test('red: an aliased, a default and a namespace import, each unused', () => {
    const f = analyse("import { a as b } from 'x';\nimport D from 'y';\nimport * as N from 'z';\n");
    assert.equal(f.filter((x) => x.rule === RULES.unused).length, 3);
  });

  test('green: names used in code, in a template expression and in a TS type position', () => {
    assert.deepEqual(analyse("import { a, b } from 'x';\nimport type { T } from 'y';\nimport { U } from 'z';\nexport const s = `${a}`;\nexport const t: U = b;"), []);
  });
});

describe('the allow comment', () => {
  const src = "const ok = url.includes('nikatru.com'); // codeql-lite: allow js/incomplete-url-substring-sanitization — a log filter, not a URL check";

  test('a reasoned allow on the line suppresses the one finding and keeps its reason', () => {
    const r = applyAllows(src, analyse(src));
    assert.deepEqual(r.kept, []);
    assert.equal(r.allowed.length, 1);
    assert.match(r.allowed[0].reason, /a log filter/);
  });

  test('red (review item 4): an allow on the line ABOVE suppresses nothing — it applies to its own line only', () => {
    const above = `// codeql-lite: allow js/incomplete-url-substring-sanitization — a log filter, not a URL check\nconst ok = url.includes('nikatru.com');`;
    const r = applyAllows(above, analyse(above));
    assert.deepEqual([r.allowed.length, r.kept.map((x) => x.rule)], [0, [RULES.urlSub]]);
  });

  test('red (review item 4): an allow inside a string literal is text, not a comment', () => {
    const inString = "const ok = url.includes('nikatru.com') || log('// codeql-lite: allow js/incomplete-url-substring-sanitization — a log filter, not a URL check');";
    const r = applyAllows(inString, analyse(inString));
    assert.deepEqual([r.allowed.length, r.kept.map((x) => x.rule)], [0, [RULES.urlSub]]);
    const inTemplate = "const ok = url.includes('nikatru.com') && `codeql-lite: allow js/incomplete-url-substring-sanitization — a log filter, not a URL check`;";
    assert.equal(applyAllows(inTemplate, analyse(inTemplate)).allowed.length, 0);
  });

  test('green control: the same allow in a comment on the finding\'s own line (a CRLF line too); another rule\'s allow does not count', () => {
    assert.equal(applyAllows(`${src}\r\nexport const x = 1;\r\n`, analyse(`${src}\r\nexport const x = 1;\r\n`)).allowed.length, 1);
    const block = "const ok = url.includes('nikatru.com'); /* codeql-lite: allow js/incomplete-url-substring-sanitization — a log filter, not a URL check */";
    assert.equal(applyAllows(block, analyse(block)).allowed.length, 1);
    const other = "const ok = url.includes('nikatru.com'); // codeql-lite: allow js/file-system-race — not this rule at all";
    assert.equal(applyAllows(other, analyse(other)).kept.length, 1);
  });

  test('an allow with a short reason suppresses nothing and is a finding of its own', () => {
    const short = "const ok = url.includes('nikatru.com'); // codeql-lite: allow js/incomplete-url-substring-sanitization — ok";
    const r = applyAllows(short, analyse(short));
    assert.deepEqual(r.kept.map((x) => x.rule), [RULES.allow]);
  });
});

describe('the tokenizer', () => {
  test('regex literals, division, templates and comments do not confuse it', () => {
    const t = tokenize("const a = b / c / d; const r = /[/]x/g; const s = `x${ {a: 1}.a }y${`n${z}`}`; // 'unclosed\n/* ' */");
    assert.equal(t.filter((x) => x.t === 're').length, 1);
    assert.ok(t.some((x) => x.t === 'id' && x.v === 'z' && x.td === 2));
  });

  test('an unterminated string or bracket is a TokenizeError, never a guess', () => {
    assert.throws(() => analyse("const a = 'open;\n"), TokenizeError);
    assert.throws(() => analyse('function f() { if (x) {\n'), TokenizeError);
  });
});

describe('review item 5 — nothing skipped silently', () => {
  test('an upper-case extension is a code file', () => {
    for (const f of ['a.MJS', 'b.TS', 'c.Jsx', 'd.mjs']) assert.ok(CODE_FILE.test(f), f);
    assert.ok(!CODE_FILE.test('e.json'));
  });

  test('a non-ASCII path git C-quotes is read back as the path', () => {
    assert.equal(unquoteGitPath('"b/tooling/\\303\\251t\\303\\251.mjs"'), 'b/tooling/été.mjs');
    assert.equal(unquoteGitPath('"b/a\\tb\\"c.mjs"'), 'b/a\tb"c.mjs');
    assert.equal(unquoteGitPath('b/plain.mjs'), 'b/plain.mjs');
    const m = changedLines('+++ "b/tooling/\\303\\251.mjs"\n@@ -0,0 +1 @@\n+x\n');
    assert.deepEqual([...m.keys()], ['tooling/é.mjs']);
  });

  test('red (PR #1203 review F4): a CHANGED path that does not exist is COVERAGE LOST, never a skip — --diff-filter=AMR already drops deletions', () => {
    const root = mkdtempSync(join(tmpdir(), 'codeql-lite-enoent-'));
    try {
      const r = grade(root, new Map([['tooling/mis-decoded.mjs', new Set([1])]]));
      assert.equal(r.files, 0);
      assert.equal(r.lost.length, 1, JSON.stringify(r));
      assert.match(r.lost[0], /tooling\/mis-decoded\.mjs: unreadable \(ENOENT\).*does not exist/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('paths', () => {
  test('a Windows-style path is a repo-relative POSIX path', () => {
    assert.equal(toRepoRel('C:\\repo', 'tooling\\ci\\x.mjs', path.win32), 'tooling/ci/x.mjs');
    assert.equal(toRepoRel('C:\\repo', 'C:\\repo\\services\\a\\src\\b.ts', path.win32), 'services/a/src/b.ts');
    assert.equal(toRepoRel('/repo', 'tooling/ci/x.mjs', path.posix), 'tooling/ci/x.mjs');
  });

  test('the base: --base, else CODEQL_LITE_BASE (ci.yml\'s origin/<PR base>), else origin/main', () => {
    assert.equal(parseArgs([], {}).base, 'origin/main');
    assert.equal(parseArgs([], { CODEQL_LITE_BASE: 'origin/stack-1' }).base, 'origin/stack-1');
    assert.equal(parseArgs([], { CODEQL_LITE_BASE: '' }).base, 'origin/main');
    assert.equal(parseArgs(['--base', 'main'], { CODEQL_LITE_BASE: 'origin/x' }).base, 'main');
  });

  test('the diff parser keeps only the new side of each hunk', () => {
    const m = changedLines('+++ b/a.mjs\n@@ -1,0 +2,3 @@\n+x\n@@ -9 +12 @@\n+y\n+++ /dev/null\n@@ -1 +0,0 @@\n');
    assert.deepEqual([...m.get('a.mjs')], [2, 3, 4, 12]);
    assert.equal(m.size, 1);
  });
});

/** A throwaway repo with the CodeQL config, one commit on main, and a branch. */
function scratchRepo() {
  const root = mkdtempSync(join(tmpdir(), 'codeql-lite-'));
  const git = (...a) => {
    const r = spawnSync('git', a, { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  mkdirSync(join(root, '.github', 'codeql'), { recursive: true });
  writeFileSync(join(root, CODEQL_CONFIG_REL), 'paths-ignore:\n  - ignored/**\n');
  mkdirSync(join(root, 'tooling'), { recursive: true });
  writeFileSync(join(root, 'tooling', 'old.mjs'), "export const a = (u) => u.includes('nikatru.com');\nexport const b = 1;\n");
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'lane');
  return { root, git };
}

describe('the CLI', () => {
  test('diff scope: a shape on an UNCHANGED line is not this change\'s; on a changed line it is (exit 1)', () => {
    const { root, git } = scratchRepo();
    try {
      writeFileSync(join(root, 'tooling', 'old.mjs'), "export const a = (u) => u.includes('nikatru.com');\nexport const b = 2;\n");
      const green = run(['--base', 'main', '--root', root]);
      assert.equal(green.status, 0, green.stdout + green.stderr);
      writeFileSync(join(root, 'tooling', 'new.mjs'), "export const c = (u) => u.startsWith('https://nikatru.com');\n");
      writeFileSync(join(root, 'ignored.mjs'), '');
      mkdirSync(join(root, 'ignored'));
      writeFileSync(join(root, 'ignored', 'x.mjs'), "export const d = (u) => u.includes('nikatru.com');\n");
      git('add', 'tooling/new.mjs');
      const red = run(['--base', 'main', '--root', root]);
      assert.equal(red.status, 1, red.stdout + red.stderr);
      assert.match(red.stdout, /^tooling\/new\.mjs:1 js\/incomplete-url-substring-sanitization /m);
      assert.doesNotMatch(red.stdout, /old\.mjs|ignored\/x\.mjs/);
      const all = run(['--all', '--root', root]);
      assert.equal(all.status, 1);
      assert.match(all.stdout, /tooling\/old\.mjs:1 /);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('review item 2: an UNTRACKED file is not the change — graded only under --untracked', () => {
    const { root } = scratchRepo();
    try {
      writeFileSync(join(root, 'tooling', 'scratch-copy.mjs'), "export const c = (u) => u.startsWith('https://nikatru.com');\n");
      const dflt = run(['--base', 'main', '--root', root]);
      assert.equal(dflt.status, 0, dflt.stdout + dflt.stderr);
      const opted = run(['--base', 'main', '--root', root, '--untracked']);
      assert.equal(opted.status, 1, opted.stdout + opted.stderr);
      assert.match(opted.stdout, /^tooling\/scratch-copy\.mjs:1 /m);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('review item 5: a non-ASCII path and an upper-case extension in the change are graded, not skipped', () => {
    const { root, git } = scratchRepo();
    try {
      writeFileSync(join(root, 'tooling', 'été.mjs'), "export const c = (u) => u.startsWith('https://nikatru.com');\n");
      writeFileSync(join(root, 'tooling', 'UP.MJS'), "export const d = (u) => u.includes('nikatru.com');\n");
      git('add', '-A');
      const r = run(['--base', 'main', '--root', root]);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stdout, /^tooling\/été\.mjs:1 js\/incomplete-url-substring-sanitization /m);
      assert.match(r.stdout, /^tooling\/UP\.MJS:1 js\/incomplete-url-substring-sanitization /m);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('review item 5: --files that grades nothing is COVERAGE LOST (exit 2), and says why', () => {
    const { root } = scratchRepo();
    try {
      writeFileSync(join(root, 'README.md'), 'x\n');
      mkdirSync(join(root, 'ignored'));
      writeFileSync(join(root, 'ignored', 'x.mjs'), 'export const a = 1;\n');
      const r = run(['--files', 'README.md', 'ignored/x.mjs', '--root', root]);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /COVERAGE LOST — --files named 2 file\(s\) and none is one CodeQL grades/);
      assert.match(r.stdout, /not graded README\.md \(not a JavaScript\/TypeScript file\)/);
      const green = run(['--files', 'README.md', 'tooling/old.mjs', '--root', root]);
      assert.equal(green.status, 1, 'one graded file is coverage: its finding counts');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('--files takes a Windows-style relative path and grades the file whole', () => {
    const { root } = scratchRepo();
    try {
      const r = run(['--files', 'tooling\\old.mjs', '--root', root]);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stdout, /^tooling\/old\.mjs:1 /m);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('COVERAGE LOST (exit 2): a base git cannot resolve', () => {
    const { root } = scratchRepo();
    try {
      const r = run(['--base', 'no-such-ref', '--root', root]);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /COVERAGE LOST — the change could not be named/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('COVERAGE LOST (exit 2): a file it must grade cannot be tokenized', () => {
    const { root, git } = scratchRepo();
    try {
      writeFileSync(join(root, 'tooling', 'broken.mjs'), "export const s = 'never closed;\n");
      git('add', 'tooling/broken.mjs');
      const r = run(['--base', 'main', '--root', root]);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /tooling\/broken\.mjs: could not be tokenized — unterminated string on line 1/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('COVERAGE LOST (exit 2): no CodeQL config to say what CodeQL scans', () => {
    const { root } = scratchRepo();
    try {
      rmSync(join(root, CODEQL_CONFIG_REL));
      const r = run(['--base', 'main', '--root', root]);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /codeql-config\.yml could not be read/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('the real tree: this branch\'s own change against origin/main is clean', () => {
    const r = run([]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /codeql-lite: clean — \d+ code file\(s\) graded/);
  });

  // Not a whole-tree ratchet (PR #1203 review F5): a finding on an old line is a report, not a
  // red guard test — the gate is diff-scoped, as CodeQL's PR rule is. `--all` stays a manual command.
  test('the real tree: --all tokenizes every tracked code file (exit 0 or 1, never COVERAGE LOST)', () => {
    const r = run(['--all']);
    assert.notEqual(r.status, 2, r.stdout + r.stderr);
    assert.ok(r.status === 0 || r.status === 1, `exit ${r.status}: ${r.stderr}`);
    const graded = Number(/(\d+) code file\(s\) graded/.exec(r.stdout)?.[1]);
    assert.ok(graded > 1000, `only ${graded} files graded`);
  });
});
