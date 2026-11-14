import { Injectable, Logger } from '@nestjs/common';
import type { MealSlot, Product, User } from '@prisma/client';
import { todayIn } from '@diet/shared';
import { unprocessable } from '../common/errors';
import { dec } from '../common/decimal';
import { IdempotencyService } from '../common/idempotency.service';
import { addDays, fromDbDate, toDbDate } from '../domain/dates';
import {
  FORECAST_HORIZON_DAYS,
  LOW_CONFIDENCE_LOOKBACK_DAYS,
  forecastStock,
  lowConfidenceProducts,
  type ForecastItem,
  type ProductForecast,
} from '../domain/forecast';
import { Decimal, round3, toStockUnit } from '../domain/units';
import { loadPlanResolver } from '../plans/plan-loader';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService, type Db } from '../products/products.service';
import {
  AdjustmentResultDto,
  CreateAdjustmentDto,
  DepletionChangeDto,
  StockDetailDto,
  StockItemDto,
  StockMovementPageDto,
  StockOverviewDto,
} from './stock.dto';

/** 소진 알림 설정 행이 없을 때의 임박 기준 (스키마 기본값과 같다) */
const DEFAULT_DAYS_BEFORE = 3;
const MOVEMENT_PAGE_SIZE = 30;

interface StockRow {
  product: Product;
  currentStock: Decimal;
  ordered: Decimal;
  forecast: ProductForecast;
  lowConfidence: boolean;
}

interface StockSnapshot {
  today: string;
  daysBefore: number;
  rows: StockRow[];
}

/** 남은 양 현황·예측·원장·보정 (FR-03, FR-08, api.md §5, DEC-080·081). 원장은 append-only */
@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  // ---------- 예측 (저장하지 않고 조회마다 계산, D-01) ----------

  /**
   * 사용자의 제품 전체를 한 번에 예측한다. 보관한 제품은 빼되(DEC-080 8) `includeId` 는 넣는다.
   * 남은 양 목록·상세·오늘 화면·날짜 예외 저장 응답이 모두 이 결과를 쓴다.
   */
  private async snapshot(db: Db, user: User, includeId?: string): Promise<StockSnapshot> {
    const today = todayIn(user.timezone);
    const products = await db.product.findMany({
      where: {
        userId: user.id,
        ...(includeId ? { OR: [{ archivedAt: null }, { id: includeId }] } : { archivedAt: null }),
      },
      orderBy: [{ name: 'asc' }],
    });
    const ids = products.map((p) => p.id);
    const [stock, ordered, setting, lastAdjust, firstMove, items, weekly] = await Promise.all([
      this.products.stockMap(db, user.id, ids),
      this.products.orderedMap(db, user.id, products),
      db.notificationSetting.findUnique({
        where: { userId_kind: { userId: user.id, kind: 'stock_depletion' } },
      }),
      db.stockMovement.groupBy({
        by: ['productId'],
        where: { userId: user.id, productId: { in: ids }, reason: 'adjust' },
        _max: { createdAt: true },
      }),
      db.stockMovement.groupBy({
        by: ['productId'],
        where: { userId: user.id, productId: { in: ids } },
        _min: { createdAt: true },
      }),
      db.mealTemplateItem.findMany({
        where: { template: { userId: user.id } },
        select: { templateId: true, productId: true, quantity: true, unit: true },
      }),
      db.weeklySchedule.findMany({
        where: { userId: user.id },
        select: { weekday: true, slot: true, updatedAt: true },
      }),
    ]);
    const weeklyChangedOn = new Map(
      weekly.map((w) => [`${w.weekday}:${w.slot}`, todayIn(user.timezone, w.updatedAt)]),
    );

    // 제품별 기준일: 마지막 실측 보정, 없으면 첫 원장 이동 (DEC-080 4)
    const baseline = new Map<string, string>();
    for (const g of firstMove) {
      if (g._min.createdAt) baseline.set(g.productId, todayIn(user.timezone, g._min.createdAt));
    }
    for (const g of lastAdjust) {
      if (g._max.createdAt) baseline.set(g.productId, todayIn(user.timezone, g._max.createdAt));
    }
    // 기준일 뒤 날짜만 보면 되고, 너무 먼 과거는 상한으로 자른다
    const floor = addDays(today, -LOW_CONFIDENCE_LOOKBACK_DAYS);
    const earliest = [...baseline.values()].sort()[0];
    const from = earliest === undefined ? today : earliest < floor ? floor : addDays(earliest, 1);
    // 오늘 기록은 예측이 항상 필요로 한다(기준일이 오늘이면 from 은 내일이 된다)
    const readFrom = from < today ? from : today;

    const [resolver, records] = await Promise.all([
      loadPlanResolver(db, user.id, readFrom, addDays(today, FORECAST_HORIZON_DAYS - 1)),
      db.mealRecord.findMany({
        where: {
          userId: user.id,
          seq: 0,
          slot: { not: 'extra' },
          status: { in: ['eaten', 'skipped'] },
          mealDate: { gte: toDbDate(readFrom), lte: toDbDate(today) },
        },
        select: { mealDate: true, slot: true },
      }),
    ]);

    const templateItems = new Map<string, ForecastItem[]>();
    for (const i of items) {
      const list = templateItems.get(i.templateId) ?? [];
      list.push({ productId: i.productId, quantity: i.quantity, unit: i.unit });
      templateItems.set(i.templateId, list);
    }
    const recorded = new Set<string>();
    const recordedToday = new Set<MealSlot>();
    for (const r of records) {
      const date = fromDbDate(r.mealDate);
      recorded.add(`${date}:${r.slot}`);
      if (date === today) recordedToday.add(r.slot);
    }

    const daysBefore = setting?.daysBefore ?? DEFAULT_DAYS_BEFORE;
    const context = { today, activeSlots: user.activeSlots, resolver, templateItems };
    const forecasts = forecastStock({
      ...context,
      daysBefore,
      recordedToday,
      products: products.map((p) => ({
        id: p.id,
        stockUnit: p.stockUnit,
        packWeightG: p.packWeightG,
        isStockTracked: p.isStockTracked,
        currentStock: stock.get(p.id) ?? new Decimal(0),
      })),
    });
    const low = lowConfidenceProducts({ ...context, from, recorded, baseline, weeklyChangedOn });

    const rows: StockRow[] = [];
    for (const p of products) {
      const forecast = forecasts.get(p.id);
      if (!forecast) continue;
      rows.push({
        product: p,
        currentStock: stock.get(p.id) ?? new Decimal(0),
        ordered: ordered.get(p.id) ?? new Decimal(0),
        forecast,
        lowConfidence: p.isStockTracked && low.has(p.id),
      });
    }
    return { today, daysBefore, rows };
  }

  private toItem(r: StockRow): StockItemDto {
    const p = r.product;
    return {
      productId: p.id,
      name: p.name,
      brand: p.brand,
      stockUnit: p.stockUnit,
      unitLabel: p.unitLabel,
      packWeightG: p.packWeightG ? p.packWeightG.toNumber() : null,
      currentStock: p.isStockTracked ? r.currentStock.toNumber() : null,
      orderedQuantity: r.ordered.toNumber(),
      level: r.forecast.level,
      depletionDate: r.forecast.depletionDate,
      daysLeft: r.forecast.daysLeft,
      beyondHorizon: r.forecast.beyondHorizon,
      lowConfidence: r.lowConfidence,
      purchaseUrl: p.purchaseUrl,
    };
  }

  /** 할 일이 있는 것부터: 확인 필요 → 다 먹음 → 소진일 빠른 순(임박·정상) → 예측 불가 → 수량 안 셈 */
  private static order(a: StockRow, b: StockRow): number {
    const rank = (r: StockRow): number => {
      const l = r.forecast.level;
      if (l === 'check_needed') return 0;
      if (l === 'depleted') return 1;
      if (l === 'imminent' || l === 'ok') return 2;
      return l === 'unpredictable' ? 3 : 4;
    };
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    const ad = a.forecast.depletionDate ?? '9999-12-31';
    const bd = b.forecast.depletionDate ?? '9999-12-31';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.product.name.localeCompare(b.product.name, 'ko');
  }

  async overview(user: User): Promise<StockOverviewDto> {
    const snap = await this.snapshot(this.prisma, user);
    return {
      today: snap.today,
      daysBefore: snap.daysBefore,
      horizonDays: FORECAST_HORIZON_DAYS,
      items: [...snap.rows].sort(StockService.order).map((r) => this.toItem(r)),
    };
  }

  async detail(user: User, productId: string): Promise<StockDetailDto> {
    await this.products.loadOwned(this.prisma, user.id, productId);
    const snap = await this.snapshot(this.prisma, user, productId);
    const row = snap.rows.find((r) => r.product.id === productId);
    if (!row) throw new Error('owned product missing from stock snapshot');
    return {
      ...this.toItem(row),
      today: snap.today,
      daysBefore: snap.daysBefore,
      horizonDays: FORECAST_HORIZON_DAYS,
      archived: row.product.archivedAt !== null,
    };
  }

  /** 오늘 화면 ⑦: 소진 임박만, 소진일 빠른 순 (DEC-080 13) */
  async imminent(db: Db, user: User): Promise<StockItemDto[]> {
    const snap = await this.snapshot(db, user);
    return snap.rows
      .filter((r) => r.forecast.level === 'imminent')
      .sort(StockService.order)
      .map((r) => this.toItem(r));
  }

  /**
   * 계획을 바꾸는 작업 앞뒤의 소진일을 비교한다 (S-24, DEC-080 14).
   * 예측 중인 식품(임박·정상)만 대상이고, 소진일이 달라진 것만 돌려준다.
   * 안내는 덤이다: 예측 계산이 실패해도 저장(work)의 성패는 바꾸지 않고 빈 목록을 돌려준다.
   */
  async depletionChanges<T>(
    user: User,
    work: () => Promise<T>,
  ): Promise<{ result: T; changes: DepletionChangeDto[] }> {
    const dates = async () => {
      try {
        const snap = await this.snapshot(this.prisma, user);
        return new Map(
          snap.rows
            .filter((r) => r.forecast.level === 'imminent' || r.forecast.level === 'ok')
            .map((r) => [r.product.id, { name: r.product.name, date: r.forecast.depletionDate }]),
        );
      } catch (e) {
        this.logger.warn(`depletion forecast failed: ${e instanceof Error ? e.message : e}`);
        return null;
      }
    };
    const before = await dates();
    const result = await work();
    const after = before ? await dates() : null;
    const changes: DepletionChangeDto[] = [];
    if (!before || !after) return { result, changes };
    for (const [productId, a] of after) {
      const b = before.get(productId);
      // 계획에 처음 나타난(또는 사라진) 식품은 비교할 소진일이 없다
      if (!b || b.date === a.date) continue;
      changes.push({ productId, name: a.name, before: b.date, after: a.date });
    }
    return { result, changes };
  }

  // ---------- 원장 (S-41) ----------

  async movements(
    userId: string,
    productId: string,
    cursor: string | undefined,
  ): Promise<StockMovementPageDto> {
    await this.products.loadOwned(this.prisma, userId, productId);
    const rows = await this.prisma.stockMovement.findMany({
      where: { userId, productId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MOVEMENT_PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { record: { select: { mealDate: true, slot: true } } },
    });
    const page = rows.slice(0, MOVEMENT_PAGE_SIZE);
    return {
      items: page.map((m) => ({
        id: m.id,
        delta: m.delta.toNumber(),
        reason: m.reason,
        note: m.note,
        createdAt: m.createdAt.toISOString(),
        meal: m.record ? { date: fromDbDate(m.record.mealDate), slot: m.record.slot } : null,
      })),
      nextCursor: rows.length > MOVEMENT_PAGE_SIZE ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  // ---------- 남은 양 맞추기 ----------

  /**
   * 남은 양 맞추기(DEC-078). 버리거나 남에게 준 양도 이것으로 반영한다(DEC-081).
   * '이 양이 남아 있다' 라는 설정이라 같은 값을 두 번 보내도 두 번째는 차이 0 이다.
   * 차이가 0 이어도 delta=0 인 adjust 이동을 남긴다 — '세어 보니 맞았다' 가 추정 신뢰도의
   * 기준점이기 때문이다(DEC-080 4). 합계는 달라지지 않고, 단위 잠금(D-13)에도 세지 않는다.
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
        // 차이는 읽은 시점의 합계·단위 설정에 기대므로 행을 먼저 잠그고 그 뒤에 읽는다.
        // 같은 제품의 보정끼리, 그리고 진행 중인 식품 수정(PATCH)과 줄을 세운다
        await tx.$queryRaw`
          SELECT id FROM products
          WHERE id = ${productId}::uuid AND user_id = ${userId}::uuid
          FOR UPDATE`;
        const product = await this.products.loadOwned(tx, userId, productId);
        if (!product.isStockTracked) {
          throw unprocessable('PRODUCT_NOT_STOCK_TRACKED', 'product is not stock tracked');
        }

        const unit = dto.unit ?? product.stockUnit;
        const measured = toStockUnit(dec(dto.measuredQuantity), unit, product);
        if (!measured) {
          throw unprocessable('UNIT_NOT_ALLOWED', `unit ${unit} is not allowed for this product`);
        }
        const current =
          (await this.products.stockMap(tx, userId, [productId])).get(productId) ?? new Decimal(0);
        const target = round3(measured);
        const delta = target.minus(current);

        const m = await tx.stockMovement.create({
          data: {
            userId,
            productId,
            delta,
            reason: 'adjust',
            note: dto.note?.trim() || null,
          },
        });
        return {
          productId,
          delta: delta.toNumber(),
          currentStock: target.toNumber(),
          movementId: m.id,
        };
      },
    );
  }
}
