// ─────────────────────────────────────────────────────────────────────────────
// play-data-safety.mjs — Play's Data safety form, RENDERED FROM THE SWORN FILE
// and declared through the API, so nobody types it into the console.
//
// apps/<app>/store/android-play/data-safety.json is the sworn, guard-checked
// source of truth for the form (tooling/ci/assert-play-declarations.mjs). Until
// this file the console was its copy BY HAND: every answer re-typed, per type,
// per purpose, from a JSON nobody re-reads at the console. Play's Developer API
// takes the whole form as one CSV:
//
//   POST https://androidpublisher.googleapis.com/androidpublisher/v3/
//        applications/{packageName}/dataSafety     {"safetyLabels": "<CSV>"}
//   (scope https://www.googleapis.com/auth/androidpublisher)
//
// and the CSV is the Play Console export's own shape: a five-column header, one
// row per (Question ID, Response ID) of Play's template, the Response value
// filled where answered and blank otherwise. PLAY_TEMPLATE below is that
// template's machine-readable IDs, from the Play Console export of 2026-10-03.
//
// 🔴 WHICH COLUMN. Every answer in data-safety.json is recorded per build
// posture, and which posture Play receives is DERIVED by assert-play-declarations
// from the .aab lane in .github/workflows/build-platforms.yml. This file does not
// derive it a second time: the CLI runs that guard and takes the posture it
// prints as confirmed against the lane, and refuses unless the guard exits 0 and
// the posture equals the file's own `buildPosture.current`.
//
// 🔴 NO INVENTED ANSWERS. Every value in the CSV is read off data-safety.json
// through PLAY_ID_MAP — the ONE table from that file's vocabulary to Play's IDs,
// so a correction is one edit. A question data-safety.json does not answer is
// left BLANK and printed as such, never guessed; a `null` the CSV would need is a
// refusal (exit 1) that names the field.
//
// Usage:
//   node tooling/release/play-data-safety.mjs --app <id> --out <file.csv>
//        [--template <play-console-export.csv>] [--apply] [--repo-root <dir>]
//
//   (dry)     render + validate, write the CSV, print what it declares. No network.
//   --apply   additionally POST it. Reads the service-account JSON from the path in
//             env PLAY_SERVICE_ACCOUNT_FILE, mints a token through submit-play.mjs'
//             mintPlayAccessToken (the one copy), prints HTTP statuses only.
//   --template  the lead's Play Console CSV export. Its (Question ID, Response ID)
//             set must equal PLAY_TEMPLATE exactly, and its requirement and label
//             columns are then used verbatim (the embedded labels are the export's
//             first 90 characters, and the usage rows carry none).
//
// Exit codes: 0 rendered (and applied); 1 a refusal; 2 COVERAGE LOST (the posture
// could not be confirmed, or a file the render needs is missing).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundedSpawn } from '../ci/bounded-spawn.mjs';
import { readGradleApplicationId } from '../ci/read-identity.mjs';
import { invokedAsScript } from './submit-common.mjs';
import { mintPlayAccessToken } from './submit-play.mjs';

export const PLAY_API_ORIGIN = 'https://androidpublisher.googleapis.com';
export const HEADER = Object.freeze([
  'Question ID (machine readable)',
  'Response ID (machine readable)',
  'Response value',
  'Answer requirement',
  'Human-friendly question label',
]);
/** Ceiling on every network call --apply makes. */
export const FETCH_TIMEOUT_MS = 30_000;
const SA_FILE_ENV = 'PLAY_SERVICE_ACCOUNT_FILE';
const GUARD_REL = 'tooling/ci/assert-play-declarations.mjs';

// ── PLAY'S TEMPLATE (Play Console export, 2026-10-03) ─────────────────────────
// [Question ID, Response ID ('' for a question row), requirement, label]. Labels
// are as the brief carried them, cut at 90 characters; pass --template to use the
// export's own.
const NON_USAGE_ROWS = [
  ['PSL_DATA_COLLECTION_COLLECTS_PERSONAL_DATA', '', 'REQUIRED', 'Does your app collect or share any of the required user data types?'],
  ['PSL_DATA_COLLECTION_ENCRYPTED_IN_TRANSIT', '', 'MAYBE_REQUIRED', 'Is all of the user data collected by your app encrypted in transit?'],
  ['PSL_SUPPORTED_ACCOUNT_CREATION_METHODS', 'PSL_ACM_USER_ID_PASSWORD', 'MULTIPLE_CHOICE', 'Which of the following methods of account creation does your app support? Select all that '],
  ['PSL_SUPPORTED_ACCOUNT_CREATION_METHODS', 'PSL_ACM_USER_ID_OTHER_AUTH', 'MULTIPLE_CHOICE', 'Which of the following methods of account creation does your app support? Select all that '],
  ['PSL_SUPPORTED_ACCOUNT_CREATION_METHODS', 'PSL_ACM_USER_ID_PASSWORD_OTHER_AUTH', 'MULTIPLE_CHOICE', 'Which of the following methods of account creation does your app support? Select all that '],
  ['PSL_SUPPORTED_ACCOUNT_CREATION_METHODS', 'PSL_ACM_OAUTH', 'MULTIPLE_CHOICE', 'Which of the following methods of account creation does your app support? Select all that '],
  ['PSL_SUPPORTED_ACCOUNT_CREATION_METHODS', 'PSL_ACM_OTHER', 'MULTIPLE_CHOICE', 'Which of the following methods of account creation does your app support? Select all that '],
  ['PSL_SUPPORTED_ACCOUNT_CREATION_METHODS', 'PSL_ACM_NONE', 'MULTIPLE_CHOICE', 'Which of the following methods of account creation does your app support? Select all that '],
  ['PSL_ACM_SPECIFY', '', 'MAYBE_REQUIRED', 'Describe the method of account creation that your app supports'],
  ['PSL_ACCOUNT_DELETION_URL', '', 'MAYBE_REQUIRED', 'Add a link that users can use to request that their account and associated data is deleted'],
  ['PSL_SUPPORT_DATA_DELETION_BY_USER', 'DATA_DELETION_YES', 'SINGLE_CHOICE', 'Do you provide a way for users to request that their data is deleted? / Yes'],
  ['PSL_SUPPORT_DATA_DELETION_BY_USER', 'DATA_DELETION_NO', 'SINGLE_CHOICE', 'Do you provide a way for users to request that their data is deleted? / No'],
  ['PSL_SUPPORT_DATA_DELETION_BY_USER', 'DATA_DELETION_NO_AUTO_DELETED', 'SINGLE_CHOICE', 'Do you provide a way for users to request that their data is deleted? / No, but user data '],
  ['PSL_DATA_DELETION_URL', '', 'MAYBE_REQUIRED', 'Delete data URL'],
  ['PSL_DATA_COLLECTION_COMPLIES_FAMILY_POLICY', '', 'OPTIONAL', "Only answer this question if you've indicated that your app's target age group includes ch"],
  ['PSL_INDEPENDENTLY_VALIDATED', '', 'OPTIONAL', 'Has your app successfully completed an independent security review, according to the Mobil'],
  ['PSL_UPI_BADGE_OPT_IN', '', 'OPTIONAL', 'Do you want to show this badge on your store listing?'],
  ['PSL_HAS_OUTSIDE_APP_ACCOUNTS', '', 'OPTIONAL', 'Can users login to your app with accounts created outside of the app?'],
  ['PSL_OUTSIDE_APP_ACCOUNT_TYPES', 'PSL_LOGIN_WITH_OUTSIDE_APP_ID', 'MULTIPLE_CHOICE', 'How are these accounts created? / Out of app identification (e.g. SIM binding, service sub'],
  ['PSL_OUTSIDE_APP_ACCOUNT_TYPES', 'PSL_LOGIN_THROUGH_EMPLOYMENT_OR_ENTERPRISE_ACCOUNT', 'MULTIPLE_CHOICE', 'How are these accounts created? / Through employment, or enterprise accounts'],
  ['PSL_OUTSIDE_APP_ACCOUNT_TYPES', 'PSL_OUTSIDE_APP_ACCOUNT_TYPE_OTHER', 'MULTIPLE_CHOICE', 'How are these accounts created? / Other'],
  ['PSL_OUTSIDE_APP_ACCOUNT_TYPE_SPECIFY', '', 'MAYBE_REQUIRED', 'Describe how these accounts are created'],
  ['PSL_DATA_TYPES_PERSONAL', 'PSL_NAME', 'MULTIPLE_CHOICE', 'Personal info / Name'],
  ['PSL_DATA_TYPES_PERSONAL', 'PSL_EMAIL', 'MULTIPLE_CHOICE', 'Personal info / Email address'],
  ['PSL_DATA_TYPES_PERSONAL', 'PSL_USER_ACCOUNT', 'MULTIPLE_CHOICE', 'Personal info / User IDs'],
  ['PSL_DATA_TYPES_PERSONAL', 'PSL_ADDRESS', 'MULTIPLE_CHOICE', 'Personal info / Address'],
  ['PSL_DATA_TYPES_PERSONAL', 'PSL_PHONE', 'MULTIPLE_CHOICE', 'Personal info / Phone number'],
  ['PSL_DATA_TYPES_PERSONAL', 'PSL_RACE_ETHNICITY', 'MULTIPLE_CHOICE', 'Personal info / Race and ethnicity'],
  ['PSL_DATA_TYPES_PERSONAL', 'PSL_POLITICAL_RELIGIOUS', 'MULTIPLE_CHOICE', 'Personal info / Political or religious beliefs'],
  ['PSL_DATA_TYPES_PERSONAL', 'PSL_SEXUAL_ORIENTATION_GENDER_IDENTITY', 'MULTIPLE_CHOICE', 'Personal info / Sexual orientation'],
  ['PSL_DATA_TYPES_PERSONAL', 'PSL_OTHER_PERSONAL', 'MULTIPLE_CHOICE', 'Personal info / Other info'],
  ['PSL_DATA_TYPES_FINANCIAL', 'PSL_CREDIT_DEBIT_BANK_ACCOUNT_NUMBER', 'MULTIPLE_CHOICE', 'Financial info / User payment info'],
  ['PSL_DATA_TYPES_FINANCIAL', 'PSL_PURCHASE_HISTORY', 'MULTIPLE_CHOICE', 'Financial info / Purchase history'],
  ['PSL_DATA_TYPES_FINANCIAL', 'PSL_CREDIT_SCORE', 'MULTIPLE_CHOICE', 'Financial info / Credit score'],
  ['PSL_DATA_TYPES_FINANCIAL', 'PSL_OTHER', 'MULTIPLE_CHOICE', 'Financial info / Other financial info'],
  ['PSL_DATA_TYPES_LOCATION', 'PSL_APPROX_LOCATION', 'MULTIPLE_CHOICE', 'Location / Approximate location'],
  ['PSL_DATA_TYPES_LOCATION', 'PSL_PRECISE_LOCATION', 'MULTIPLE_CHOICE', 'Location / Precise location'],
  ['PSL_DATA_TYPES_SEARCH_AND_BROWSING', 'PSL_WEB_BROWSING_HISTORY', 'MULTIPLE_CHOICE', 'Web browsing / Web browsing history'],
  ['PSL_DATA_TYPES_EMAIL_AND_TEXT', 'PSL_EMAILS', 'MULTIPLE_CHOICE', 'Messages / Emails'],
  ['PSL_DATA_TYPES_EMAIL_AND_TEXT', 'PSL_SMS_CALL_LOG', 'MULTIPLE_CHOICE', 'Messages / SMS or MMS'],
  ['PSL_DATA_TYPES_EMAIL_AND_TEXT', 'PSL_OTHER_MESSAGES', 'MULTIPLE_CHOICE', 'Messages / Other in-app messages'],
  ['PSL_DATA_TYPES_PHOTOS_AND_VIDEOS', 'PSL_PHOTOS', 'MULTIPLE_CHOICE', 'Photos and videos / Photos'],
  ['PSL_DATA_TYPES_PHOTOS_AND_VIDEOS', 'PSL_VIDEOS', 'MULTIPLE_CHOICE', 'Photos and videos / Videos'],
  ['PSL_DATA_TYPES_AUDIO', 'PSL_AUDIO', 'MULTIPLE_CHOICE', 'Audio files / Voice or sound recordings'],
  ['PSL_DATA_TYPES_AUDIO', 'PSL_MUSIC', 'MULTIPLE_CHOICE', 'Audio files / Music files'],
  ['PSL_DATA_TYPES_AUDIO', 'PSL_OTHER_AUDIO', 'MULTIPLE_CHOICE', 'Audio files / Other audio files'],
  ['PSL_DATA_TYPES_HEALTH_AND_FITNESS', 'PSL_HEALTH', 'MULTIPLE_CHOICE', 'Health and fitness / Health info'],
  ['PSL_DATA_TYPES_HEALTH_AND_FITNESS', 'PSL_FITNESS', 'MULTIPLE_CHOICE', 'Health and fitness / Fitness info'],
  ['PSL_DATA_TYPES_CONTACTS', 'PSL_CONTACTS', 'MULTIPLE_CHOICE', 'Contacts / Contacts'],
  ['PSL_DATA_TYPES_CALENDAR', 'PSL_CALENDAR', 'MULTIPLE_CHOICE', 'Calendar / Calendar events'],
  ['PSL_DATA_TYPES_APP_PERFORMANCE', 'PSL_CRASH_LOGS', 'MULTIPLE_CHOICE', 'App info and performance / Crash logs'],
  ['PSL_DATA_TYPES_APP_PERFORMANCE', 'PSL_PERFORMANCE_DIAGNOSTICS', 'MULTIPLE_CHOICE', 'App info and performance / Diagnostics'],
  ['PSL_DATA_TYPES_APP_PERFORMANCE', 'PSL_OTHER_PERFORMANCE', 'MULTIPLE_CHOICE', 'App info and performance / Other app performance data'],
  ['PSL_DATA_TYPES_FILES_AND_DOCS', 'PSL_FILES_AND_DOCS', 'MULTIPLE_CHOICE', 'Files and docs / Files and docs'],
  ['PSL_DATA_TYPES_APP_ACTIVITY', 'PSL_USER_INTERACTION', 'MULTIPLE_CHOICE', 'App activity / App interactions'],
  ['PSL_DATA_TYPES_APP_ACTIVITY', 'PSL_IN_APP_SEARCH_HISTORY', 'MULTIPLE_CHOICE', 'App activity / In-app search history'],
  ['PSL_DATA_TYPES_APP_ACTIVITY', 'PSL_APPS_ON_DEVICE', 'MULTIPLE_CHOICE', 'App activity / Installed apps'],
  ['PSL_DATA_TYPES_APP_ACTIVITY', 'PSL_USER_GENERATED_CONTENT', 'MULTIPLE_CHOICE', 'App activity / Other user-generated content'],
  ['PSL_DATA_TYPES_APP_ACTIVITY', 'PSL_OTHER_APP_ACTIVITY', 'MULTIPLE_CHOICE', 'App activity / Other actions'],
  ['PSL_DATA_TYPES_IDENTIFIERS', 'PSL_DEVICE_ID', 'MULTIPLE_CHOICE', 'Device or other IDs / Device or other IDs'],
];
/** The usage block, repeated once per data type with <TYPE> = the type's Response ID. */
const USAGE_BLOCK = [
  ['PSL_DATA_USAGE_COLLECTION_AND_SHARING', 'PSL_DATA_USAGE_ONLY_COLLECTED', 'MULTIPLE_CHOICE'],
  ['PSL_DATA_USAGE_COLLECTION_AND_SHARING', 'PSL_DATA_USAGE_ONLY_SHARED', 'MULTIPLE_CHOICE'],
  ['PSL_DATA_USAGE_EPHEMERAL', '', 'MAYBE_REQUIRED'],
  ['DATA_USAGE_USER_CONTROL', 'PSL_DATA_USAGE_USER_CONTROL_OPTIONAL', 'SINGLE_CHOICE'],
  ['DATA_USAGE_USER_CONTROL', 'PSL_DATA_USAGE_USER_CONTROL_REQUIRED', 'SINGLE_CHOICE'],
  ...['DATA_USAGE_COLLECTION_PURPOSE', 'DATA_USAGE_SHARING_PURPOSE'].flatMap((q) =>
    [
      'PSL_APP_FUNCTIONALITY',
      'PSL_ANALYTICS',
      'PSL_DEVELOPER_COMMUNICATIONS',
      'PSL_FRAUD_PREVENTION_SECURITY',
      'PSL_ADVERTISING',
      'PSL_PERSONALIZATION',
      'PSL_ACCOUNT_MANAGEMENT',
    ].map((r) => [q, r, 'MULTIPLE_CHOICE']),
  ),
];
const DATA_TYPE_IDS = NON_USAGE_ROWS.filter(([q]) => q.startsWith('PSL_DATA_TYPES_')).map(([, r]) => r);
const usageQuestion = (typeId, part) => `PSL_DATA_USAGE_RESPONSES:${typeId}:${part}`;

/** Play's template, in the export's order: { question, response, requirement, label }. */
export const PLAY_TEMPLATE = Object.freeze(
  [
    ...NON_USAGE_ROWS.map(([question, response, requirement, label]) => ({ question, response, requirement, label: label.trimEnd() })),
    ...DATA_TYPE_IDS.flatMap((t) =>
      USAGE_BLOCK.map(([part, response, requirement]) => ({ question: usageQuestion(t, part), response, requirement, label: '' })),
    ),
  ].map(Object.freeze),
);

// ── PLAY_ID_MAP — data-safety.json's vocabulary → Play's IDs. ONE table. ──────
// A wrong ID is corrected HERE and nowhere else. Every value must be a pair in
// PLAY_TEMPLATE; render() refuses one that is not.
export const PLAY_ID_MAP = Object.freeze({
  collectsPersonalData: 'PSL_DATA_COLLECTION_COLLECTS_PERSONAL_DATA',
  /** `${category}/${type}` exactly as data-safety.json `vocabulary.categories` spells them. */
  types: Object.freeze({
    'Personal info/Name': ['PSL_DATA_TYPES_PERSONAL', 'PSL_NAME'],
    'Personal info/Email address': ['PSL_DATA_TYPES_PERSONAL', 'PSL_EMAIL'],
    'Personal info/User IDs': ['PSL_DATA_TYPES_PERSONAL', 'PSL_USER_ACCOUNT'],
    'Personal info/Address': ['PSL_DATA_TYPES_PERSONAL', 'PSL_ADDRESS'],
    'Personal info/Phone number': ['PSL_DATA_TYPES_PERSONAL', 'PSL_PHONE'],
    'Personal info/Race and ethnicity': ['PSL_DATA_TYPES_PERSONAL', 'PSL_RACE_ETHNICITY'],
    'Personal info/Political or religious beliefs': ['PSL_DATA_TYPES_PERSONAL', 'PSL_POLITICAL_RELIGIOUS'],
    'Personal info/Sexual orientation': ['PSL_DATA_TYPES_PERSONAL', 'PSL_SEXUAL_ORIENTATION_GENDER_IDENTITY'],
    'Personal info/Other info': ['PSL_DATA_TYPES_PERSONAL', 'PSL_OTHER_PERSONAL'],
    'Financial info/User payment info': ['PSL_DATA_TYPES_FINANCIAL', 'PSL_CREDIT_DEBIT_BANK_ACCOUNT_NUMBER'],
    'Financial info/Purchase history': ['PSL_DATA_TYPES_FINANCIAL', 'PSL_PURCHASE_HISTORY'],
    'Financial info/Credit score': ['PSL_DATA_TYPES_FINANCIAL', 'PSL_CREDIT_SCORE'],
    'Financial info/Other financial info': ['PSL_DATA_TYPES_FINANCIAL', 'PSL_OTHER'],
    'Location/Approximate location': ['PSL_DATA_TYPES_LOCATION', 'PSL_APPROX_LOCATION'],
    'Location/Precise location': ['PSL_DATA_TYPES_LOCATION', 'PSL_PRECISE_LOCATION'],
    'Web browsing/Web browsing history': ['PSL_DATA_TYPES_SEARCH_AND_BROWSING', 'PSL_WEB_BROWSING_HISTORY'],
    'Messages/Emails': ['PSL_DATA_TYPES_EMAIL_AND_TEXT', 'PSL_EMAILS'],
    'Messages/SMS or MMS': ['PSL_DATA_TYPES_EMAIL_AND_TEXT', 'PSL_SMS_CALL_LOG'],
    'Messages/Other in-app messages': ['PSL_DATA_TYPES_EMAIL_AND_TEXT', 'PSL_OTHER_MESSAGES'],
    'Photos and videos/Photos': ['PSL_DATA_TYPES_PHOTOS_AND_VIDEOS', 'PSL_PHOTOS'],
    'Photos and videos/Videos': ['PSL_DATA_TYPES_PHOTOS_AND_VIDEOS', 'PSL_VIDEOS'],
    'Audio files/Voice or sound recordings': ['PSL_DATA_TYPES_AUDIO', 'PSL_AUDIO'],
    'Audio files/Music files': ['PSL_DATA_TYPES_AUDIO', 'PSL_MUSIC'],
    'Audio files/Other audio files': ['PSL_DATA_TYPES_AUDIO', 'PSL_OTHER_AUDIO'],
    'Health and fitness/Health info': ['PSL_DATA_TYPES_HEALTH_AND_FITNESS', 'PSL_HEALTH'],
    'Health and fitness/Fitness info': ['PSL_DATA_TYPES_HEALTH_AND_FITNESS', 'PSL_FITNESS'],
    'Contacts/Contacts': ['PSL_DATA_TYPES_CONTACTS', 'PSL_CONTACTS'],
    'Calendar/Calendar events': ['PSL_DATA_TYPES_CALENDAR', 'PSL_CALENDAR'],
    'App info and performance/Crash logs': ['PSL_DATA_TYPES_APP_PERFORMANCE', 'PSL_CRASH_LOGS'],
    'App info and performance/Diagnostics': ['PSL_DATA_TYPES_APP_PERFORMANCE', 'PSL_PERFORMANCE_DIAGNOSTICS'],
    'App info and performance/Other app performance data': ['PSL_DATA_TYPES_APP_PERFORMANCE', 'PSL_OTHER_PERFORMANCE'],
    'Files and docs/Files and docs': ['PSL_DATA_TYPES_FILES_AND_DOCS', 'PSL_FILES_AND_DOCS'],
    'App activity/App interactions': ['PSL_DATA_TYPES_APP_ACTIVITY', 'PSL_USER_INTERACTION'],
    'App activity/In-app search history': ['PSL_DATA_TYPES_APP_ACTIVITY', 'PSL_IN_APP_SEARCH_HISTORY'],
    'App activity/Installed apps': ['PSL_DATA_TYPES_APP_ACTIVITY', 'PSL_APPS_ON_DEVICE'],
    'App activity/Other user-generated content': ['PSL_DATA_TYPES_APP_ACTIVITY', 'PSL_USER_GENERATED_CONTENT'],
    'App activity/Other actions': ['PSL_DATA_TYPES_APP_ACTIVITY', 'PSL_OTHER_APP_ACTIVITY'],
    'Device or other IDs/Device or other IDs': ['PSL_DATA_TYPES_IDENTIFIERS', 'PSL_DEVICE_ID'],
  }),
  /** data-safety.json `vocabulary.purposes` → the purpose Response ID (collection and sharing alike). */
  purposes: Object.freeze({
    'App functionality': 'PSL_APP_FUNCTIONALITY',
    Analytics: 'PSL_ANALYTICS',
    'Developer communications': 'PSL_DEVELOPER_COMMUNICATIONS',
    'Advertising or marketing': 'PSL_ADVERTISING',
    'Fraud prevention, security, and compliance': 'PSL_FRAUD_PREVENTION_SECURITY',
    Personalization: 'PSL_PERSONALIZATION',
    'Account management': 'PSL_ACCOUNT_MANAGEMENT',
  }),
  usage: Object.freeze({
    collectionAndSharing: 'PSL_DATA_USAGE_COLLECTION_AND_SHARING',
    collected: 'PSL_DATA_USAGE_ONLY_COLLECTED',
    shared: 'PSL_DATA_USAGE_ONLY_SHARED',
    ephemeral: 'PSL_DATA_USAGE_EPHEMERAL',
    userControl: 'DATA_USAGE_USER_CONTROL',
    /** answers[].required: true → REQUIRED, false → OPTIONAL. */
    controlRequired: 'PSL_DATA_USAGE_USER_CONTROL_REQUIRED',
    controlOptional: 'PSL_DATA_USAGE_USER_CONTROL_OPTIONAL',
    collectionPurpose: 'DATA_USAGE_COLLECTION_PURPOSE',
    sharingPurpose: 'DATA_USAGE_SHARING_PURPOSE',
  }),
  dataSecurity: Object.freeze({
    /** dataSecurity.encryptedInTransit.answer */
    encryptedInTransit: 'PSL_DATA_COLLECTION_ENCRYPTED_IN_TRANSIT',
    /** dataSecurity.deletionRequestSupported.answer: true → YES, false → NO. */
    deletionQuestion: 'PSL_SUPPORT_DATA_DELETION_BY_USER',
    deletionYes: 'DATA_DELETION_YES',
    deletionNo: 'DATA_DELETION_NO',
    /** dataSecurity.deletionRequestSupported.webDeletionUrl — the delete-ACCOUNT page. */
    accountDeletionUrl: 'PSL_ACCOUNT_DELETION_URL',
    /** The SAME webDeletionUrl, filled only when the deletion answer is YES: the page is where a
     *  user requests deletion of their data (its title is "Delete your account and data"). */
    dataDeletionUrl: 'PSL_DATA_DELETION_URL',
    /** dataSecurity.independentSecurityReview.answer */
    independentlyValidated: 'PSL_INDEPENDENTLY_VALIDATED',
    /** dataSecurity.playFamiliesPolicy.answer — rendered ONLY when true: the question says
     *  "Only answer this question if … your app's target age group includes children". */
    familiesPolicy: 'PSL_DATA_COLLECTION_COMPLIES_FAMILY_POLICY',
  }),
  /** data-safety.json `accounts` — every value is read per posture. */
  accounts: Object.freeze({
    methodsQuestion: 'PSL_SUPPORTED_ACCOUNT_CREATION_METHODS',
    /** accounts.creationMethods.<key>[posture]: true → the response is chosen. */
    methods: Object.freeze({
      userIdPassword: 'PSL_ACM_USER_ID_PASSWORD',
      userIdOtherAuth: 'PSL_ACM_USER_ID_OTHER_AUTH',
      userIdPasswordOtherAuth: 'PSL_ACM_USER_ID_PASSWORD_OTHER_AUTH',
      oauth: 'PSL_ACM_OAUTH',
      other: 'PSL_ACM_OTHER',
      none: 'PSL_ACM_NONE',
    }),
    /** accounts.otherDescription — only when `other` is chosen. */
    otherSpecify: 'PSL_ACM_SPECIFY',
    /** accounts.outsideAppAccounts[posture] */
    outsideApp: 'PSL_HAS_OUTSIDE_APP_ACCOUNTS',
    outsideAppTypesQuestion: 'PSL_OUTSIDE_APP_ACCOUNT_TYPES',
    /** accounts.outsideAppAccounts.types[] → the type Response ID. */
    outsideAppTypes: Object.freeze({
      'outside-app-id': 'PSL_LOGIN_WITH_OUTSIDE_APP_ID',
      'employment-or-enterprise': 'PSL_LOGIN_THROUGH_EMPLOYMENT_OR_ENTERPRISE_ACCOUNT',
      other: 'PSL_OUTSIDE_APP_ACCOUNT_TYPE_OTHER',
    }),
    /** accounts.outsideAppAccounts.description — only when type `other` is chosen. */
    outsideAppSpecify: 'PSL_OUTSIDE_APP_ACCOUNT_TYPE_SPECIFY',
  }),
});

/** Questions data-safety.json does not answer. Left blank, printed, never guessed.
 *  PSL_UPI_BADGE_OPT_IN is OPTIONAL and asks whether the app uses UPI to move money; this app's
 *  only payment rail is store billing (app.yaml `billing.mobileIap`), and nothing in the sworn file
 *  records a UPI answer, so it stays blank rather than being inferred here. */
export const NOT_DECLARED_BY_THE_SWORN_FILE = Object.freeze(['PSL_UPI_BADGE_OPT_IN']);

export class Refusal extends Error {
  constructor(problems) {
    super(problems.join('\n'));
    this.problems = problems;
  }
}

const key = (q, r) => `${q}\u0000${r}`;
const isHttps = (u) => {
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * data-safety.json + a posture → { csv, rows, declared, notDeclared }.
 * Throws Refusal naming every problem; never returns a partial CSV.
 *
 * @param {object} ds        the parsed data-safety.json
 * @param {string} posture   a key of ds.buildPosture.postures
 * @param {{ idMap?: object, template?: ReadonlyArray<{question,response,requirement,label}> }} [opts]
 */
export function render(ds, posture, { idMap = PLAY_ID_MAP, template = PLAY_TEMPLATE } = {}) {
  const problems = [];
  const values = new Map(); // key → value string
  const inTemplate = new Set(template.map((r) => key(r.question, r.response)));
  const set = (q, r, v, why) => {
    if (!inTemplate.has(key(q, r))) {
      problems.push(`${why} maps to (${q}, ${r || '∅'}), which is NOT a (Question ID, Response ID) pair in Play's template. Correct it in PLAY_ID_MAP.`);
      return;
    }
    values.set(key(q, r), String(v));
  };

  if (!ds || typeof ds !== 'object') throw new Refusal(['data-safety.json did not parse to an object.']);
  const postures = Object.keys(ds.buildPosture?.postures ?? {});
  if (!postures.includes(posture)) {
    problems.push(`posture ${JSON.stringify(posture)} is not one of buildPosture.postures (${postures.join(', ') || 'none'}).`);
  }
  if (Array.isArray(ds.unresolved) && ds.unresolved.length > 0) {
    problems.push(`data-safety.json \`unresolved\` holds ${ds.unresolved.length} open question(s): ${ds.unresolved.map((u) => u?.id ?? JSON.stringify(u)).join(', ')}. An open question is a form field with no sworn answer.`);
  }
  const answers = Array.isArray(ds.answers) ? ds.answers : [];
  if (answers.length === 0) problems.push('data-safety.json has no `answers`.');
  if (problems.length) throw new Refusal(problems);

  // Every vocabulary type must have a Play ID, and every answer must name one.
  for (const [cat, types] of Object.entries(ds.vocabulary?.categories ?? {})) {
    for (const t of types) if (!idMap.types[`${cat}/${t}`]) problems.push(`vocabulary type "${cat}/${t}" has no entry in PLAY_ID_MAP.types.`);
  }

  const u = idMap.usage;
  const declared = [];
  for (const a of answers) {
    const name = `${a?.category}/${a?.type}`;
    const where = `answers["${name}"]`;
    const ids = idMap.types[name];
    if (!ids) {
      problems.push(`${where} names a type with no entry in PLAY_ID_MAP.types — an unknown ID is never guessed.`);
      continue;
    }
    const collected = a.collected?.[posture];
    const shared = a.shared?.[posture];
    if (typeof collected !== 'boolean') problems.push(`${where}.collected["${posture}"] is ${JSON.stringify(collected)}; the form needs true or false.`);
    if (typeof shared !== 'boolean') problems.push(`${where}.shared["${posture}"] is ${JSON.stringify(shared)}; the form needs true or false.`);
    if (collected !== true && shared !== true) continue;

    const [tq, tr] = ids;
    set(tq, tr, 'true', `${where} (declared)`);
    if (collected) set(usageQuestion(tr, u.collectionAndSharing), u.collected, 'true', `${where}.collected`);
    if (shared) set(usageQuestion(tr, u.collectionAndSharing), u.shared, 'true', `${where}.shared`);

    if (collected) {
      if (typeof a.ephemeral !== 'boolean') problems.push(`${where}.ephemeral is ${JSON.stringify(a.ephemeral)}; a collected type must say whether it is processed ephemerally.`);
      else set(usageQuestion(tr, u.ephemeral), '', String(a.ephemeral), `${where}.ephemeral`);
    }
    if (typeof a.required !== 'boolean') {
      problems.push(`${where}.required is ${JSON.stringify(a.required)}; a declared type must say whether users can choose (USER_CONTROL).`);
    } else {
      set(usageQuestion(tr, u.userControl), a.required ? u.controlRequired : u.controlOptional, 'true', `${where}.required`);
    }

    const purposeIds = (list, field) => {
      if (!Array.isArray(list) || list.length === 0) {
        problems.push(`${where}.${field} is ${JSON.stringify(list)}; a declared type must name at least one purpose.`);
        return [];
      }
      const out = [];
      for (const p of list) {
        const id = idMap.purposes[p];
        if (!id) problems.push(`${where}.${field} names purpose ${JSON.stringify(p)}, which has no entry in PLAY_ID_MAP.purposes.`);
        else out.push([p, id]);
      }
      return out;
    };
    const collectionPurposes = collected ? purposeIds(a.purposes, 'purposes') : [];
    for (const [p, id] of collectionPurposes) set(usageQuestion(tr, u.collectionPurpose), id, 'true', `${where}.purposes "${p}"`);
    // data-safety.json records ONE purpose list, and Play asks collection and sharing purposes
    // separately. A shared type therefore needs its own `sharingPurposes`; reusing `purposes`
    // would be an answer nobody swore.
    const sharingPurposes = shared ? purposeIds(a.sharingPurposes, 'sharingPurposes') : [];
    for (const [p, id] of sharingPurposes) set(usageQuestion(tr, u.sharingPurpose), id, 'true', `${where}.sharingPurposes "${p}"`);

    declared.push({
      type: name,
      collected,
      shared,
      ephemeral: collected ? a.ephemeral : null,
      required: a.required,
      purposes: collectionPurposes.map(([p]) => p),
      sharingPurposes: sharingPurposes.map(([p]) => p),
    });
  }

  set(idMap.collectsPersonalData, '', String(declared.length > 0), 'answers (any type collected or shared)');

  const sec = ds.dataSecurity ?? {};
  const d = idMap.dataSecurity;
  const bool = (path, v) => {
    if (typeof v !== 'boolean') problems.push(`data-safety.json ${path} is ${JSON.stringify(v)}; the form needs true or false.`);
    return v;
  };
  const enc = bool('dataSecurity.encryptedInTransit.answer', sec.encryptedInTransit?.answer);
  if (typeof enc === 'boolean') set(d.encryptedInTransit, '', String(enc), 'dataSecurity.encryptedInTransit');
  const del = bool('dataSecurity.deletionRequestSupported.answer', sec.deletionRequestSupported?.answer);
  if (typeof del === 'boolean') set(d.deletionQuestion, del ? d.deletionYes : d.deletionNo, 'true', 'dataSecurity.deletionRequestSupported');
  const delUrl = sec.deletionRequestSupported?.webDeletionUrl;
  if (delUrl != null && !isHttps(delUrl)) problems.push(`dataSecurity.deletionRequestSupported.webDeletionUrl ${JSON.stringify(delUrl)} is not an https URL.`);
  else if (delUrl != null) set(d.accountDeletionUrl, '', delUrl, 'dataSecurity.deletionRequestSupported.webDeletionUrl');
  if (del === true && delUrl == null) problems.push('dataSecurity.deletionRequestSupported.answer is true and webDeletionUrl is absent; Play asks for the link.');
  const isr = bool('dataSecurity.independentSecurityReview.answer', sec.independentSecurityReview?.answer);
  if (typeof isr === 'boolean') set(d.independentlyValidated, '', String(isr), 'dataSecurity.independentSecurityReview');
  const fam = bool('dataSecurity.playFamiliesPolicy.answer', sec.playFamiliesPolicy?.answer);
  if (fam === true) set(d.familiesPolicy, '', 'true', 'dataSecurity.playFamiliesPolicy');

  // ── accounts ── one answer per posture, never inferred from another field.
  const acc = idMap.accounts;
  const accounts = { methods: [], outsideApp: null, outsideAppTypes: [] };
  const methods = ds.accounts?.creationMethods;
  if (!methods || typeof methods !== 'object') {
    problems.push('data-safety.json has no `accounts.creationMethods`; Play asks which account-creation methods the app supports, and an unanswered method is never guessed.');
  } else {
    for (const [k, id] of Object.entries(acc.methods)) {
      const v = methods[k]?.[posture];
      if (typeof v !== 'boolean') problems.push(`data-safety.json accounts.creationMethods.${k}["${posture}"] is ${JSON.stringify(v)}; the form needs true or false.`);
      else if (v) {
        set(acc.methodsQuestion, id, 'true', `accounts.creationMethods.${k}`);
        accounts.methods.push(k);
      }
    }
    for (const k of Object.keys(methods)) if (!(k in acc.methods)) problems.push(`accounts.creationMethods.${k} has no entry in PLAY_ID_MAP.accounts.methods.`);
    const other = ds.accounts.otherDescription;
    if (accounts.methods.includes('other')) {
      if (typeof other !== 'string' || other.trim() === '') problems.push('accounts.creationMethods.other is true and accounts.otherDescription is empty; Play asks to describe the method.');
      else set(acc.otherSpecify, '', other, 'accounts.otherDescription');
    }
  }
  const out = ds.accounts?.outsideAppAccounts;
  const outside = out?.[posture];
  if (typeof outside !== 'boolean') {
    problems.push(`data-safety.json accounts.outsideAppAccounts["${posture}"] is ${JSON.stringify(outside)}; the form needs true or false.`);
  } else {
    accounts.outsideApp = outside;
    set(acc.outsideApp, '', String(outside), 'accounts.outsideAppAccounts');
    const types = Array.isArray(out.types) ? out.types : [];
    if (outside && types.length === 0) problems.push('accounts.outsideAppAccounts is true and names no `types`; Play asks how those accounts are created.');
    if (!outside && types.length > 0) problems.push('accounts.outsideAppAccounts is false and names `types`; an answer to a question that does not apply is an invented one.');
    for (const t of outside ? types : []) {
      const id = acc.outsideAppTypes[t];
      if (!id) problems.push(`accounts.outsideAppAccounts.types names ${JSON.stringify(t)}, which has no entry in PLAY_ID_MAP.accounts.outsideAppTypes.`);
      else {
        set(acc.outsideAppTypesQuestion, id, 'true', `accounts.outsideAppAccounts.types "${t}"`);
        accounts.outsideAppTypes.push(t);
      }
    }
    if (accounts.outsideAppTypes.includes('other')) {
      if (typeof out.description !== 'string' || out.description.trim() === '') problems.push('accounts.outsideAppAccounts.types includes "other" and `description` is empty; Play asks to describe how those accounts are created.');
      else set(acc.outsideAppSpecify, '', out.description, 'accounts.outsideAppAccounts.description');
    }
  }
  if (del === true && delUrl != null && isHttps(delUrl)) set(d.dataDeletionUrl, '', delUrl, 'dataSecurity.deletionRequestSupported.webDeletionUrl (data deletion)');

  if (problems.length) throw new Refusal(problems);

  const rows = template.map((r) => ({ ...r, value: values.get(key(r.question, r.response)) ?? '' }));
  const v = validate(rows);
  if (v.length) throw new Refusal(v);
  return { csv: toCsv(rows), rows, declared, accounts, notDeclared: [...NOT_DECLARED_BY_THE_SWORN_FILE] };
}

/** The hard checks over a rendered row set. Returns problems (empty = valid). */
export function validate(rows, template = PLAY_TEMPLATE) {
  const problems = [];
  const known = new Set(template.map((r) => key(r.question, r.response)));
  const seen = new Set();
  const val = new Map();
  for (const r of rows) {
    const k = key(r.question, r.response);
    if (!known.has(k)) problems.push(`(${r.question}, ${r.response || '∅'}) is not in Play's template.`);
    if (seen.has(k)) problems.push(`(${r.question}, ${r.response || '∅'}) is rendered twice.`);
    seen.add(k);
    if (r.value !== '') val.set(k, r.value);
  }
  for (const t of template) if (!seen.has(key(t.question, t.response))) problems.push(`(${t.question}, ${t.response || '∅'}) is missing from the render.`);
  const get = (q, r = '') => val.get(key(q, r));

  for (const t of template) if (t.requirement === 'REQUIRED' && get(t.question, t.response) === undefined) problems.push(`REQUIRED question ${t.question} is unanswered.`);
  for (const r of rows) {
    if (r.value === '') continue;
    if (r.response !== '' && r.value !== 'true') problems.push(`(${r.question}, ${r.response}) has value ${JSON.stringify(r.value)}; a chosen response is "true" and an unchosen one is blank.`);
  }
  const singleChoice = new Map();
  for (const r of rows) if (r.requirement === 'SINGLE_CHOICE' && r.value === 'true') singleChoice.set(r.question, (singleChoice.get(r.question) ?? 0) + 1);
  for (const [q, n] of singleChoice) if (n > 1) problems.push(`SINGLE_CHOICE question ${q} has ${n} responses chosen.`);

  // Accounts: the methods question is answered, NONE stands alone, and an app that lets users create an
  // account carries the account-deletion link Play requires of it.
  const acc = PLAY_ID_MAP.accounts;
  const chosen = Object.values(acc.methods).filter((id) => get(acc.methodsQuestion, id) === 'true');
  if (chosen.length === 0) problems.push(`${acc.methodsQuestion} has no method chosen (PSL_ACM_NONE is the answer for an app without accounts).`);
  if (chosen.includes(acc.methods.none) && chosen.length > 1) problems.push(`${acc.methodsQuestion} chooses ${acc.methods.none} beside ${chosen.length - 1} method(s).`);
  if (chosen.some((id) => id !== acc.methods.none) && get(PLAY_ID_MAP.dataSecurity.accountDeletionUrl) === undefined) problems.push(`${acc.methodsQuestion} says users can create an account and ${PLAY_ID_MAP.dataSecurity.accountDeletionUrl} is blank.`);
  if ((get(acc.otherSpecify) !== undefined) !== chosen.includes(acc.methods.other)) problems.push(`${acc.otherSpecify} must be filled exactly when ${acc.methods.other} is chosen.`);
  if (get(PLAY_ID_MAP.dataSecurity.deletionQuestion, PLAY_ID_MAP.dataSecurity.deletionYes) === 'true' && get(PLAY_ID_MAP.dataSecurity.dataDeletionUrl) === undefined) problems.push(`${PLAY_ID_MAP.dataSecurity.deletionQuestion} is YES and ${PLAY_ID_MAP.dataSecurity.dataDeletionUrl} is blank.`);
  const outsideTypes = Object.values(acc.outsideAppTypes).filter((id) => get(acc.outsideAppTypesQuestion, id) === 'true');
  if (get(acc.outsideApp) !== 'true' && outsideTypes.length) problems.push(`${acc.outsideAppTypesQuestion} is answered and ${acc.outsideApp} is not true.`);
  if (get(acc.outsideApp) === 'true' && !outsideTypes.length) problems.push(`${acc.outsideApp} is true and ${acc.outsideAppTypesQuestion} is unanswered.`);

  const collects = get(PLAY_ID_MAP.collectsPersonalData) === 'true';
  if (collects && get(PLAY_ID_MAP.dataSecurity.encryptedInTransit) === undefined) problems.push(`${PLAY_ID_MAP.dataSecurity.encryptedInTransit} is unanswered and the app collects data.`);

  const u = PLAY_ID_MAP.usage;
  const declaredTypes = template.filter((t) => t.question.startsWith('PSL_DATA_TYPES_')).map((t) => [t.response, get(t.question, t.response) === 'true']);
  if (declaredTypes.some(([, on]) => on) !== collects) problems.push(`${PLAY_ID_MAP.collectsPersonalData} says ${collects} and the data-type rows disagree.`);
  for (const [tr, on] of declaredTypes) {
    const block = rows.filter((r) => r.question.startsWith(`PSL_DATA_USAGE_RESPONSES:${tr}:`) && r.value !== '');
    if (!on) {
      if (block.length) problems.push(`${tr} is not declared and ${block.length} of its usage row(s) are answered.`);
      continue;
    }
    const collected = get(usageQuestion(tr, u.collectionAndSharing), u.collected) === 'true';
    const shared = get(usageQuestion(tr, u.collectionAndSharing), u.shared) === 'true';
    if (!collected && !shared) problems.push(`${tr} is declared and neither collected nor shared.`);
    const control = block.filter((r) => r.question === usageQuestion(tr, u.userControl));
    if (control.length !== 1) problems.push(`${tr} is declared and has ${control.length} USER_CONTROL answers (exactly one is required).`);
    const cp = block.filter((r) => r.question === usageQuestion(tr, u.collectionPurpose)).length;
    const sp = block.filter((r) => r.question === usageQuestion(tr, u.sharingPurpose)).length;
    if (collected && cp === 0) problems.push(`${tr} is collected and has no collection purpose.`);
    if (!collected && cp > 0) problems.push(`${tr} is not collected and has a collection purpose.`);
    if (shared && sp === 0) problems.push(`${tr} is shared and has no sharing purpose.`);
    if (!shared && sp > 0) problems.push(`${tr} is not shared and has a sharing purpose.`);
    const eph = get(usageQuestion(tr, u.ephemeral));
    if (collected && eph !== 'true' && eph !== 'false') problems.push(`${tr} is collected and EPHEMERAL is unanswered.`);
    if (!collected && eph !== undefined) problems.push(`${tr} is not collected and EPHEMERAL is answered.`);
  }
  return problems;
}

// ── CSV, RFC 4180 ─────────────────────────────────────────────────────────────
const csvField = (s) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
export function toCsv(rows) {
  const lines = [HEADER, ...rows.map((r) => [r.question, r.response, r.value, r.requirement, r.label])];
  return lines.map((l) => l.map((f) => csvField(String(f ?? ''))).join(',')).join('\r\n') + '\r\n';
}

/** RFC 4180 parse: quoted fields, doubled quotes, CRLF or LF. Throws on an unterminated quote. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let f = '';
  let i = 0;
  let quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { f += '"'; i += 2; continue; }
      if (c === '"') { quoted = false; i++; continue; }
      f += c; i++; continue;
    }
    if (c === '"' && f === '') { quoted = true; i++; continue; }
    if (c === ',') { row.push(f); f = ''; i++; continue; }
    if (c === '\r' && s[i + 1] === '\n') i++;
    if (c === '\n' || c === '\r') { row.push(f); rows.push(row); row = []; f = ''; i++; continue; }
    f += c; i++;
  }
  if (quoted) throw new Error('unterminated quoted field');
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

/** The lead's Play Console export → a template. Its pair set must equal PLAY_TEMPLATE's exactly. */
export function templateFromExport(text) {
  const [header, ...body] = parseCsv(text);
  if (JSON.stringify(header) !== JSON.stringify(HEADER)) throw new Refusal([`the export's header is ${JSON.stringify(header)}; Play's is ${JSON.stringify(HEADER)}.`]);
  const tpl = body.filter((r) => r.length > 1 || r[0] !== '').map(([question, response, , requirement, label]) => ({ question, response: response ?? '', requirement: requirement ?? '', label: label ?? '' }));
  const ours = new Set(PLAY_TEMPLATE.map((r) => key(r.question, r.response)));
  const theirs = new Set(tpl.map((r) => key(r.question, r.response)));
  const problems = [];
  for (const r of tpl) if (!ours.has(key(r.question, r.response))) problems.push(`the export has (${r.question}, ${r.response || '∅'}), which PLAY_TEMPLATE does not — Play's template has moved; update PLAY_TEMPLATE and PLAY_ID_MAP.`);
  for (const r of PLAY_TEMPLATE) if (!theirs.has(key(r.question, r.response))) problems.push(`PLAY_TEMPLATE has (${r.question}, ${r.response || '∅'}), which the export does not.`);
  if (problems.length) throw new Refusal(problems);
  return tpl.map(Object.freeze);
}

/** --out, resolved against cwd with the platform's own path rules, so `C:\x\ds.csv`,
 *  `out\ds.csv` and `out/ds.csv` all land where a Windows shell means them to. */
export function resolveOut(out, cwd = process.cwd(), pathImpl = { resolve: resolvePath }) {
  return pathImpl.resolve(cwd, out);
}

// ── --apply ───────────────────────────────────────────────────────────────────
/** A fetch with a ceiling and no redirect-following: a redirect off the pinned host is a refusal. */
const bounded = (fetchImpl) => (url, init = {}) => fetchImpl(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

/**
 * Mint a token through submit-play's mintPlayAccessToken and POST the CSV.
 * Logs HTTP statuses only — never the token, the assertion, the key or a response body.
 */
export async function applyDataSafety({ csv, packageName, serviceAccount, fetchImpl = globalThis.fetch, log = console.log, apiOrigin = PLAY_API_ORIGIN }) {
  const f = bounded(fetchImpl);
  const token = await mintPlayAccessToken(serviceAccount, {
    keySource: `the file ${SA_FILE_ENV} names`,
    post: async (url, init) => {
      const res = await f(url, { method: 'POST', ...init });
      log(`→    token exchange → HTTP ${res.status}`);
      if (res.status !== 200) throw new Error(`token exchange answered HTTP ${res.status}.`);
      try {
        return JSON.parse(await res.text());
      } catch {
        throw new Error('token exchange answered 200 with a body that is not JSON.');
      }
    },
  });
  const url = `${apiOrigin}/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/dataSafety`;
  const res = await f(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ safetyLabels: csv }),
  });
  let googleStatus = '';
  if (res.status !== 200) {
    try {
      const s = JSON.parse(await res.text())?.error?.status;
      if (typeof s === 'string' && /^[A-Z_]+$/.test(s)) googleStatus = ` ${s}`;
    } catch {
      /* the status line is all that is printed either way */
    }
  }
  log(`→    dataSafety (POST ${url}) → HTTP ${res.status}${googleStatus}`);
  if (res.status !== 200) throw new Error(`dataSafety answered HTTP ${res.status}${googleStatus}.`);
  return res.status;
}

// ── the posture, as assert-play-declarations confirms it ──────────────────────
/** Runs the guard and returns the posture it printed as confirmed for `apps/<app>`. */
export function confirmedPosture(root, app) {
  const r = boundedSpawn(process.execPath, [join(root, GUARD_REL), '--repo-root', root], { cwd: root, label: GUARD_REL, timeoutMs: 120_000 });
  if (!r.ok) return { posture: null, status: r.status, detail: r.detail, tail: (r.stdout + r.stderr).trim().split('\n').slice(-12) };
  const esc = app.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = r.stdout.match(new RegExp(`^ok\\s+apps/${esc} — .*lane posture "([^"]+)" confirmed against (\\S+)`, 'm'));
  return { posture: m ? m[1] : null, lane: m ? m[2] : null, status: r.status, detail: m ? '' : `${GUARD_REL} exited 0 and printed no confirmed lane posture for apps/${app}.` };
}

// ── the CLI ───────────────────────────────────────────────────────────────────
if (invokedAsScript(import.meta.url)) await cli();

async function cli() {
  const argv = process.argv.slice(2);
  const opt = (o) => {
    const i = argv.indexOf(`--${o}`);
    return i !== -1 && i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };
  const APPLY = argv.includes('--apply');
  const root = resolvePath(opt('repo-root') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const fail = (code, lines) => {
    console.error('');
    console.error(code === 2 ? `FAIL COVERAGE LOST — ${lines[0]}` : `FAIL ${lines[0]}`);
    for (const l of lines.slice(1)) console.error(`     ${l}`);
    console.error('\nplay-data-safety: FAILED');
    process.exit(code);
  };
  const read = (rel) => {
    try {
      return readFileSync(join(root, rel), 'utf8');
    } catch (e) {
      if (e?.code === 'ENOENT') return null;
      throw e;
    }
  };

  const app = opt('app');
  const out = opt('out');
  if (!app || !out) fail(2, ['--app <id> and --out <file> are both required.', 'Usage: node tooling/release/play-data-safety.mjs --app <id> --out <file.csv> [--template <export.csv>] [--apply]']);
  if (!/^[a-z0-9_-]+$/.test(app)) fail(1, [`--app ${JSON.stringify(app)} is not an app id.`]);

  const register = JSON.parse(read('tooling/channel-register.json') ?? 'null');
  const dirTpl = register?.channels?.find((c) => c?.id === 'android-play')?.storeMetadataDir;
  if (typeof dirTpl !== 'string') fail(2, ['tooling/channel-register.json declares no android-play storeMetadataDir.']);
  const storeDir = dirTpl.replace('{app}', app);
  const dsRel = `${storeDir}/data-safety.json`;
  const dsText = read(dsRel);
  if (dsText === null) fail(2, [`${dsRel} does not exist — there is no sworn declaration to render.`]);
  let ds;
  try {
    ds = JSON.parse(dsText);
  } catch (e) {
    fail(1, [`${dsRel} is not valid JSON (${e.message}).`]);
  }

  const ppRel = `${storeDir}/privacy-policy-url.txt`;
  const privacyUrl = (read(ppRel) ?? '').trim();
  if (!isHttps(privacyUrl)) fail(1, [`${ppRel} does not hold an https URL (${JSON.stringify(privacyUrl)}).`]);

  // The posture: the guard's, confirmed against the .aab lane — never re-derived here.
  const c = confirmedPosture(root, app);
  if (c.posture === null) {
    fail(c.status === 1 ? 1 : 2, [
      `${GUARD_REL} did not confirm a posture for apps/${app}${c.status !== null ? ` (exit ${c.status})` : ''}.`,
      'The posture is which column of data-safety.json Play receives; it is derived by that guard from the .aab lane,',
      'and a declaration rendered from an unconfirmed column could be the wrong build. Make the guard green first.',
      ...(c.detail ? [c.detail] : []),
      ...(c.tail ?? []).map((l) => `| ${l}`),
    ]);
  }
  if (c.posture !== ds.buildPosture?.current) {
    fail(1, [`${GUARD_REL} confirmed posture "${c.posture}" and ${dsRel} buildPosture.current is ${JSON.stringify(ds.buildPosture?.current)}.`]);
  }
  console.log(`ok   posture "${c.posture}" — confirmed by ${GUARD_REL} against ${c.lane}`);

  let template = PLAY_TEMPLATE;
  const tplPath = opt('template');
  if (tplPath) {
    try {
      template = templateFromExport(readFileSync(resolveOut(tplPath), 'utf8'));
    } catch (e) {
      fail(1, e instanceof Refusal ? [`--template ${tplPath} disagrees with PLAY_TEMPLATE:`, ...e.problems] : [`--template ${tplPath} could not be read: ${e.message}`]);
    }
    console.log(`ok   template — the export's ${template.length} row(s) match PLAY_TEMPLATE pair for pair; its labels are used`);
  }

  let result;
  try {
    result = render(ds, c.posture, { template });
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    fail(1, [`${dsRel} cannot be rendered for posture "${c.posture}":`, ...e.problems]);
  }

  const outAbs = resolveOut(out);
  mkdirSync(dirname(outAbs), { recursive: true });
  writeFileSync(outAbs, result.csv);
  const answered = result.rows.filter((r) => r.value !== '').length;
  console.log(`ok   wrote ${outAbs} — ${result.rows.length} row(s), ${answered} answered`);
  console.log('');
  console.log(`Declared for posture "${c.posture}" (${result.declared.length} data type(s)):`);
  for (const d of result.declared) {
    const how = [d.collected && 'collected', d.shared && 'shared'].filter(Boolean).join(' + ');
    const purposes = [...d.purposes, ...d.sharingPurposes.map((p) => `${p} (sharing)`)].join(', ');
    console.log(`  · ${d.type} — ${how}; ${d.required ? 'required' : 'optional'}; ephemeral ${d.ephemeral}; → ${purposes}`);
  }
  const sec = ds.dataSecurity;
  console.log('Data security:');
  console.log(`  · encrypted in transit: ${sec.encryptedInTransit.answer}`);
  console.log(`  · deletion request supported: ${sec.deletionRequestSupported.answer} — account deletion URL ${sec.deletionRequestSupported.webDeletionUrl}`);
  console.log(`  · independent security review: ${sec.independentSecurityReview.answer}`);
  console.log(`  · data deletion URL: ${result.rows.find((r) => r.question === PLAY_ID_MAP.dataSecurity.dataDeletionUrl)?.value || '(blank)'}`);
  console.log(`  · Families policy badge: ${sec.playFamiliesPolicy.answer}${sec.playFamiliesPolicy.answer ? '' : ' (left blank: the question is only for apps whose target age group includes children)'}`);
  console.log('Accounts:');
  console.log(`  · creation methods: ${result.accounts.methods.map((k) => PLAY_ID_MAP.accounts.methods[k]).join(', ')}`);
  console.log(`  · accounts created outside the app: ${result.accounts.outsideApp}${result.accounts.outsideAppTypes.length ? ` (${result.accounts.outsideAppTypes.join(', ')})` : ''}`);
  const na = result.rows.filter((r) => r.value === '' && [PLAY_ID_MAP.accounts.otherSpecify, PLAY_ID_MAP.accounts.outsideAppTypesQuestion, PLAY_ID_MAP.accounts.outsideAppSpecify].includes(r.question));
  console.log(`  · left blank because they do not apply to these answers: ${[...new Set(na.map((r) => r.question))].join(', ') || 'none'}`);
  console.log(`Privacy policy (${ppRel}, set on the listing — the CSV has no row for it): ${privacyUrl}`);
  console.log(`⬜   NOT declared by ${dsRel}, left blank: ${result.notDeclared.join(', ')}`);

  if (!APPLY) {
    console.log('\nplay-data-safety: ok (dry — nothing was sent; review the CSV, then re-run with --apply)');
    return;
  }

  // ── --apply ─────────────────────────────────────────────────────────────────
  const gradleRel = `apps/${app}/android/app/build.gradle.kts`;
  const gradle = read(gradleRel);
  if (gradle === null) fail(2, [`${gradleRel} does not exist — nothing declares the package name.`]);
  const id = readGradleApplicationId(gradle, gradleRel);
  if (id.value === null) fail(id.lost ? 2 : 1, [id.missing ?? id.lost]);
  const saPath = (process.env[SA_FILE_ENV] ?? '').trim();
  if (saPath === '') fail(1, [`${SA_FILE_ENV} is not set; --apply needs the path to the service-account JSON.`]);
  let sa;
  try {
    sa = JSON.parse(readFileSync(resolveOut(saPath), 'utf8'));
  } catch (e) {
    // Never the content: the parser's message is about structure, the read's about the path.
    fail(1, [`the file ${SA_FILE_ENV} names could not be read as JSON (${e.code ?? 'parse error'}). Its content is never printed.`]);
  }
  const missing = ['type', 'client_email', 'private_key'].filter((k) => typeof sa?.[k] !== 'string' || sa[k] === '');
  if (missing.length || sa.type !== 'service_account') {
    fail(1, [`the file ${SA_FILE_ENV} names is not a service-account key (missing or wrong: ${missing.length ? missing.join(', ') : 'type'}). Only key NAMES are reported.`]);
  }
  try {
    await applyDataSafety({ csv: result.csv, packageName: id.value, serviceAccount: sa });
  } catch (e) {
    fail(1, [`--apply did not complete: ${e.message}`]);
  }
  console.log(`\nplay-data-safety: ok — Data safety declared for ${id.value}. Record declaredOn for android-play in apps/${app}/app.yaml.`);
}
