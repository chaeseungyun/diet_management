import { NotFoundException } from '@nestjs/common';

/**
 * 사용자 소유 리소스 접근 규칙 (NFR-04, D-06).
 * 조회 결과가 없거나 다른 사용자 소유이면 구분 없이 404 를 던진다. 403 은 쓰지 않는다.
 * 단계 1부터 모든 서비스가 `findFirst({ where: { id, userId } })` 결과에 이 함수를 적용한다.
 */
export function assertOwned<T extends { userId: string }>(
  entity: T | null | undefined,
  userId: string,
): T {
  if (!entity || entity.userId !== userId) {
    throw new NotFoundException();
  }
  return entity;
}
