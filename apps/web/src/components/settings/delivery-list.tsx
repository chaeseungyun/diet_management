import { SLOT_LABELS } from '@diet/shared';
import type { Schemas } from '@/lib/api';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/card';
import { dateLabel } from '@/lib/format';

type Delivery = Schemas['NotificationDeliveryDto'];

const STATUS: Record<Delivery['status'], [string, BadgeVariant]> = {
  sent: ['보냄', 'success'],
  pending: ['보내는 중', 'info'],
  failed: ['실패', 'destructive'],
  skipped: ['건너뜀', 'outline'],
};

/** 실패 사유를 사람이 읽는 말로. 원문은 title 로 남긴다 */
function reasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  if (reason === 'expired') return '15분 안에 보내지 못함';
  if (reason === 'no_subscription') return '알림을 켠 기기 없음';
  if (reason.startsWith('gone')) return '기기 구독이 만료됨';
  if (reason.startsWith('permanent 403')) return '서버 키 불일치';
  if (reason.startsWith('transient')) return '푸시 서비스 일시 오류';
  return '보내지 못함';
}

/** S-71 최근 알림. 시각은 사용자 시간대로 보인다 */
export function DeliveryList({
  deliveries,
  timezone,
}: {
  deliveries: Delivery[];
  timezone: string;
}) {
  if (deliveries.length === 0) return <EmptyState>최근 7일 동안 보낸 알림이 없습니다</EmptyState>;
  const time = new Intl.DateTimeFormat('ko-KR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return (
    <ul className="divide-y divide-border rounded-xl border border-border text-sm">
      {deliveries.map((d) => {
        const [label, variant] = STATUS[d.status];
        const what =
          d.type === 'stock_depletion'
            ? '곧 떨어질 식품'
            : d.type === 'day_complete'
              ? '하루 완료'
              : `${d.slot ? SLOT_LABELS[d.slot] : ''} ${d.seq === 0 ? '알림' : `재알림 ${d.seq}`}`;
        const reason = reasonLabel(d.failureReason);
        return (
          <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="min-w-0">
              <span className="font-medium">{what}</span>
              <span className="block text-xs text-muted-foreground">
                {dateLabel(d.targetDate)} · {time.format(new Date(d.sentAt ?? d.scheduledAt))}
                {reason ? <span title={d.failureReason ?? undefined}> · {reason}</span> : null}
              </span>
            </span>
            <Badge variant={variant}>{label}</Badge>
          </li>
        );
      })}
    </ul>
  );
}
