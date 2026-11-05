import { NotFoundException } from '@nestjs/common';
import { assertOwned } from './owned';

describe('assertOwned', () => {
  const me = 'user-a';
  it('returns the entity when owned by the session user', () => {
    const row = { id: '1', userId: me };
    expect(assertOwned(row, me)).toBe(row);
  });
  it('throws 404 for a missing row', () => {
    expect(() => assertOwned(null, me)).toThrow(NotFoundException);
  });
  it('throws 404 (not 403) for a row owned by someone else', () => {
    expect(() => assertOwned({ id: '1', userId: 'user-b' }, me)).toThrow(NotFoundException);
  });
});
