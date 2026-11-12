import type { ErrorCode } from '@diet/shared';

/**
 * 오류 화면 문구 (DEC-079). 서버는 code 만 정하고, 무엇이라고 말할지는 여기 한 곳에서 정한다.
 * 해요체. 서버 message(개발자용 영어)는 화면에 내지 않는다.
 * `satisfies` 덕분에 shared 의 ERROR_CODES 에 코드를 더하면 이 표의 누락이 타입 오류가 된다.
 */
export const ERROR_MESSAGES = {
  BAD_REQUEST: '요청을 처리하지 못했어요. 새로 고침 후 다시 해 주세요.',
  UNAUTHENTICATED: '로그인이 풀렸어요. 다시 로그인해 주세요.',
  FORBIDDEN: '요청이 막혔어요. 새로 고침 후 다시 해 주세요.',
  NOT_FOUND: '찾을 수 없어요. 이미 지워졌을 수 있어요.',
  CONFLICT: '다른 기기에서 먼저 바뀌었어요. 새로 고침 후 다시 해 주세요.',
  VALIDATION_FAILED: '입력한 값을 확인해 주세요.',
  PAYLOAD_TOO_LARGE: '보낸 내용이 너무 커요.',
  SERVICE_UNAVAILABLE: '지금은 처리할 수 없어요. 잠시 뒤 다시 해 주세요.',
  INTERNAL: '잠시 문제가 생겼어요. 잠시 뒤 다시 해 주세요.',

  CSRF_REJECTED: '요청이 막혔어요. 새로 고침 후 다시 해 주세요.',
  IDEMPOTENCY_KEY_REUSED: '잠시 문제가 생겼어요. 새로 고침 후 다시 해 주세요.',
  FUTURE_DATE: '미래 날짜는 기록할 수 없어요.',

  UNIT_LABEL_REQUIRED: '표시 단위명(팩·개·통)을 적어 주세요.',
  UNIT_NOT_ALLOWED:
    '이 식품은 그 단위로 적을 수 없어요. 개 단위 식품을 g 로 적으려면 식품 수정에서 1개의 무게를 먼저 넣어 주세요.',
  STOCK_UNIT_LOCKED:
    '기록이 있는 식품은 수량 단위를 바꿀 수 없어요. g 로 적으려면 식품 수정에서 1개의 무게를 넣어 주세요.',
  UNIT_SETTINGS_IN_USE:
    '이 단위를 쓰는 식단이나 영양 정보가 있어 바꿀 수 없어요. 그쪽을 먼저 고쳐 주세요.',
  PRODUCT_ARCHIVED: '보관한 식품이에요. 보관을 풀고 다시 해 주세요.',
  PRODUCT_IN_TEMPLATE: '이 식품을 쓰는 식단이 있어요. 식단에서 먼저 빼 주세요.',
  PRODUCT_NOT_STOCK_TRACKED: '남은 양을 세지 않는 식품이에요.',
  NUTRITION_MISSING: '영양 정보를 먼저 입력해 주세요.',
  PURCHASE_NOT_ORDERED: '배송 중인 구매만 고치거나 취소할 수 있어요.',

  TEMPLATE_REQUIRED: '식단을 골라 주세요.',
  TEMPLATE_ARCHIVED: '보관한 식단이에요. 보관을 풀고 다시 해 주세요.',
  TEMPLATE_IN_PLAN: '식단표나 날짜 예외에서 쓰는 식단이에요. 먼저 다른 식단으로 바꿔 주세요.',

  RECORD_CONFLICT: '다른 기기에서 먼저 바뀌었어요. 새로 고침 후 다시 해 주세요.',
  EMPTY_HOME_MEAL: "먹은 품목을 하나 이상 넣거나 '안 먹음'으로 기록해 주세요.",
  OUTSIDE_MENU_REQUIRED: '메뉴 이름을 적어 주세요.',
  QUANTITY_REQUIRED: '먹은 양을 적어 주세요.',
  DAY_HAS_UNRECORDED: '아직 기록하지 않은 끼니가 있어요.',
  BEFORE_SIGNUP: '가입하기 전 날짜는 완료할 수 없어요.',

  WEIGHT_EXISTS: '이 날 체중이 이미 있어요. 덮어쓸까요?',

  NOTIFY_TIME_REQUIRED: '알림 시각을 정해 주세요.',
  PUSH_ENDPOINT_INVALID: '이 브라우저에서는 알림을 켤 수 없어요.',
  PUSH_NOT_CONFIGURED: '지금은 알림을 보낼 수 없어요.',
} satisfies Record<ErrorCode, string>;

/** fetch 자체가 실패(오프라인·서버 꺼짐). 실패를 저장으로 보이지 않는다 (NFR-03) */
export const NETWORK_MESSAGE =
  '연결이 끊겼어요. 적은 내용은 그대로 있어요. 연결되면 다시 해 주세요.';

/** API 오류가 아닌 예외(화면 코드의 버그 등) */
export const UNKNOWN_MESSAGE = '처리하지 못했어요. 다시 해 주세요.';

export type ErrorMessageOptions = {
  /** 같은 code 라도 이 화면에서는 다르게 안내할 때 */
  messages?: Partial<Record<ErrorCode, string>>;
  /** 검증 실패 필드 → 화면 라벨. 있으면 "'라벨'을 확인해 주세요." */
  fields?: Record<string, string>;
};

/** 검증 실패 첫 필드의 라벨로 문구를 만든다. 없으면 null */
export function fieldMessage(
  failed: readonly { field: string }[] | undefined,
  labels: Record<string, string> | undefined,
): string | null {
  if (!failed || !labels) return null;
  for (const f of failed) {
    const label = labels[f.field] ?? labels[f.field.replace(/\.\d+\./g, '.*.')];
    if (label) return `'${label}'${objectParticle(label)} 확인해 주세요.`;
  }
  return null;
}

/** 을/를: 마지막 글자에 받침이 있으면 '을'. 한글이 아니면 '을(를)' */
function objectParticle(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return '을(를)';
  return (last - 0xac00) % 28 === 0 ? '를' : '을';
}
