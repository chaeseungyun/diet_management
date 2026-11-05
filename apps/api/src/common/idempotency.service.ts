import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export type Tx = Prisma.TransactionClient;

const TTL_HOURS = 24;

/**
 * 쓰기 요청 멱등성 (NFR-02, erd A5, api.md §0).
 * (user, key) 행을 같은 트랜잭션 안에서 먼저 삽입하고 본 작업을 수행한 뒤 응답을 저장한다.
 * - 같은 키 재전송: 저장된 응답을 그대로 돌려주고 재차감하지 않는다.
 * - 같은 키에 다른 본문: 422.
 * - 같은 키 동시 요청: 두 번째는 첫 번째 트랜잭션이 끝날 때까지 유니크 인덱스에서 대기한 뒤 저장된 응답을 받는다(요구사항 §7-7).
 * - 본 작업이 실패하면 키 행도 롤백되어 재시도가 가능하다.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(
    userId: string,
    key: string | undefined,
    request: unknown,
    work: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    if (!key) {
      return this.prisma.$transaction((tx) => work(tx), { timeout: 15_000 });
    }
    const hash = createHash('sha256')
      .update(JSON.stringify(request ?? null))
      .digest('hex');
    const expiresAt = new Date(Date.now() + TTL_HOURS * 3600_000);

    return this.prisma.$transaction(
      async (tx) => {
        const inserted = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO idempotency_keys (user_id, key, request_hash, expires_at)
          VALUES (${userId}::uuid, ${key}, ${hash}, ${expiresAt})
          ON CONFLICT (user_id, key) DO NOTHING
          RETURNING id`;

        if (inserted.length === 0) {
          // 이미 처리됐거나 처리 중. FOR UPDATE 는 진행 중인 트랜잭션이 끝날 때까지 기다린다.
          const rows = await tx.$queryRaw<
            { request_hash: string; response_status: number | null; response_body: unknown }[]
          >`
            SELECT request_hash, response_status, response_body
            FROM idempotency_keys
            WHERE user_id = ${userId}::uuid AND key = ${key}
            FOR UPDATE`;
          const row = rows[0];
          if (!row) throw new UnprocessableEntityException('Idempotency-Key state lost');
          if (row.request_hash !== hash) {
            throw new UnprocessableEntityException(
              'Idempotency-Key was already used with a different request',
            );
          }
          return row.response_body as T;
        }

        const result = await work(tx);
        await tx.idempotencyKey.update({
          where: { userId_key: { userId, key } },
          data: {
            responseStatus: 200,
            responseBody: result as unknown as Prisma.InputJsonValue,
          },
        });
        return result;
      },
      { timeout: 15_000 },
    );
  }
}
