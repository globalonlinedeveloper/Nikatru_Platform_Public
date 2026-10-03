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
import { analyse, applyAllows, changedLines, parseArgs, RULES, toRepoRel, tokenize, TokenizeError, CODEQL_CONFIG_REL } from '../assert-codeql-lite.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-codeql-lite.mjs');
const FS = "import { existsSync, readFileSync, writeFileSync, openSync, mkdtempSync } from 'node:fs';\nimport { join } from 'node:path';\nimport { tmpdir } from 'node:os';\n";
/** The rules a source trips, its imports used so the unused-import rule stays out of the way. */
const rulesOf = (src) => analyse(`${FS}${src}\nexport const _use = [existsSync, readFileSync, writeFileSync, openSync, mkdtempSync, join, tmpdir];\n`).map((f) => f.rule);
const run = (args, cwd = REPO) => spawnSync(process.execPath, [GUARD, ...args], { cwd, encoding: 'utf8' });

describe('js/file-system-race', () => {
  test('red control: the real #1189 line — existsSync(p) ? readFileSync(p), then writeFileSync(p)', () => {
    const src = [
      'function main() {',
      '  const sheetAbs = join(ROOT, sheetRel);',
      "  const previous = existsSync(sheetAbs) ? readSheet(readFileSync(sheetAbs, 'utf8')) : null;",
      '  writeFileSync(sheetAbs, sheetText(r, previous));',
      '}',
    ].join('\n');
    const f = analyse(`${FS}${src}\nexport const _u = [openSync, mkdtempSync, tmpdir];`).filter((x) => x.rule === RULES.race);
    assert.deepEqual(f.map((x) => x.line), [6, 7]);
    assert.match(f[0].message, /existsSync\(\) checked on line 6/);
  });

  test('red: a check through the fs namespace, then a read in the same function', () => {
    assert.ok(analyse("import fs from 'node:fs';\nfunction f(p) { if (!fs.existsSync(p)) return null; return fs.readFileSync(p, 'utf8'); }").some((x) => x.rule === RULES.race));
  });

  test('green: the try/ENOENT form #1189 shipped', () => {
    const src = "const readOrNull = (abs) => { try { return readFileSync(abs, 'utf8'); } catch (err) { if (err && err.code === 'ENOENT') return null; throw err; } };\nfunction f() { return existsSync(a) ? 1 : 0; }";
    assert.deepEqual(rulesOf(src), []);
  });

  test('green: a check and a use in DIFFERENT functions, or of different paths', () => {
    assert.deepEqual(rulesOf('function a(p) { return existsSync(p); }\nfunction b(p) { return readFileSync(p); }'), []);
    assert.deepEqual(rulesOf('function a(p, q) { if (existsSync(p)) return readFileSync(q); }'), []);
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

  test('green: replaceAll, a /g regex, and backslashes escaped first', () => {
    assert.deepEqual(rulesOf("const a = s.replaceAll('\"', '&quot;');\nconst b = s.replace(/</g, '&lt;');\nconst c = s.replace(/\\\\/g, '\\\\\\\\').replace(/\"/g, '\\\\\"');"), []);
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

  test('an allow on the line above counts; one for a different rule does not', () => {
    const above = `// codeql-lite: allow js/incomplete-url-substring-sanitization — a log filter, not a URL check\nconst ok = url.includes('nikatru.com');`;
    assert.equal(applyAllows(above, analyse(above)).allowed.length, 1);
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
    const { root } = scratchRepo();
    try {
      writeFileSync(join(root, 'tooling', 'broken.mjs'), "export const s = 'never closed;\n");
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

  test('the real tree: --all tokenizes every tracked code file (a finding is a report, never exit 2)', () => {
    const r = run(['--all']);
    assert.notEqual(r.status, 2, r.stderr);
    const graded = Number(/(\d+) code file\(s\) graded/.exec(r.stdout)?.[1]);
    assert.ok(graded > 1000, `only ${graded} files graded`);
  });
});
