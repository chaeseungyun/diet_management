import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultErrorCode,
  displayUnit,
  ERROR_CODES,
  isErrorCode,
  formatQuantity,
  isValidDateString,
  isValidTimezone,
  MEAL_SLOTS,
  todayIn,
} from './index.js';

test('isValidTimezone accepts IANA names and rejects junk', () => {
  assert.equal(isValidTimezone('Asia/Seoul'), true);
  assert.equal(isValidTimezone('UTC'), true);
  assert.equal(isValidTimezone('Not/AZone'), false);
  assert.equal(isValidTimezone(''), false);
});

test('MEAL_SLOTS has the five slots in day order', () => {
  assert.deepEqual(
    [...MEAL_SLOTS],
    ['breakfast', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack'],
  );
});

test('isValidDateString checks calendar validity', () => {
  assert.equal(isValidDateString('2026-11-06'), true);
  assert.equal(isValidDateString('2026-02-30'), false);
  assert.equal(isValidDateString('2026-1-6'), false);
  assert.equal(isValidDateString('yesterday'), false);
});

test('todayIn respects the time zone boundary', () => {
  const now = new Date('2026-11-05T16:30:00Z'); // 01:30 KST on the 6th
  assert.equal(todayIn('Asia/Seoul', now), '2026-11-06');
  assert.equal(todayIn('UTC', now), '2026-11-05');
});

test('formatQuantity trims zeros and marks unknown', () => {
  assert.equal(formatQuantity(0.5), '0.5');
  assert.equal(formatQuantity(30), '30');
  assert.equal(formatQuantity(1.23456), '1.235');
  assert.equal(formatQuantity(null), '–');
});

test('displayUnit uses the label for ea products', () => {
  assert.equal(displayUnit({ stockUnit: 'ea', unitLabel: '팩' }), '팩');
  assert.equal(displayUnit({ stockUnit: 'g', unitLabel: null }), 'g');
});

test('error codes: defaults by status and membership (DEC-079)', () => {
  assert.equal(defaultErrorCode(401), 'UNAUTHENTICATED');
  assert.equal(defaultErrorCode(404), 'NOT_FOUND');
  assert.equal(defaultErrorCode(409), 'CONFLICT');
  assert.equal(defaultErrorCode(422), 'VALIDATION_FAILED');
  assert.equal(defaultErrorCode(418), 'BAD_REQUEST');
  assert.equal(defaultErrorCode(502), 'INTERNAL');
  assert.equal(isErrorCode('STOCK_UNIT_LOCKED'), true);
  assert.equal(isErrorCode('stock_unit_locked'), false);
  assert.equal(new Set(ERROR_CODES).size, ERROR_CODES.length);
  for (const c of ERROR_CODES) assert.match(c, /^[A-Z][A-Z0-9_]*$/);
});
