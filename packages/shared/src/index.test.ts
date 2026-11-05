import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidTimezone, MEAL_SLOTS } from './index.js';

test('isValidTimezone accepts IANA names and rejects junk', () => {
  assert.equal(isValidTimezone('Asia/Seoul'), true);
  assert.equal(isValidTimezone('UTC'), true);
  assert.equal(isValidTimezone('Not/AZone'), false);
  assert.equal(isValidTimezone(''), false);
});

test('MEAL_SLOTS has the five slots in order', () => {
  assert.deepEqual(
    [...MEAL_SLOTS],
    ['breakfast', 'lunch', 'dinner', 'afternoon_snack', 'evening_snack'],
  );
});
