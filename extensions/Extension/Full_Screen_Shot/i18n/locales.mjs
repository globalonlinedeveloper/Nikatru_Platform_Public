/* FullShot i18n — LOCALE REGISTRY.  BUILD-TIME ONLY, never shipped.
   ------------------------------------------------------------------
   The 55 locales the Chrome Web Store accepts, in the store's own spelling
   (underscore, not hyphen).  Nothing in this file is loaded by the extension
   at runtime; it exists so _locales/make-locales.mjs can emit one directory
   per locale.

   FIELDS
     code      Chrome/CWS locale directory name.  `_locales/<code>/messages.json`.
     bcp47     The same locale as a BCP-47 tag, for Intl.PluralRules and
               Intl.NumberFormat.  Chrome writes pt_BR, Intl wants pt-BR.
     dir       'ltr' | 'rtl'.  Three locales are right-to-left: ar, fa, he.
     name      English name, for build logs only.
     native    Endonym, for build logs only.
     inherits  Optional parent locale CODE.  A locale with a parent only needs
               a translation-memory entry where it DIFFERS from the parent; the
               generator materialises a COMPLETE file by walking the chain.
               We materialise rather than lean on Chrome's own
               <lang>_<REGION> -> <lang> -> default_locale fallback so the
               emitted files are self-contained and portable to Firefox.

   Plural categories are NOT listed here.  They are resolved at build time from
   the platform's CLDR data via Intl.PluralRules — see i18n/plurals.mjs for why
   a hand-maintained table would already be wrong. */

export const LOCALES = [
  { code: 'ar',     bcp47: 'ar',     dir: 'rtl', name: 'Arabic',              native: 'العربية' },
  { code: 'am',     bcp47: 'am',     dir: 'ltr', name: 'Amharic',             native: 'አማርኛ' },
  { code: 'bg',     bcp47: 'bg',     dir: 'ltr', name: 'Bulgarian',           native: 'Български' },
  { code: 'bn',     bcp47: 'bn',     dir: 'ltr', name: 'Bengali',             native: 'বাংলা' },
  { code: 'ca',     bcp47: 'ca',     dir: 'ltr', name: 'Catalan',             native: 'Català' },
  { code: 'cs',     bcp47: 'cs',     dir: 'ltr', name: 'Czech',               native: 'Čeština' },
  { code: 'da',     bcp47: 'da',     dir: 'ltr', name: 'Danish',              native: 'Dansk' },
  { code: 'de',     bcp47: 'de',     dir: 'ltr', name: 'German',              native: 'Deutsch' },
  { code: 'el',     bcp47: 'el',     dir: 'ltr', name: 'Greek',               native: 'Ελληνικά' },
  { code: 'en',     bcp47: 'en',     dir: 'ltr', name: 'English',             native: 'English', source: true },
  { code: 'en_AU',  bcp47: 'en-AU',  dir: 'ltr', name: 'English (Australia)', native: 'English (Australia)', inherits: 'en_GB' },
  { code: 'en_GB',  bcp47: 'en-GB',  dir: 'ltr', name: 'English (UK)',        native: 'English (UK)',        inherits: 'en' },
  { code: 'en_US',  bcp47: 'en-US',  dir: 'ltr', name: 'English (US)',        native: 'English (US)',        inherits: 'en' },
  { code: 'es',     bcp47: 'es',     dir: 'ltr', name: 'Spanish',             native: 'Español' },
  { code: 'es_419', bcp47: 'es-419', dir: 'ltr', name: 'Spanish (Latin America)', native: 'Español (Latinoamérica)', inherits: 'es' },
  { code: 'et',     bcp47: 'et',     dir: 'ltr', name: 'Estonian',            native: 'Eesti' },
  { code: 'fa',     bcp47: 'fa',     dir: 'rtl', name: 'Persian',             native: 'فارسی' },
  { code: 'fi',     bcp47: 'fi',     dir: 'ltr', name: 'Finnish',             native: 'Suomi' },
  { code: 'fil',    bcp47: 'fil',    dir: 'ltr', name: 'Filipino',            native: 'Filipino' },
  { code: 'fr',     bcp47: 'fr',     dir: 'ltr', name: 'French',              native: 'Français' },
  { code: 'gu',     bcp47: 'gu',     dir: 'ltr', name: 'Gujarati',            native: 'ગુજરાતી' },
  { code: 'he',     bcp47: 'he',     dir: 'rtl', name: 'Hebrew',              native: 'עברית' },
  { code: 'hi',     bcp47: 'hi',     dir: 'ltr', name: 'Hindi',               native: 'हिन्दी' },
  { code: 'hr',     bcp47: 'hr',     dir: 'ltr', name: 'Croatian',            native: 'Hrvatski' },
  { code: 'hu',     bcp47: 'hu',     dir: 'ltr', name: 'Hungarian',           native: 'Magyar' },
  { code: 'id',     bcp47: 'id',     dir: 'ltr', name: 'Indonesian',          native: 'Indonesia' },
  { code: 'it',     bcp47: 'it',     dir: 'ltr', name: 'Italian',             native: 'Italiano' },
  { code: 'ja',     bcp47: 'ja',     dir: 'ltr', name: 'Japanese',            native: '日本語' },
  { code: 'kn',     bcp47: 'kn',     dir: 'ltr', name: 'Kannada',             native: 'ಕನ್ನಡ' },
  { code: 'ko',     bcp47: 'ko',     dir: 'ltr', name: 'Korean',              native: '한국어' },
  { code: 'lt',     bcp47: 'lt',     dir: 'ltr', name: 'Lithuanian',          native: 'Lietuvių' },
  { code: 'lv',     bcp47: 'lv',     dir: 'ltr', name: 'Latvian',             native: 'Latviešu' },
  { code: 'ml',     bcp47: 'ml',     dir: 'ltr', name: 'Malayalam',           native: 'മലയാളം' },
  { code: 'mr',     bcp47: 'mr',     dir: 'ltr', name: 'Marathi',             native: 'मराठी' },
  { code: 'ms',     bcp47: 'ms',     dir: 'ltr', name: 'Malay',               native: 'Melayu' },
  { code: 'nl',     bcp47: 'nl',     dir: 'ltr', name: 'Dutch',               native: 'Nederlands' },
  { code: 'no',     bcp47: 'no',     dir: 'ltr', name: 'Norwegian',           native: 'Norsk' },
  { code: 'pl',     bcp47: 'pl',     dir: 'ltr', name: 'Polish',              native: 'Polski' },
  { code: 'pt_BR',  bcp47: 'pt-BR',  dir: 'ltr', name: 'Portuguese (Brazil)', native: 'Português (Brasil)' },
  { code: 'pt_PT',  bcp47: 'pt-PT',  dir: 'ltr', name: 'Portuguese (Portugal)', native: 'Português (Portugal)', inherits: 'pt_BR' },
  { code: 'ro',     bcp47: 'ro',     dir: 'ltr', name: 'Romanian',            native: 'Română' },
  { code: 'ru',     bcp47: 'ru',     dir: 'ltr', name: 'Russian',             native: 'Русский' },
  { code: 'sk',     bcp47: 'sk',     dir: 'ltr', name: 'Slovak',              native: 'Slovenčina' },
  { code: 'sl',     bcp47: 'sl',     dir: 'ltr', name: 'Slovenian',           native: 'Slovenščina' },
  { code: 'sr',     bcp47: 'sr',     dir: 'ltr', name: 'Serbian',             native: 'Српски' },
  { code: 'sv',     bcp47: 'sv',     dir: 'ltr', name: 'Swedish',             native: 'Svenska' },
  { code: 'sw',     bcp47: 'sw',     dir: 'ltr', name: 'Swahili',             native: 'Kiswahili' },
  { code: 'ta',     bcp47: 'ta',     dir: 'ltr', name: 'Tamil',               native: 'தமிழ்' },
  { code: 'te',     bcp47: 'te',     dir: 'ltr', name: 'Telugu',              native: 'తెలుగు' },
  { code: 'th',     bcp47: 'th',     dir: 'ltr', name: 'Thai',                native: 'ไทย' },
  { code: 'tr',     bcp47: 'tr',     dir: 'ltr', name: 'Turkish',             native: 'Türkçe' },
  { code: 'uk',     bcp47: 'uk',     dir: 'ltr', name: 'Ukrainian',           native: 'Українська' },
  { code: 'vi',     bcp47: 'vi',     dir: 'ltr', name: 'Vietnamese',          native: 'Tiếng Việt' },
  { code: 'zh_CN',  bcp47: 'zh-CN',  dir: 'ltr', name: 'Chinese (Simplified)',  native: '简体中文' },
  { code: 'zh_TW',  bcp47: 'zh-TW',  dir: 'ltr', name: 'Chinese (Traditional)', native: '繁體中文' }
];

export const BY_CODE = new Map(LOCALES.map(l => [l.code, l]));
export const RTL = LOCALES.filter(l => l.dir === 'rtl').map(l => l.code);

/* The chain a locale resolves through, most specific first.
   en_AU -> en_GB -> en.  Cycles throw rather than hang. */
export function chain(code) {
  const out = [];
  let cur = code;
  while (cur) {
    if (out.includes(cur)) throw new Error('inherits cycle at ' + code + ': ' + out.join(' -> ') + ' -> ' + cur);
    out.push(cur);
    const l = BY_CODE.get(cur);
    if (!l) throw new Error('unknown locale code in inherits chain: ' + cur);
    cur = l.inherits;
  }
  return out;
}
