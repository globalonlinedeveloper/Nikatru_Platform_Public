// ─────────────────────────────────────────────────────────────────────────────
// ics.ts — THE ONE RFC 5545 WRITER (ST-R2).
//
// Every target reaches a calendar the same way: by URL. Google Calendar, Apple
// Calendar and Outlook all subscribe to an https:// or webcal:// feed, and a
// browser opens the same file as a download (`?download=1`). So there is ONE
// writer, here, and no client writes a calendar file of its own — a second
// writer is a second reading of the format that drifts from this one (A ST-K3,
// ONE PIPELINE).
//
// 🔴 NO RRULE, AND THAT IS THE DATE ENGINE RULE, NOT A SIMPLIFICATION. An RRULE
// hands the recurrence to the calendar client, and RFC 5545 §3.3.10 says a
// BYMONTHDAY that does not exist in a month is IGNORED — so a subscription billed
// on the 31st would vanish from every month without one, while the app and the
// email say Feb 28 (src/renewals.ts `advance`, which CLAMPS). Each event is one
// concrete date computed by `advance`, and the client computes nothing.
//
// What the RFC requires and this file does, each held by test/calendar-feed.test.ts:
//   · CRLF line endings (§3.1);
//   · content lines folded at 75 OCTETS, not characters, never inside a UTF-8
//     sequence, continuation lines starting with one space (§3.1);
//   · TEXT escaped: backslash, semicolon, comma, newline (§3.3.11), after the
//     control characters §3.3.11 does not allow are removed;
//   · a UID per event that is STABLE across fetches (§3.8.4.7), so a client that
//     re-reads the feed updates the event it has instead of adding a second one;
//   · all-day events: DTSTART;VALUE=DATE and an exclusive DTEND the day after
//     (§3.6.1), and one DISPLAY VALARM per lead, `lead` days before (§3.6.6).
// ─────────────────────────────────────────────────────────────────────────────

/** One all-day event. `date` is 'YYYY-MM-DD'. */
export interface IcsEvent {
  uid: string;
  date: string;
  summary: string;
  description?: string;
  /** Days before `date` each alarm fires, one VALARM per entry; `[]` for no
   *  alarm (a subscription whose `reminder_days` is `[]`). */
  alarmDaysBefore: readonly number[];
}

export interface IcsCalendar {
  /** The feed's display name (X-WR-CALNAME, read by Google, Apple and Outlook). */
  name: string;
  /** DTSTAMP for every event — the instant the feed was produced. */
  stamp: Date;
  events: IcsEvent[];
}

const CRLF = '\r\n';

/**
 * §3.1: the most octets a content line may carry, excluding the CRLF.
 *
 * @ceiling none — a limit of the file format (RFC 5545 §3.1), not a platform resource.
 */
export const ICS_MAX_LINE_OCTETS = 75;

/**
 * The control characters TEXT may not carry: every C0 control except HTAB
 * (U+0009, which §3.1's WSP allows) and the line breaks the escape below turns
 * into `\n`, plus DEL. §3.3.11's TSAFE-CHAR excludes CONTROL (§3.1), so a name a
 * person typed with a stray U+0007 made the whole feed malformed for a strict
 * reader (rv2-services-019).
 */
// eslint-disable-next-line no-control-regex
const ICS_FORBIDDEN_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** §3.3.11 TEXT escaping. Controls stripped FIRST, so nothing below sees one;
 *  then backslash, or the other escapes are doubled. */
export function escapeText(value: string): string {
  return value
    .replace(ICS_FORBIDDEN_CONTROLS, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * §3.1 folding, by UTF-8 OCTETS. The first line holds at most 75 octets; each
 * continuation line is a single space plus at most 74 more. A code point is never
 * split, so a line may end short of the limit rather than cut a character.
 */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let current = '';
  let currentOctets = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    // The leading space of a continuation line counts toward its 75.
    if (currentOctets + n > ICS_MAX_LINE_OCTETS) {
      out.push(current);
      current = ' ';
      currentOctets = 1;
    }
    current += ch;
    currentOctets += n;
  }
  out.push(current);
  return out.join(CRLF);
}

/** 'YYYY-MM-DD' → 'YYYYMMDD' (§3.3.4 DATE). Throws on anything else. */
function icsDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new RangeError(`ics: not a YYYY-MM-DD date: ${JSON.stringify(ymd)}`);
  return `${m[1]}${m[2]}${m[3]}`;
}

/** The day after 'YYYY-MM-DD', in UTC — an all-day event's exclusive DTEND. */
function nextDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** §3.3.5 DATE-TIME in UTC form: 'YYYYMMDDTHHMMSSZ'. */
function icsStamp(at: Date): string {
  return at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** §3.3.6 DURATION, negative, in whole days. Zero is "at the start". */
function beforeTrigger(days: number): string {
  return days > 0 ? `-P${days}D` : 'PT0S';
}

/** The whole VCALENDAR, CRLF-terminated, every line folded. */
export function writeCalendar(cal: IcsCalendar): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nikatru//Renewal reminders//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(cal.name)}`,
  ];
  const stamp = icsStamp(cal.stamp);
  for (const e of cal.events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeText(e.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(e.date)}`,
      `DTEND;VALUE=DATE:${icsDate(nextDay(e.date))}`,
      `SUMMARY:${escapeText(e.summary)}`,
      'TRANSP:TRANSPARENT',
    );
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    for (const days of e.alarmDaysBefore) {
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeText(e.summary)}`,
        `TRIGGER:${beforeTrigger(days)}`,
        'END:VALARM',
      );
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}
