// ─────────────────────────────────────────────────────────────────────────────
// required-providers.mjs — which providers an app's own configuration makes a
// party to its users' data, read from the `requiredWhen` field that every row
// of tooling/legal/provider-register.json carries.
//
// ── WHY THE TRIGGER LIVES ON THE REGISTER ROW ────────────────────────────────
// apps/subscriptiontracker/app.yaml gained `billing.mobileIap` (RevenueCat, and
// through it Apple's and Google's in-app billing) while its privacy.yaml went on
// naming five processors, and no check asked who now touched the data
// (O-APP-PRIVACY-OMITS-STORE-BILLING). Adding three rows by hand would be true
// until the next app or the next rail. So each provider row states the
// condition under which an app must declare it, in terms of facts the app
// already declares (its app.yaml, and the laned channels of
// tooling/channel-register.json), and assert-app-yaml limb 9 holds every
// privacy.yaml to the set this module returns.
//
// ── THE FIVE KINDS ────────────────────────────────────────────────────────────
//   always         every app with a privacy declaration: the shared stack
//   appYaml        the app's app.yaml carries `path`, and its value is `equals`
//   mobileIapRail  the app declares `billing.mobileIap` AND a laned app channel
//                  sells on `rail` (the store bills that purchase)
//   channelRail    a laned app channel sells on `rail`; with `regionToo`, a
//                  laned app channel's `purchaseRail.regionRails` naming it counts
//   never          no app configuration makes it a processor; `why` (at least
//                  20 characters) says why, and a privacy.yaml declaring it is a
//                  finding
//
// "Laned app channel" = a `channels[]` row with `surface: "app"` and a non-null
// `lane`: a channel something builds and ships. The register is platform-wide
// (a channel row names no app), so every laned app channel counts for every
// app. A channel with `lane: null` ships nothing yet and triggers nothing.
//
// ── PURE ─────────────────────────────────────────────────────────────────────
// No file is read and nothing exits here. The caller reads the inputs and maps
// the two error codes: UNKNOWN_KIND (a row with no `requiredWhen`, or a kind
// this module does not know) is exit 2, because the row can no longer be
// judged; MALFORMED (a known kind with a wrong shape) is exit 1.
// ─────────────────────────────────────────────────────────────────────────────

export const REQUIRED_WHEN_KINDS = Object.freeze(['always', 'appYaml', 'mobileIapRail', 'channelRail', 'never']);

/** The keys each kind may carry besides `kind`. A key starting with `_` is a
 *  comment and is always allowed. */
const KIND_KEYS = Object.freeze({
  always: [],
  appYaml: ['path', 'equals'],
  mobileIapRail: ['rail'],
  channelRail: ['rail', 'regionToo'],
  never: ['why'],
});

/** The shortest `why` a `never` row may give. */
export const NEVER_WHY_MIN = 20;

export class RequiredWhenError extends Error {
  /** @param {'UNKNOWN_KIND'|'MALFORMED'} code  @param {string[]} findings */
  constructor(code, findings) {
    super(findings.join('\n'));
    this.name = 'RequiredWhenError';
    this.code = code;
    this.findings = findings;
  }
}

/** The value at a dotted path of a parsed document, or undefined. */
export function getPath(obj, dotted) {
  let v = obj;
  for (const seg of dotted.split('.')) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, seg)) return undefined;
    v = v[seg];
  }
  return v;
}

/** The 1-based line of a dotted key in YAML text, or null. A key only matches
 *  at the indentation of its parent's first child, so a same-named key nested
 *  deeper is never taken for it. */
export function yamlKeyLine(text, dotted) {
  const lines = text.split('\n');
  let from = 0;
  let parentIndent = -1;
  let found = -1;
  for (const seg of dotted.split('.')) {
    found = -1;
    let childIndent = null;
    for (let i = from; i < lines.length; i += 1) {
      const body = lines[i].trimStart();
      if (body === '' || body.startsWith('#')) continue;
      const indent = lines[i].length - body.length;
      if (indent <= parentIndent) break;
      if (childIndent === null) childIndent = indent;
      if (indent === childIndent && body.startsWith(`${seg}:`)) {
        found = i;
        parentIndent = indent;
        from = i + 1;
        break;
      }
    }
    if (found === -1) return null;
  }
  return found + 1;
}

/** The 1-based line of `"id": "<id>"` in JSON text, searching from the first
 *  line that contains `after` (when given), or null. */
export function jsonIdLine(text, id, after = null) {
  const lines = text.split('\n');
  let i = 0;
  if (after !== null) {
    while (i < lines.length && !lines[i].includes(after)) i += 1;
  }
  for (; i < lines.length; i += 1) {
    if (lines[i].includes(`"id": "${id}"`)) return i + 1;
  }
  return null;
}

/** The channels whose rails trigger a provider. */
export function lanedAppChannels(channelRegister) {
  const channels = Array.isArray(channelRegister?.channels) ? channelRegister.channels : [];
  return channels.filter((c) => c && c.surface === 'app' && c.lane !== null && typeof c.lane === 'object');
}

/**
 * Grade every row's `requiredWhen` without evaluating it.
 * @returns {{ unknown: string[], malformed: string[] }}
 */
export function gradeRequiredWhen(providerRegister, channelRegister) {
  const unknown = [];
  const malformed = [];
  const rails = channelRegister?.purchaseRails?.rails;
  const railIds = rails && typeof rails === 'object' ? Object.keys(rails).filter((r) => r !== 'none') : [];
  const rows = Array.isArray(providerRegister?.providers) ? providerRegister.providers : [];
  for (const row of rows) {
    const id = row?.id ?? '(a row with no id)';
    const rw = row?.requiredWhen;
    if (rw === null || typeof rw !== 'object' || Array.isArray(rw)) {
      unknown.push(`provider "${id}" has no requiredWhen object, so no app can be told whether it must declare it.`);
      continue;
    }
    if (!REQUIRED_WHEN_KINDS.includes(rw.kind)) {
      unknown.push(`provider "${id}" requiredWhen.kind is ${JSON.stringify(rw.kind)}; the kinds this reader judges are ${REQUIRED_WHEN_KINDS.join(', ')}.`);
      continue;
    }
    const allowed = KIND_KEYS[rw.kind];
    for (const k of Object.keys(rw)) {
      if (k === 'kind' || k.startsWith('_') || allowed.includes(k)) continue;
      malformed.push(`provider "${id}" requiredWhen (kind ${rw.kind}) carries "${k}", which that kind does not read.`);
    }
    if (rw.kind === 'appYaml') {
      if (typeof rw.path !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z][A-Za-z0-9_-]*)*$/.test(rw.path)) {
        malformed.push(`provider "${id}" requiredWhen.path must be a dotted app.yaml key, got ${JSON.stringify(rw.path)}.`);
      }
      if (!['string', 'number', 'boolean'].includes(typeof rw.equals)) {
        malformed.push(`provider "${id}" requiredWhen.equals must be a string, number or boolean, got ${JSON.stringify(rw.equals)}.`);
      }
    }
    if (rw.kind === 'mobileIapRail' || rw.kind === 'channelRail') {
      if (!railIds.includes(rw.rail)) {
        malformed.push(`provider "${id}" requiredWhen.rail is ${JSON.stringify(rw.rail)}, which is not a selling rail in tooling/channel-register.json purchaseRails.rails (${railIds.join(', ')}).`);
      }
    }
    if (rw.kind === 'channelRail' && rw.regionToo !== undefined && typeof rw.regionToo !== 'boolean') {
      malformed.push(`provider "${id}" requiredWhen.regionToo must be true or false, got ${JSON.stringify(rw.regionToo)}.`);
    }
    if (rw.kind === 'never' && (typeof rw.why !== 'string' || rw.why.trim().length < NEVER_WHY_MIN)) {
      malformed.push(`provider "${id}" requiredWhen.why must say in at least ${NEVER_WHY_MIN} characters why no app configuration makes it a processor.`);
    }
  }
  return { unknown, malformed };
}

/**
 * The providers `appId`'s configuration requires it to declare, in register
 * order. Throws RequiredWhenError when a row cannot be judged.
 *
 * @param {string} appId
 * @param {{ appYaml: object, channelRegister: object, providerRegister: object }} inputs
 * @returns {Array<{ id: string, kind: string, trigger: string, appYamlPath?: string, channels?: Array<{ id: string, via: string }> }>}
 */
export function resolveRequiredProviders(appId, { appYaml, channelRegister, providerRegister }) {
  const { unknown, malformed } = gradeRequiredWhen(providerRegister, channelRegister);
  if (unknown.length) throw new RequiredWhenError('UNKNOWN_KIND', unknown);
  if (malformed.length) throw new RequiredWhenError('MALFORMED', malformed);

  const laned = lanedAppChannels(channelRegister);
  const mobileIap = getPath(appYaml, 'billing.mobileIap');
  const declaresMobileIap = mobileIap !== null && typeof mobileIap === 'object';
  const onRail = (rail) => laned.filter((c) => c.purchaseRail?.rail === rail).map((c) => ({ id: c.id, via: 'purchaseRail.rail' }));
  const inRegion = (rail) =>
    laned.flatMap((c) =>
      (Array.isArray(c.purchaseRail?.regionRails) ? c.purchaseRail.regionRails : [])
        .filter((r) => r?.rail === rail)
        .map((r) => ({ id: c.id, via: `purchaseRail.regionRails ${r.region}` })),
    );

  const required = [];
  for (const row of providerRegister.providers) {
    const rw = row.requiredWhen;
    if (rw.kind === 'always') {
      required.push({ id: row.id, kind: rw.kind, trigger: 'requiredWhen always: every app with a privacy declaration uses it' });
    } else if (rw.kind === 'appYaml') {
      if (getPath(appYaml, rw.path) === rw.equals) {
        required.push({ id: row.id, kind: rw.kind, trigger: `${appId} app.yaml ${rw.path} is ${JSON.stringify(rw.equals)}`, appYamlPath: rw.path });
      }
    } else if (rw.kind === 'mobileIapRail') {
      const channels = onRail(rw.rail);
      if (declaresMobileIap && channels.length) {
        required.push({
          id: row.id,
          kind: rw.kind,
          trigger: `${appId} app.yaml declares billing.mobileIap and ${channels.map((c) => c.id).join(', ')} sell${channels.length === 1 ? 's' : ''} on ${rw.rail}`,
          appYamlPath: 'billing.mobileIap',
          channels,
        });
      }
    } else if (rw.kind === 'channelRail') {
      const channels = [...onRail(rw.rail), ...(rw.regionToo === true ? inRegion(rw.rail) : [])];
      if (channels.length) {
        required.push({
          id: row.id,
          kind: rw.kind,
          trigger: `${channels.map((c) => c.id).join(', ')} sell${channels.length === 1 ? 's' : ''} on ${rw.rail}`,
          channels,
        });
      }
    }
  }
  return required;
}

/** The ids whose row says no app configuration makes them a processor. */
export function neverProviders(providerRegister) {
  return (Array.isArray(providerRegister?.providers) ? providerRegister.providers : [])
    .filter((row) => row?.requiredWhen?.kind === 'never')
    .map((row) => row.id);
}
