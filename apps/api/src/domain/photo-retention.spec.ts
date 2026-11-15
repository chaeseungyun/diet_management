import { PHOTO_BUDGET_BYTES, photoRetentionDays } from './photo-retention';

const MB = 1024 * 1024;

describe('photoRetentionDays (DEC-069)', () => {
  it('keeps 30 days when nothing or little comes in', () => {
    expect(photoRetentionDays(0)).toEqual({ days: 30, raw: null });
    // 2명 × 6장 × 0.5 MB × 14일 = 84 MB → 3,413일
    expect(photoRetentionDays(84 * MB)).toEqual({ days: 30, raw: 3413 });
  });

  it('shortens retention as inflow grows, down to 7 days and no further', () => {
    // 하루 평균 유입 = 예산 ÷ 10 → 10일
    expect(photoRetentionDays((PHOTO_BUDGET_BYTES / 10) * 14)).toEqual({ days: 10, raw: 10 });
    expect(photoRetentionDays((PHOTO_BUDGET_BYTES / 3) * 14)).toEqual({ days: 7, raw: 3 });
  });

  it('drops to the 7-day floor when the disk is full', () => {
    expect(photoRetentionDays(0, true)).toEqual({ days: 7, raw: null });
    expect(photoRetentionDays(84 * MB, true).days).toBe(7);
  });
});
