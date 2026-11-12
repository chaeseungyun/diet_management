import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { conflict, unprocessable } from '../common/errors';
import {
  Prisma,
  type DayCompletion,
  type MealItemSnapshot,
  type MealRecord,
  type Product,
  type ProductNutritionVersion,
  type User,
} from '@prisma/client';
import { MEAL_SLOTS, todayIn, type AnySlot, type MealSlot } from '@diet/shared';
import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService, type Tx } from '../common/idempotency.service';
import { assertRange } from '../common/validators';
import { dec } from '../common/decimal';
import { eachDate, fromDbDate, toDbDate } from '../domain/dates';
import { NO_PLAN, type PlanResolver, type ResolvedPlan } from '../domain/plan';
import { convertQuantity, Decimal, isAllowedUnit, toStockUnit } from '../domain/units';
import {
  addTotals,
  computeNutrition,
  sumNutrition,
  type NutritionTotals,
  type NutritionValues,
} from '../domain/nutrition';
import { ProductsService } from '../products/products.service';
import { TemplatesService, type TemplateView } from '../templates/templates.service';
import { PlansService } from '../plans/plans.service';
import { GoalsService } from '../goals/goals.service';
import { GoalDto } from '../goals/goals.dto';
import { WeightsService } from '../weights/weights.service';
import { WeightDto } from '../weights/weights.dto';
import {
  CompleteDayDto,
  DayCompletionCheckDto,
  DayCompletionDto,
  DayDto,
  DaySummaryDto,
  MealItemDto,
  MealRecordDto,
  PutMealRecordDto,
  type CompletionBlocker,
  type RecordContext,
} from './meals.dto';

type Db = Prisma.TransactionClient | PrismaService;
type SnapshotWithProduct = MealItemSnapshot & { product: Product | null };
type RecordWithItems = MealRecord & { items: SnapshotWithProduct[] };

/** 보이는 끼니 하나의 계산 결과 (계획·기록·DTO) */
interface EvaluatedSlot {
  slot: MealSlot;
  plan: ResolvedPlan;
  record: RecordWithItems | null;
  dto: MealRecordDto;
}

/** 하루 계산 결과. 오늘 화면·완료 판정·(단계 2) 통계가 같은 값을 쓴다 (D-01) */
interface DayEvaluation {
  slots: EvaluatedSlot[];
  extras: MealRecordDto[];
  recorded: NutritionTotals;
  expected: NutritionTotals;
  nextSlot: MealSlot | null;
  hasOverride: boolean;
  completion: DayCompletion | null;
}

const include = {
  items: { include: { product: true }, orderBy: { sortOrder: 'asc' as const } },
} as const;

const ZERO: NutritionTotals = {
  kcal: new Decimal(0),
  carbG: new Decimal(0),
  proteinG: new Decimal(0),
  fatG: new Decimal(0),
  complete: true,
  missing: 0,
};

/** 계획은 있지만 추정할 수 없음(외부 식사 예정) → 예상 합계에 '미상 1건' */

/**
 * 식사 기록 (FR-05, FR-06, D-01, D-04, D-08, D-10, NFR-02).
 * 쓰기는 "상태 설정"이며, 서버가 이전 스냅샷과의 차이로 원장 이동(consume_reverse → consume)을 만든다.
 * 식사 상태 변경·스냅샷·재고 변경·완료 해제는 한 트랜잭션이다.
 */
@Injectable()
export class MealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly products: ProductsService,
    private readonly templates: TemplatesService,
    private readonly plans: PlansService,
    private readonly goals: GoalsService,
    private readonly weights: WeightsService,
  ) {}

  // ---------- 조회 ----------

  async getRecord(user: User, date: string, slot: MealSlot): Promise<MealRecordDto> {
    const resolver = await this.plans.loadResolver(this.prisma, user.id, date, date);
    const plan = resolver.resolve(date, slot);
    const record = await this.prisma.mealRecord.findUnique({
      where: {
        userId_mealDate_slot_seq: { userId: user.id, mealDate: toDbDate(date), slot, seq: 0 },
      },
      include,
    });
    return this.toDto(this.prisma, user.id, record, { date, slot, plan });
  }

  async getDay(user: User, date: string): Promise<DayDto> {
    const [ev, goal, weight] = await Promise.all([
      this.evaluateDay(this.prisma, user, date),
      this.goals.effectiveGoal(this.prisma, user.id, date),
      this.weights.forDate(user.id, date),
    ]);
    return {
      date,
      isToday: date === todayIn(user.timezone),
      slots: ev.slots.map((s) => s.dto),
      extras: ev.extras,
      nutrition: {
        recorded: this.totalsDto(ev.recorded),
        expected: this.totalsDto(ev.expected),
        goal: goal ? GoalDto.from(goal, true) : null,
      },
      nextSlot: ev.nextSlot,
      weight: weight ? WeightDto.from(weight) : null,
      completion: ev.completion ? DayCompletionDto.from(ev.completion) : null,
      completionCheck: this.checkFrom(user, date, ev),
      hasOverride: ev.hasOverride,
    };
  }

  /** 하루의 보이는 끼니·추가 간식·합계를 한 번 계산한다 */
  private async evaluateDay(db: Db, user: User, date: string): Promise<DayEvaluation> {
    const today = todayIn(user.timezone);
    const mealDate = toDbDate(date);
    const [resolver, records, completion] = await Promise.all([
      this.plans.loadResolver(db, user.id, date, date),
      db.mealRecord.findMany({
        where: { userId: user.id, mealDate },
        include,
        orderBy: [{ slot: 'asc' }, { seq: 'asc' }],
      }),
      db.dayCompletion.findUnique({
        where: { userId_onDate: { userId: user.id, onDate: mealDate } },
      }),
    ]);
    const plans = new Map<MealSlot, ResolvedPlan>(
      MEAL_SLOTS.map((s) => [s, resolver.resolve(date, s)]),
    );
    const views = await this.templates.loadViews(
      db,
      user.id,
      [...plans.values()].map((p) => p.templateId).filter((x): x is string => Boolean(x)),
    );
    const versions = await this.products.currentNutritionMap(
      db,
      records
        .flatMap((r) => r.items.map((i) => i.productId))
        .filter((x): x is string => Boolean(x)),
    );

    const slots: EvaluatedSlot[] = [];
    let recorded = ZERO;
    let expected = ZERO;
    let nextSlot: MealSlot | null = null;
    const active = new Set<string>(user.activeSlots);
    for (const slot of MEAL_SLOTS) {
      const plan = plans.get(slot) ?? NO_PLAN;
      const record = records.find((r) => r.slot === slot && r.seq === 0) ?? null;
      // 숨긴 끼니(D-18)는 기록이 있을 때만 보인다
      if (!active.has(slot) && (!record || record.status === 'unrecorded')) continue;
      const view = plan.templateId ? views.get(plan.templateId) : undefined;
      const dto = this.assemble(
        record,
        { date, slot, plan, templateName: view?.name ?? null },
        view,
        versions,
      );
      slots.push({ slot, plan, record, dto });
      const totals = this.totalsOf(record, plan, view, versions);
      if (dto.status === 'unrecorded') {
        expected = addTotals(expected, totals);
        if (date === today && plan.planType !== 'none' && nextSlot === null) nextSlot = slot;
      } else {
        recorded = addTotals(recorded, totals);
      }
    }
    const extras = records
      .filter((r) => r.slot === 'extra')
      .map((r) => {
        const totals = this.totalsOf(r, NO_PLAN, undefined, versions);
        if (r.status === 'eaten') recorded = addTotals(recorded, totals);
        return this.assemble(
          r,
          { date, slot: 'extra', plan: NO_PLAN, templateName: null },
          undefined,
          versions,
        );
      });
    expected = addTotals(expected, recorded);

    return {
      slots,
      extras,
      recorded,
      expected,
      nextSlot,
      hasOverride: [...plans.values()].some((p) => p.source === 'override'),
      completion,
    };
  }

  // ---------- 하루 완료 (FR-06, D-04, D-18, D-19, 상태 전이 §4) ----------

  async getCompletion(user: User, date: string): Promise<DayCompletionCheckDto> {
    const ev = await this.evaluateDay(this.prisma, user, date);
    return this.checkFrom(user, date, ev);
  }

  /**
   * 하루 완료. 미래·가입 전 날짜와 식단 끼니 미기록은 422.
   * 미기록 자유 끼니는 완료를 막지 않고(D-18), skipUnrecordedFree 면 같은 트랜잭션에서
   * '안 먹음' 으로 저장한다(S-14 확인 질문의 '아니오', D-19).
   * 이미 완료된 날은 nutritionComplete 만 다시 계산한다(멱등). 완료는 목표 달성과 무관하다(D-20).
   */
  async complete(user: User, date: string, dto: CompleteDayDto): Promise<DayCompletionDto> {
    return this.prisma.$transaction(async (tx) => {
      let ev = await this.evaluateDay(tx, user, date);
      const check = this.checkFrom(user, date, ev);
      if (check.blocker === 'unrecorded') {
        throw unprocessable(
          'DAY_HAS_UNRECORDED',
          `cannot complete ${date}: unrecorded slots ${check.unrecorded.join(', ')}`,
        );
      }
      if (check.blocker) {
        throw unprocessable(
          check.blocker === 'future' ? 'FUTURE_DATE' : 'BEFORE_SIGNUP',
          `cannot complete ${date}: ${check.blocker}`,
        );
      }
      if (dto.skipUnrecordedFree && check.unrecordedFree.length > 0) {
        for (const slot of check.unrecordedFree) {
          const s = ev.slots.find((x) => x.slot === slot);
          if (!s) continue;
          const body = new PutMealRecordDto();
          body.status = 'skipped';
          body.version = s.record?.version ?? null;
          await this.write(tx, user, { date, slot, seq: 0, plan: s.plan }, s.record, body);
        }
        ev = await this.evaluateDay(tx, user, date);
      }
      const onDate = toDbDate(date);
      const row = await tx.dayCompletion.upsert({
        where: { userId_onDate: { userId: user.id, onDate } },
        create: { userId: user.id, onDate, nutritionComplete: ev.recorded.complete },
        update: { nutritionComplete: ev.recorded.complete },
      });
      return DayCompletionDto.from(row);
    });
  }

  /** 완료 해제. 없는 날도 조용히 204 */
  async uncomplete(user: User, date: string): Promise<void> {
    await this.prisma.dayCompletion.deleteMany({
      where: { userId: user.id, onDate: toDbDate(date) },
    });
  }

  /**
   * 완료 판정. 미래·가입 전 날짜는 추적 제외(상태 전이 §4).
   * 막는 것은 식단 끼니 미기록만이고, 자유 끼니 미기록은 따로 알려 준다(D-18·D-19).
   * nutritionComplete 는 기록된 합계(먹었음 + 안 먹음 0 + 추가 간식)에 미상이 없는지다.
   */
  private checkFrom(user: User, date: string, ev: DayEvaluation): DayCompletionCheckDto {
    const today = todayIn(user.timezone);
    const signup = todayIn(user.timezone, user.createdAt);
    const unrecorded = ev.slots
      .filter((s) => s.dto.status === 'unrecorded' && s.plan.planType === 'template')
      .map((s) => s.slot);
    const unrecordedFree = ev.slots
      .filter((s) => s.dto.status === 'unrecorded' && s.plan.planType === 'none')
      .map((s) => s.slot);
    let blocker: CompletionBlocker | null = null;
    if (date > today) blocker = 'future';
    else if (date < signup) blocker = 'before_signup';
    else if (unrecorded.length > 0) blocker = 'unrecorded';
    return {
      date,
      canComplete: blocker === null,
      blocker,
      slots: ev.slots.map((s) => ({
        slot: s.slot,
        planType: s.plan.planType,
        status: s.dto.status,
        counted: s.plan.planType === 'template' || s.dto.status !== 'unrecorded',
      })),
      unrecorded,
      unrecordedFree,
      nutritionComplete: ev.recorded.complete,
      missing: ev.recorded.missing,
      completion: ev.completion ? DayCompletionDto.from(ev.completion) : null,
    };
  }

  async getDays(user: User, from: string, to: string): Promise<DaySummaryDto[]> {
    assertRange(from, to, 62);
    const today = todayIn(user.timezone);
    const [resolver, records, completions] = await Promise.all([
      this.plans.loadResolver(this.prisma, user.id, from, to),
      this.prisma.mealRecord.findMany({
        where: { userId: user.id, mealDate: { gte: toDbDate(from), lte: toDbDate(to) } },
        select: { mealDate: true, slot: true, seq: true, status: true, kind: true },
      }),
      this.prisma.dayCompletion.findMany({
        where: { userId: user.id, onDate: { gte: toDbDate(from), lte: toDbDate(to) } },
        select: { onDate: true },
      }),
    ]);
    const completed = new Set(completions.map((c) => fromDbDate(c.onDate)));
    const activeSet = new Set<string>(user.activeSlots);
    const byDate = new Map<string, typeof records>();
    for (const r of records) {
      const d = fromDbDate(r.mealDate);
      byDate.set(d, [...(byDate.get(d) ?? []), r]);
    }
    return eachDate(from, to).map((date) => {
      const recs = byDate.get(date) ?? [];
      let activeSlots = 0;
      let recordedSlots = 0;
      let hasOverride = false;
      let hasOutside = false;
      for (const slot of MEAL_SLOTS) {
        const plan = resolver.resolve(date, slot);
        const rec = recs.find((r) => r.slot === slot && r.seq === 0);
        const isRecorded = Boolean(rec && rec.status !== 'unrecorded');
        // 숨긴 끼니는 기록이 있을 때만 센다 (D-18)
        if (!activeSet.has(slot) && !isRecorded) continue;
        if (plan.source === 'override') hasOverride = true;
        if (rec?.status === 'eaten' && rec.kind === 'outside') hasOutside = true;
        // 자유 끼니(none)는 미기록이면 집계 대상이 아니고, 먹었음·안 먹음이면 센다 (D-18)
        if (plan.planType === 'none' && !isRecorded) continue;
        activeSlots += 1;
        if (isRecorded) recordedSlots += 1;
      }
      return {
        date,
        completed: completed.has(date),
        hasOverride,
        hasOutside,
        activeSlots,
        recordedSlots,
        unrecordedCount: date <= today ? activeSlots - recordedSlots : null,
      };
    });
  }

  // ---------- 쓰기 ----------

  async putRecord(
    user: User,
    date: string,
    slot: MealSlot,
    dto: PutMealRecordDto,
    idemKey: string | undefined,
  ): Promise<MealRecordDto> {
    return this.idempotency.run(
      user.id,
      idemKey,
      { op: 'meal.put', date, slot, dto },
      async (tx) => {
        const resolver = await this.plans.loadResolver(tx, user.id, date, date);
        const plan = resolver.resolve(date, slot);
        const existing = await tx.mealRecord.findUnique({
          where: {
            userId_mealDate_slot_seq: { userId: user.id, mealDate: toDbDate(date), slot, seq: 0 },
          },
          include,
        });
        return this.write(tx, user, { date, slot, seq: 0, plan }, existing, dto);
      },
    );
  }

  async createExtra(
    user: User,
    date: string,
    dto: PutMealRecordDto,
    idemKey: string | undefined,
  ): Promise<MealRecordDto> {
    if (dto.version !== undefined && dto.version !== null) {
      throw new UnprocessableEntityException('version is not used when creating an extra');
    }
    return this.idempotency.run(user.id, idemKey, { op: 'extra.create', date, dto }, async (tx) => {
      const last = await tx.mealRecord.aggregate({
        where: { userId: user.id, mealDate: toDbDate(date), slot: 'extra' },
        _max: { seq: true },
      });
      const seq = (last._max.seq ?? 0) + 1;
      return this.write(tx, user, { date, slot: 'extra', seq, plan: NO_PLAN }, null, dto);
    });
  }

  async updateExtra(
    user: User,
    date: string,
    id: string,
    dto: PutMealRecordDto,
    idemKey: string | undefined,
  ): Promise<MealRecordDto> {
    return this.idempotency.run(
      user.id,
      idemKey,
      { op: 'extra.update', date, id, dto },
      async (tx) => {
        const existing = await this.loadExtra(tx, user.id, date, id);
        return this.write(
          tx,
          user,
          { date, slot: 'extra', seq: existing.seq, plan: NO_PLAN },
          existing,
          dto,
        );
      },
    );
  }

  /** 삭제 시 차감 전량 복구 (D-10) */
  async deleteExtra(user: User, date: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.loadExtra(tx, user.id, date, id);
      // 행 잠금: 동시 수정이 끝난 뒤 복구한다
      await tx.$queryRaw`SELECT id FROM meal_records WHERE id = ${existing.id}::uuid FOR UPDATE`;
      await this.reverseDeductions(tx, user.id, existing);
      await tx.mealRecord.delete({ where: { id: existing.id } });
      await tx.dayCompletion.deleteMany({ where: { userId: user.id, onDate: toDbDate(date) } });
    });
  }

  private async loadExtra(
    db: Db,
    userId: string,
    date: string,
    id: string,
  ): Promise<RecordWithItems> {
    const r = await db.mealRecord.findFirst({
      where: { id, userId, mealDate: toDbDate(date), slot: 'extra' },
      include,
    });
    if (!r) throw new NotFoundException();
    return r;
  }

  /**
   * 상태 설정의 핵심 (ERD §4-1·4-2, api.md §8 처리 순서).
   * version 비교 → 품목 검증 → 기존 차감 복구(consume_reverse) → 레코드 갱신 → 새 스냅샷 → 차감(consume) → 완료 해제.
   */
  private async write(
    tx: Tx,
    user: User,
    target: { date: string; slot: AnySlot; seq: number; plan: ResolvedPlan },
    existing: RecordWithItems | null,
    dto: PutMealRecordDto,
  ): Promise<MealRecordDto> {
    const { date, slot, seq, plan } = target;
    const version = dto.version ?? null;
    if (existing && version !== existing.version) {
      throw conflict(
        'RECORD_CONFLICT',
        `version mismatch: expected ${existing.version}, got ${version ?? 'null'}`,
      );
    }
    if (!existing && version !== null) {
      throw conflict('RECORD_CONFLICT', 'record does not exist; send version=null');
    }

    const kind = dto.kind ?? 'home';
    const eaten = dto.status === 'eaten';
    const items = eaten ? (dto.items ?? []) : [];
    if (eaten && kind === 'outside' && !dto.outsideMenu?.trim()) {
      throw unprocessable('OUTSIDE_MENU_REQUIRED', 'outsideMenu is required for an outside meal');
    }
    // 품목 없는 '먹었음' 은 의미가 없다(안 먹음으로 기록해야 한다). 외부 식사는 메뉴명만으로 가능 (DEC-057)
    if (eaten && kind === 'home' && items.length === 0) {
      throw unprocessable(
        'EMPTY_HOME_MEAL',
        'items must not be empty for an eaten home meal; use status=skipped instead',
      );
    }

    // 품목 검증: 소유 제품(404), 단위 허용(422), 수량 규칙(422)
    const products = await this.products.loadOwnedMany(
      tx,
      user.id,
      items.map((i) => i.productId),
    );
    const prepared = items.map((i, idx) => {
      const p = products.get(i.productId);
      if (!p) throw new NotFoundException();
      if (!isAllowedUnit(p, i.unit)) {
        throw unprocessable(
          'UNIT_NOT_ALLOWED',
          `unit ${i.unit} is not allowed for ${p.name} (D-02)`,
        );
      }
      let quantity: Decimal | null = dec(i.quantity ?? null);
      let estimated = false;
      if (quantity === null) {
        if (p.isStockTracked) {
          throw unprocessable('QUANTITY_REQUIRED', `quantity is required for ${p.name}`);
        }
        // 소스: 기본 추정량을 stock_unit 기준으로 쓴다 (D-09)
        if (p.defaultServingAmount !== null && i.unit === p.stockUnit) {
          quantity = p.defaultServingAmount;
          estimated = true;
        }
      }
      return { product: p, unit: i.unit, quantity, estimated, sortOrder: idx };
    });

    // 템플릿 계획량(스냅샷의 planned_quantity)
    const view = plan.templateId
      ? (await this.templates.loadViews(tx, user.id, [plan.templateId])).get(plan.templateId)
      : undefined;
    const versions = await this.products.currentNutritionMap(
      tx,
      prepared.map((x) => x.product.id),
    );

    // 1) 레코드 갱신·생성. 기존 레코드는 version 조건부 갱신으로 행을 잠근다:
    //    동시 수정은 먼저 커밋한 쪽만 통과하고 나머지는 409 (D-08, 요구사항 §7-7).
    //    원장·스냅샷은 이 잠금을 얻은 뒤에만 건드린다.
    const now = new Date();
    const outside = eaten && kind === 'outside';
    const data = {
      status: dto.status,
      kind,
      outsideMenu: outside ? dto.outsideMenu!.trim() : null,
      outsideKcal: outside ? dec(dto.outsideKcal ?? null) : null,
      outsideCarbG: outside ? dec(dto.outsideCarbG ?? null) : null,
      outsideProteinG: outside ? dec(dto.outsideProteinG ?? null) : null,
      outsideFatG: outside ? dec(dto.outsideFatG ?? null) : null,
      eatenAt: eaten ? (existing?.status === 'eaten' ? existing.eatenAt : now) : null,
    };
    let record: MealRecord;
    if (existing) {
      const updated = await tx.mealRecord.updateMany({
        where: { id: existing.id, version: existing.version },
        data: { ...data, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw conflict('RECORD_CONFLICT', 'record was modified concurrently; reload and retry');
      }
      // 2) 기존 차감 복구 → 스냅샷 제거 (잠금 이후이므로 먼저 커밋된 쓰기의 결과를 본다)
      await this.reverseDeductions(tx, user.id, existing);
      await tx.mealItemSnapshot.deleteMany({ where: { mealRecordId: existing.id } });
      record = await tx.mealRecord.findUniqueOrThrow({ where: { id: existing.id } });
    } else {
      try {
        record = await tx.mealRecord.create({
          data: {
            userId: user.id,
            mealDate: toDbDate(date),
            slot,
            seq,
            templateId: plan.templateId,
            planChanged: plan.source === 'override',
            version: 0,
            ...data,
          },
        });
      } catch (e) {
        // 동시 생성 경쟁(요구사항 §7-7): 유니크 위반은 409
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw conflict('RECORD_CONFLICT', 'record was created concurrently; reload and retry');
        }
        throw e;
      }
    }

    // 3) 새 스냅샷 + 4) 차감
    const affected = new Set<string>();
    const createdSnapshots: { id: string; productId: string }[] = [];
    for (const x of prepared) {
      const ver = versions.get(x.product.id) ?? null;
      const n = computeNutrition(ver, x.quantity, x.unit, x.product);
      const plannedItem = view?.items.find((ti) => ti.productId === x.product.id);
      const planned = plannedItem
        ? convertQuantity(plannedItem.quantity, plannedItem.unit, x.unit, x.product)
        : null;
      const snapshot = await tx.mealItemSnapshot.create({
        data: {
          mealRecordId: record.id,
          productId: x.product.id,
          productName: x.product.name,
          plannedQuantity: planned,
          actualQuantity: x.quantity,
          unit: x.unit,
          basisAmount: ver?.basisAmount ?? null,
          basisUnit: ver?.basisUnit ?? null,
          kcal: n.kcal,
          carbG: n.carbG,
          proteinG: n.proteinG,
          fatG: n.fatG,
          nutritionSource: ver ? (x.estimated ? 'manual_estimate' : ver.source) : null,
          deductsStock: x.product.isStockTracked,
          sortOrder: x.sortOrder,
        },
      });
      if (x.product.isStockTracked && x.quantity !== null) {
        const delta = toStockUnit(x.quantity, x.unit, x.product);
        if (delta && !delta.isZero()) {
          await tx.stockMovement.create({
            data: {
              userId: user.id,
              productId: x.product.id,
              delta: delta.neg(),
              reason: 'consume',
              mealItemSnapshotId: snapshot.id,
              mealRecordId: record.id,
              note: x.product.name,
            },
          });
          affected.add(x.product.id);
          createdSnapshots.push({ id: snapshot.id, productId: x.product.id });
        }
      }
    }
    // 원장이 음수가 된 제품의 스냅샷에 '재고 확인 필요' 표시 (FR-03: 저장은 막지 않는다)
    if (affected.size > 0) {
      const stock = await this.products.stockMap(tx, user.id, [...affected]);
      const negative = new Set([...stock].filter(([, v]) => v.lt(0)).map(([k]) => k));
      const flagged = createdSnapshots.filter((s) => negative.has(s.productId)).map((s) => s.id);
      if (flagged.length > 0) {
        await tx.mealItemSnapshot.updateMany({
          where: { id: { in: flagged } },
          data: { stockCheckNeeded: true },
        });
      }
    }

    // 5) 완료된 날이면 완료 해제 (D-04). 알림 skipped/pending 처리는 단계 2
    const cleared = await tx.dayCompletion.deleteMany({
      where: { userId: user.id, onDate: toDbDate(date) },
    });

    const fresh = await tx.mealRecord.findUniqueOrThrow({ where: { id: record.id }, include });
    return this.toDto(tx, user.id, fresh, {
      date,
      slot,
      plan,
      completionCleared: cleared.count > 0,
    });
  }

  /** 이 레코드가 만든 순 차감을 제품별로 complete 복구한다 (consume_reverse, +) */
  private async reverseDeductions(tx: Tx, userId: string, record: RecordWithItems): Promise<void> {
    const net = await tx.stockMovement.groupBy({
      by: ['productId'],
      where: { mealRecordId: record.id, reason: { in: ['consume', 'consume_reverse'] } },
      _sum: { delta: true },
    });
    for (const g of net) {
      const sum = g._sum.delta ?? new Decimal(0);
      if (sum.isZero()) continue;
      await tx.stockMovement.create({
        data: {
          userId,
          productId: g.productId,
          delta: sum.neg(),
          reason: 'consume_reverse',
          mealRecordId: record.id,
          note: record.items.find((i) => i.productId === g.productId)?.productName ?? null,
        },
      });
    }
  }

  // ---------- DTO 조립 ----------

  private async toDto(
    db: Db,
    userId: string,
    record: RecordWithItems | null,
    ctx: Omit<RecordContext, 'templateName'>,
  ): Promise<MealRecordDto> {
    const templateId = record?.templateId ?? ctx.plan.templateId;
    const view = templateId
      ? (await this.templates.loadViews(db, userId, [templateId])).get(templateId)
      : undefined;
    const versions = await this.products.currentNutritionMap(
      db,
      (record?.items ?? []).map((i) => i.productId).filter((x): x is string => Boolean(x)),
    );
    return this.assemble(record, { ...ctx, templateName: view?.name ?? null }, view, versions);
  }

  private assemble(
    record: RecordWithItems | null,
    ctx: RecordContext,
    view: TemplateView | undefined,
    versions: Map<string, ProductNutritionVersion>,
  ): MealRecordDto {
    const status = record?.status ?? 'unrecorded';
    let items: MealItemDto[];
    if (status === 'eaten' && record) {
      items = record.items.map((s) =>
        MealItemDto.fromSnapshot(s, s.productId ? (versions.get(s.productId) ?? null) : null),
      );
    } else if (ctx.plan.planType === 'template' && view) {
      // unrecorded·skipped 모두 계획 품목을 '예정' 으로 돌려준다. 안 먹음에서 먹었음으로 바꿀 때 기준이 된다 (DEC-057)
      items = view.items.map((i) =>
        MealItemDto.planned(i.product, i.quantity.toNumber(), i.unit, i.nutrition, i.version),
      );
    } else {
      items = [];
    }
    return MealRecordDto.build(record, ctx, items, this.totalsOf(record, ctx.plan, view, versions));
  }

  /** eaten: 스냅샷(+외부 입력), skipped: 0, unrecorded: 계획 예상(템플릿 현재 영양 / 외부 예정은 미상) */
  private totalsOf(
    record: RecordWithItems | null,
    plan: ResolvedPlan,
    view: TemplateView | undefined,
    _versions: Map<string, ProductNutritionVersion>,
  ): NutritionTotals {
    const status = record?.status ?? 'unrecorded';
    if (status === 'skipped') return ZERO;
    if (status === 'eaten' && record) {
      const parts: NutritionValues[] = record.items.map((s) => ({
        kcal: s.kcal,
        carbG: s.carbG,
        proteinG: s.proteinG,
        fatG: s.fatG,
      }));
      if (record.kind === 'outside') {
        parts.push({
          kcal: record.outsideKcal,
          carbG: record.outsideCarbG,
          proteinG: record.outsideProteinG,
          fatG: record.outsideFatG,
        });
      }
      return sumNutrition(parts);
    }
    if (plan.planType === 'template' && view)
      return sumNutrition(view.items.map((i) => i.nutrition));
    return ZERO;
  }

  private totalsDto(t: NutritionTotals) {
    return {
      kcal: t.kcal.toNumber(),
      carbG: t.carbG.toNumber(),
      proteinG: t.proteinG.toNumber(),
      fatG: t.fatG.toNumber(),
      complete: t.complete,
      missing: t.missing,
    };
  }
}
