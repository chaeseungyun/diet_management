import { redirect } from 'next/navigation';
import { type MealSlot } from '@diet/shared';
import { apiGet, getMe, type Schemas } from '@/lib/api';
import { Page, Section } from '@/components/shell/page';
import { PushDeviceCard } from '@/components/settings/push-device-card';
import { NotificationSettingsForm } from '@/components/settings/notification-settings-form';
import { DeliveryList } from '@/components/settings/delivery-list';

/**
 * 알림 설정 (S-71, DEC-074·075). 끼니 설정은 계정에 저장되고, 알림은 켜 둔 모든 기기로 간다.
 * 이 기기의 권한·구독은 브라우저에서만 알 수 있어 PushDeviceCard 가 클라이언트에서 그린다.
 */
export default async function NotificationsPage() {
  const me = await getMe();
  if (!me) redirect('/login');
  const [settings, deliveries] = await Promise.all([
    apiGet<Schemas['NotificationSettingDto'][]>('/notification-settings'),
    apiGet<Schemas['NotificationDeliveryDto'][]>('/notifications'),
  ]);

  return (
    <Page title="알림" back="/settings">
      <PushDeviceCard />
      <NotificationSettingsForm
        // 알림 켜기가 끼니를 일괄로 켜면(DEC-077) 새로 고침된 서버 값으로 다시 그린다
        key={settings.map((s) => `${s.kind}:${s.enabled}:${s.notifyMinute}`).join()}
        settings={settings}
        activeSlots={me.activeSlots as MealSlot[]}
      />
      <Section title="최근 알림 (7일)">
        <DeliveryList deliveries={deliveries} timezone={me.timezone} />
      </Section>
    </Page>
  );
}
