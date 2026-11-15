import { PHOTO_MAX_RETENTION_DAYS, PHOTO_MIN_RETENTION_DAYS } from '@diet/shared';

/** 사진 디스크 예산 20 GB (DEC-069) */
export const PHOTO_BUDGET_BYTES = 20_480 * 1024 * 1024;
/** 유입량을 보는 기간(일) */
export const PHOTO_INFLOW_WINDOW_DAYS = 14;
/** 디스크 사용률이 이 값을 넘으면 정리 트리거 (DEC-069) */
export const PHOTO_DISK_USAGE_LIMIT = 0.8;

/**
 * 보관 일수 = clamp(7, 30, floor(예산 ÷ 최근 14일 일평균 유입)) (DEC-069).
 * `raw` 는 자르기 전 값이고 유입이 없으면 null(제한 없음)이다.
 * 디스크가 찼으면(80 % 초과) 유입량과 무관하게 하한 7일로 내린다. 7일 아래로는 내리지 않는다.
 */
export function photoRetentionDays(
  inflowBytes: number,
  diskFull = false,
): { days: number; raw: number | null } {
  const raw =
    inflowBytes > 0
      ? Math.floor(PHOTO_BUDGET_BYTES / (inflowBytes / PHOTO_INFLOW_WINDOW_DAYS))
      : null;
  if (diskFull) return { days: PHOTO_MIN_RETENTION_DAYS, raw };
  const days =
    raw === null
      ? PHOTO_MAX_RETENTION_DAYS
      : Math.min(PHOTO_MAX_RETENTION_DAYS, Math.max(PHOTO_MIN_RETENTION_DAYS, raw));
  return { days, raw };
}
