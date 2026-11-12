import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { unprocessable } from '../common/errors';
import type { Prisma, Product, Purchase, PurchaseStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService, type Tx } from '../common/idempotency.service';
import { dec } from '../common/decimal';
import { toDbDate } from '../domain/dates';
import { ProductsService } from '../products/products.service';
import {
  CreatePurchaseDto,
  CreateReceiptDto,
  PurchaseDto,
  ReceiptDto,
  ReceivePurchaseDto,
  UpdatePurchaseDto,
} from './purchases.dto';

const include = { product: true, receipts: true } as const;
type Db = Prisma.TransactionClient | PrismaService;

/** 구매·입고 (FR-03, D-11, S-34, S-35). 입고는 StockReceipt + StockMovement(receipt) 1 트랜잭션 */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly products: ProductsService,
  ) {}

  private async loadOwned(db: Db, userId: string, id: string) {
    const p = await db.purchase.findFirst({ where: { id, userId }, include });
    if (!p) throw new NotFoundException();
    return p;
  }

  async list(userId: string, status: PurchaseStatus | undefined): Promise<PurchaseDto[]> {
    const rows = await this.prisma.purchase.findMany({
      where: { userId, ...(status ? { status } : {}) },
      include,
      orderBy: [{ purchasedOn: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(PurchaseDto.from);
  }

  async create(
    userId: string,
    dto: CreatePurchaseDto,
    idemKey: string | undefined,
  ): Promise<PurchaseDto> {
    if (dto.receivedQuantity !== undefined && !dto.received) {
      throw new UnprocessableEntityException('receivedQuantity requires received=true');
    }
    return this.idempotency.run(userId, idemKey, { op: 'purchases.create', dto }, async (tx) => {
      const product = await this.products.loadOwned(tx, userId, dto.productId);
      if (product.archivedAt) throw unprocessable('PRODUCT_ARCHIVED', 'product is archived');
      const purchase = await tx.purchase.create({
        data: {
          userId,
          productId: product.id,
          quantity: dec(dto.quantity),
          purchasedOn: toDbDate(dto.purchasedOn),
          price: dec(dto.price ?? null),
          url: dto.url || null,
          status: 'ordered',
        },
      });
      if (dto.received) {
        await this.receiveInTx(tx, userId, purchase, product, dto.receivedQuantity);
      }
      return PurchaseDto.from(await this.loadOwned(tx, userId, purchase.id));
    });
  }

  async update(userId: string, id: string, dto: UpdatePurchaseDto): Promise<PurchaseDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const p = await this.loadOwned(tx, userId, id);
      if (p.status !== 'ordered') {
        throw unprocessable('PURCHASE_NOT_ORDERED', 'only ordered purchases can be edited');
      }
      await tx.purchase.update({
        where: { id },
        data: {
          ...(dto.quantity !== undefined ? { quantity: dec(dto.quantity) } : {}),
          ...(dto.purchasedOn !== undefined ? { purchasedOn: toDbDate(dto.purchasedOn) } : {}),
          ...(dto.price !== undefined ? { price: dec(dto.price) } : {}),
          ...(dto.url !== undefined ? { url: dto.url || null } : {}),
        },
      });
      return this.loadOwned(tx, userId, id);
    });
    return PurchaseDto.from(updated);
  }

  /** 받았음: 입고 수량 기본값 = 구매 수량 × units_per_package, 요청으로 덮어쓰기 가능 (D-11) */
  async receive(
    userId: string,
    id: string,
    dto: ReceivePurchaseDto,
    idemKey: string | undefined,
  ): Promise<PurchaseDto> {
    return this.idempotency.run(
      userId,
      idemKey,
      { op: 'purchases.receive', id, dto },
      async (tx) => {
        const p = await this.loadOwned(tx, userId, id);
        if (p.status !== 'ordered') {
          throw unprocessable('PURCHASE_NOT_ORDERED', 'purchase is not in ordered state');
        }
        await this.receiveInTx(tx, userId, p, p.product, dto.quantity);
        return PurchaseDto.from(await this.loadOwned(tx, userId, id));
      },
    );
  }

  private async receiveInTx(
    tx: Tx,
    userId: string,
    purchase: Purchase,
    product: Product,
    quantityOverride: number | undefined,
  ): Promise<void> {
    const quantity =
      quantityOverride !== undefined
        ? dec(quantityOverride)
        : purchase.quantity.mul(product.unitsPerPackage);
    const receipt = await tx.stockReceipt.create({
      data: { userId, productId: product.id, purchaseId: purchase.id, quantity },
    });
    // 소스(재고 비관리)는 원장에 기록하지 않는다 (D-09)
    if (product.isStockTracked && !quantity.isZero()) {
      await tx.stockMovement.create({
        data: {
          userId,
          productId: product.id,
          delta: quantity,
          reason: 'receipt',
          receiptId: receipt.id,
        },
      });
    }
    await tx.purchase.update({ where: { id: purchase.id }, data: { status: 'received' } });
  }

  async cancel(userId: string, id: string): Promise<PurchaseDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const p = await this.loadOwned(tx, userId, id);
      if (p.status !== 'ordered') {
        throw unprocessable('PURCHASE_NOT_ORDERED', 'only ordered purchases can be cancelled');
      }
      await tx.purchase.update({ where: { id }, data: { status: 'cancelled' } });
      return this.loadOwned(tx, userId, id);
    });
    return PurchaseDto.from(updated);
  }

  /** 구매 이력 없는 기존 보유분 초기 등록 (FR-03 제안, reason initial) */
  async createInitialReceipt(
    userId: string,
    dto: CreateReceiptDto,
    idemKey: string | undefined,
  ): Promise<ReceiptDto> {
    return this.idempotency.run(userId, idemKey, { op: 'receipts.create', dto }, async (tx) => {
      const product = await this.products.loadOwned(tx, userId, dto.productId);
      if (!product.isStockTracked) {
        throw unprocessable('PRODUCT_NOT_STOCK_TRACKED', 'product is not stock tracked');
      }
      const receipt = await this.products.createInitialReceipt(
        tx,
        userId,
        product.id,
        dec(dto.quantity),
        dto.note?.trim() || null,
      );
      return ReceiptDto.from(receipt);
    });
  }
}
