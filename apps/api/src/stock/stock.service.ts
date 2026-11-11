import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { dec } from '../common/decimal';
import { IdempotencyService } from '../common/idempotency.service';
import { Decimal, round3, toStockUnit } from '../domain/units';
import { ProductsService } from '../products/products.service';
import { AdjustmentResultDto, CreateAdjustmentDto } from './stock.dto';

/** 재고 보정 (FR-03, S-42, api.md §5). 원장은 append-only — 차이만큼 이동을 더한다 */
@Injectable()
export class StockService {
  constructor(
    private readonly products: ProductsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * 실측 잔량 보정 (DEC-078). 결과가 '이 양이 남아 있다' 라는 설정이라 같은 값을 두 번 보내도
   * 두 번째는 차이 0 이 되어 이동을 만들지 않는다. Idempotency-Key 는 응답 재현용이다.
   */
  async adjust(
    userId: string,
    productId: string,
    dto: CreateAdjustmentDto,
    idemKey: string | undefined,
  ): Promise<AdjustmentResultDto> {
    return this.idempotency.run(
      userId,
      idemKey,
      { op: 'stock.adjust', productId, dto },
      async (tx) => {
        const product = await this.products.loadOwned(tx, userId, productId);
        if (!product.isStockTracked) {
          throw new UnprocessableEntityException('product is not stock tracked');
        }
        // 차이는 읽은 시점의 합계에 기대므로 같은 제품의 보정끼리 줄 세운다
        await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId}::uuid FOR UPDATE`;

        const unit = dto.unit ?? product.stockUnit;
        const measured = toStockUnit(dec(dto.measuredQuantity), unit, product);
        if (!measured) {
          throw new UnprocessableEntityException(`unit ${unit} is not allowed for this product`);
        }
        const target = round3(measured);
        const current =
          (await this.products.stockMap(tx, userId, [productId])).get(productId) ??
          new Decimal(0);
        const delta = target.minus(current);

        let movementId: string | null = null;
        if (!delta.isZero()) {
          const m = await tx.stockMovement.create({
            data: {
              userId,
              productId,
              delta,
              reason: 'adjust',
              note: dto.note?.trim() || null,
            },
          });
          movementId = m.id;
        }
        return {
          productId,
          delta: delta.toNumber(),
          currentStock: target.toNumber(),
          movementId,
        };
      },
    );
  }
}
