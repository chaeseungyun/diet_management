import { ApiProperty } from '@nestjs/swagger';

/** 지표별 평균 (FR-06). 유효일 = 하루 완료 + 이 지표 완전 */
export class MetricAverageDto {
  /** 유효일 평균. 유효일 0 이면 null ('데이터 없음') */
  @ApiProperty({ type: Number, nullable: true })
  average!: number | null;

  @ApiProperty()
  validDays!: number;

  /** 완료했지만 이 지표가 미상인 날 (제외 이유: 영양 미상) */
  @ApiProperty()
  unknownDays!: number;
}

export class NutritionAveragesDto {
  @ApiProperty({ type: MetricAverageDto })
  kcal!: MetricAverageDto;

  @ApiProperty({ type: MetricAverageDto })
  carbG!: MetricAverageDto;

  @ApiProperty({ type: MetricAverageDto })
  proteinG!: MetricAverageDto;

  @ApiProperty({ type: MetricAverageDto })
  fatG!: MetricAverageDto;
}

export class GoalAchievementDto {
  /** 완료 + kcal 완전 + 목표가 있던 날 중 kcal ≤ 그 날 목표 */
  @ApiProperty()
  achievedDays!: number;

  /** 판정 대상: 완료 + kcal 완전 + 목표가 있던 날 */
  @ApiProperty()
  eligibleDays!: number;
}

export class WeightPointDto {
  @ApiProperty({ example: '2026-11-08' })
  date!: string;

  @ApiProperty()
  weightKg!: number;
}

export class WeightSummaryInRangeDto {
  @ApiProperty({ type: WeightPointDto, nullable: true })
  first!: WeightPointDto | null;

  @ApiProperty({ type: WeightPointDto, nullable: true })
  last!: WeightPointDto | null;

  /** last - first. 측정 2회 미만이면 null */
  @ApiProperty({ type: Number, nullable: true })
  change!: number | null;

  @ApiProperty()
  measuredDays!: number;
}

/** 계획 식단 실천율 (FR-06, 1차 정확 일치, DEC-068) */
export class AdherenceDto {
  /** 분모: 식단 끼니로 기록된(먹었음·안 먹음) 정규 끼니 */
  @ApiProperty()
  plannedSlots!: number;

  /** 식단 품목·수량 그대로 먹음 */
  @ApiProperty()
  asPlannedSlots!: number;

  /** 먹었지만 품목·수량이 다름 또는 식단 외 식사 */
  @ApiProperty()
  modifiedSlots!: number;

  @ApiProperty()
  skippedSlots!: number;

  /** asPlannedSlots / plannedSlots. 분모 0 이면 null */
  @ApiProperty({ type: Number, nullable: true })
  rate!: number | null;

  /** 분모에 든 끼니 중 날짜 예외로 다른 식단이 적용된 끼니 */
  @ApiProperty()
  overriddenSlots!: number;

  /** 날짜 예외로 자유 끼니로 바꿔 분모에서 뺀 끼니 (출장 등 사전 변경) */
  @ApiProperty()
  excludedByOverride!: number;
}

export class StatsSummaryDto {
  @ApiProperty({ example: '2026-11-02' })
  from!: string;

  @ApiProperty({ example: '2026-11-08' })
  to!: string;

  /** 기간 중 가입일 이후·오늘 이전(포함) 날짜 수 */
  @ApiProperty()
  trackedDays!: number;

  @ApiProperty()
  completedDays!: number;

  /** 기록 완료율 = completedDays / trackedDays. 추적일 0 이면 null */
  @ApiProperty({ type: Number, nullable: true })
  completionRate!: number | null;

  /** 추적일 중 완료하지 않은 날 (평균 제외 이유: 미기록·미완료) */
  @ApiProperty()
  notCompletedDays!: number;

  /** 오늘 기준 연속 기록 일수 (기간과 무관). 오늘을 아직 완료하지 않았으면 어제부터 센다 */
  @ApiProperty()
  currentStreak!: number;

  @ApiProperty({ type: NutritionAveragesDto })
  averages!: NutritionAveragesDto;

  @ApiProperty({ type: GoalAchievementDto })
  goal!: GoalAchievementDto;

  @ApiProperty({ type: WeightSummaryInRangeDto })
  weight!: WeightSummaryInRangeDto;

  @ApiProperty({ type: AdherenceDto })
  adherence!: AdherenceDto;
}

export class MetricFlagsDto {
  @ApiProperty()
  kcal!: boolean;

  @ApiProperty()
  carbG!: boolean;

  @ApiProperty()
  proteinG!: boolean;

  @ApiProperty()
  fatG!: boolean;
}

/** 일별 시계열 (PC 차트, S-60). 불완전한 날의 값은 '기록된 합계' */
export class StatsDayDto {
  @ApiProperty({ example: '2026-11-08' })
  date!: string;

  @ApiProperty()
  tracked!: boolean;

  @ApiProperty()
  completed!: boolean;

  /** 먹었음 기록(정규 끼니 + 추가 간식)의 확인된 값 합계 */
  @ApiProperty()
  kcal!: number;

  @ApiProperty()
  carbG!: number;

  @ApiProperty()
  proteinG!: number;

  @ApiProperty()
  fatG!: number;

  /** 지표별 완전 여부. false 면 위 값은 미상이 빠진 '기록된 합계' */
  @ApiProperty({ type: MetricFlagsDto })
  complete!: MetricFlagsDto;

  @ApiProperty({ type: Number, nullable: true })
  goalKcal!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  weightKg!: number | null;
}

export class StatsDailyDto {
  @ApiProperty({ example: '2026-11-02' })
  from!: string;

  @ApiProperty({ example: '2026-11-08' })
  to!: string;

  @ApiProperty({ type: StatsDayDto, isArray: true })
  days!: StatsDayDto[];
}
