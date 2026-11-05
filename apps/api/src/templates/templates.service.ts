import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  MealTemplate,
  MealTemplateItem,
  Prisma,
  Product,
  ProductNutritionVersion,
  User,
} from '@prisma/client';
import { todayIn } from '@diet/shared';
import { PrismaService } from '../prisma/prisma.service';
import { dec } from '../common/decimal';
import { toDbDate } from '../domain/dates';
import { isAllowedUnit } from '../domain/units';
import { computeNutrition, sumNutrition, type NutritionValues } from '../domain/nutrition';
import { ProductsService } from '../products/products.service';
import { PutTemplateDto, TemplateDto, TemplateItemDto, TemplateUsageDto } from './templates.dto';

type Db = Prisma.TransactionClient | PrismaService;

export type TemplateItemView = MealTemplateItem & {
  product: Product;
  nutrition: NutritionValues;
  version: ProductNutritionVersion | null;
};
export type TemplateView = MealTemplate & { items: TemplateItemView[] };

/** 식단 템플릿 (FR-04, D-02, S-20, S-21). 변경은 과거 스냅샷에 영향 없음 (NFR-02) */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  /** 템플릿 + 품목 + 제품 + 현재 영양. 계획 조회·식사 기록이 같이 쓴다. 타인 것은 제외된다 */
  async loadViews(db: Db, userId: string, ids: string[]): Promise<Map<string, TemplateView>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const templates = await db.mealTemplate.findMany({
      where: { userId, id: { in: unique } },
      include: { items: { include: { product: true }, orderBy: { sortOrder: 'asc' } } },
    });
    const productIds = templates.flatMap((t) => t.items.map((i) => i.productId));
    const versions = await this.products.currentNutritionMap(db, productIds);
    return new Map(
      templates.map((t) => [
        t.id,
        {
          ...t,
          items: t.items.map((i) => {
            const version = versions.get(i.productId) ?? null;
            return {
              ...i,
              version,
              nutrition: computeNutrition(version, i.quantity, i.unit, i.product),
            };
          }),
        },
      ]),
    );
  }

  private async usage(db: Db, userId: string, today: string, ids: string[]) {
    const [weekly, overrides] = await Promise.all([
      db.weeklySchedule.groupBy({
        by: ['templateId'],
        where: { userId, templateId: { in: ids } },
        _count: { _all: true },
      }),
      db.dateOverride.groupBy({
        by: ['templateId'],
        where: { userId, templateId: { in: ids }, onDate: { gte: toDbDate(today) } },
        _count: { _all: true },
      }),
    ]);
    const w = new Map(weekly.map((g) => [g.templateId, g._count._all]));
    const o = new Map(overrides.map((g) => [g.templateId, g._count._all]));
    return (id: string): TemplateUsageDto => ({
      weeklyCells: w.get(id) ?? 0,
      upcomingOverrides: o.get(id) ?? 0,
    });
  }

  private async toDtos(db: Db, user: User, ids: string[]): Promise<TemplateDto[]> {
    const views = await this.loadViews(db, user.id, ids);
    const usage = await this.usage(db, user.id, todayIn(user.timezone), ids);
    return ids
      .map((id) => views.get(id))
      .filter((v): v is TemplateView => Boolean(v))
      .map((v) =>
        TemplateDto.from(
          v,
          v.items.map((i) => TemplateItemDto.from(i, i.nutrition)),
          sumNutrition(v.items.map((i) => i.nutrition)),
          usage(v.id),
        ),
      );
  }

  async list(user: User, archived: boolean): Promise<TemplateDto[]> {
    const rows = await this.prisma.mealTemplate.findMany({
      where: { userId: user.id, archivedAt: archived ? { not: null } : null },
      orderBy: { name: 'asc' },
      select: { id: true },
    });
    return this.toDtos(
      this.prisma,
      user,
      rows.map((r) => r.id),
    );
  }

  async get(user: User, id: string): Promise<TemplateDto> {
    const [dto] = await this.toDtos(this.prisma, user, [id]);
    if (!dto) throw new NotFoundException();
    return dto;
  }

  /** 품목 검증: 소유 제품(404), 보관 제품·허용되지 않는 단위(422) */
  private async validateItems(tx: Prisma.TransactionClient, userId: string, dto: PutTemplateDto) {
    const products = await this.products.loadOwnedMany(
      tx,
      userId,
      dto.items.map((i) => i.productId),
    );
    for (const item of dto.items) {
      const p = products.get(item.productId);
      if (!p) throw new NotFoundException();
      if (p.archivedAt) throw new UnprocessableEntityException(`product ${p.name} is archived`);
      if (!isAllowedUnit(p, item.unit)) {
        throw new UnprocessableEntityException(
          `unit ${item.unit} is not allowed for ${p.name} (D-02: g needs packWeightG on ea products)`,
        );
      }
    }
  }

  async create(user: User, dto: PutTemplateDto): Promise<TemplateDto> {
    const id = await this.prisma.$transaction(async (tx) => {
      await this.validateItems(tx, user.id, dto);
      const t = await tx.mealTemplate.create({
        data: {
          userId: user.id,
          name: dto.name.trim(),
          items: {
            create: dto.items.map((i, idx) => ({
              productId: i.productId,
              quantity: dec(i.quantity),
              unit: i.unit,
              sortOrder: idx,
            })),
          },
        },
      });
      return t.id;
    });
    return this.get(user, id);
  }

  /** 이름·품목 전체 교체 */
  async replace(user: User, id: string, dto: PutTemplateDto): Promise<TemplateDto> {
    await this.prisma.$transaction(async (tx) => {
      const t = await tx.mealTemplate.findFirst({ where: { id, userId: user.id } });
      if (!t) throw new NotFoundException();
      await this.validateItems(tx, user.id, dto);
      await tx.mealTemplateItem.deleteMany({ where: { templateId: id } });
      await tx.mealTemplate.update({
        where: { id },
        data: {
          name: dto.name.trim(),
          items: {
            create: dto.items.map((i, idx) => ({
              productId: i.productId,
              quantity: dec(i.quantity),
              unit: i.unit,
              sortOrder: idx,
            })),
          },
        },
      });
    });
    return this.get(user, id);
  }

  /** 보관. 주간 계획·앞으로의 예외가 참조하면 422 (요구사항 §7-7 권고) */
  async archive(user: User, id: string): Promise<TemplateDto> {
    await this.prisma.$transaction(async (tx) => {
      const t = await tx.mealTemplate.findFirst({ where: { id, userId: user.id } });
      if (!t) throw new NotFoundException();
      const u = (await this.usage(tx, user.id, todayIn(user.timezone), [id]))(id);
      if (u.weeklyCells > 0 || u.upcomingOverrides > 0) {
        throw new UnprocessableEntityException(
          'template is referenced by the weekly plan or upcoming overrides; unassign it first',
        );
      }
      await tx.mealTemplate.update({ where: { id }, data: { archivedAt: new Date() } });
    });
    return this.get(user, id);
  }

  async unarchive(user: User, id: string): Promise<TemplateDto> {
    const t = await this.prisma.mealTemplate.findFirst({ where: { id, userId: user.id } });
    if (!t) throw new NotFoundException();
    await this.prisma.mealTemplate.update({ where: { id }, data: { archivedAt: null } });
    return this.get(user, id);
  }
}
