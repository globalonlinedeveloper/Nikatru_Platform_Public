// ─────────────────────────────────────────────────────────────────────────────
// price-literals.test.mjs — assert-no-price-literals.mjs must be able to FAIL.
//
// [pipeline 5]M-11 — a displayed price comes from the rail, never from app code.
//
// 🔴 THE DEFECT THIS GUARD IS NAMED AFTER WAS LIVE FOR MONTHS.
// `apps/subscriptiontracker/lib/services/purchases/purchases_service.dart` returned `$2.99`
// and `$24.99`; the owner decided $4.99/mo and $19.99/yr on 2026-07-27. Nothing
// went red, because a hardcoded price is consistent with itself forever — and
// the obvious guard, `assert-no-hardcoded-strings.mjs`, excludes `apps/subscriptiontracker`
// wholesale, i.e. excludes the evidence file.
//
// ⚠️ REAL-TREE MUTATIONS FIRST (2026-08-01, four, on a scratch COPY):
//   PL1  `r'$2.99'` re-introduced into the paywall widget  -> caught
//   PL2  the paywall stops reading `.formattedPrice`       -> caught (limb B)
//   PL3  `formattedPrice` returns a config-supplied string -> caught after a FIX
//   PL4  the price matcher itself neutered                 -> caught (canary)
//
// 🔴 ONE DEFECT THE MUTATION RUN FOUND IN THE GUARD ITSELF:
//   PL3 WAS NOT CAUGHT. Limb B tested `toStringAsFixed` / `amountMinor` /
//   `_symbols` at FILE level, so gutting the getter and leaving the helpers in
//   place kept every token present. Scoped to `formattedPrice`'s own body now.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-no-price-literals.mjs');
const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
const PAYWALL_REL = `${BRICK}/lib/features/monetization/paywall_screen.dart`;

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-pl-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

const PAYWALL = `
class PaywallScreen extends ConsumerStatefulWidget {
  const PaywallScreen({super.key});
}
Widget _row(Offering o) => ListTile(title: Text(o.formattedPrice));
`;

const OFFERING = `
class Offering {
  final int amountMinor;
  final String currencyCode;

  String get formattedPrice {
    final int units = _minorUnitDigits[currencyCode] ?? 2;
    final String major = (amountMinor / 100).toStringAsFixed(units);
    final String? symbol = _symbols[currencyCode];
    return symbol == null ? '\$currencyCode \$major' : '\$symbol\$major';
  }

  static const Map<String, String> _symbols = <String, String>{'USD': r'\$'};
  static const Map<String, int> _minorUnitDigits = <String, int>{'JPY': 0};
}
`;

function write(root, rel, body) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
}

/** The guard floors its scan at 40 dart files; below that a clean result means
 *  the scan broke rather than the tree being clean. Filler makes the floor
 *  reachable so the OTHER limbs are what each case is measuring. */
function filler(root, n = 45) {
  for (let i = 0; i < n; i += 1) {
    write(root, `packages/core/lib/src/filler_${i}.dart`, `// nothing to see\nclass Filler${i} {}\n`);
  }
}

// ── the listing fixture (limb C) ────────────────────────────────────────────
// Two app channels and one extension channel, each with a product tree and the
// factory tree that stamps the next one. ios-appstore declares two additional
// text fields; edge carries the per-store-additional `search-terms.txt`.
// README.md and the URL field are in every tree and are NOT listing text: the
// README carries a `$1` shape, which limb C must not read.
const LISTING_REGISTER = () => ({
  channels: [
    { id: 'web', kind: 'web', surface: 'app', storeMetadataDir: null },
    { id: 'android-play', kind: 'store', surface: 'app', storeMetadataDir: 'apps/{app}/store/android-play' },
    { id: 'ios-appstore', kind: 'store', surface: 'app', storeMetadataDir: 'apps/{app}/store/ios-appstore' },
    { id: 'edge-addons', kind: 'store', surface: 'extension', storeMetadataDir: 'extensions/Extension/{tool}/store/edge' },
  ],
  storeMetadataContract: {
    perChannel: { 'ios-appstore': { additionalFiles: ['subtitle.txt', 'promotional-text.txt', 'privacy-manifest.json'] } },
  },
});
const LISTING_TEXT = {
  'title.txt': 'Demo\n',
  'short-description.txt': 'Track every subscription in one place\n',
  'long-description.txt': 'Demo keeps every renewal in one place.\nReminds you 7 days ahead, across 3 devices. Version 1.0.101.\n',
  'category.txt': 'Finance\n',
};
const LISTING_NOT_TEXT = {
  'README.md': 'Regenerate with `sed "s/x/$1/"`; the old stub read $0.\n',
  'privacy-policy-url.txt': 'https://example.com/privacy\n',
};
const IOS_EXTRA = { 'subtitle.txt': 'Every renewal, on time\n', 'promotional-text.txt': 'Now with reminders.\n' };
const EDGE_EXTRA = { 'search-terms.txt': 'subscriptions\nrenewals\n' };
const LISTING_TREES = [
  ['apps/demo/store/android-play', {}],
  [`${BRICK}/store/android-play`, {}],
  ['apps/demo/store/ios-appstore', IOS_EXTRA],
  [`${BRICK}/store/ios-appstore`, IOS_EXTRA],
  ['extensions/Extension/demo_tool/store/edge', EDGE_EXTRA],
  ['extensions/templates/tool/store/edge', EDGE_EXTRA],
];

function listingFixture(root, o) {
  const register = LISTING_REGISTER();
  if (o.mutateRegister) o.mutateRegister(register);
  if (!o.noRegister) write(root, 'tooling/channel-register.json', `${JSON.stringify(register, null, 2)}\n`);
  write(root, 'catalog/apps.json', `${JSON.stringify(o.apps ?? [{ slug: 'demo' }])}\n`);
  // An app root with no dart is limb A's per-root COVERAGE LOST, so the app
  // the listing belongs to carries one file.
  write(root, 'apps/demo/lib/main.dart', 'class Demo {}\n');
  if (!o.noTool) write(root, 'extensions/Extension/demo_tool/tool.json', '{}\n');
  for (const [dir, extra] of LISTING_TREES) {
    for (const [name, body] of Object.entries({ ...LISTING_TEXT, ...LISTING_NOT_TEXT, ...extra })) {
      const rel = `${dir}/${name}`;
      if (o.listing && rel in o.listing) {
        if (o.listing[rel] !== null) write(root, rel, o.listing[rel]);
      } else {
        write(root, rel, body);
      }
    }
  }
}

function run(o = {}) {
  const root = join(TMP, `case-${(seq += 1)}`);
  filler(root, o.fillerCount ?? 45);
  write(root, PAYWALL_REL, o.paywall ?? PAYWALL);
  write(root, 'packages/purchases/lib/src/offering.dart', o.offering ?? OFFERING);
  listingFixture(root, o);
  if (o.extra) for (const [rel, body] of Object.entries(o.extra)) write(root, rel, body);
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('assert-no-price-literals — the price comes from the rail', () => {
  test('PASSES on a tree whose price is derived', () => {
    const r = run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /assert-no-price-literals: ok/);
  });

  test('the matcher is proven against known-dirty input on EVERY run', () => {
    // The tree is (correctly) clean, so a clean result and a broken regex print
    // identically without the in-guard canary.
    const r = run();
    assert.match(r.out, /matcher verified: \d+ known price literal\(s\) matched/);
  });

  test('🔴 FAILS when a price literal is re-introduced into a widget', () => {
    const r = run({ paywall: PAYWALL.replace('Text(o.formattedPrice)', "Text(r'\\$2.99')") });
    assert.equal(r.code, 1);
    assert.match(r.out, /contains price literal/);
  });

  for (const [name, lit] of Object.entries({
    'a rupee price': "'₹399'",
    'a code-first price': "'USD 4.99'",
    'a code-last price': "'19.99 EUR'",
    'a thousands-separated price': "'£1,299.00'",
  })) {
    test(`FAILS on ${name}`, () => {
      const r = run({ paywall: `${PAYWALL}\nconst String x = ${lit};\n` });
      assert.equal(r.code, 1);
      assert.match(r.out, /contains price literal/);
    });
  }

  for (const [name, lit] of Object.entries({
    'a version string': "'v1.0.0'",
    'a date': "'2026-08-01'",
    'a bare number with no currency marker': "'4.99'",
    'a hex colour': "'#4CAF50'",
  })) {
    test(`does NOT fire on ${name} — a guard that cries wolf is switched off inside a week`, () => {
      const r = run({ paywall: `${PAYWALL}\nconst String x = ${lit};\n` });
      assert.equal(r.code, 0, r.out);
    });
  }

  test('a price in a COMMENT is prose, not a defect', () => {
    // This guard's own header contains three. A guard that matched the comment
    // explaining what must not appear is a mistake this repo has shipped once.
    const r = run({ paywall: `// the old stub returned \\$2.99 and \\$24.99\n${PAYWALL}` });
    assert.equal(r.code, 0, r.out);
  });

  test('🔴 FAILS when the paywall stops rendering a rail-derived price at all', () => {
    // Deleting the price display passes the NEGATIVE limb perfectly, and is
    // exactly the wrong way to satisfy M-11.
    const r = run({ paywall: PAYWALL.replace('Text(o.formattedPrice)', 'Text(o.productId)') });
    assert.equal(r.code, 1);
    assert.match(r.out, /never reads `\.formattedPrice`/);
  });

  test('🔴 FAILS when formattedPrice returns a config-supplied string instead of deriving', () => {
    // The defect the mutation run exposed in this guard: a file-level token
    // match survived gutting the getter, because the helpers still mentioned
    // every token. A `display_price` passed straight through moves the literal
    // from Dart into JSON and satisfies nothing.
    const r = run({
      offering: OFFERING.replace(
        '  String get formattedPrice {',
        '  String get formattedPrice => displayPrice;\n\n  String get _dead {',
      ),
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /does not DERIVE its display string/);
  });

  test('COVERAGE LOST when the scan reaches almost nothing', () => {
    const r = run({ fillerCount: 2 });
    assert.equal(r.code, 2);
    assert.match(r.out, /COVERAGE LOST — scanned only/);
  });

  test('COVERAGE LOST when the paywall itself is gone — a tree with no paywall has no prices in it', () => {
    const root = join(TMP, `bare-${(seq += 1)}`);
    filler(root);
    write(root, 'packages/purchases/lib/src/offering.dart', OFFERING);
    const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(`${r.stdout}${r.stderr}`, /COVERAGE LOST/);
  });

  test('a price literal inside test/ is EVIDENCE, not a defect', () => {
    // `offering_test.dart` asserts that 499 + USD formats to $4.99. Removing
    // that literal would delete the only proof the formatter formats.
    const r = run({
      extra: { 'packages/purchases/test/offering_test.dart': "expect(o.formattedPrice, r'\\$4.99');" },
    });
    assert.equal(r.code, 0, r.out);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A PAYWALL THAT MOVED INTO THE CHASSIS PACKAGE — [ADR 067] decision 2
//
// [ADR 066] step 4 empties the paywall screen into
// `package:nikatru_chassis_screens`, and the price rendering goes with it.
// Read at the adapter alone this guard sees no price at all — and a hardcoded
// `\$2.99` in the package is a price shipped to every stamped app that nothing
// would ever fail over.
//
// 🔴 THE EXTENSION SHIPPED WITH NO TEST. It gained 94 lines on 2026-09-05 and
// this file gained none. PD2 is the one that matters: the literal is in the
// package and the delegation is real, so the finding must fire THERE.
// ─────────────────────────────────────────────────────────────────────────────
describe('a paywall whose body moved into the chassis package', () => {
  const CHASSIS_REL = 'packages/chassis_screens/lib/paywall_body.dart';
  const IMPORT = "import 'package:nikatru_chassis_screens/paywall_body.dart';\n";

  /** The adapter left behind: same path, same class, none of the body. `used`
   *  decides whether it actually references what it imports. */
  const adapter = (used) =>
    IMPORT +
    '\nclass PaywallScreen extends ConsumerStatefulWidget {\n  const PaywallScreen({super.key});\n}\n' +
    (used ? 'Widget _row(Offering o) => const PaywallBody();\n' : 'Widget _row(Offering o) => const SizedBox();\n');

  const packageBody = (literal) =>
    'class PaywallBody extends StatelessWidget {\n' +
    '  const PaywallBody({super.key});\n' +
    (literal
      ? "  Widget build(BuildContext c) => Text(r'\$2.99');\n"
      : '  Widget build(BuildContext c) => Text(o.formattedPrice);\n') +
    '}\n';

  // GREEN CONTROL — the delegation resolves, the guard reads the package file,
  // and a derived price there is still a derived price.
  test('PD1 · the delegation is followed and REPORTED, and a derived price passes', () => {
    const r = run({ paywall: adapter(true), extra: { [CHASSIS_REL]: packageBody(false) } });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /the paywall price limb also read 1 chassis file\(s\) it delegates to/);
  });

  // 🔴 THE FINDING, THROUGH THE DELEGATION. Without the resolver this tree is
  // green and ships a hardcoded price to every stamped app.
  test('PD2 · 🔴 a hardcoded price IN THE PACKAGE is found', () => {
    const r = run({ paywall: adapter(true), extra: { [CHASSIS_REL]: packageBody(true) } });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /paywall_body\.dart/);
  });

  // 🔴 THE EXPLOIT: an import nothing references must not widen the scan — and
  // must not be read as "no delegation" either.
  test('PD3 · 🔴 an import the adapter never uses is refused, not followed', () => {
    const r = run({ paywall: adapter(false), extra: { [CHASSIS_REL]: packageBody(false) } });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /never references anything it declares \(PaywallBody\)/);
  });

  test('PD4 · 🔴 a delegation to a file that is not on disk is COVERAGE LOST', () => {
    const r = run({ paywall: adapter(true) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /that file is not on disk/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LIMB C — THE LISTING TEXT, ON EVERY CHANNEL (O-PRICE-GUARD-IS-DART-ONLY)
//
// Until 2026-09-24 this guard read `.dart` only, and RC1 below — the lifetime
// price appended to a Play description — exited 0 on the real tree. Each
// failing case names the `file:line` it plants, so a finding that fires on the
// wrong file does not pass.
// ─────────────────────────────────────────────────────────────────────────────
describe('limb C — no price and no lifetime plan in any listing text field', () => {
  test('LC1 · the OK line counts the listing text it read, per channel and per tree', () => {
    const r = run();
    assert.equal(r.code, 0, r.out);
    assert.match(
      r.out,
      /ok {3}listing text reaches 30 file\(s\) on 3 channel\(s\): android-play 8 in 2 tree\(s\), ios-appstore 12 in 2 tree\(s\), edge-addons 10 in 2 tree\(s\)\n/,
    );
    assert.match(r.out, /ok {3}no price figure and no lifetime plan in listing text/);
  });

  test('RC1 · 🔴 `Lifetime ₹2,499` appended to the Play long description names the file and line, twice', () => {
    const rel = 'apps/demo/store/android-play/long-description.txt';
    const r = run({ listing: { [rel]: `${LISTING_TEXT['long-description.txt']}Lifetime ₹2,499\n` } });
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes(`\`${rel}:3\` names a price ("₹2,499")`), r.out);
    assert.ok(r.out.includes(`\`${rel}:3\` names the lifetime plan ("Lifetime")`), r.out);
  });

  test('RC2 · 🔴 `Rs 2,499` in an ios-appstore ADDITIONAL text field the row declares', () => {
    const rel = 'apps/demo/store/ios-appstore/promotional-text.txt';
    const r = run({ listing: { [rel]: 'Now with reminders.\nPro is Rs 2,499 a year.\n' } });
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes(`\`${rel}:2\` names a price ("Rs 2,499")`), r.out);
  });

  test('RC3 · 🔴 `€4.99` in an EXTENSION store field one store takes (edge search terms)', () => {
    const rel = 'extensions/Extension/demo_tool/store/edge/search-terms.txt';
    const r = run({ listing: { [rel]: 'subscriptions\n€4.99\n' } });
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes(`\`${rel}:2\` names a price ("€4.99")`), r.out);
  });

  test('RC4 · 🔴 a store channel whose trees yield no listing text is COVERAGE LOST, by name', () => {
    const r = run({
      mutateRegister: (reg) =>
        reg.channels.push({ id: 'amo', kind: 'store', surface: 'extension', storeMetadataDir: 'extensions/Extension/{tool}/store/firefox' }),
    });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — channel "amo" yielded ZERO listing text files from 2 candidate tree\(s\)/);
  });

  test('RC5 · 🔴 a price in the BRICK listing — the one every stamped app inherits — is found', () => {
    const rel = `${BRICK}/store/android-play/short-description.txt`;
    const r = run({ listing: { [rel]: 'Pro for USD 4.99\n' } });
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes(`\`${rel}:1\` names a price ("USD 4.99")`), r.out);
  });

  test('LC2 · 🔴 the lifetime plan alone is refused on a field outside apps-gov-in', () => {
    const rel = 'apps/demo/store/ios-appstore/subtitle.txt';
    const r = run({ listing: { [rel]: 'Lifetime access\n' } });
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes(`\`${rel}:1\` names the lifetime plan ("Lifetime")`), r.out);
  });

  test('LC3 · a README.md in a store tree is not listing text: the file set is the vocabulary, not the directory', () => {
    const r = run({ listing: { 'apps/demo/store/android-play/README.md': 'The web checkout sells Lifetime at ₹2,499.\n' } });
    assert.equal(r.code, 0, r.out);
  });

  test('LC4 · COVERAGE LOST when the register is gone — limb C cannot say which channels have a listing', () => {
    const r = run({ noRegister: true });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — tooling\/channel-register\.json does not exist, so limb C cannot say which channels carry a listing/);
  });

  test('LC5 · COVERAGE LOST when a tree exists and holds none of its listing text fields', () => {
    const dir = 'apps/demo/store/android-play';
    const r = run({
      listing: {
        [`${dir}/title.txt`]: null,
        [`${dir}/short-description.txt`]: null,
        [`${dir}/long-description.txt`]: null,
        [`${dir}/category.txt`]: null,
      },
    });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — apps\/demo\/store\/android-play exists and holds none of the 4 listing text field\(s\) channel "android-play" carries/);
  });

  test('LC6 · COVERAGE LOST when a channel is on a surface the vocabulary has no column for', () => {
    const r = run({
      mutateRegister: (reg) =>
        reg.channels.push({ id: 'script-store', kind: 'store', surface: 'scripts', storeMetadataDir: 'scripts/{tool}/store/x' }),
    });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — channel "script-store" is on surface "scripts", which has no column in contracts\/store\/vocabulary\.js LISTING_FIELDS/);
  });

  test('LC7 · COVERAGE LOST when no tool exists — the extension template alone is not a product', () => {
    // The template still yields 5 files for edge-addons, so the per-channel
    // count stays above zero: a union over the factory and the products is
    // not a coverage check, and this is the line that says so.
    const r = run({ noTool: true });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — extensions\/Extension\/ holds no tool \(no directory with a tool\.json\), so limb C could name no tool's listing tree/);
  });

  test('LC8 · COVERAGE LOST when catalog/apps.json names no app — the brick alone is not a product', () => {
    const r = run({ apps: [] });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — catalog\/apps\.json names no app, so limb C could name no app's listing tree/);
  });
});
