// ─────────────────────────────────────────────────────────────────────────────
// channel-surface.mjs — the ONE answer to "is the thing this channel delivers a
// Flutter application?", read out of tooling/channel-register.json's `surfaces`
// block and nowhere else.
//
// O-EXT-SURFACE-AXIS, residue (3). Until 2026-09-15 six guards decided that by
// comparing a row's `surface` with the literal 'extension':
//
//   assert-channel-claims      site artifact links graded against catalog/apps.json
//   assert-channel-register    which store rows get the app-shaped clauses
//   assert-platform-proof-fresh the `flutter build` proof's platform domain
//   assert-purchase-path       §A's PurchaseChannel (Dart enum) matrix
//   assert-seams-wired         which lanes must `--dart-define` GLITCHTIP_DSN
//   release-manifest           which store rows publish per deployment environment
//
// Each asked the same question — does this surface ship a Flutter app? — and
// each answered it with "is not the extension". The register's surface
// vocabulary is OPEN (release-manifest.mjs's `channelIsOnSurface` header records
// the day a third surface leaked through exactly that reading), so a third
// surface — scripts, say, which the product register already anticipates —
// would have been graded as a Flutter app by all six at once, silently.
//
// ── THE DECLARATION ──────────────────────────────────────────────────────────
// Every `surfaces.<name>` carries `flutterApp: true | false`. It is REQUIRED and
// has no default, for the reason `surface` itself has none: a default would put a
// new surface on one side of every guard above without anyone deciding which.
// assert-channel-register.mjs refuses a surface that omits it.
//
// ── THE ANSWER ───────────────────────────────────────────────────────────────
// `flutterAppChannel(register, row)` → `true`, `false`, or `null`. NULL MEANS
// UNDECIDABLE — the row names a surface the register does not declare, or the
// declaration carries no boolean — and every caller turns null into its own
// COVERAGE LOST rather than picking a side. That is the property the literal
// comparison lacked: `c.surface !== 'extension'` answered "Flutter" for a surface
// nobody had described.
//
// It scans nothing and exits nowhere: pure functions over a parsed register.
// Flat in tooling/ci because assert-guard-coverage treats a subdirectory as a
// guard escaping its scan. Its failing cases are in test/channel-surface.test.mjs.
// ─────────────────────────────────────────────────────────────────────────────

/** The declaration field. Named once, so the register check and every reader agree. */
export const FLUTTER_APP_FIELD = 'flutterApp';

/**
 * The declared surfaces of a parsed register, as a Map name → declaration.
 * `_`-prefixed keys are prose, as everywhere else in that file.
 * @param {unknown} register
 * @returns {Map<string, Record<string, unknown>>}
 */
export function declaredSurfaces(register) {
  const out = new Map();
  const block = register && typeof register === 'object' ? /** @type {any} */ (register).surfaces : null;
  if (!block || typeof block !== 'object' || Array.isArray(block)) return out;
  for (const [name, def] of Object.entries(block)) {
    if (name.startsWith('_')) continue;
    if (def && typeof def === 'object' && !Array.isArray(def)) out.set(name, /** @type {any} */ (def));
  }
  return out;
}

/**
 * Does this channel row deliver a Flutter application?
 * @param {unknown} register a parsed tooling/channel-register.json
 * @param {unknown} row one entry of its `channels`
 * @returns {true | false | null} null = the surface is undeclared, or declares no boolean
 */
export function flutterAppChannel(register, row) {
  const name = row && typeof row === 'object' ? /** @type {any} */ (row).surface : undefined;
  if (typeof name !== 'string' || name === '') return null;
  const def = declaredSurfaces(register).get(name);
  if (!def) return null;
  const flag = def[FLUTTER_APP_FIELD];
  return typeof flag === 'boolean' ? flag : null;
}

/**
 * Split rows three ways. `undeclared` is never empty by accident: a caller that
 * finds anything in it has read a row it cannot place and must say so.
 * @param {unknown} register
 * @param {unknown[]} rows
 */
export function partitionByFlutterApp(register, rows) {
  const flutter = [];
  const other = [];
  const undeclared = [];
  for (const row of rows ?? []) {
    const v = flutterAppChannel(register, row);
    if (v === true) flutter.push(row);
    else if (v === false) other.push(row);
    else undeclared.push(row);
  }
  return { flutter, other, undeclared };
}

/**
 * The sentence every caller prints when a row cannot be placed, so the refusal
 * reads the same in six guards.
 * @param {unknown} row
 * @param {string} guardQuestion what the calling guard needed to know
 */
export function undeclaredSurfaceLine(row, guardQuestion) {
  const r = /** @type {any} */ (row) ?? {};
  return (
    `channel ${JSON.stringify(r.id ?? null)} is on surface ${JSON.stringify(r.surface ?? null)}, which ` +
    `tooling/channel-register.json \`surfaces\` does not declare with a boolean \`${FLUTTER_APP_FIELD}\` — so ` +
    `${guardQuestion} cannot be decided for it. A surface nobody described is not a Flutter app and not an ` +
    'extension; declare it (O-EXT-SURFACE-AXIS).'
  );
}
