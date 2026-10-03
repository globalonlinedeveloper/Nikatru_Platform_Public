// ─────────────────────────────────────────────────────────────────────────────
// mask.ts — PII masked in free text BEFORE storage (lane feedback-intake, Do 2).
//
// The client already blurs the screenshot and scrubs opt-in logs; this is the
// server's own pass over what a person typed, because a person types their card
// number into a "billing" report. Masked, in this order (an e-mail must go before
// a UPI id, which is the same shape without the dot):
//   e-mail address          a@b.com                 → [email]
//   UPI id                  name@okhdfc             → [upi]
//   card-like               13-19 digits, spaces or dashes allowed, Luhn-valid → [card]
//   phone number            7-15 digits with an optional +, spaces, dashes, dots
//                           or brackets              → [phone]
// A digit run that is neither (a version "3.47.5", a short order code) stays.
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// A UPI VPA: handle@psp, the PSP a run of letters with no dot (okhdfc, ybl, paytm).
const UPI = /[A-Za-z0-9._-]{2,}@[A-Za-z][A-Za-z0-9]{1,}(?![A-Za-z0-9.@-])/g;
const CARD = /(?<![\d])(?:\d[ -]?){12,18}\d(?![\d])/g;
const PHONE = /(?<![\w])\+?\(?\d[\d ().-]{5,}\d(?![\w])/g;

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** `text` with every e-mail, UPI id, card-like and phone-like string masked. */
export function maskPii(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(UPI, '[upi]')
    .replace(CARD, (m) => {
      const digits = m.replace(/\D/g, '');
      return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? '[card]' : m;
    })
    .replace(PHONE, (m) => {
      const digits = m.replace(/\D/g, '');
      // A dotted version ("3.47.5") is not a phone number: dots with no other separator.
      if (/^\d+(\.\d+)+$/.test(m)) return m;
      return digits.length >= 7 && digits.length <= 15 ? '[phone]' : m;
    });
}

/** Links in `text`: an http(s) URL or a bare www. host. */
export function linkCount(text: string): number {
  return (text.match(/\bhttps?:\/\/|\bwww\./gi) ?? []).length;
}
