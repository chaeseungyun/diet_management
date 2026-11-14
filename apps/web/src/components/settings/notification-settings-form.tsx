'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { MEAL_SLOTS, SLOT_LABELS, SUGGESTED_NOTIFY_MINUTES, type MealSlot } from '@diet/shared';
import type { Schemas } from '@/lib/api';
import { api } from '@/lib/client';
import { pad2 } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Section } from '@/components/shell/page';
import { StatusBanner, useStatus } from '@/components/ui/status';

type Setting = Schemas['NotificationSettingDto'];
type Kind = Setting['kind'];

const REMIND_INTERVALS = [15, 30, 45, 60, 90, 120, 180];
const REMIND_COUNTS = [1, 2, 3];
const DAYS_BEFORE = [1, 2, 3, 5, 7, 14];

function toTime(minute: number | null): string {
  return minute === null ? '' : `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`;
}

function fromTime(value: string): number | null {
  const m = /^(\d{2}):(\d{2})/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function intervalLabel(m: number): string {
  if (m < 60) return `${m}분`;
  return m % 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m / 60}시간`;
}

function same(a: Setting, b: Setting): boolean {
  return (
    a.enabled === b.enabled &&
    a.notifyMinute === b.notifyMinute &&
    a.remindAfterMinutes === b.remindAfterMinutes &&
    a.remindMaxCount === b.remindMaxCount &&
    a.daysBefore === b.daysBefore
  );
}

/** 현재 값이 목록에 없으면(다른 기기·API 로 저장) 함께 보인다 */
function withCurrent(options: number[], current: number): number[] {
  return options.includes(current) ? options : [...options, current].sort((x, y) => x - y);
}

/**
 * S-71 알림 종류별 설정. 계정 단위로 저장되고 바뀐 종류만 PUT 한다.
 * 쓰는 끼니(D-18)와 켜 둔 끼니만 보인다. 자유 끼니인 날·이미 기록한 끼니는 보내지 않는다(D-19).
 */
export function NotificationSettingsForm({
  settings,
  activeSlots,
}: {
  settings: Setting[];
  activeSlots: MealSlot[];
}) {
  const router = useRouter();
  const { status, run } = useStatus();
  const [saved, setSaved] = useState(() => new Map(settings.map((s) => [s.kind, s])));
  const [draft, setDraft] = useState(saved);

  const get = (kind: Kind) => draft.get(kind)!;
  const patch = (kind: Kind, p: Partial<Setting>) =>
    setDraft((d) => new Map(d).set(kind, { ...d.get(kind)!, ...p }));

  const slots = MEAL_SLOTS.filter((s) => activeSlots.includes(s) || saved.get(s)?.enabled);
  const changed = [...draft.values()].filter((s) => !same(s, saved.get(s.kind)!));
  const missingTime = slots.some((s) => get(s).enabled && get(s).notifyMinute === null);
  const remind = get('unrecorded_remind');
  const dayComplete = get('day_complete');
  const stock = get('stock_depletion');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const results = await run(async () => {
        const out: Setting[] = [];
        for (const s of changed) {
          out.push(
            await api<Setting>('PUT', `/notification-settings/${s.kind}`, {
              enabled: s.enabled,
              notifyMinute: s.notifyMinute,
              remindAfterMinutes: s.remindAfterMinutes,
              remindMaxCount: s.remindMaxCount,
              daysBefore: s.daysBefore,
            }),
          );
        }
        return out;
      }, '알림 설정 저장');
      const next = new Map(saved);
      results.forEach((r) => next.set(r.kind, r));
      setSaved(next);
      setDraft(next);
      router.refresh();
    } catch {
      // 배너. 일부만 저장됐을 수 있어 새로 고침하면 서버 값이 보인다
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Section title="끼니 알림">
        <Card className="flex flex-col divide-y divide-border">
          {slots.map((slot) => {
            const s = get(slot);
            const inactive = !activeSlots.includes(slot);
            return (
              <div key={slot} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <Checkbox
                    label={SLOT_LABELS[slot]}
                    checked={s.enabled}
                    onChange={(e) =>
                      patch(slot, {
                        enabled: e.target.checked,
                        notifyMinute:
                          e.target.checked && s.notifyMinute === null
                            ? SUGGESTED_NOTIFY_MINUTES[slot]
                            : s.notifyMinute,
                      })
                    }
                  />
                  {inactive ? (
                    <p className="ml-6 text-xs text-muted-foreground">
                      쓰지 않는 끼니라 보내지 않습니다
                    </p>
                  ) : null}
                </div>
                <Input
                  type="time"
                  step={60}
                  aria-label={`${SLOT_LABELS[slot]} 알림 시각`}
                  className="w-32"
                  value={toTime(s.notifyMinute)}
                  disabled={!s.enabled}
                  required={s.enabled}
                  onChange={(e) => patch(slot, { notifyMinute: fromTime(e.target.value) })}
                />
              </div>
            );
          })}
        </Card>
        <p className="text-xs text-muted-foreground">
          그 시각에 아직 기록하지 않은 식단 끼니만 알립니다. 자유 끼니인 날은 보내지 않습니다. 15분
          안에 보내지 못하면 건너뜁니다.
        </p>
      </Section>

      <Section title="기록 안 했을 때 다시 알림">
        <Card className="flex flex-col gap-3 p-4">
          <Checkbox
            label="다시 알림"
            checked={remind.enabled}
            onChange={(e) =>
              patch('unrecorded_remind', {
                enabled: e.target.checked,
                remindMaxCount:
                  e.target.checked && remind.remindMaxCount === 0 ? 1 : remind.remindMaxCount,
              })
            }
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Select
              aria-label="다시 알림 간격"
              className="w-32"
              value={remind.remindAfterMinutes}
              disabled={!remind.enabled}
              onChange={(e) =>
                patch('unrecorded_remind', { remindAfterMinutes: Number(e.target.value) })
              }
            >
              {withCurrent(REMIND_INTERVALS, remind.remindAfterMinutes).map((m) => (
                <option key={m} value={m}>
                  {intervalLabel(m)}
                </option>
              ))}
            </Select>
            <span>뒤에</span>
            <Select
              aria-label="다시 알림 횟수"
              className="w-28"
              value={remind.remindMaxCount}
              disabled={!remind.enabled}
              onChange={(e) =>
                patch('unrecorded_remind', { remindMaxCount: Number(e.target.value) })
              }
            >
              {withCurrent(REMIND_COUNTS, remind.remindMaxCount).map((n) => (
                <option key={n} value={n}>
                  최대 {n}번
                </option>
              ))}
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            끼니 알림 뒤에도 기록하지 않았으면 다시 보냅니다. 앞 알림을 덮어써서 알림이 쌓이지
            않습니다.
          </p>
        </Card>
      </Section>

      <Section title="하루 완료 알림">
        <Card className="flex flex-col gap-3 p-4">
          <Checkbox
            label="하루 완료를 안 눌렀을 때 알림"
            checked={dayComplete.enabled}
            onChange={(e) => patch('day_complete', { enabled: e.target.checked })}
          />
          <p className="text-xs text-muted-foreground">
            식단 끼니를 모두 기록하고 1시간이 지나도 하루 완료를 누르지 않았으면 한 번 알립니다.
          </p>
        </Card>
      </Section>

      <Section title="곧 떨어질 식품 알림">
        <Card className="flex flex-col gap-3 p-4">
          <Checkbox
            label="곧 떨어질 식품 알림"
            checked={stock.enabled}
            onChange={(e) => patch('stock_depletion', { enabled: e.target.checked })}
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>떨어지기</span>
            <Select
              aria-label="떨어지기 며칠 전"
              className="w-28"
              value={stock.daysBefore}
              disabled={!stock.enabled}
              onChange={(e) => patch('stock_depletion', { daysBefore: Number(e.target.value) })}
            >
              {withCurrent(DAYS_BEFORE, stock.daysBefore).map((n) => (
                <option key={n} value={n}>
                  {n}일 전
                </option>
              ))}
            </Select>
            <span>부터,</span>
            <Input
              type="time"
              step={60}
              aria-label="곧 떨어질 식품 알림 시각"
              className="w-32"
              value={toTime(stock.notifyMinute)}
              disabled={!stock.enabled}
              required={stock.enabled}
              onChange={(e) => {
                const minute = fromTime(e.target.value);
                if (minute !== null) patch('stock_depletion', { notifyMinute: minute });
              }}
            />
            <span>에</span>
          </div>
          <p className="text-xs text-muted-foreground">
            식품마다 한 번, 같은 날 여러 개면 한 통으로 묶어 알립니다. 다시 채운 뒤 또 떨어져 가면
            다시 알립니다. 배송 중인 식품은 알리지 않습니다. 며칠 전 기준은 식품 화면의 &apos;곧
            떨어짐&apos; 표시에도 쓰입니다.
          </p>
        </Card>
      </Section>

      <StatusBanner status={status} />
      <Button
        type="submit"
        disabled={changed.length === 0 || missingTime || status.kind === 'saving'}
      >
        저장
      </Button>
      {missingTime ? (
        <p className="text-xs text-destructive" role="alert">
          켠 끼니에는 알림 시각이 필요합니다.
        </p>
      ) : null}
    </form>
  );
}
