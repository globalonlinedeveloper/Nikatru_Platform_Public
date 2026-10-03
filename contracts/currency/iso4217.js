// ─────────────────────────────────────────────────────────────────────────────
// iso4217.js — THE ONE ISO 4217 TABLE: every currency code a price may carry,
// and how many minor-unit digits it has. Plain ES module, no build step.
//
// ⏱ 2026-10-01 · lane fix-st-api-bounds (rv2-services-030, and #1118 review
// finding 3). There were three answers to "how many decimals does this currency
// have", and they disagreed:
//   · packages/core money.dart knew JPY 0 and KWD 3 and called everything else 2;
//   · services/platform/src/lib/reminders.ts carried ISO's full exception list;
//   · services/subscriptiontracker-api accepted ANY three letters (`ZZZ`) and
//     never checked `price_minor` against `price`.
// So a KRW plan written by the app as minor = price × 100 printed 100× too high
// in reminder mail, and a BHD plan 10× too low. Now:
//   · services/subscriptiontracker-api imports this file: a code not in it is a
//     400, and `price_minor` must equal round(price × 10^digits);
//   · services/platform's reminder formatter imports this file;
//   · packages/core reads the GENERATED Dart view (generate-dart.mjs writes
//     packages/core/lib/src/money/iso4217.g.dart; `--check` reds a drift).
//
// THE LIST: ISO 4217 List One, every code with a minor unit (the codes whose
// minor unit ISO publishes as "N.A." — precious metals, XDR, XSU, XUA, the
// bond-market units XBA-XBD, the test code XTS and XXX — are not money a
// subscription is priced in, so they are absent and refused). Three codes ISO
// has since replaced are KEPT so a device still set to one is not refused:
// ANG (replaced by XCG, 2025), CUC (no longer circulating) and SLL (replaced by
// SLE, 2023). HRK and ZWL are not: their successors (EUR, ZWG) are here and no
// price is quoted in them any more.
// ─────────────────────────────────────────────────────────────────────────────

/** Minor-unit digits by ISO 4217 alphabetic code (upper case). Frozen. */
export const MINOR_UNIT_DIGITS = Object.freeze({
  AED: 2, AFN: 2, ALL: 2, AMD: 2, ANG: 2, AOA: 2, ARS: 2, AUD: 2, AWG: 2, AZN: 2,
  BAM: 2, BBD: 2, BDT: 2, BGN: 2, BHD: 3, BIF: 0, BMD: 2, BND: 2, BOB: 2, BOV: 2,
  BRL: 2, BSD: 2, BTN: 2, BWP: 2, BYN: 2, BZD: 2,
  CAD: 2, CDF: 2, CHE: 2, CHF: 2, CHW: 2, CLF: 4, CLP: 0, CNY: 2, COP: 2, COU: 2,
  CRC: 2, CUC: 2, CUP: 2, CVE: 2, CZK: 2,
  DJF: 0, DKK: 2, DOP: 2, DZD: 2,
  EGP: 2, ERN: 2, ETB: 2, EUR: 2,
  FJD: 2, FKP: 2,
  GBP: 2, GEL: 2, GHS: 2, GIP: 2, GMD: 2, GNF: 0, GTQ: 2, GYD: 2,
  HKD: 2, HNL: 2, HTG: 2, HUF: 2,
  IDR: 2, ILS: 2, INR: 2, IQD: 3, IRR: 2, ISK: 0,
  JMD: 2, JOD: 3, JPY: 0,
  KES: 2, KGS: 2, KHR: 2, KMF: 0, KPW: 2, KRW: 0, KWD: 3, KYD: 2, KZT: 2,
  LAK: 2, LBP: 2, LKR: 2, LRD: 2, LSL: 2, LYD: 3,
  MAD: 2, MDL: 2, MGA: 2, MKD: 2, MMK: 2, MNT: 2, MOP: 2, MRU: 2, MUR: 2, MVR: 2,
  MWK: 2, MXN: 2, MXV: 2, MYR: 2, MZN: 2,
  NAD: 2, NGN: 2, NIO: 2, NOK: 2, NPR: 2, NZD: 2,
  OMR: 3,
  PAB: 2, PEN: 2, PGK: 2, PHP: 2, PKR: 2, PLN: 2, PYG: 0,
  QAR: 2,
  RON: 2, RSD: 2, RUB: 2, RWF: 0,
  SAR: 2, SBD: 2, SCR: 2, SDG: 2, SEK: 2, SGD: 2, SHP: 2, SLE: 2, SLL: 2, SOS: 2,
  SRD: 2, SSP: 2, STN: 2, SVC: 2, SYP: 2, SZL: 2,
  THB: 2, TJS: 2, TMT: 2, TND: 3, TOP: 2, TRY: 2, TTD: 2, TWD: 2, TZS: 2,
  UAH: 2, UGX: 0, USD: 2, USN: 2, UYI: 0, UYU: 2, UYW: 4, UZS: 2,
  VED: 2, VES: 2, VND: 0, VUV: 0,
  WST: 2,
  XAF: 0, XCD: 2, XCG: 2, XOF: 0, XPF: 0,
  YER: 2,
  ZAR: 2, ZMW: 2, ZWG: 2,
});

/** True when [code] is a code in the table, exactly as written (upper case). */
export function isIso4217(code) {
  return typeof code === 'string' && Object.hasOwn(MINOR_UNIT_DIGITS, code);
}

/** The minor-unit digits of [code] (upper case), or null for a code not in the table. */
export function minorUnitDigits(code) {
  return isIso4217(code) ? MINOR_UNIT_DIGITS[code] : null;
}

/**
 * The exact minor-unit count a decimal [price] is in [code]: round(price × 10^digits),
 * or null for a code not in the table. The ONE rounding rule: the ST API checks
 * a client's `price_minor` against it, and core's `Money.fromMajorUnits` is the
 * same arithmetic (`(major * 10^digits).round()`).
 */
export function toMinorUnits(price, code) {
  const digits = minorUnitDigits(code);
  return digits === null ? null : Math.round(price * 10 ** digits);
}
