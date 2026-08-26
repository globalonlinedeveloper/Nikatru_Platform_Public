/* selftest.node.js — do the gates in scripts/ actually bite?
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/test/selftest.node.js
     node scripts/test/selftest.node.js --keep     (leave the fixtures on disk)

   No dependencies, no framework, bare Node. It builds a small but REAL tool
   tree in the OS temp directory — real PNG icons copied out of templates/tool, a
   real manifest, a real locale catalogue — runs each gate against it, then
   breaks exactly one thing and runs the gate again.

   WHY THIS FILE EXISTS AT ALL

   The recurring failure in this family is not a broken check, it is a check
   that silently stopped checking. It still prints "clean", CI still goes green,
   and nothing surfaces until the thing it guarded is already broken. The
   defence is not more checks; it is a recorded failing case for every check.

   So every assertion below comes in pairs: the gate PASSES on a correct tree,
   and FAILS on one specific mutation, with a message that names the problem.
   An assertion that cannot fail is worse than none — it inflates apparent
   coverage — so if you add a gate to scripts/ and cannot write the mutation
   that makes it red, the gate is not real and belongs deleted rather than kept
   "for safety".

   THE TWO THINGS IT DELIBERATELY PROVES ABOUT ITSELF

     - the network scanner does NOT fire on the word "fetch" in a comment
       (a gate that is red on its own documentation is a gate people disable),
       and DOES fire on a real call four lines later;
     - an external <a href> does not fail the remote-subresource gate, while an
       external <script src> does.

   Exit codes: 0 every pair behaved · 1 a gate did not bite, or bit wrongly. */

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = path.resolve(__dirname, '..');
const REPO = path.resolve(SCRIPTS, '..');
const KEEP = process.argv.includes('--keep');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-selftest-'));

let PASS = 0;
const FAILURES = [];

function ok(label, extra) { PASS++; console.log('  PASS  ' + label + (extra ? '  — ' + extra : '')); }
function bad(label, why) { FAILURES.push({ label, why }); console.log('  FAIL  ' + label + '\n        ' + String(why).split('\n').join('\n        ')); }

function run(script, argv, root) {
  const res = spawnSync(process.execPath, [path.join(SCRIPTS, script), ...argv, '--repo-root', root], {
    encoding: 'utf8', cwd: REPO
  });
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

/* `expect` is the whole point: a case states the code it wants AND a fragment
   of the message. A gate that fails for an unrelated reason is not the gate
   working — that is how three "caught" mutations turned out to be compile
   errors in an earlier project in this family. */
function expect(label, { script, argv, root, code, contains }) {
  const r = run(script, argv, root);
  const codeOk = r.code === code;
  const textOk = !contains || r.out.includes(contains);
  if (codeOk && textOk) return ok(label, 'exit ' + r.code + (contains ? ' · says "' + contains + '"' : ''));
  bad(label,
    (codeOk ? '' : 'expected exit ' + code + ', got ' + r.code + '\n') +
    (textOk ? '' : 'expected the output to contain: ' + contains + '\n') +
    '--- output ---\n' + r.out.trim());
}

/* ---------------- fixture ---------------- */
function w(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

const TOOL = 'Extension/Good_Tool';

function buildBase(root) {
  w(root, 'README.md',
    '# fixture\n\n## Extensions\n\n<!-- CATALOG:START -->\n' +
    '| Extension | What it does | Status |\n|---|---|---|\n| [Placeholder](x) | stale row | Built |\n' +
    '<!-- CATALOG:END -->\n\ntail\n');

  w(root, 'core/core.json', JSON.stringify({ version: '0.1.0', channel: 'v1' }, null, 2) + '\n');
  w(root, 'core/v1/a.js', "'use strict';\nglobalThis.A = 1;\n");
  w(root, 'core/v1/sub/b.js', "'use strict';\nglobalThis.B = 2;\n");

  w(root, TOOL + '/manifest.json', JSON.stringify({
    manifest_version: 3,
    default_locale: 'en',
    name: '__MSG_appName__',
    short_name: '__MSG_appShortName__',
    version: '1.0.0',
    description: '__MSG_appDescription__',
    permissions: ['storage', 'activeTab'],
    content_security_policy: { extension_pages: "default-src 'self'; script-src 'self'; connect-src 'none'" },
    action: {
      default_popup: 'popup/popup.html',
      default_icon: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' }
    },
    background: { service_worker: 'background.js' },
    icons: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' }
  }, null, 2) + '\n');

  w(root, TOOL + '/background.js',
    "'use strict';\n" +
    'chrome.runtime.onInstalled.addListener(function () {});\n');

  w(root, TOOL + '/popup/popup.html',
    '<!doctype html><html><head><link rel="stylesheet" href="popup.css"></head>\n' +
    '<body><p><a href="https://nikatru.com/privacy">Privacy</a></p>\n' +
    '<script src="popup.js"></script></body></html>\n');
  w(root, TOOL + '/popup/popup.js', "'use strict';\ndocument.title = 'x';\n");
  w(root, TOOL + '/popup/popup.css', 'body { margin: 0 }\n');

  w(root, TOOL + '/_locales/en/messages.json', JSON.stringify({
    appName: { message: 'Good Tool' },
    appShortName: { message: 'GoodTool' },
    appDescription: { message: 'A fixture extension used by the scripts self-test.' }
  }, null, 2) + '\n');

  for (const size of [16, 32, 48, 128]) {
    const src = path.join(REPO, 'templates', 'tool', 'icons', 'icon' + size + '.png');
    const dst = path.join(root, TOOL, 'icons', 'icon' + size + '.png');
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }

  w(root, TOOL + '/CHANGELOG.md', '# Changelog\n\n## [1.0.0] - 2026-08-14\n\n### Added\n\n- first release\n');
  w(root, TOOL + '/test/smoke.node.js', "'use strict';\nconsole.log('ok');\n");

  w(root, TOOL + '/tool.json', JSON.stringify({
    $schema: '../../scripts/schema/tool.schema.json',
    id: 'goodtool',
    name: 'Good Tool',
    surface: 'extension',
    status: 'wip',
    summary: 'A fixture extension used by the scripts self-test.',
    manifest: 'manifest.json',
    package: {
      include: ['manifest.json', 'background.js', 'popup/', 'icons/', '_locales/'],
      exclude: ['**/*.node.js', '**/test/**', '**/*.md']
    },
    targets: { chromium: { stores: ['chrome', 'edge'] } },
    tests: ['test/smoke.node.js'],
    policy: {
      permissions: { storage: 'remembers the user\'s settings', activeTab: 'acts on the tab the user invoked it on' },
      optionalHostPermissions: {},
      networkAllowlist: []
    },
    listings: { chrome: null, edge: null, firefox: null }
  }, null, 2) + '\n');
}

const BASE = path.join(TMP, '_base');
buildBase(BASE);

let caseNo = 0;
/* Each case gets a pristine copy, so one mutation can never leak into the next.
   A shared fixture that accumulates damage produces cascading failures whose
   first cause is the only real one. */
function fixture(mutate) {
  const root = path.join(TMP, 'case-' + (++caseNo));
  copyDir(BASE, root);
  if (mutate) mutate(root);
  return root;
}
const readJson = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
/* mkdir first: a mutation that ADDS a locale writes into a directory the base
   fixture does not have. */
const writeJson = (root, rel, v) => w(root, rel, JSON.stringify(v, null, 2) + '\n');
const edit = (root, rel, fn) => {
  const abs = path.join(root, rel);
  fs.writeFileSync(abs, fn(fs.readFileSync(abs, 'utf8')), 'utf8');
};

/* =====================================================================
   toolinfo + discover
   ===================================================================== */
console.log('\ndiscover.mjs');
expect('a well-formed tree yields a matrix', {
  script: 'discover.mjs', argv: ['--json'], root: fixture(), code: 0, contains: '["goodtool"]'
});
expect('a duplicate tool id is fatal', {
  script: 'discover.mjs', argv: [], code: 1, contains: 'duplicate tool id',
  root: fixture(root => {
    copyDir(path.join(root, TOOL), path.join(root, 'Extension/Second_Tool'));
  })
});
expect('surface must match the category directory', {
  script: 'discover.mjs', argv: [], code: 1, contains: 'A category IS the delivery surface',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); t.surface = 'web'; writeJson(root, TOOL + '/tool.json', t); })
});
expect('a listed test that does not exist is fatal', {
  script: 'discover.mjs', argv: [], code: 1, contains: 'silently stops running',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); t.tests = ['test/gone.node.js']; writeJson(root, TOOL + '/tool.json', t); })
});
expect('an id that is not lowercase-kebab is fatal', {
  script: 'discover.mjs', argv: [], code: 1, contains: 'must be lowercase-kebab',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); t.id = 'Good_Tool'; writeJson(root, TOOL + '/tool.json', t); })
});
expect('a version in tool.json is fatal (the manifest is the only source)', {
  script: 'discover.mjs', argv: [], code: 1, contains: 'single source of',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); t.version = '1.0.0'; writeJson(root, TOOL + '/tool.json', t); })
});
expect('unparseable tool.json names the line and column', {
  script: 'discover.mjs', argv: [], code: 1, contains: 'does not parse as JSON',
  root: fixture(root => { edit(root, TOOL + '/tool.json', s => s.replace('{', '{ oops')); })
});

/* =====================================================================
   lint
   ===================================================================== */
console.log('\nlint.mjs');
expect('clean sources parse', {
  script: 'lint.mjs', argv: ['goodtool'], root: fixture(), code: 0, contains: 'file(s) parse'
});
expect('a syntax error in a shipped file fails', {
  script: 'lint.mjs', argv: ['goodtool'], code: 1, contains: 'SyntaxError',
  root: fixture(root => { edit(root, TOOL + '/background.js', s => s + 'const a = ;\n'); })
});
expect('a syntax error in a listed TEST also fails', {
  script: 'lint.mjs', argv: ['goodtool'], code: 1, contains: 'SyntaxError',
  root: fixture(root => { edit(root, TOOL + '/test/smoke.node.js', s => s + 'function ( {\n'); })
});
expect('selecting zero files is a FAILURE, not a pass', {
  script: 'lint.mjs', argv: ['goodtool'], code: 1, contains: 'REQUIRED COVERAGE',
  root: fixture(root => {
    const t = readJson(root, TOOL + '/tool.json');
    t.package.include = ['nothing-matches-this.json'];
    writeJson(root, TOOL + '/tool.json', t);
  })
});
expect('the tool can be named by path as well as by id', {
  script: 'lint.mjs', argv: [TOOL], root: fixture(), code: 0, contains: 'file(s) parse'
});
expect('an unknown tool name refuses rather than checking nothing', {
  script: 'lint.mjs', argv: ['nosuchtool'], root: fixture(), code: 2, contains: 'no tool named'
});

/* =====================================================================
   check-version
   ===================================================================== */
console.log('\ncheck-version.mjs');
expect('manifest and CHANGELOG agree', {
  script: 'check-version.mjs', argv: ['goodtool'], root: fixture(), code: 0
});
expect('a CHANGELOG behind the manifest fails', {
  script: 'check-version.mjs', argv: ['goodtool'], code: 1, contains: "CHANGELOG.md's newest entry is [0.9.0]",
  root: fixture(root => { edit(root, TOOL + '/CHANGELOG.md', s => s.replace('1.0.0', '0.9.0')); })
});
expect('a missing CHANGELOG fails', {
  script: 'check-version.mjs', argv: ['goodtool'], code: 1, contains: 'CHANGELOG.md is missing',
  root: fixture(root => { fs.rmSync(path.join(root, TOOL, 'CHANGELOG.md')); })
});
expect('a reused version number fails', {
  script: 'check-version.mjs', argv: ['goodtool'], code: 1, contains: 'A version is never reused',
  root: fixture(root => { edit(root, TOOL + '/CHANGELOG.md', s => s + '\n## [1.0.0] - 2026-01-01\n\n- again\n'); })
});
expect('--expect disagreeing with the manifest fails', {
  script: 'check-version.mjs', argv: ['goodtool', '--expect', '1.0.1'], root: fixture(), code: 1, contains: 'the caller expected v1.0.1'
});
expect('a tag naming another tool fails', {
  script: 'check-version.mjs', argv: ['goodtool', '--tag', 'othertool-v1.0.0'], root: fixture(), code: 1, contains: 'tag names this tool'
});
/* A malformed version must be reported BY the version gate, as its own
   failure (exit 1) — not by the loader as "cannot run" (exit 2). The first
   version of toolinfo.mjs made it a tool.json contract error, which meant the
   one script whose whole job is version agreement was the one script that could
   not say so. Both scripts that grade it are asserted here. */
expect('an illegal version format fails IN check-version, not in the loader', {
  script: 'check-version.mjs', argv: ['goodtool'], code: 1, contains: 'no leading zeros',
  root: fixture(root => { const m = readJson(root, TOOL + '/manifest.json'); m.version = '1.0.0-beta'; writeJson(root, TOOL + '/manifest.json', m); })
});
expect('and policy-check grades it too', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'manifest version format',
  root: fixture(root => { const m = readJson(root, TOOL + '/manifest.json'); m.version = '01.2.3'; writeJson(root, TOOL + '/manifest.json', m); })
});

/* =====================================================================
   policy-check
   ===================================================================== */
console.log('\npolicy-check.mjs');
expect('a clean tool passes every gate', {
  script: 'policy-check.mjs', argv: ['goodtool'], root: fixture(), code: 0
});
expect('a real fetch() in a shipped file fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'zero network calls',
  root: fixture(root => { edit(root, TOOL + '/background.js', s => s + 'fetch("https://example.com/ping");\n'); })
});
expect('the word fetch in a COMMENT does not fail, and is still reported', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0, contains: 'only inside comments or strings',
  root: fixture(root => {
    edit(root, TOOL + '/background.js', s =>
      '// This extension never calls fetch(), XMLHttpRequest or navigator.sendBeacon.\n' +
      '/* Not a WebSocket in sight, and no EventSource either. */\n' + s);
  })
});
expect('a fetch hidden under a comment banner is still caught', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'zero network calls',
  root: fixture(root => {
    edit(root, TOOL + '/background.js', s =>
      '// We never call fetch(). Honest.\n' + s + 'const u = "/*"; fetch("https://example.com/x");\n');
  })
});
expect('a URL inside a string does not fail the gate', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0,
  root: fixture(root => { edit(root, TOOL + '/background.js', s => s + 'const doc = "see https://example.com for how fetch() works";\n'); })
});
expect('eval() fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'no runtime code generation',
  root: fixture(root => { edit(root, TOOL + '/background.js', s => s + 'eval("1+1");\n'); })
});
expect('string-form setTimeout fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'string-form setTimeout',
  root: fixture(root => { edit(root, TOOL + '/background.js', s => s + 'setTimeout("go()", 10);\n'); })
});
expect('a remote <script src> fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'no remote subresources',
  root: fixture(root => { edit(root, TOOL + '/popup/popup.html', s => s.replace('</body>', '<script src="https://cdn.example.com/x.js"></script></body>')); })
});
expect('an external <a href> does NOT fail (it navigates, it does not load)', {
  script: 'policy-check.mjs', argv: ['goodtool'], root: fixture(), code: 0, contains: 'external <a href>'
});
expect('an unjustified permission fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'no justification at all: downloads',
  root: fixture(root => { const m = readJson(root, TOOL + '/manifest.json'); m.permissions.push('downloads'); writeJson(root, TOOL + '/manifest.json', m); })
});
expect('a placeholder justification fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'placeholder justification',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); t.policy.permissions.storage = 'TODO explain'; writeJson(root, TOOL + '/tool.json', t); })
});
expect('static host_permissions without a justification fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'static host_permissions require',
  root: fixture(root => { const m = readJson(root, TOOL + '/manifest.json'); m.host_permissions = ['<all_urls>']; writeJson(root, TOOL + '/manifest.json', m); })
});
expect('a description over 132 characters fails, measured on the TRANSLATION', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'the limit is 132',
  root: fixture(root => {
    const m = readJson(root, TOOL + '/_locales/en/messages.json');
    m.appDescription.message = 'x'.repeat(137);
    writeJson(root, TOOL + '/_locales/en/messages.json', m);
  })
});
expect('an over-long description in a NON-default locale is caught too', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'de: description is',
  root: fixture(root => {
    const m = readJson(root, TOOL + '/_locales/en/messages.json');
    m.appDescription.message = 'x'.repeat(137);
    writeJson(root, TOOL + '/_locales/de/messages.json', m);
  })
});
expect('an unresolved __MSG_ key fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'every __MSG_ key resolves',
  root: fixture(root => {
    const m = readJson(root, TOOL + '/_locales/en/messages.json');
    delete m.appShortName;
    writeJson(root, TOOL + '/_locales/en/messages.json', m);
  })
});
/* The next three came from running policy-check against the real FullShot tree
   after the fixture was already green. The fixture had no bidi support and no
   file that documents the i18n mechanism in prose, so it could not have shown
   either bug — which is the whole argument for mutating something real. */
expect("Chrome's predefined __MSG_@@ messages are not demanded of messages.json", {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0,
  root: fixture(root => {
    edit(root, TOOL + '/popup/popup.html', s => s.replace('<body>', '<body dir="__MSG_@@bidi_dir__">'));
  })
});
expect('a __MSG_ key quoted in a COMMENT is not demanded either', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0,
  root: fixture(root => {
    edit(root, TOOL + '/background.js', s =>
      '// Chrome substitutes __MSG_someKeyThatDoesNotExist__ at load time; see the docs.\n' + s);
    edit(root, TOOL + '/popup/popup.html', s =>
      s.replace('<body>', '<!-- __MSG_anotherMissingKey__ is explained in the README -->\n<body>'));
  })
});
expect('a real unresolved key in real markup still fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: '__MSG_reallyMissing__',
  root: fixture(root => {
    edit(root, TOOL + '/popup/popup.html', s => s.replace('<body>', '<body title="__MSG_reallyMissing__">'));
  })
});
expect('a build-time .mjs swept into the package is reported', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0, contains: 'build-time file(s) are inside the packaged set',
  root: fixture(root => { w(root, TOOL + '/popup/make-thing.mjs', "export const x = 1;\n"); })
});
expect('a missing default locale catalogue fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'REFUSES TO LOAD',
  root: fixture(root => { const m = readJson(root, TOOL + '/manifest.json'); m.default_locale = 'fr'; writeJson(root, TOOL + '/manifest.json', m); })
});
expect('locales are packaged even when package.include forgets them', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 0, contains: 'no longer reaches _locales on its own',
  root: fixture(root => {
    const t = readJson(root, TOOL + '/tool.json');
    t.package.include = t.package.include.filter(x => x !== '_locales/');
    writeJson(root, TOOL + '/tool.json', t);
  })
});
/* 🔴 PLURAL CATEGORIES — the locale-completeness limb, both directions.
   Chrome's messages.json has no plural support, so a count-agreeing sentence is
   spelled one key per CLDR category. Which categories exist differs by language,
   and until 2026-08-22 this gate did a naive key-set diff: it demanded
   `itemCountOne` of Japanese, a form Japanese does not have, on every run
   forever. The cases below pin the exemption from BOTH sides, and every one of
   them is graded through `--warnings-as-errors` on purpose — this limb warns
   rather than fails, so an exit code is the only thing that can tell "reported"
   from "not reported" apart. The base fixture exits 0 under that flag, so a 1
   here is this limb and nothing else.

   `en` = one|other · `ja` = other alone · `ru` = one|few|many|other.
   Read from Intl.PluralRules at run time, exactly as the gate reads it. */
const dropKeys = (obj, keys) => {
  const o = JSON.parse(JSON.stringify(obj));
  for (const k of keys) delete o[k];
  return o;
};
function withPlurals(mutate = () => {}) {
  return fixture(root => {
    const en = readJson(root, TOOL + '/_locales/en/messages.json');
    en.itemCountOne = { message: 'one item' };
    en.itemCountOther = { message: 'several items' };
    /* NOT a plural: `stepOne` has no `stepOther`, so the base's category set in
       the default locale is {one}, not en's {one, other}. A suffix is a
       spelling, not a semantic — the tool's own plurals.mjs records this family
       paying for that confusion once already. */
    en.stepOne = { message: 'Step one' };
    writeJson(root, TOOL + '/_locales/en/messages.json', en);
    writeJson(root, TOOL + '/_locales/ja/messages.json', dropKeys(en, ['itemCountOne']));
    writeJson(root, TOOL + '/_locales/ru/messages.json',
      Object.assign(dropKeys(en, []), { itemCountFew: { message: 'few' }, itemCountMany: { message: 'many' } }));
    mutate(root);
  });
}
expect('a CLDR category the locale does NOT have is not a missing key', {
  script: 'policy-check.mjs', argv: ['goodtool', '--warnings-as-errors'], code: 0,
  contains: 'plural-aware: 1 key(s) across 1 locale(s) were NOT counted as missing',
  root: withPlurals()
});
expect('a genuinely missing key in the same locale is STILL reported', {
  script: 'policy-check.mjs', argv: ['goodtool', '--warnings-as-errors'], code: 1, contains: 'ja: 1 key(s) missing (itemCountOther',
  root: withPlurals(root => {
    writeJson(root, TOOL + '/_locales/ja/messages.json',
      dropKeys(readJson(root, TOOL + '/_locales/ja/messages.json'), ['itemCountOther']));
  })
});
expect('a key that merely ENDS in One is not exempted', {
  script: 'policy-check.mjs', argv: ['goodtool', '--warnings-as-errors'], code: 1, contains: 'ja: 1 key(s) missing (stepOne',
  root: withPlurals(root => {
    writeJson(root, TOOL + '/_locales/ja/messages.json',
      dropKeys(readJson(root, TOOL + '/_locales/ja/messages.json'), ['stepOne']));
  })
});
/* The other direction, and it is the one a key-set diff can NEVER see: `ru`
   needs `itemCountFew`, and `en` has no such key to diff against. Nothing falls
   back either — chrome.i18n resolves it to the empty string. */
expect('a plural form the DEFAULT locale does not have is reported when a locale needs it', {
  script: 'policy-check.mjs', argv: ['goodtool', '--warnings-as-errors'], code: 1, contains: '1 plural form(s) absent (itemCountFew',
  root: withPlurals(root => {
    writeJson(root, TOOL + '/_locales/ru/messages.json',
      dropKeys(readJson(root, TOOL + '/_locales/ru/messages.json'), ['itemCountFew']));
  })
});

/* 🔴 AND THE CONVENTION THIS GATE MUST NOT BREAK. The corpus records a SECOND,
   incompatible plural strategy (pipeline/06-i18n.md I-4): the skeleton emits all
   SIX CLDR forms into EVERY catalogue so `_other` is a real fallback, and a
   plain key-set parity check is exactly right for that tree. The family
   recovery above declines such a base by construction — six suffixes in `en` is
   not `en`'s own set of two — so a tool following that convention is graded
   with no exemption at all, as it was before this change. This case is the pin
   on that, because widening the exemption to "any base with plural suffixes"
   would silently stop grading those trees. */
expect('a tool that emits all six forms into every locale keeps the plain parity check', {
  script: 'policy-check.mjs', argv: ['goodtool', '--warnings-as-errors'], code: 1, contains: 'ja: 1 key(s) missing (itemCountOne',
  root: fixture(root => {
    const en = readJson(root, TOOL + '/_locales/en/messages.json');
    for (const s of ['Zero', 'One', 'Two', 'Few', 'Many', 'Other']) en['itemCount' + s] = { message: s };
    writeJson(root, TOOL + '/_locales/en/messages.json', en);
    const ja = JSON.parse(JSON.stringify(en));
    delete ja.itemCountOne;
    writeJson(root, TOOL + '/_locales/ja/messages.json', ja);
  })
});

expect('an underscore-prefixed root directory fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'reserved for use by the system',
  root: fixture(root => {
    w(root, TOOL + '/_core/ns.js', "'use strict';\n");
    const t = readJson(root, TOOL + '/tool.json');
    t.package.include.push('_core/');
    writeJson(root, TOOL + '/tool.json', t);
  })
});
expect('an icon of the wrong size fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'is actually 128x128',
  root: fixture(root => {
    fs.copyFileSync(path.join(root, TOOL, 'icons/icon128.png'), path.join(root, TOOL, 'icons/icon16.png'));
  })
});
expect('a renamed non-PNG icon fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'is not a PNG',
  root: fixture(root => { fs.writeFileSync(path.join(root, TOOL, 'icons/icon48.png'), 'not a png', 'utf8'); })
});
expect('a package with no manifest fails', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'Manifest file is missing or unreadable',
  root: fixture(root => {
    const t = readJson(root, TOOL + '/tool.json');
    t.package.include = t.package.include.filter(x => x !== 'manifest.json');
    writeJson(root, TOOL + '/tool.json', t);
  })
});
/* An absent allowlist must be reported BY policy-check, not by the loader.
   These two cases exist because the first version of toolinfo.mjs made both
   fields tool.json contract errors — which made every gate exit 2 and turned
   the branches inside policy-check that handle them into assertions that could
   never fire. A gate must be able to fail for the reason it is about. */
expect('an absent networkAllowlist is not treated as an empty one', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'policy.networkAllowlist is declared',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); delete t.policy.networkAllowlist; writeJson(root, TOOL + '/tool.json', t); })
});
expect('an absent policy.permissions fails in policy-check', {
  script: 'policy-check.mjs', argv: ['goodtool'], code: 1, contains: 'policy.permissions is declared',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); delete t.policy.permissions; writeJson(root, TOOL + '/tool.json', t); })
});
expect('but the matrix can still be built — a policy gap is not a contract break', {
  script: 'discover.mjs', argv: ['--json'], code: 0, contains: '["goodtool"]',
  root: fixture(root => { const t = readJson(root, TOOL + '/tool.json'); delete t.policy.networkAllowlist; writeJson(root, TOOL + '/tool.json', t); })
});

/* =====================================================================
   sync-core + check-core-sync
   ===================================================================== */
console.log('\nsync-core.mjs / check-core-sync.mjs');
const withCore = root => { const t = readJson(root, TOOL + '/tool.json'); t.core = { channel: 'v1', pin: null }; writeJson(root, TOOL + '/tool.json', t); };

expect('a tool that vendors no core passes', {
  script: 'check-core-sync.mjs', argv: ['goodtool'], root: fixture(), code: 0, contains: 'vendors no core'
});
expect('an orphan vendor/core with no declaration fails', {
  script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'declares no core channel',
  root: fixture(root => { w(root, TOOL + '/vendor/core/ghost.js', "'use strict';\n"); })
});
expect('a declared channel that was never synced fails', {
  script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'never been created',
  root: fixture(withCore)
});
expect('a declared channel with no core/ directory fails', {
  script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'FAIL  core/v1/ exists',
  root: fixture(root => { withCore(root); fs.rmSync(path.join(root, 'core'), { recursive: true }); })
});

{
  const root = fixture(withCore);
  expect('sync-core vendors the channel', {
    script: 'sync-core.mjs', argv: ['goodtool'], root, code: 0, contains: 'vendored 2 file(s)'
  });
  const meta = path.join(root, TOOL, 'vendor/core/.coremeta.json');
  if (fs.existsSync(meta)) ok('.coremeta.json was written', JSON.parse(fs.readFileSync(meta, 'utf8')).coreVersion);
  else bad('.coremeta.json was written', 'not found at ' + meta);
  expect('and the sync then verifies', { script: 'check-core-sync.mjs', argv: ['goodtool'], root, code: 0, contains: 'byte-identical' });

  const synced = root; // reuse as the base for drift mutations
  const drift = mutate => { const r2 = path.join(TMP, 'case-' + (++caseNo)); copyDir(synced, r2); mutate(r2); return r2; };

  expect('a hand-edited vendored file fails', {
    script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'MODIFIED',
    root: drift(r2 => { edit(r2, TOOL + '/vendor/core/a.js', s => s + '// patched locally\n'); })
  });
  expect('editing the vendored file AND its recorded hash still fails', {
    script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'MODIFIED',
    root: drift(r2 => {
      const abs = path.join(r2, TOOL, 'vendor/core/a.js');
      fs.writeFileSync(abs, "'use strict';\nglobalThis.A = 99;\n", 'utf8');
      const crypto = require('crypto');
      const m = readJson(r2, TOOL + '/vendor/core/.coremeta.json');
      m.files['a.js'] = 'sha256-' + crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
      writeJson(r2, TOOL + '/vendor/core/.coremeta.json', m);
    })
  });
  expect('a CRLF-only difference is named as line endings, not as a mystery hash', {
    script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'LINE ENDINGS',
    root: drift(r2 => {
      const abs = path.join(r2, TOOL, 'vendor/core/a.js');
      fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8').replace(/\n/g, '\r\n'), 'utf8');
    })
  });
  expect('a core bump leaves the tool behind, and says so', {
    script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'the vendored core is current',
    root: drift(r2 => { const c = readJson(r2, 'core/core.json'); c.version = '0.2.0'; writeJson(r2, 'core/core.json', c); })
  });
  expect('a pin that names a version core/ does not hold is refused by sync-core', {
    script: 'sync-core.mjs', argv: ['goodtool'], code: 2, contains: 'confirm the lie',
    root: drift(r2 => { const t = readJson(r2, TOOL + '/tool.json'); t.core.pin = '9.9.9'; writeJson(r2, TOOL + '/tool.json', t); })
  });
  expect('a file deleted from vendor/core fails', {
    script: 'check-core-sync.mjs', argv: ['goodtool'], code: 1, contains: 'MISSING',
    root: drift(r2 => { fs.rmSync(path.join(r2, TOOL, 'vendor/core/sub/b.js')); })
  });
  expect('a stray file in vendor/core is not silently deleted', {
    script: 'sync-core.mjs', argv: ['goodtool'], code: 1, contains: 'this script did not put there',
    root: drift(r2 => { w(r2, TOOL + '/vendor/core/mine.js', "'use strict';\n"); })
  });
}

/* =====================================================================
   gen-catalog
   ===================================================================== */
console.log('\ngen-catalog.mjs');
{
  const root = fixture();
  expect('--check sees a stale table', { script: 'gen-catalog.mjs', argv: ['--check'], root, code: 1, contains: 'out of date' });
  expect('writing fixes it', { script: 'gen-catalog.mjs', argv: [], root, code: 0, contains: 'rewrote the catalog' });
  expect('and --check then agrees', { script: 'gen-catalog.mjs', argv: ['--check'], root, code: 0, contains: 'up to date' });
  const md = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  if (md.includes('| [Good Tool](Extension/Good_Tool) |') && md.includes('tail'))
    ok('the row is generated and the surrounding prose survives');
  else bad('the row is generated and the surrounding prose survives', md);
}
expect('no markers means no write', {
  script: 'gen-catalog.mjs', argv: [], code: 2, contains: 'has no catalog markers',
  root: fixture(root => { edit(root, 'README.md', s => s.replace('<!-- CATALOG:START -->', '').replace('<!-- CATALOG:END -->', '')); })
});
expect('an empty result will not overwrite a real table', {
  script: 'gen-catalog.mjs', argv: [], code: 2, contains: 'silently delete the catalog',
  root: fixture(root => { fs.rmSync(path.join(root, TOOL, 'tool.json')); })
});
expect('a null listing never becomes an invented URL', {
  script: 'gen-catalog.mjs', argv: ['--print'], root: fixture(), code: 0, contains: 'In progress'
});

/* =====================================================================
   new-tool
   ===================================================================== */
console.log('\nnew-tool.mjs');
{
  const root = fixture(r2 => {
    /* A minimal templates/tool so the copy is fast and the precedence rule
       (templates/tool wins over _skeleton) is the thing under test. */
    w(r2, 'templates/tool/manifest.json', JSON.stringify({
      manifest_version: 3, default_locale: 'en', name: '__MSG_appName__', version: '0.0.1',
      permissions: ['storage'], background: { service_worker: 'background.js' }
    }, null, 2) + '\n');
    w(r2, 'templates/tool/background.js', "'use strict';\n");
    w(r2, 'templates/tool/_locales/en/messages.json', JSON.stringify({ appName: { message: 'x' } }) + '\n');
    w(r2, 'templates/tool/test/smoke.node.js', "console.log('ok');\n");
    w(r2, 'templates/tool/publish/identity.json', JSON.stringify({ slug: 'skeleton', ownerDomain: 'REPLACE-WITH-YOUR-DOMAIN.example' }, null, 2) + '\n');
    w(r2, 'templates/tool/publish/old-release-1.0.0.zip', 'PK-not-really\n');
    w(r2, 'templates/tool/skeleton.json', JSON.stringify({ skeletonVersion: '1.1.0', tool: '', copiedAt: '' }, null, 2) + '\n');
  });

  expect('--dry-run writes nothing', {
    script: 'new-tool.mjs', argv: ['--category', 'Extension', '--name', 'Tab Digest', '--id', 'tabdigest', '--dry-run'],
    root, code: 0, contains: 'dry run'
  });
  if (!fs.existsSync(path.join(root, 'Extension/Tab_Digest'))) ok('--dry-run really created nothing');
  else bad('--dry-run really created nothing', 'Extension/Tab_Digest exists');

  expect('it scaffolds', {
    script: 'new-tool.mjs', argv: ['--category', 'Extension', '--name', 'Tab Digest', '--id', 'tabdigest'],
    root, code: 0, contains: 'wrote Extension/Tab_Digest/tool.json'
  });
  const made = path.join(root, 'Extension/Tab_Digest');
  const checks = [
    ['directory name is Title_Snake_Case', fs.existsSync(made)],
    ['skeleton.json stamped with the tool name', fs.existsSync(path.join(made, 'skeleton.json')) && JSON.parse(fs.readFileSync(path.join(made, 'skeleton.json'), 'utf8')).tool === 'Tab_Digest'],
    ['skeletonVersion left alone', JSON.parse(fs.readFileSync(path.join(made, 'skeleton.json'), 'utf8')).skeletonVersion === '1.1.0'],
    ['identity slug set to the tool id', JSON.parse(fs.readFileSync(path.join(made, 'publish/identity.json'), 'utf8')).slug === 'tabdigest'],
    ["the previous tool's release zip did NOT come along", !fs.existsSync(path.join(made, 'publish/old-release-1.0.0.zip'))],
    ['a CHANGELOG was seeded at the manifest version', fs.readFileSync(path.join(made, 'CHANGELOG.md'), 'utf8').includes('## [0.0.1]')],
    ['permission justifications are EMPTY, so policy-check is red by design', JSON.parse(fs.readFileSync(path.join(made, 'tool.json'), 'utf8')).policy.permissions.storage === '']
  ];
  for (const [label, cond] of checks) cond ? ok(label) : bad(label, 'condition false');

  expect('and the new tool is discovered', { script: 'discover.mjs', argv: ['--json'], root, code: 0, contains: 'tabdigest' });
  expect('its empty justification really does fail policy-check', {
    script: 'policy-check.mjs', argv: ['tabdigest'], root, code: 1, contains: 'no justification at all: storage'
  });
  expect('running it again refuses rather than overwriting', {
    script: 'new-tool.mjs', argv: ['--category', 'Extension', '--name', 'Tab Digest', '--id', 'tabdigest2'],
    root, code: 2, contains: 'already exists'
  });
  expect('a duplicate id is refused', {
    script: 'new-tool.mjs', argv: ['--category', 'Extension', '--name', 'Other Thing', '--id', 'tabdigest'],
    root, code: 2, contains: 'already used by'
  });
  expect('an uppercase id is refused', {
    script: 'new-tool.mjs', argv: ['--category', 'Extension', '--name', 'Nope', '--id', 'Nope'],
    root, code: 2, contains: 'not lowercase-kebab'
  });
  expect('a lowercase category is refused', {
    script: 'new-tool.mjs', argv: ['--category', 'extension', '--name', 'Nope', '--id', 'nope'],
    root, code: 2, contains: 'not Capitalized_Singular'
  });
}

/* A half-built templates/tool with no manifest must not win precedence over a
   complete _skeleton. This is not hypothetical: templates/tool/ appeared in the
   real repo holding only README.md and tool.json while another agent was
   building it, and the first version of this script stamped a two-file scaffold
   from it and called that a success. */
expect('a template with no manifest.json is refused, and names the fallback', {
  script: 'new-tool.mjs', argv: ['--category', 'Extension', '--name', 'Half Built', '--id', 'halfbuilt'],
  code: 2, contains: 'has no manifest.json',
  root: fixture(r2 => {
    w(r2, 'templates/tool/tool.json', '{ "id": "template" }\n');
    w(r2, 'templates/tool/README.md', '# still being written\n');
    w(r2, '_skeleton/manifest.json', JSON.stringify({ manifest_version: 3, version: '0.0.1', name: 'x' }, null, 2) + '\n');
    w(r2, '_skeleton/background.js', "'use strict';\n");
  })
});
expect('and --template can then point at the complete one', {
  script: 'new-tool.mjs', argv: ['--category', 'Extension', '--name', 'Half Built', '--id', 'halfbuilt', '--template', '_skeleton', '--dry-run'],
  code: 0, contains: 'dry run',
  root: fixture(r2 => {
    w(r2, 'templates/tool/tool.json', '{ "id": "template" }\n');
    w(r2, '_skeleton/manifest.json', JSON.stringify({ manifest_version: 3, version: '0.0.1', name: 'x' }, null, 2) + '\n');
    w(r2, '_skeleton/background.js', "'use strict';\n");
  })
});

/* =====================================================================
   check-store-packages.mjs

   The gate whose subject is the BUILT ARTIFACT rather than the source. Every
   mutation below is a real zip written byte by byte, because the defect it was
   written for is exactly a case where the source was right and the zip was not:
   on 2026-08-20 six -firefox.zip in Extension/Full_Screen_Shot/publish/ carried
   `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` while the overlay beside them
   carried `fullshot@nikatru.com`. A fixture that mocked the reader would have
   proved nothing about that.
   ===================================================================== */
console.log('\ncheck-store-packages.mjs');

/* A minimal STORED (method 0) zip. No compression, so the test depends on no
   codec and the reader's deflate path is exercised by the real packages the
   `package` job builds rather than by a synthetic one here. */
function zipOf(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    /* A Buffer body is passed through untouched. The freshness cases below put
       the fixture's real icon PNGs into a package and hash them back out, and
       Buffer.from(<png>, 'utf8') is a DIFFERENT FILE — it would report every
       package as stale and the case would "pass" for the wrong reason. */
    const nb = Buffer.from(name, 'utf8');
    const body = Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(body.length, 22);
    lh.writeUInt16LE(nb.length, 26);
    locals.push(lh, nb, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(body.length, 24);
    ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nb);
    offset += 30 + nb.length + body.length;
  }
  const lp = Buffer.concat(locals), cp = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cp.length, 12); eocd.writeUInt32LE(lp.length, 16);
  return Buffer.concat([lp, cp, eocd]);
}

/* The fixture tool declares only `chromium`, so a Firefox package needs the
   target adding too — a package for a target the tool does not declare is a
   different question, and conflating them would make these cases ambiguous. */
function withPackage(zipName, manifest, { firefoxTarget = true, identity = true } = {}) {
  return fixture(root => {
    if (identity) {
      writeJson(root, TOOL + '/publish/identity.json', { slug: 'goodtool', ownerDomain: 'example.test' });
    }
    if (firefoxTarget) {
      const t = readJson(root, TOOL + '/tool.json');
      t.targets.firefox = { overlay: 'publish/manifest.firefox.json' };
      writeJson(root, TOOL + '/tool.json', t);
      /* The overlay must EXIST: toolinfo.mjs treats a `targets.firefox.overlay`
         pointing at a missing file as a tool.json contract error, which makes
         every gate exit 2 before it reads anything. Writing the declaration
         without the file is how the first draft of these cases turned nine
         mutations into nine identical CANNOT RUNs. */
      writeJson(root, TOOL + '/publish/manifest.firefox.json', {
        browser_specific_settings: { gecko: { id: 'goodtool@example.test', strict_min_version: '128.0' } }
      });
    }
    const abs = path.join(root, TOOL, 'publish', zipName);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    /* Three shapes, and the Buffer case is here because leaving it out is a
       real bug this file caught: `zipOf({...})` returns a Buffer, fell through
       to the object branch, and was JSON.stringify'd INTO a manifest.json —
       so the "archive with no manifest" case shipped an archive that had one,
       and the gate correctly graded it and the assertion failed. A fixture that
       does not build what its name says builds is a test of nothing.
         string -> written as-is (a file that is not a zip at all)
         Buffer -> written as-is (a zip this case assembled itself)
         object -> wrapped as the archive's manifest.json */
    const bytes = Buffer.isBuffer(manifest) ? manifest
      : typeof manifest === 'string' ? Buffer.from(manifest, 'utf8')
        : zipOf({ 'manifest.json': JSON.stringify(manifest) });
    fs.writeFileSync(abs, bytes);
  });
}

const goodFfManifest = {
  manifest_version: 3, version: '1.0.0', name: 'x',
  browser_specific_settings: { gecko: { id: 'goodtool@example.test', strict_min_version: '128.0' } }
};

expect('a package whose gecko.id agrees with identity.json passes', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 0, contains: 'goodtool@example.test',
  root: withPackage('goodtool-1.0.0-firefox.zip', goodFfManifest)
});

/* 🔴 THE RECORDED DEFECT. */
expect('a BUILT package carrying the placeholder gecko.id is caught', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'MUST NOT BE UPLOADED TO AMO',
  root: withPackage('goodtool-1.0.0-firefox.zip', {
    ...goodFfManifest,
    browser_specific_settings: { gecko: { id: 'goodtool@REPLACE-WITH-YOUR-DOMAIN.example' } }
  })
});

/* Two real-looking domains. No placeholder test catches this one, and AMO fixes
   whichever reaches it first — permanently. */
expect('a package whose gecko.id disagrees with identity.json is caught', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'agrees with publish/identity.json',
  root: withPackage('goodtool-1.0.0-firefox.zip', {
    ...goodFfManifest,
    browser_specific_settings: { gecko: { id: 'goodtool@someone-elses-domain.test' } }
  })
});

expect('a Firefox package with no gecko.id at all is caught', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'carries a gecko.id',
  root: withPackage('goodtool-1.0.0-firefox.zip', {
    ...goodFfManifest, browser_specific_settings: { gecko: { strict_min_version: '128.0' } }
  })
});

expect('a listed add-on that self-hosts updates is caught', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'must not self-host updates',
  root: withPackage('goodtool-1.0.0-firefox.zip', {
    ...goodFfManifest,
    browser_specific_settings: { gecko: { id: 'goodtool@example.test', update_url: 'https://example.test/u.json' } }
  })
});

/* The chromium package goes to Chrome AND Edge unchanged, so a Firefox-only key
   in it ships twice. The target is decided by CONTENT, so this zip is graded as
   a Firefox one — which is itself the finding: it is named as a chromium
   artifact and is not one. */
expect('a chromium-named package carrying browser_specific_settings is not silently accepted', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'MUST NOT BE UPLOADED TO AMO',
  root: withPackage('goodtool-1.0.0.zip', {
    manifest_version: 3, version: '1.0.0', name: 'x',
    browser_specific_settings: { gecko: { id: 'goodtool@REPLACE-WITH-YOUR-DOMAIN.example' } }
  })
});

expect('a stale version beside the current one WARNS rather than passing silently', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 0, contains: 'is v0.9.0, the tree is v1.0.0',
  root: withPackage('goodtool-0.9.0-firefox.zip', { ...goodFfManifest, version: '0.9.0' })
});

/* An unreadable archive must not read as a clean one. */
expect('a .zip that is not a zip is a finding, not a skip', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'is a readable zip',
  root: withPackage('goodtool-1.0.0-firefox.zip', 'this is not a zip at all, it is prose')
});

expect('an archive with no manifest.json is a finding, not a skip', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'contains a manifest.json',
  root: withPackage('goodtool-1.0.0-firefox.zip', zipOf({ 'README.md': '# not a store package' }))
});

/* 🔴 THE ANTI-VACUITY PAIR. Zero packages is the CI state and it is legitimate,
   so it exits 0 — and the run must SAY so, because "0 packages, clean" and
   "12 packages, clean" printing the same thing is the failure this whole file
   exists to prevent. */
expect('zero packages exits 0 but says out loud that it proved nothing', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 0, contains: 'ZERO PACKAGES WERE PRESENT',
  root: fixture(root => { writeJson(root, TOOL + '/publish/identity.json', { slug: 'goodtool', ownerDomain: 'example.test' }); })
});

/* 🔴 THE CHROMIUM HALF HAD NO update_url REFUSAL. The gecko branch has refused
   `gecko.update_url` since it was written; the Chromium branch had no equivalent,
   so the SAME bytes could carry a top-level `update_url` to Chrome Web Store and
   Edge Add-ons unremarked. Both stores refuse a listed extension that self-hosts
   updates, at review — which costs a submission slot instead of a build. */
expect('a chromium package that self-hosts updates is caught', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'has no top-level update_url',
  root: withPackage('goodtool-1.0.0-chromium.zip',
    { manifest_version: 3, version: '1.0.0', name: 'x', update_url: 'https://example.test/updates.xml' },
    { firefoxTarget: false })
});

/* 🔴 ONE PACKAGE, TWO STORES. These bytes go to Chrome Web Store AND Edge
   Add-ons, so a localised store field reading "for Chrome" is right in one
   listing and wrong in the other — the same defect as the Edge listing that told
   users to open `chrome://`, one layer down. Resolved through the PACKAGED
   locales, because the store resolves `__MSG_` in the reader's language. */
expect('a localised store field naming Chrome is caught in the shared package', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1, contains: 'names no browser in its localised store fields',
  root: withPackage('goodtool-1.0.0-chromium.zip', zipOf({
    'manifest.json': JSON.stringify({ manifest_version: 3, version: '1.0.0', default_locale: 'en', name: '__MSG_appName__' }),
    '_locales/en/messages.json': JSON.stringify({ appName: { message: 'GoodTool for Chrome' } }),
  }), { firefoxTarget: false })
});

/* 🔴 AND THE CASE THAT PROVES THE CHECK PARSES INSTEAD OF GREPPING. `description`
   in a messages.json is TRANSLATOR GUIDANCE and is never shown to a user.
   MEASURED 2026-08-20 on the real tool: 55 of 55 locale files contain the word
   "chrome", every one of them in a `description`. A grep would fire 55 times and
   be wrong 55 times; this must PASS. Without this case the check above could be
   "fixed" into a grep and no test would notice. */
expect('the word chrome in a translator DESCRIPTION is not a finding', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 0, contains: 'names no browser in its localised store fields',
  root: withPackage('goodtool-1.0.0-chromium.zip', zipOf({
    'manifest.json': JSON.stringify({ manifest_version: 3, version: '1.0.0', default_locale: 'en', name: '__MSG_appName__' }),
    '_locales/en/messages.json': JSON.stringify({
      appName: { message: 'GoodTool', description: 'Shown in the Chrome Web Store and chrome://extensions.' },
    }),
  }), { firefoxTarget: false })
});

expect('a tool declaring no targets CANNOT RUN rather than passing', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 2, contains: 'declares no `targets`',
  root: fixture(root => {
    const t = readJson(root, TOOL + '/tool.json');
    delete t.targets;
    writeJson(root, TOOL + '/tool.json', t);
  })
});

/* ---------------------------------------------------------------------------
   THE FRESHNESS LIMB — "is this package the tree, or a photograph of it?"

   🔴 THE RECORDED DEFECT, MEASURED 2026-08-26 ON THE REAL TREE. dist/ held a
   build that predated two privacy fixes — content/capture.js, pages/history.js,
   pages/result.js and all 55 locale catalogues differed from the source beside
   it — and `node scripts/check-store-packages.mjs fullshot` printed five PASS
   lines and exited 0. Nothing in that output was false; the missing sentence was
   about age, and a reader seeing 5-PASS concluded the shipping package contained
   the current code.

   The pair below is deliberately a pair with the SAME EXIT CODE, which is
   unusual in this file and is the point: staleness must be LOUD and must NOT
   redden the lane, because opening a package you built earlier is a supported
   use of this command. So the mutation is proven by the WORDS, not by the code,
   and the fresh case proves the words are not printed unconditionally.
   --------------------------------------------------------------------------- */

/* The exact set of files buildBase() writes that goodtool's package.include
   selects. WRITTEN OUT rather than re-derived: a test that computes its
   expectation with the same rules as the code under test proves only that one
   function agrees with itself. The count is asserted below, so a packaged file
   added to the fixture turns this case red instead of quietly shrinking it. */
const PACKAGED = [
  '_locales/en/messages.json',
  'background.js',
  'icons/icon128.png', 'icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png',
  'manifest.json',
  'popup/popup.css', 'popup/popup.html', 'popup/popup.js'
];

/* Writes a package that genuinely IS the fixture tree, into dist/ at the repo
   root — where `pack.mjs --out dist` writes and what ci.yml passes.
   DELIBERATELY NOT the tool's publish/: a zip there is a golden master, the
   bytes a store received, and the limb says something different (and opposite)
   about those — it must never tell anyone to rebuild over one. */
function withBuiltPackage(mutateAfterBuild) {
  return fixture(root => {
    const files = {};
    for (const rel of PACKAGED) files[rel] = fs.readFileSync(path.join(root, TOOL, rel));
    const abs = path.join(root, 'dist', 'goodtool-chromium.zip');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, zipOf(files));
    if (mutateAfterBuild) mutateAfterBuild(root);
  });
}

expect('a package built from the tree is reported as carrying it', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 0,
  contains: '10 packaged file(s) hashed',
  root: withBuiltPackage()
});

/* THE MUTATION IS TO THE SOURCE, NOT TO THE ZIP, because that is the shape the
   defect actually has: nobody edits an artifact. The tree moves on underneath
   one that is still sitting there. */
const staleRoot = withBuiltPackage(root => {
  fs.appendFileSync(path.join(root, TOOL, 'background.js'),
    "chrome.runtime.onStartup.addListener(function () {});\n");
});
expect('a package the tree has moved on from is called stale', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], root: staleRoot, code: 0, contains: 'is STALE'
});
expect('...it names the file that is newer than the package', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], root: staleRoot, code: 0,
  contains: 'newest differing file: background.js'
});
/* 🔴 AND IT STAYS EXIT 0. Asserted as its own line rather than left implicit in
   the two above, because "warns" and "does not fail" are two claims and the one
   that would be silently lost is the second. If this limb is ever "strengthened"
   into a failure, this is the case that says no. */
expect('...and grading an old artifact does NOT redden the lane', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], root: staleRoot, code: 0, contains: '1 warning(s)'
});

/* 🔴 THE ANTI-VACUITY PAIR FOR THIS LIMB. A freshness check that examined
   nothing must never be reachable from the word "fresh", and there are two ways
   to examine nothing. */
expect('a package sharing no file with the tree is not reported as fresh', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 0,
  contains: 'shares no file with the tree that would pack it',
  root: withPackage('goodtool-1.0.0-firefox.zip', goodFfManifest)
});

/* The other way: the RULER is empty. include patterns that have stopped
   matching, in a tree with no _locales/ for the unconditional collector to
   union in. This one FAILS while staleness only warns — deliberately, and the
   reason is in the limb's own comment: "this package is old" is a fact about an
   artifact, and "I compared zero files" is the check not running. */
expect('a freshness limb with no file set at all FAILS rather than certifying', {
  script: 'check-store-packages.mjs', argv: ['goodtool'], code: 1,
  contains: 'has a file set to compare packages against',
  root: fixture(root => {
    const t = readJson(root, TOOL + '/tool.json');
    t.package.include = ['nothing-here/*.js'];
    writeJson(root, TOOL + '/tool.json', t);
    fs.rmSync(path.join(root, TOOL, '_locales'), { recursive: true });
    const m = readJson(root, TOOL + '/manifest.json');
    delete m.default_locale;
    delete m.name;
    delete m.short_name;
    delete m.description;
    writeJson(root, TOOL + '/manifest.json', m);
    const abs = path.join(root, 'dist', 'goodtool-chromium.zip');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, zipOf({
      'manifest.json': JSON.stringify({ manifest_version: 3, version: '1.0.0', name: 'x' })
    }));
  })
});

/* =====================================================================
   check-store-metadata.mjs

   The STORE axis. Two builds, three stores — so the mutations that matter are
   the ones where those two axes are allowed to drift apart, and the one where a
   store limit arrives without anybody having read it from the store.
   ===================================================================== */
console.log('\ncheck-store-metadata.mjs');

const STORE_FILES = {
  'title.txt': 'Good Tool',
  'short-description.txt': 'A fixture extension used by the scripts self-test.',
  'long-description.txt': 'x'.repeat(400),
  'category.txt': 'Productivity',
};
const SHARED_FILES = {
  'privacy-policy-url.txt': 'https://example.test/privacy',
  'support-url.txt': 'https://example.test/support',
  'screenshots/README.md': '# 1280x800, the one size all three stores take\n',
};

/* A complete, correct store layer on the fixture tool: three rows, two targets,
   every directory populated. Mutations below start from this and break one
   thing, so a failure can only be the thing that was broken. */
function withStores(mutate = () => {}) {
  return fixture(root => {
    const t = readJson(root, TOOL + '/tool.json');
    t.targets = { chromium: { stores: ['chrome', 'edge'] }, firefox: { overlay: 'publish/manifest.firefox.json' } };
    writeJson(root, TOOL + '/publish/manifest.firefox.json', {
      browser_specific_settings: { gecko: { id: 'goodtool@example.test', strict_min_version: '128.0' } }
    });
    /* The URL files are a SECOND copy of what identity.json declares, so the
       fixture carries both — a drift check with only one side present is not a
       drift check, it is an existence check wearing one. */
    writeJson(root, TOOL + '/publish/identity.json', {
      slug: 'goodtool', ownerDomain: 'example.test', supportEmail: 'support@example.test',
      privacyPolicyUrl: SHARED_FILES['privacy-policy-url.txt'],
    });
    t.storeMetadata = {
      sharedDir: 'store/_shared',
      stores: {
        chrome: { target: 'chromium', dir: 'store/chrome', served: false },
        edge: { target: 'chromium', dir: 'store/edge', served: false },
        firefox: { target: 'firefox', dir: 'store/firefox', served: false },
      },
    };
    const dirs = { chrome: 'store/chrome', edge: 'store/edge', firefox: 'store/firefox' };
    for (const d of Object.values(dirs)) {
      for (const [f, body] of Object.entries(STORE_FILES)) w(root, TOOL + '/' + d + '/' + f, body + '\n');
    }
    for (const [f, body] of Object.entries(SHARED_FILES)) w(root, TOOL + '/store/_shared/' + f, body + '\n');
    /* A real PNG, so the screenshots limb's PASS path is exercised too and the
       mutations below are the only thing that can empty the directory. */
    fs.copyFileSync(path.join(REPO, 'templates', 'tool', 'icons', 'icon128.png'),
      path.join(root, TOOL, 'store', '_shared', 'screenshots', 'shot-01.png'));
    mutate(t, root);
    writeJson(root, TOOL + '/tool.json', t);
  });
}

expect('a complete three-store layer passes', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 0, contains: '3 store row(s) graded',
  root: withStores()
});

/* 🔴 THE AXIS MUTATIONS — the two that let builds and stores drift apart. */
expect('a store naming a target that does not exist is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'which is not in targets',
  root: withStores(t => { t.storeMetadata.stores.edge.target = 'webkit'; })
});
expect('a target no store claims is caught — an artifact going nowhere', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'is claimed by at least one store',
  root: withStores(t => { t.targets.safari = { overlay: null }; })
});

/* The three declarations of the store set must agree. */
expect('a store set that disagrees with the schema vocabulary is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'two declarations of one fact',
  root: withStores(t => { delete t.storeMetadata.stores.firefox; })
});

/* served is a GATE — the same absence, two verdicts. */
expect('a MISSING directory on an unserved store PRINTS and exits 0', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 0, contains: 'NO TREE (not served)',
  root: withStores((t, root) => { fs.rmSync(path.join(root, TOOL, 'store', 'chrome'), { recursive: true, force: true }); })
});
expect('the SAME missing directory on a SERVED store FAILS', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'the listing is live',
  root: withStores((t, root) => {
    t.storeMetadata.stores.chrome.served = true;
    fs.rmSync(path.join(root, TOOL, 'store', 'chrome'), { recursive: true, force: true });
  })
});

/* What is owner-gated is CREATING a listing, not KEEPING one. */
expect('an EMPTIED listing field fails even on an unserved store', {
  /* A single-line fragment on purpose: Report.fail() re-indents every wrapped
     line by eight spaces, so a `contains` that spans the wrap never matches
     even when the gate is behaving perfectly. */
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'An empty listing field is worse than a missing one',
  root: withStores((t, root) => { w(root, TOOL + '/store/chrome/title.txt', '   \n'); })
});
expect('a missing required listing field is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'category.txt exists',
  root: withStores((t, root) => { fs.rmSync(path.join(root, TOOL, 'store', 'edge', 'category.txt')); })
});

expect('an orphan directory under store/ is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'orphaned, unreachable',
  root: withStores((t, root) => { w(root, TOOL + '/store/opera/title.txt', 'left behind\n'); })
});

/* 🔴 THE LIMIT MUTATIONS. An invented limit fires on correct input. */
expect('a limit with no source is REFUSED rather than enforced', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'An invented limit fires on CORRECT input',
  root: withStores(t => { t.storeMetadata.stores.chrome.limits = { 'title.txt': { max: 75 } }; })
});
expect('a value over a SOURCED limit is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'against a maximum of 5',
  root: withStores(t => {
    t.storeMetadata.stores.chrome.limits = { 'title.txt': { max: 5, source: 'https://developer.chrome.com/x (fetched 2026-08-20)' } };
  })
});
expect('a value under a SOURCED minimum is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'against a minimum of 250',
  root: withStores(t => {
    t.storeMetadata.stores.edge.limits = { 'title.txt': { min: 250, source: 'https://learn.microsoft.com/x (fetched 2026-08-20)' } };
  })
});

/* 🔴 THE CONTENT MUTATIONS ON THE SHARED URL FILES.
   Until 2026-08-22 these files were graded on existence and non-blankness
   alone, and the real tree shipped a `privacy-policy-url.txt` whose entire
   content was the word NOT-YET-HOSTED plus a comment saying no submission could
   proceed — printing PASS the whole time, a day after identity.json had been
   filled with the live URL. Every case below is red against that version of the
   guard and green against this one. */
expect('a URL file holding a refusal notice instead of a URL is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'which is not an https URL',
  root: withStores((t, root) => { w(root, TOOL + '/store/_shared/privacy-policy-url.txt', 'NOT-YET-HOSTED\n'); })
});
expect('a URL file that disagrees with publish/identity.json is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'One URL, two files, two values',
  root: withStores((t, root) => { w(root, TOOL + '/store/_shared/privacy-policy-url.txt', 'https://example.test/other-privacy\n'); })
});
expect('a URL file holding two URLs is caught — a store field takes one', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'Two lines is two answers',
  root: withStores((t, root) => {
    w(root, TOOL + '/store/_shared/privacy-policy-url.txt', 'https://example.test/privacy\nhttps://example.test/privacy2\n');
  })
});
/* The file may carry a dated correction beside the value — the real tree's does
   — so a `#` comment must not be read as a second URL. */
expect('a # comment beside the URL is not a second URL', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 0, contains: 'agrees with publish/identity.json privacyPolicyUrl',
  root: withStores((t, root) => {
    w(root, TOOL + '/store/_shared/privacy-policy-url.txt', '# CORRECTED 2026-08-22, was NOT-YET-HOSTED\nhttps://example.test/privacy\n');
  })
});
/* Hosting is owner work, so an unfilled URL PRINTS while nothing is served and
   FAILS the moment a listing is live — the same split `served` already governs.
   A guard permanently red on one person's work teaches everyone red is
   negotiable; a guard green over a live wrong listing teaches nothing at all. */
expect('an unfilled URL with identity.json ALSO unfilled is an OWNER action, not a failure', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 0, contains: 'is not filled in yet',
  root: withStores((t, root) => {
    w(root, TOOL + '/store/_shared/privacy-policy-url.txt', '⟨HTTPS URL OF THE HOSTED PRIVACY POLICY⟩\n');
    const id = readJson(root, TOOL + '/publish/identity.json');
    delete id.privacyPolicyUrl;
    writeJson(root, TOOL + '/publish/identity.json', id);
  })
});
expect('the SAME unfilled URL FAILS once a store is served', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'the listing is live and this field is already public',
  root: withStores((t, root) => {
    t.storeMetadata.stores.chrome.served = true;
    w(root, TOOL + '/store/_shared/privacy-policy-url.txt', '⟨HTTPS URL OF THE HOSTED PRIVACY POLICY⟩\n');
    const id = readJson(root, TOOL + '/publish/identity.json');
    delete id.privacyPolicyUrl;
    writeJson(root, TOOL + '/publish/identity.json', id);
  })
});

/* A read that FAILS is not a result that is EMPTY. An identity.json that does
   not parse would leave every URL file graded as "nothing to compare against" —
   the agreement check disarmed, in silence, still printing PASS. */
expect('an unparseable identity.json is a failure, not a disarmed comparison', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'must not read as',
  root: withStores((t, root) => { w(root, TOOL + '/publish/identity.json', '{ oops\n'); })
});
/* 🔴 AND THE SAME HOLE ONE LEVEL IN: PARSES ≠ USABLE. `[]`, `null`, `"x"` and
   `3` are all valid JSON, so the catch above never fires for them — and every
   one of them makes `identity[field]` undefined, which the grader then reads as
   "identity.json declares no URL". The drift check is disarmed exactly as an
   unparseable file would disarm it, in silence, while the URL file still prints
   a bare PASS. Both cases below exit 0 against the version of the guard shipped
   earlier in this round and 1 against this one. */
expect('an identity.json that is an ARRAY is a failure, not a disarmed comparison', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'it parses as an array',
  root: withStores((t, root) => { w(root, TOOL + '/publish/identity.json', '[]\n'); })
});
expect('an identity.json that is JSON `null` is a failure, not a disarmed comparison', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'it parses as null',
  root: withStores((t, root) => { w(root, TOOL + '/publish/identity.json', 'null\n'); })
});

/* 🔴 SCREENSHOTS: the README is not an image. REQUIRED_SHARED lists
   `screenshots/README.md`, so the entire screenshot requirement used to be
   satisfied by a text file explaining that there are no screenshots. */
expect('a served listing with zero screenshots is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'the directory holds no .png/.jpg, and a store row is `served: true`',
  root: withStores((t, root) => {
    t.storeMetadata.stores.chrome.served = true;
    fs.rmSync(path.join(root, TOOL, 'store', '_shared', 'screenshots', 'shot-01.png'));
  })
});
expect('the SAME empty screenshots directory is an OWNER action while nothing is served', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 0, contains: 'holds no images yet',
  root: withStores((t, root) => { fs.rmSync(path.join(root, TOOL, 'store', '_shared', 'screenshots', 'shot-01.png')); })
});

/* 🔴 THE DOCUMENTED `--all` INVOCATION, WHICH HAD NEVER RUN. loadAllTools
   returns an object, not an array, so `!tools.length` was always true and the
   flag in this guard's own usage line died with "no tool resolved" on a tree
   holding a complete store layer. No case covered it, which is why it survived.
   The second limb is the half that matters more: --all must not swallow a
   tool.json that will not load. */
expect('--all grades the tree instead of refusing to run', {
  script: 'check-store-metadata.mjs', argv: ['--all'], code: 0, contains: '3 store row(s) graded',
  root: withStores()
});
expect('--all refuses when a tool.json will not load, rather than grading a shorter tree', {
  script: 'check-store-metadata.mjs', argv: ['--all'], code: 2, contains: 'the tool set is not the tree',
  root: withStores((t, root) => { w(root, 'Extension/Broken_Tool/tool.json', '{ oops\n'); })
});

/* Anti-vacuity. */
expect('an emptied store set CANNOT RUN rather than passing', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'row set IS the subject',
  root: withStores(t => { t.storeMetadata.stores = {}; })
});
expect('a tool with targets but NO storeMetadata is caught', {
  script: 'check-store-metadata.mjs', argv: ['goodtool'], code: 1, contains: 'checked by nothing',
  root: withStores(t => { delete t.storeMetadata; })
});

/* =====================================================================
   argument handling
   ===================================================================== */
console.log('\nargument handling');
expect('a mistyped flag is refused, not ignored', {
  script: 'policy-check.mjs', argv: ['goodtool', '--warings-as-errors'], root: fixture(), code: 2, contains: 'unknown option'
});
expect('naming no tool at all refuses', {
  script: 'policy-check.mjs', argv: [], root: fixture(), code: 2, contains: 'no tool given'
});

/* =====================================================================
   coverage — is there a case in this file for every gate CI actually runs?
   =====================================================================

   EXT-GUARD-COVERAGE. Every pair above proves that ONE NAMED gate bites.
   Nothing above notices a gate that has NO pair at all, and on the checks
   list a gate nobody tests is indistinguishable from a gate that passes —
   which is this file's own opening paragraph turned back on itself.
   Platform_Public answers this with an assert-guard-coverage step; this
   repository has no such script, and the only file the answer can live in
   is the suite whose coverage is in question.

   BOTH SETS ARE DERIVED, NEITHER IS LISTED. The invoked set is read out of
   .github/workflows; the covered set is read out of this file's own source.
   A hand-written copy of either would be a second declaration of a fact the
   workflows already state, and the copy is the one that rots — toward
   looking healthier than the repository is. That is the same reasoning the
   `gate-inventory` job in ci.yml is built on, and this is the other half of
   it: that job asks whether a called gate EXISTS, this asks whether a
   called gate is PROVEN.

   WHAT IT IS NOT. It does not assert that a gate is well tested — one case
   satisfies it. It asserts only that the number of cases is not zero, which
   is the distinction between a gate that was thought about and one that was
   never looked at. ===================================================== */
console.log('\ncoverage (which workflow-invoked gates have a case here)');

/* Filled in from the derived sets below and printed by the final summary line,
   which used to end "every gate proven to bite on a real mutation" full stop.
   ⚠️ CORRECTED 2026-08-25: measured that day, that sentence was true of the 7
   gates with a case and said nothing about the 10 that have none — an
   overclaim of exactly the kind this section exists to detect, printed by the
   suite itself on every green run. The numbers in it are now derived on the
   run that prints them rather than asserted in prose. */
let COVERAGE_NOTE = '';

/* Kept deliberately in step with the pattern in ci.yml's `gate-inventory`
   step, including its narrowness: the full `Extension/<Tool>/publish/`
   prefix is required, because a bare `publish/<name>.node.js` is a
   tool-relative path that does not resolve from the repository root and
   appears in prose. A fresh RegExp per call — a shared /g literal carries
   lastIndex between calls and would silently drop matches. */
const gateHits = text => text.match(
  /(?:scripts|Extension\/[A-Za-z0-9_]+\/publish)\/[A-Za-z0-9][A-Za-z0-9._/-]*\.(?:mjs|node\.js)/g
) || [];

/* One line in, one line out, comment removed. YAML comments and the shell
   comments inside a `run: |` body are the same shape and the same hazard, so
   they get the same treatment: a `#` counts only where a comment can start —
   at the head of the line or after whitespace — and never inside quotes. The
   quote state is per line on purpose; a string spanning lines inside a run
   body would be a block scalar of its own. */
function stripComments(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (q === '"' && c === '\\') { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}
const stripAll = text => text.split(/\r?\n/).map(stripComments).join('\n');

const repoRel = abs => path.relative(REPO, abs).split(path.sep).join('/');

/* gate path -> Set of workflow files that call it. `null` means the workflow
   directory could not be read at all, which is COVERAGE LOST, not zero gaps. */
function gatesInvokedByWorkflows() {
  const dir = path.join(REPO, '.github', 'workflows');
  let files;
  try { files = fs.readdirSync(dir).filter(f => /\.ya?ml$/i.test(f)); }
  catch (_) { return null; }
  const found = new Map();
  for (const f of files) {
    for (const hit of gateHits(stripAll(fs.readFileSync(path.join(dir, f), 'utf8')))) {
      const gate = path.posix.normalize(hit);
      if (!found.has(gate)) found.set(gate, new Set());
      found.get(gate).add(f);
    }
  }
  return found;
}

/* The covered set is this file, read as text. A case names its gate in the
   same key `run()` resolves against SCRIPTS, so the same resolution is done
   here and the result is made repo-relative — a future case reaching a gate
   outside scripts/ lands in the set without this needing to change.
   SELF-REFERENCE, PINNED: the matcher below is anchored to the head of a
   line, and the only line in this block that carries that key is inside a
   regular expression whose line starts with `const`. Measured 2026-08-25 on
   the file as written: 10 gate names, unchanged by adding this section. */
function gatesWithACaseInThisFile() {
  const src = fs.readFileSync(__filename, 'utf8');
  const re = /^[ \t]*script:[ \t]*'([^'\n]+)'/gm;
  const out = new Set();
  let m;
  while ((m = re.exec(src))) out.add(repoRel(path.resolve(SCRIPTS, m[1])));
  return out;
}

/* THE RECORDED EXEMPTIONS. An entry here is not a claim that the gate is
   fine; it is a claim that its absence was LOOKED AT and why it is still
   absent. Two rules below keep it from becoming a place to hide things: an
   entry naming a gate no workflow invokes is dead and fails, and an entry
   naming a gate that has since gained a case is stale and fails. The list
   can therefore only shrink without someone editing this file on purpose. */
const NO_CASE_RECORDED = [
  { gate: 'scripts/test/selftest.node.js',
    why: 'PERMANENT. This is the suite itself. A case for it would be this file spawning this file; what grades it is that every other case in it is a proven red/green pair.' },
  { gate: 'scripts/pack.mjs',
    why: 'OPEN GAP, recorded 2026-08-25. The check-store-packages cases synthesise their zips with the local zipOf() helper rather than running pack.mjs, so pack\'s allowlist and its determinism are asserted by nothing in this file — CI compares two pack runs, which catches non-determinism but not a wrong allowlist.' },
  { gate: 'scripts/verify-refs.mjs',
    why: 'OPEN GAP, recorded 2026-08-25. Both workflow calls are `--zip <file> --strict|--leaks`, so a case needs a built package as its subject, not the --repo-root tree every case here mutates. The zip fixture exists (zipOf) and wiring it to this gate is the next step.' },
  { gate: 'scripts/run-tests.mjs',
    why: 'OPEN GAP, recorded 2026-08-25. It runs exactly the commands in a tool.json "tests" block, so a case must let the fixture spawn a real child command and prove both limbs: a failing command fails the gate, and an EMPTY tests block does not pass silently.' },
  { gate: 'scripts/secret-scan.mjs',
    why: 'OPEN GAP, recorded 2026-08-25. A case has to plant a credential-shaped literal, and this file is inside the tree CI scans with `secret-scan.mjs .` — so the literal must be assembled at run time rather than written as source, or the suite becomes the finding. Deliberately not bodged in without that being got right.' },
  { gate: 'scripts/sha256.mjs',
    why: 'OPEN GAP, recorded 2026-08-25. The plainest of the nine: one file in, one hash out, used by the determinism comparison in ci.yml. Nothing here proves it reports a missing file rather than printing an empty hash.' },
  { gate: 'scripts/check-catalog.mjs',
    why: 'OPEN GAP, recorded 2026-08-25. gen-catalog.mjs has cases; its two consumers do not. This one grades the real README catalog markers, so a case needs the marker block in the fixture README to be driven out of step with the fixture tools.' },
  { gate: 'scripts/publish-catalog.mjs',
    why: 'OPEN GAP, recorded 2026-08-25. Same family as check-catalog.mjs and uncovered for the same reason.' },
  { gate: 'scripts/changelog-section.mjs',
    why: 'OPEN GAP, recorded 2026-08-25. Called only from release.yml, to cut one version section out of a CHANGELOG for the release body. Uncovered means a release note that silently comes out empty is caught by nobody.' },
  { gate: 'Extension/Full_Screen_Shot/publish/verify-firefox-package.node.js',
    why: 'OPEN GAP, recorded 2026-08-25. It lives in a tool\'s publish/, not in scripts/, and the run() helper here resolves against SCRIPTS and appends --repo-root, which this gate does not take — it takes --zip. It needs its own runner before it can have a case.' }
];

/* The evaluation, as a pure function, so it can be pointed at synthetic sets
   and shown to bite before it is pointed at the real ones. */
function unexplainedGaps(invoked, covered, recorded) {
  const excused = new Set(recorded.map(e => e.gate));
  return [...invoked].filter(g => !covered.has(g) && !excused.has(g)).sort();
}

/* ---- the evaluator must itself be shown to go red ---- */
{
  const uncovered = 'scripts/' + 'nobody-tests-me.mjs';
  const proven = 'scripts/' + 'has-a-case.mjs';
  const red = unexplainedGaps([proven, uncovered], new Set([proven]), []);
  const green = unexplainedGaps([proven, uncovered], new Set([proven]), [{ gate: uncovered, why: 'recorded' }]);
  if (red.length === 1 && red[0] === uncovered && green.length === 0) {
    ok('the coverage evaluator reports an uncovered gate, and only an unrecorded one');
  } else {
    bad('the coverage evaluator reports an uncovered gate, and only an unrecorded one',
      'on a synthetic pair it returned ' + JSON.stringify(red) + ' unrecorded and ' +
      JSON.stringify(green) + ' recorded; it cannot fail over the input class it exists for');
  }
}

/* ---- a gate named in a COMMENT is not a gate anybody invokes ---- */
/* The two names are assembled from halves so that no full path to a file that
   does not exist ever appears as one token in this repository — a whole-path
   grep somewhere else must not start reporting a missing script because of a
   fixture string. */
{
  const inRun = 'scripts/' + 'ghost-invoked.mjs';
  const inComment = 'scripts/' + 'ghost-mentioned.mjs';
  const synthetic = [
    '# a workflow header that discusses ' + inComment + ' at length',
    'jobs:',
    '  demo:',
    '    steps:',
    '      - name: real',
    '        run: |',
    '          # and a shell comment inside a run body, naming ' + inComment,
    '          node ' + inRun + ' --all  # ' + inComment,
    ''
  ].join('\n');
  const seen = new Set(gateHits(stripAll(synthetic)));
  if (seen.has(inRun) && !seen.has(inComment)) {
    ok('a gate named only in a comment is not counted as invoked', 'YAML header, shell comment and trailing comment all stripped');
  } else {
    bad('a gate named only in a comment is not counted as invoked',
      'the comment stripper let through ' + JSON.stringify([...seen]) +
      '; prose would enter the invoked set and this whole case would grade the wrong thing');
  }
}

/* ---- the real sets ---- */
const INVOKED = gatesInvokedByWorkflows();
const COVERED = gatesWithACaseInThisFile();

if (INVOKED === null) {
  bad('the set of gates the workflows invoke can be read',
    'COVERAGE LOST — ' + path.join(REPO, '.github', 'workflows') + ' could not be read.\n' +
    'An unreadable workflow directory produces an empty invoked set, and an empty invoked set has no gaps in it. ' +
    'That is not a clean bill of health, so it is a failure here rather than a silent pass.');
} else if (INVOKED.size === 0) {
  bad('the set of gates the workflows invoke is not empty',
    'COVERAGE LOST — the workflow files parsed but named no gate at all.\n' +
    'Either every gate call was removed, or the pattern in this section no longer matches the way they are written. ' +
    'Both mean this case is grading nothing, and grading nothing must never be green.');
} else if (COVERED.size === 0) {
  bad('the set of gates with a case in this file is not empty',
    'COVERAGE LOST — this file read its own source and found no case naming a gate, ' +
    'which cannot be true while the cases above are running. The matcher has drifted from the way a case is written, ' +
    'and every gate would be reported as uncovered — or, with the check inverted, none would.');
} else {
  ok('both sets are derived, neither is listed',
    INVOKED.size + ' gate(s) invoked by .github/workflows · ' + COVERED.size + ' gate(s) with a case here');

  const gaps = unexplainedGaps(INVOKED.keys(), COVERED, NO_CASE_RECORDED);
  if (gaps.length === 0) {
    const excused = NO_CASE_RECORDED.length;
    COVERAGE_NOTE = '\n' + excused + ' of ' + INVOKED.size + ' workflow-invoked gate(s) have NO case here. ' +
      'Every one is recorded in NO_CASE_RECORDED with the reason; none is a silent gap.';
    ok('every gate the workflows invoke has a case here or a recorded reason',
      (INVOKED.size - excused) + ' proven · ' + excused + ' recorded as having no case');
  } else {
    bad('every gate the workflows invoke has a case here or a recorded reason',
      gaps.length + ' gate(s) are called by a workflow, have no case in this file, and no recorded reason:\n' +
      gaps.map(g => '  · ' + g + '   (called by ' + [...INVOKED.get(g)].sort().join(', ') + ')').join('\n') +
      '\nAdd a red/green pair for each, or add an entry to NO_CASE_RECORDED saying what is missing and why. ' +
      'Do not add the entry to make this green if you can write the pair.');
  }

  /* Both directions of rot in the recorded list. */
  const dead = NO_CASE_RECORDED.filter(e => !INVOKED.has(e.gate)).map(e => e.gate).sort();
  if (dead.length === 0) ok('every recorded reason still names a gate a workflow invokes');
  else bad('every recorded reason still names a gate a workflow invokes',
    'these entries excuse a gate no workflow calls any more, so they excuse nothing and hide the next real gap:\n' +
    dead.map(g => '  · ' + g).join('\n'));

  const stale = NO_CASE_RECORDED.filter(e => COVERED.has(e.gate)).map(e => e.gate).sort();
  if (stale.length === 0) ok('no recorded reason survives the case that closed it');
  else bad('no recorded reason survives the case that closed it',
    'these gates now HAVE a case in this file, so the entry recording their absence is false:\n' +
    stale.map(g => '  · ' + g).join('\n') +
    '\nDelete the entry. The list is a ratchet; leaving a closed gap in it is how the count stops meaning anything.');
}

/* ---------------- summary ---------------- */
console.log('');
if (!KEEP) { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
else console.log('fixtures kept at ' + TMP);

if (FAILURES.length) {
  console.log(FAILURES.length + ' of ' + (PASS + FAILURES.length) + ' checks FAILED');
  for (const f of FAILURES) console.log('  - ' + f.label);
  process.exit(1);
}
console.log('ALL PASS — ' + PASS + ' checks, every gate THAT HAS A CASE proven to bite on a real mutation' + COVERAGE_NOTE);
process.exit(0);
