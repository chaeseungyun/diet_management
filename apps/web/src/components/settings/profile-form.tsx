'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { NICKNAME_MAX_LENGTH, type MealSlot } from '@diet/shared';
import type { MeDto } from '@/lib/api';
import { api } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { StatusBanner, useStatus } from '@/components/ui/status';
import { ActiveSlotsField } from './active-slots-field';

export const COMMON_TIMEZONES = [
  'Asia/Seoul',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Los_Angeles',
  'UTC',
];

/** S-70 프로필(닉네임)·시간대. 시간대 변경은 날짜 경계·알림 예약을 바꾼다 */
export function ProfileForm({ me }: { me: MeDto }) {
  const router = useRouter();
  const { status, run } = useStatus();
  const [nickname, setNickname] = useState(me.nickname);
  const [timezone, setTimezone] = useState(me.timezone);
  const [activeSlots, setActiveSlots] = useState<MealSlot[]>(me.activeSlots as MealSlot[]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await run(() => api('PATCH', '/me', { nickname, timezone, activeSlots }), '프로필 저장');
      router.refresh();
    } catch {
      // 배너
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <StatusBanner status={status} />
      <Field label="닉네임" htmlFor="nick">
        <Input
          id="nick"
          maxLength={NICKNAME_MAX_LENGTH}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
      </Field>
      <Field
        label="시간대"
        htmlFor="tz"
        hint="식사·체중 날짜의 경계 기준. 알림 시각도 이 시간대로 판정합니다"
      >
        <Input
          id="tz"
          list="tz-list"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        />
        <datalist id="tz-list">
          {COMMON_TIMEZONES.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
      </Field>
      <ActiveSlotsField value={activeSlots} onChange={setActiveSlots} />
      <Button
        type="submit"
        variant="outline"
        disabled={
          nickname === me.nickname &&
          timezone === me.timezone &&
          activeSlots.join() === me.activeSlots.join()
        }
      >
        저장
      </Button>
    </form>
  );
}
