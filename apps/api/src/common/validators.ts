import {
  Injectable,
  NotFoundException,
  PipeTransform,
  UnprocessableEntityException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import { registerDecorator, type ValidationOptions } from 'class-validator';
import type { Request } from 'express';
import {
  IDEMPOTENCY_HEADER,
  MEAL_SLOTS,
  isValidDateString,
  isValidTimezone,
  type MealSlot,
} from '@diet/shared';

/** YYYY-MM-DD 이고 달력에 존재하는 날짜 */
export function IsCalendarDate(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isCalendarDate',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} must be a YYYY-MM-DD date`, ...options },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isValidDateString(value),
      },
    });
  };
}

/** IANA 시간대 검증 데코레이터 */
export function IsTimezone(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isTimezone',
      target: object.constructor,
      propertyName,
      options: { message: 'timezone must be a valid IANA time zone', ...options },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isValidTimezone(value),
      },
    });
  };
}

/** 경로·쿼리의 날짜 파라미터. 형식이 틀리면 422 (api.md §0 검증 실패) */
@Injectable()
export class DateParamPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isValidDateString(value)) {
      throw new UnprocessableEntityException(`invalid date: ${value}`);
    }
    return value;
  }
}

/** 선택 날짜 쿼리. 비어 있으면 undefined */
@Injectable()
export class OptionalDateParamPipe implements PipeTransform<
  string | undefined,
  string | undefined
> {
  transform(value: string | undefined): string | undefined {
    if (value === undefined || value === '') return undefined;
    if (!isValidDateString(value)) {
      throw new UnprocessableEntityException(`invalid date: ${value}`);
    }
    return value;
  }
}

/** `Idempotency-Key` 헤더 (api.md §0). 없으면 undefined. 길이 상한으로 남용 방지 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const raw = req.headers[IDEMPOTENCY_HEADER];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) return undefined;
    if (value.length > 128) throw new UnprocessableEntityException('Idempotency-Key too long');
    return value;
  },
);

/** 날짜 범위 상한 검사 (캘린더·통계 조회) */
export function assertRange(from: string, to: string, maxDays: number): void {
  if (from > to) throw new UnprocessableEntityException('from must be <= to');
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (span > maxDays) throw new UnprocessableEntityException(`range exceeds ${maxDays} days`);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 경로의 리소스 ID. UUID 형식이 아니면 존재할 수 없으므로 404 (D-06 과 일관) */
@Injectable()
export class UuidParamPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !UUID_RE.test(value)) throw new NotFoundException();
    return value.toLowerCase();
  }
}

/** 정규 5슬롯 경로 파라미터. extra 나 모르는 값은 404 */
@Injectable()
export class SlotParamPipe implements PipeTransform<string, MealSlot> {
  transform(value: string): MealSlot {
    if (!(MEAL_SLOTS as readonly string[]).includes(value)) throw new NotFoundException();
    return value as MealSlot;
  }
}
