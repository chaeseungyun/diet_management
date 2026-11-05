'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { MeDto } from '@/lib/api';
import { api } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { StatusBanner, useStatus } from '@/components/ui/status';
import { GoalForm } from './goal-form';
import { COMMON_TIMEZONES } from './profile-form';

/** S-03: 시간대 확인 → 목표(선택) → 완료 표시(PATCH /me onboarded). 건너뛰어도 완료로 표시한다 */
export function Onboarding({ me, today }: { me: MeDto; today: string }) {
  const router = useRouter();
  const { status, run } = useStatus();
  const [timezone, setTimezone] = useState(me.timezone);
  const [step, setStep] = useState<'tz' | 'goal'>('tz');

  async function finish() {
    try {
      await run(() => api('PATCH', '/me', { timezone, onboarded: true }), '설정 완료');
      router.replace('/');
      router.refresh();
    } catch {
      // 배너
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        안녕하세요, {me.nickname}님. 두 가지만 확인하면 바로 기록을 시작할 수 있습니다.
      </p>
      <StatusBanner status={status} />
      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <h2 className="font-semibold">1. 시간대</h2>
          <Field
            label="날짜 경계 기준 시간대"
            htmlFor="ob-tz"
            hint="식사·체중은 이 시간대의 날짜로 저장됩니다"
          >
            <Input
              id="ob-tz"
              list="ob-tz-list"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            />
            <datalist id="ob-tz-list">
              {COMMON_TIMEZONES.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </Field>
          {step === 'tz' ? <Button onClick={() => setStep('goal')}>다음</Button> : null}
        </CardContent>
      </Card>
      {step === 'goal' ? (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            <h2 className="font-semibold">2. 목표 (선택)</h2>
            <GoalForm
              current={null}
              today={today}
              submitLabel="목표 저장 후 시작"
              onSaved={finish}
            />
            <Button variant="ghost" onClick={finish}>
              건너뛰기
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
