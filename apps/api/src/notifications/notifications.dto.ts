import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  DeliveryStatus,
  MealSlot,
  NotificationKind,
  NotificationType,
  type NotificationDelivery,
  type NotificationSetting,
} from '@prisma/client';
import { fromDbDate } from '../domain/dates';
import { DEFAULT_DAYS_BEFORE, DEFAULT_STOCK_NOTIFY_MINUTE } from '../domain/notifications';

/** 화면 순서 = 5끼니 → 미기록 재알림 → 하루 완료 → 소진 알림 (S-71) */
export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'breakfast',
  'lunch',
  'afternoon_snack',
  'dinner',
  'evening_snack',
  'unrecorded_remind',
  'day_complete',
  'stock_depletion',
];

export const SLOT_KINDS: readonly NotificationKind[] = NOTIFICATION_KINDS.slice(0, 5);

/**
 * 설정 행이 없을 때의 켜짐 여부 (DEC-084). 하루 완료·소진 알림은 기본 켜짐이라
 * 이미 알림을 켠 계정도 따로 손대지 않고 받는다. 끼니·재알림은 기본 꺼짐.
 */
export const DEFAULT_ENABLED: Record<NotificationKind, boolean> = {
  breakfast: false,
  lunch: false,
  afternoon_snack: false,
  dinner: false,
  evening_snack: false,
  unrecorded_remind: false,
  day_complete: true,
  stock_depletion: true,
};

export const DEFAULTS = {
  remindAfterMinutes: 60,
  remindMaxCount: 1,
  daysBefore: DEFAULT_DAYS_BEFORE,
} as const;

export class NotificationSettingDto {
  @ApiProperty({ enum: NotificationKind, enumName: 'NotificationKind' })
  kind!: NotificationKind;

  @ApiProperty()
  enabled!: boolean;

  /** 알림 시각, 사용자 시간대 기준 하루 중 분(0~1439). 끼니 종류와 소진 알림(기본 540 = 09:00)에 의미가 있다 */
  @ApiProperty({ type: Number, nullable: true, example: 720 })
  notifyMinute!: number | null;

  /** unrecorded_remind: 첫 알림 뒤 간격(분) */
  @ApiProperty({ example: 60 })
  remindAfterMinutes!: number;

  /** unrecorded_remind: 재알림 횟수 0~3 */
  @ApiProperty({ example: 1 })
  remindMaxCount!: number;

  /** stock_depletion: 예측 소진일 N일 전 */
  @ApiProperty({ example: 3 })
  daysBefore!: number;

  static from(
    kind: NotificationKind,
    row: NotificationSetting | undefined,
  ): NotificationSettingDto {
    const dto = new NotificationSettingDto();
    dto.kind = kind;
    dto.enabled = row?.enabled ?? DEFAULT_ENABLED[kind];
    dto.notifyMinute =
      row?.notifyMinute ?? (kind === 'stock_depletion' ? DEFAULT_STOCK_NOTIFY_MINUTE : null);
    dto.remindAfterMinutes = row?.remindAfterMinutes ?? DEFAULTS.remindAfterMinutes;
    dto.remindMaxCount = row?.remindMaxCount ?? DEFAULTS.remindMaxCount;
    dto.daysBefore = row?.daysBefore ?? DEFAULTS.daysBefore;
    return dto;
  }
}

/** 보내지 않은 필드는 기존 값(없으면 기본값)을 유지한다 */
export class PutNotificationSettingDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, maximum: 1439 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1439)
  notifyMinute?: number | null;

  @ApiPropertyOptional({ minimum: 15, maximum: 180 })
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(180)
  remindAfterMinutes?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  remindMaxCount?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 14 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(14)
  daysBefore?: number;
}

/** POST /notification-settings/enable-meals 결과 (DEC-077) */
export class EnableMealsResultDto {
  /** false = 이미 켜진 끼니 알림이 있어 아무것도 바꾸지 않음 */
  @ApiProperty()
  applied!: boolean;

  /** 이번에 켠 끼니 */
  @ApiProperty({ enum: NotificationKind, enumName: 'NotificationKind', isArray: true })
  enabledKinds!: NotificationKind[];

  @ApiProperty({ type: NotificationSettingDto, isArray: true })
  settings!: NotificationSettingDto[];
}

// ---------- 푸시 구독 ----------

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export class PushKeysDto {
  /** 브라우저 ECDH 공개키(base64url) */
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  @Matches(B64URL)
  p256dh!: string;

  /** 브라우저 auth 비밀값(base64url) */
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  @Matches(B64URL)
  auth!: string;
}

/** 브라우저 PushSubscription.toJSON() 모양 그대로 받는다 */
export class CreatePushSubscriptionDto {
  @ApiProperty({ example: 'https://fcm.googleapis.com/fcm/send/…' })
  @IsString()
  @MaxLength(2048)
  endpoint!: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber()
  expirationTime?: number | null;

  @ApiProperty({ type: PushKeysDto })
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;
}

export class UnsubscribeDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2048)
  endpoint!: string;
}

export class PushSubscriptionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class PushPublicKeyDto {
  /** VAPID 공개키(base64url). 서버에 키가 없으면 null — 이때 푸시는 쓸 수 없다 */
  @ApiProperty({ type: String, nullable: true })
  publicKey!: string | null;
}

// ---------- 테스트 발송·발송 기록 ----------

export class TestPushDto {
  /** 이 기기(현재 브라우저)의 구독 endpoint */
  @ApiProperty()
  @IsString()
  @MaxLength(2048)
  endpoint!: string;
}

export class TestPushResultDto {
  @ApiProperty()
  ok!: boolean;

  /** 푸시 서비스 응답 코드. 네트워크 오류면 null */
  @ApiProperty({ type: Number, nullable: true })
  status!: number | null;

  /** 실패 사유(화면 표시용). 성공이면 null */
  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;
}

export class NotificationDeliveryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: NotificationType, enumName: 'NotificationType' })
  type!: NotificationType;

  @ApiProperty({ example: '2026-11-10' })
  targetDate!: string;

  @ApiProperty({ enum: MealSlot, enumName: 'MealSlot', nullable: true })
  slot!: MealSlot | null;

  /** 0 = 첫 알림, 1~3 = 재알림 회차 */
  @ApiProperty()
  seq!: number;

  @ApiProperty({ enum: DeliveryStatus, enumName: 'DeliveryStatus' })
  status!: DeliveryStatus;

  @ApiProperty({ format: 'date-time' })
  scheduledAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  sentAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  failureReason!: string | null;

  static from(d: NotificationDelivery): NotificationDeliveryDto {
    const dto = new NotificationDeliveryDto();
    dto.id = d.id;
    dto.type = d.type;
    dto.targetDate = fromDbDate(d.targetDate);
    dto.slot = d.slot;
    dto.seq = d.seq;
    dto.status = d.status;
    dto.scheduledAt = d.scheduledAt.toISOString();
    dto.sentAt = d.sentAt ? d.sentAt.toISOString() : null;
    dto.failureReason = d.failureReason;
    return dto;
  }
}
