import { describe, it, expect } from 'vitest';
import { MAX_REMINDERS, MAX_REMINDER_DAY, isReminderDaysList, parseReminderDays } from '../src/reminder-days';

// ─────────────────────────────────────────────────────────────────────────────
// The `subscriptions.reminder_days` contract, read ONCE for both Workers
// (O-REMINDER-DAYS-JSON-READ-AS-NUMBER). It runs in both Workers' `npm test`,
// so the API that writes the column and the platform that reminds from it are
// graded on the same reading.
// ─────────────────────────────────────────────────────────────────────────────

describe('parseReminderDays — the stored column, read one way', () => {
  it('NULL is the account lead, [] is no reminder, a list is those days — three answers, not two', () => {
    expect(parseReminderDays(null)).toBeNull();
    expect(parseReminderDays('[]')).toEqual([]);
    expect(parseReminderDays('[7,1]')).toEqual([7, 1]);
    expect(parseReminderDays(`[0,${MAX_REMINDER_DAY}]`)).toEqual([0, MAX_REMINDER_DAY]);
  });

  it('🔴 the JSON TEXT the API writes is read, not dropped — a number-typed read is the defect this closes', () => {
    // What subscriptiontracker-api's validate() stores, byte for byte.
    expect(parseReminderDays(JSON.stringify([7]))).toEqual([7]);
    // A bare number was never what the column held; it is not a list.
    expect(parseReminderDays(7)).toBeNull();
    expect(parseReminderDays('7')).toBeNull();
  });

  it('anything outside the contract reads as NULL (the account lead), never a throw', () => {
    for (const raw of [
      'not json',
      '{"days":7}',
      '"[7]"',
      '[1.5]',
      '[-1]',
      `[${MAX_REMINDER_DAY + 1}]`,
      '[7,7]',
      `[${Array.from({ length: MAX_REMINDERS + 1 }, (_, i) => i).join(',')}]`,
      '["7"]',
      '[null]',
      '',
      undefined,
      {},
    ]) {
      expect(parseReminderDays(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});

describe('isReminderDaysList — the one test the write and the read share', () => {
  it('accepts the empty list and up to MAX_REMINDERS distinct whole days in range', () => {
    expect(isReminderDaysList([])).toBe(true);
    expect(isReminderDaysList(Array.from({ length: MAX_REMINDERS }, (_, i) => i))).toBe(true);
    expect(isReminderDaysList([MAX_REMINDER_DAY])).toBe(true);
  });

  it('refuses a non-list, a decimal, a negative, past a year, a repeat and too many', () => {
    expect(isReminderDaysList(7)).toBe(false);
    expect(isReminderDaysList(null)).toBe(false);
    expect(isReminderDaysList([1.5])).toBe(false);
    expect(isReminderDaysList([-1])).toBe(false);
    expect(isReminderDaysList([MAX_REMINDER_DAY + 1])).toBe(false);
    expect(isReminderDaysList([7, 7])).toBe(false);
    expect(isReminderDaysList(Array.from({ length: MAX_REMINDERS + 1 }, (_, i) => i))).toBe(false);
  });
});
