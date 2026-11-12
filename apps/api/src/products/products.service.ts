import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { unprocessable } from '../common/errors';
import { Prisma, type Product, type ProductNutritionVersion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { dec, numReq } from '../common/decimal';
import { Decimal, isAllowedBasisUnit, isAllowedUnit } from '../domain/units';
import { computeNutrition } from '../domain/nutrition';
import {
  BackfillResultDto,
  CreateNutritionDto,
  CreateProductDto,
  NutritionSaveResultDto,
  NutritionVersionDto,
  ProductDetailDto,
  ProductDto,
  ProductPurchaseDto,
  UpdateProductDto,
} from './products.dto';

export type Db = Prisma.TransactionClient | PrismaService;

/** 제품·영양 (FR-02, D-02, D-09, D-11, D-13, S-30~S-33) */
@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- 다른 모듈이 쓰는 조회 헬퍼 (사용자 격리는 모두 여기서) ----------

  /** 소유 제품 1건. 없거나 타인 것이면 404 (D-06) */
  async loadOwned(db: Db, userId: string, id: string): Promise<Product> {
    const p = await db.product.findFirst({ where: { id, userId } });
    if (!p) throw new NotFoundException();
    return p;
  }

  /** 소유 제품 여러 건. 하나라도 없으면 404 */
  async loadOwnedMany(db: Db, userId: string, ids: string[]): Promise<Map<string, Product>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await db.product.findMany({ where: { userId, id: { in: unique } } });
    if (rows.length !== unique.length) throw new NotFoundException();
    return new Map(rows.map((p) => [p.id, p]));
  }

  async currentNutritionMap(
    db: Db,
    productIds: string[],
  ): Promise<Map<string, ProductNutritionVersion>> {
    if (productIds.length === 0) return new Map();
    const rows = await db.productNutritionVersion.findMany({
      where: { productId: { in: productIds }, supersededAt: null },
    });
    return new Map(rows.map((v) => [v.productId, v]));
  }

  /** 현재 재고 = SUM(delta) (erd §3). 이동이 없는 제품은 0 */
  async stockMap(db: Db, userId: string, productIds: string[]): Promise<Map<string, Decimal>> {
    if (productIds.length === 0) return new Map();
    const groups = await db.stockMovement.groupBy({
      by: ['productId'],
      where: { userId, productId: { in: productIds } },
      _sum: { delta: true },
    });
    return new Map(groups.map((g) => [g.productId, g._sum.delta ?? new Decimal(0)]));
  }

  /** 배송 중(ordered) 수량을 stock_unit 으로 환산한 합 */
  async orderedMap(
    db: Db,
    userId: string,
    products: readonly Product[],
  ): Promise<Map<string, Decimal>> {
    if (products.length === 0) return new Map();
    const groups = await db.purchase.groupBy({
      by: ['productId'],
      where: { userId, status: 'ordered', productId: { in: products.map((p) => p.id) } },
      _sum: { quantity: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    return new Map(
      groups.map((g) => {
        const p = byId.get(g.productId);
        const packages = g._sum.quantity ?? new Decimal(0);
        return [g.productId, p ? packages.mul(p.unitsPerPackage) : packages];
      }),
    );
  }

  private async toDtos(db: Db, userId: string, products: Product[]): Promise<ProductDto[]> {
    const ids = products.map((p) => p.id);
    const [nutrition, stock, ordered] = await Promise.all([
      this.currentNutritionMap(db, ids),
      this.stockMap(db, userId, ids),
      this.orderedMap(db, userId, products),
    ]);
    return products.map((p) =>
      ProductDto.from(p, {
        nutrition: nutrition.get(p.id) ?? null,
        currentStock: p.isStockTracked ? (stock.get(p.id) ?? new Decimal(0)).toNumber() : null,
        orderedQuantity: (ordered.get(p.id) ?? new Decimal(0)).toNumber(),
      }),
    );
  }

  // ---------- 제품 ----------

  async list(userId: string, q: string | undefined, archived: boolean): Promise<ProductDto[]> {
    const products = await this.prisma.product.findMany({
      where: {
        userId,
        archivedAt: archived ? { not: null } : null,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { brand: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ name: 'asc' }],
    });
    return this.toDtos(this.prisma, userId, products);
  }

  async get(userId: string, id: string): Promise<ProductDetailDto> {
    const product = await this.loadOwned(this.prisma, userId, id);
    const [[dto], purchases, templateItems, movement] = await Promise.all([
      this.toDtos(this.prisma, userId, [product]),
      this.prisma.purchase.findMany({
        where: { userId, productId: id },
        include: { receipts: true },
        orderBy: [{ purchasedOn: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.mealTemplateItem.findMany({
        where: { productId: id, template: { archivedAt: null } },
        include: { template: { select: { id: true, name: true } } },
      }),
      this.prisma.stockMovement.findFirst({ where: { productId: id }, select: { id: true } }),
    ]);
    const templates = new Map(templateItems.map((t) => [t.template.id, t.template]));
    return {
      ...(dto as ProductDto),
      purchases: purchases.map(ProductPurchaseDto.from),
      templates: [...templates.values()],
      stockUnitLocked: movement !== null,
    };
  }

  /** 단위 필드 정합성 (D-11). 반환값은 저장할 정규화 값 */
  private normalizeUnits(input: {
    stockUnit: Product['stockUnit'];
    unitLabel?: string | null;
    packWeightG?: number | null;
  }): {
    unitLabel: string | null;
    packWeightG: Decimal | null;
  } {
    if (input.stockUnit === 'ea') {
      const label = input.unitLabel?.trim();
      if (!label)
        throw unprocessable('UNIT_LABEL_REQUIRED', 'unitLabel is required for ea products');
      return { unitLabel: label, packWeightG: dec(input.packWeightG ?? null) };
    }
    if (input.packWeightG) {
      throw new UnprocessableEntityException('packWeightG applies only to ea products');
    }
    return { unitLabel: null, packWeightG: null };
  }

  async create(userId: string, dto: CreateProductDto): Promise<ProductDto> {
    const units = this.normalizeUnits({ ...dto, stockUnit: dto.stockUnit });
    const isStockTracked = dto.isStockTracked ?? true;
    if (!isStockTracked && dto.initialStock !== undefined) {
      throw new UnprocessableEntityException('initialStock is not allowed for untracked products');
    }
    const product = await this.prisma.$transaction(async (tx) => {
      const p = await tx.product.create({
        data: {
          userId,
          name: dto.name.trim(),
          brand: dto.brand?.trim() || null,
          stockUnit: dto.stockUnit,
          unitLabel: units.unitLabel,
          unitsPerPackage: dec(dto.unitsPerPackage ?? 1),
          packWeightG: units.packWeightG,
          isStockTracked,
          defaultServingAmount: dec(dto.defaultServingAmount ?? null),
          purchaseUrl: dto.purchaseUrl || null,
        },
      });
      if (dto.initialStock !== undefined && dto.initialStock > 0) {
        await this.createInitialReceipt(tx, userId, p.id, dec(dto.initialStock), null);
      }
      return p;
    });
    const [out] = await this.toDtos(this.prisma, userId, [product]);
    return out as ProductDto;
  }

  /** 기존 보유분 초기 등록: StockReceipt(purchase 없음) + StockMovement(initial) 1 트랜잭션 (FR-03) */
  async createInitialReceipt(
    tx: Prisma.TransactionClient,
    userId: string,
    productId: string,
    quantity: Decimal,
    note: string | null,
  ) {
    const receipt = await tx.stockReceipt.create({
      data: { userId, productId, purchaseId: null, quantity },
    });
    await tx.stockMovement.create({
      data: { userId, productId, delta: quantity, reason: 'initial', receiptId: receipt.id, note },
    });
    return receipt;
  }

  async update(userId: string, id: string, dto: UpdateProductDto): Promise<ProductDto> {
    const product = await this.prisma.$transaction(async (tx) => {
      const existing = await this.loadOwned(tx, userId, id);
      const stockUnit = dto.stockUnit ?? existing.stockUnit;
      if (stockUnit !== existing.stockUnit) {
        const moved = await tx.stockMovement.count({ where: { productId: id } });
        if (moved > 0) {
          throw unprocessable(
            'STOCK_UNIT_LOCKED',
            'stockUnit cannot change once stock movements exist (D-13)',
          );
        }
      }
      const units = this.normalizeUnits({
        stockUnit,
        unitLabel: dto.unitLabel !== undefined ? dto.unitLabel : existing.unitLabel,
        packWeightG:
          dto.packWeightG !== undefined ? dto.packWeightG : numOrNull(existing.packWeightG),
      });
      const merged = { stockUnit, packWeightG: units.packWeightG };

      // 단위 구성이 바뀌면 이미 저장된 템플릿 품목·영양 기준 단위가 허용 범위를 벗어나지 않아야 한다
      const [items, current] = await Promise.all([
        tx.mealTemplateItem.findMany({
          where: { productId: id, template: { archivedAt: null } },
          select: { unit: true },
        }),
        tx.productNutritionVersion.findFirst({ where: { productId: id, supersededAt: null } }),
      ]);
      if (items.some((i) => !isAllowedUnit(merged, i.unit))) {
        throw unprocessable(
          'UNIT_SETTINGS_IN_USE',
          'a meal template uses a unit that the new unit settings do not allow',
        );
      }
      if (current && !isAllowedBasisUnit(merged, current.basisUnit)) {
        throw unprocessable(
          'UNIT_SETTINGS_IN_USE',
          'the current nutrition basis unit is not allowed by the new unit settings',
        );
      }

      return tx.product.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.brand !== undefined ? { brand: dto.brand?.trim() || null } : {}),
          stockUnit,
          unitLabel: units.unitLabel,
          packWeightG: units.packWeightG,
          ...(dto.unitsPerPackage !== undefined
            ? { unitsPerPackage: dec(dto.unitsPerPackage) }
            : {}),
          ...(dto.isStockTracked !== undefined ? { isStockTracked: dto.isStockTracked } : {}),
          ...(dto.defaultServingAmount !== undefined
            ? { defaultServingAmount: dec(dto.defaultServingAmount) }
            : {}),
          ...(dto.purchaseUrl !== undefined ? { purchaseUrl: dto.purchaseUrl || null } : {}),
        },
      });
    });
    const [out] = await this.toDtos(this.prisma, userId, [product]);
    return out as ProductDto;
  }

  /** 보관. 보관되지 않은 템플릿이 참조하면 422 (요구사항 §7-7 권고) */
  async archive(userId: string, id: string): Promise<ProductDto> {
    const product = await this.prisma.$transaction(async (tx) => {
      await this.loadOwned(tx, userId, id);
      const used = await tx.mealTemplateItem.count({
        where: { productId: id, template: { archivedAt: null } },
      });
      if (used > 0) {
        throw unprocessable(
          'PRODUCT_IN_TEMPLATE',
          'product is used by an active meal template; remove it from the template first',
        );
      }
      return tx.product.update({ where: { id }, data: { archivedAt: new Date() } });
    });
    const [out] = await this.toDtos(this.prisma, userId, [product]);
    return out as ProductDto;
  }

  async unarchive(userId: string, id: string): Promise<ProductDto> {
    await this.loadOwned(this.prisma, userId, id);
    const product = await this.prisma.product.update({ where: { id }, data: { archivedAt: null } });
    const [out] = await this.toDtos(this.prisma, userId, [product]);
    return out as ProductDto;
  }

  // ---------- 영양 (FR-02, D-03, D-11) ----------

  async nutritionVersions(userId: string, id: string): Promise<NutritionVersionDto[]> {
    await this.loadOwned(this.prisma, userId, id);
    const rows = await this.prisma.productNutritionVersion.findMany({
      where: { productId: id },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(NutritionVersionDto.from);
  }

  /** 새 버전 저장. 이전 버전은 superseded. 과거 스냅샷은 바뀌지 않는다(NFR-02). 응답에 영양 미상 스냅샷 수(D-03 1단계) */
  async saveNutrition(
    userId: string,
    id: string,
    dto: CreateNutritionDto,
  ): Promise<NutritionSaveResultDto> {
    return this.prisma.$transaction(async (tx) => {
      const product = await this.loadOwned(tx, userId, id);
      if (!isAllowedBasisUnit(product, dto.basisUnit)) {
        throw unprocessable(
          'UNIT_NOT_ALLOWED',
          'basisUnit must equal the product stock unit, or g for ea products with packWeightG (D-11)',
        );
      }
      const now = new Date();
      await tx.productNutritionVersion.updateMany({
        where: { productId: id, supersededAt: null },
        data: { supersededAt: now },
      });
      const version = await tx.productNutritionVersion.create({
        data: {
          productId: id,
          basisAmount: dec(dto.basisAmount),
          basisUnit: dto.basisUnit,
          kcal: dec(dto.kcal ?? null),
          carbG: dec(dto.carbG ?? null),
          proteinG: dec(dto.proteinG ?? null),
          fatG: dec(dto.fatG ?? null),
          source: dto.source,
        },
      });
      const unknownSnapshotCount = await this.countUnknownSnapshots(tx, id);
      return { version: NutritionVersionDto.from(version), unknownSnapshotCount };
    });
  }

  private countUnknownSnapshots(db: Db, productId: string): Promise<number> {
    return db.mealItemSnapshot.count({
      where: {
        productId,
        kcal: null,
        actualQuantity: { not: null },
        record: { status: 'eaten' },
      },
    });
  }

  /** D-03 2단계: kcal 미상 스냅샷만 현재 버전으로 채우고 출처 backfill·시각을 남긴다. 값이 있는 스냅샷은 손대지 않는다 */
  async backfill(userId: string, id: string): Promise<BackfillResultDto> {
    return this.prisma.$transaction(async (tx) => {
      const product = await this.loadOwned(tx, userId, id);
      const version = await tx.productNutritionVersion.findFirst({
        where: { productId: id, supersededAt: null },
      });
      if (!version) throw unprocessable('NUTRITION_MISSING', 'product has no nutrition version');
      const targets = await tx.mealItemSnapshot.findMany({
        where: {
          productId: id,
          kcal: null,
          actualQuantity: { not: null },
          record: { status: 'eaten' },
        },
      });
      let updated = 0;
      let skipped = 0;
      const now = new Date();
      for (const s of targets) {
        const n = computeNutrition(version, s.actualQuantity, s.unit, product);
        if (n.kcal === null) {
          skipped += 1;
          continue;
        }
        await tx.mealItemSnapshot.update({
          where: { id: s.id },
          data: {
            basisAmount: version.basisAmount,
            basisUnit: version.basisUnit,
            kcal: n.kcal,
            carbG: n.carbG,
            proteinG: n.proteinG,
            fatG: n.fatG,
            nutritionSource: 'backfill',
            backfilledAt: now,
          },
        });
        updated += 1;
      }
      return { updated, skipped };
    });
  }
}

function numOrNull(d: Decimal | null): number | null {
  return d === null ? null : numReq(d);
}
