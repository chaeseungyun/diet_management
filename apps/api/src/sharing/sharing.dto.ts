import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, ValidateIf } from 'class-validator';
import type { FriendInvite } from '@prisma/client';
import {
  EXTRA_SLOT,
  MEAL_KINDS,
  MEAL_SLOTS,
  MEAL_STATUSES,
  SHARE_VISIBILITIES,
  STOCK_UNITS,
  type AnySlot,
  type MealKind,
  type MealStatus,
  type ShareVisibility,
  type StockUnit,
} from '@diet/shared';
import { NutritionTotalsDto } from '../common/nutrition.dto';
import { RecordSocialDto } from './social.dto';

export class SharingSettingsDto {
  /** private = 나만 보기(기본), friends = 친구에게 공개 */
  @ApiProperty({ enum: SHARE_VISIBILITIES })
  visibility!: ShareVisibility;

  /** 몸무게도 공개하는가(기본 false). 친구별 몸무게 스위치를 켠 친구에게만, 끼니가 보일 때만 보인다 (DEC-101) */
  @ApiProperty()
  shareWeight!: boolean;
}

/** 둘 중 하나는 있어야 한다. 보내지 않은 쪽은 그대로 둔다(null 은 422) */
export class UpdateSharingSettingsDto {
  @ApiProperty({ enum: SHARE_VISIBILITIES, required: false })
  @ValidateIf(
    (o: UpdateSharingSettingsDto) => o.visibility !== undefined || o.shareWeight === undefined,
  )
  @IsIn(SHARE_VISIBILITIES)
  visibility?: ShareVisibility;

  /** 몸무게도 공개할지 (DEC-101) */
  @ApiProperty({ required: false })
  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  shareWeight?: boolean;
}

export class FriendInviteDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  code!: string;

  /** 친구에게 보낼 주소 (`<웹 오리진>/invite/<code>`) */
  @ApiProperty()
  url!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  static from(i: FriendInvite, webOrigin: string): FriendInviteDto {
    return {
      id: i.id,
      code: i.code,
      url: `${webOrigin}/invite/${i.code}`,
      expiresAt: i.expiresAt.toISOString(),
    };
  }
}

/** 초대 링크 미리보기. 로그인 없이 보이므로 초대한 사람의 닉네임만 싣는다 */
export class FriendInvitePreviewDto {
  @ApiProperty()
  nickname!: string;
}

export class FriendTodayDto {
  /** 친구 시간대의 오늘. 친구의 하루로 가는 링크에 쓴다 */
  @ApiProperty({ example: '2026-11-16' })
  date!: string;

  /** 집계 대상 끼니 수 (DaySummaryDto.activeSlots 와 같은 계산) */
  @ApiProperty()
  activeSlots!: number;

  @ApiProperty()
  recordedSlots!: number;

  @ApiProperty()
  completed!: boolean;
}

export class FriendDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  nickname!: string;

  /** 친구가 된 시각 */
  @ApiProperty({ format: 'date-time' })
  since!: string;

  /** 내가 이 친구에게 끄지 않았는가(친구별 스위치). 내 공개 범위가 private 이면 이 값과 무관하게 안 보인다 */
  @ApiProperty()
  shareToFriend!: boolean;

  /** 내가 이 친구에게 몸무게를 켰는가(기본 false). 내 몸무게 공개가 꺼져 있거나 끼니가 안 보이면 이 값과 무관하게 안 보인다 */
  @ApiProperty()
  shareWeightToFriend!: boolean;

  /** 이 친구의 끼니를 내가 볼 수 있는가. false 면 today 는 null 이고 친구의 하루는 404 */
  @ApiProperty()
  shared!: boolean;

  /** 친구의 오늘(친구 시간대) 요약. 볼 수 없으면 null */
  @ApiProperty({ type: FriendTodayDto, nullable: true })
  today!: FriendTodayDto | null;
}

/** 내가 차단한 사람 (DEC-097) */
export class BlockedUserDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  nickname!: string;
}

/** 둘 중 하나는 있어야 한다. 보내지 않은 쪽은 그대로 둔다(null 은 422). 끼니를 끄면 몸무게도 꺼진다 */
export class UpdateFriendDto {
  /** 이 친구에게 내 끼니를 보일지 */
  @ApiProperty({ required: false })
  @ValidateIf(
    (o: UpdateFriendDto) => o.shareToFriend !== undefined || o.shareWeightToFriend === undefined,
  )
  @IsBoolean()
  shareToFriend?: boolean;

  /** 이 친구에게 내 몸무게를 보일지 (DEC-101) */
  @ApiProperty({ required: false })
  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  shareWeightToFriend?: boolean;
}

// ---------- 친구의 하루 ----------
// DayDto 를 재사용하지 않는다: 보낼 필드를 여기서 하나씩 고른다(화이트리스트).
// 계획·식단 이름·재고·목표(목표 체중 포함)·영양 출처는 넣지 않는다 (sharing-plan §3·§9-2).
// 몸무게는 owner 가 이 친구에게 켰을 때만 값과 7일 추이를 싣는다 (DEC-101).

export class SharedMealItemDto {
  @ApiProperty()
  name!: string;

  /** 실제로 먹은 양. 재고를 관리하지 않는 식품을 양 없이 기록했으면 null */
  @ApiProperty({ type: Number, nullable: true })
  quantity!: number | null;

  @ApiProperty({ enum: STOCK_UNITS })
  unit!: StockUnit;

  /** 화면에 보일 단위(ea 식품의 '팩'·'개' 등) */
  @ApiProperty()
  displayUnit!: string;
}

export class SharedPhotoDto {
  /** 파일은 `GET /friends/{userId}/meal-photos/{id}` 로 받는다 */
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  width!: number;

  @ApiProperty()
  height!: number;

  /** 보관 기간 지남. 파일 요청은 404 */
  @ApiProperty()
  expired!: boolean;
}

export class SharedMealDto {
  /** 저장된 기록 id. 미기록 끼니는 null */
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  recordId!: string | null;

  @ApiProperty({ enum: [...MEAL_SLOTS, EXTRA_SLOT] })
  slot!: AnySlot;

  @ApiProperty({ enum: MEAL_STATUSES })
  status!: MealStatus;

  /** home = 내 식품, outside = 식단 외 식사. 먹었음이 아니면 의미 없음 */
  @ApiProperty({ enum: MEAL_KINDS })
  kind!: MealKind;

  /** 식단 외 식사의 메뉴명. 그 밖에는 null */
  @ApiProperty({ type: String, nullable: true })
  outsideMenu!: string | null;

  /** 먹은 품목. 먹었음이 아니면 비어 있다(계획 품목은 공유하지 않는다) */
  @ApiProperty({ type: SharedMealItemDto, isArray: true })
  items!: SharedMealItemDto[];

  @ApiProperty({ type: SharedPhotoDto, isArray: true })
  photos!: SharedPhotoDto[];

  /** 반응 집계·내 반응·댓글 수. 미기록 끼니는 null (반응·댓글을 달 수 없다) */
  @ApiProperty({ type: RecordSocialDto, nullable: true })
  social!: RecordSocialDto | null;
}

export class SharedWeightPointDto {
  @ApiProperty({ example: '2026-11-16' })
  date!: string;

  /** 그날 기록이 없으면 null(미상). 0 이나 앞 값으로 채우지 않는다 */
  @ApiProperty({ type: Number, nullable: true })
  weightKg!: number | null;
}

/** 친구에게 보이는 몸무게 (DEC-101). 목표 체중·변화량은 싣지 않는다 */
export class SharedWeightDto {
  /** 보는 날짜의 몸무게. 기록이 없으면 null */
  @ApiProperty({ type: Number, nullable: true })
  weightKg!: number | null;

  /** 보는 날짜를 끝으로 하는 7일(그날 포함, 날짜 오름차순). 가입일 앞은 잘라 7개보다 적을 수 있다 */
  @ApiProperty({ type: SharedWeightPointDto, isArray: true })
  recent!: SharedWeightPointDto[];
}

export class SharedDayOwnerDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  nickname!: string;
}

export class SharedDayDto {
  @ApiProperty({ type: SharedDayOwnerDto })
  owner!: SharedDayOwnerDto;

  @ApiProperty({ example: '2026-11-16' })
  date!: string;

  /** 친구 시간대의 오늘. 이 뒤 날짜는 404 */
  @ApiProperty({ example: '2026-11-16' })
  today!: string;

  /** 볼 수 있는 가장 이른 날짜(친구의 가입일). 이 앞 날짜는 404 */
  @ApiProperty({ example: '2026-11-07' })
  firstDate!: string;

  /** 정규 끼니(하루 순서). 미기록 자유 끼니는 빠진다 (D-18) */
  @ApiProperty({ type: SharedMealDto, isArray: true })
  slots!: SharedMealDto[];

  @ApiProperty({ type: SharedMealDto, isArray: true })
  extras!: SharedMealDto[];

  /** 기록된 합계(먹었음 + 안 먹음 0 + 추가 간식). 미상이 있으면 complete=false (null 은 미상) */
  @ApiProperty({ type: NutritionTotalsDto })
  nutrition!: NutritionTotalsDto;

  /** 하루 완료 여부 */
  @ApiProperty()
  completed!: boolean;

  /** 몸무게. 친구가 나에게 몸무게를 공개하지 않으면 null (기록이 없는 것과 다르다) */
  @ApiProperty({ type: SharedWeightDto, nullable: true })
  weight!: SharedWeightDto | null;
}
