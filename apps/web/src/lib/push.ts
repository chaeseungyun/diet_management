'use client';

import { api, ApiError } from './client';
import type { components } from './api-types';

/**
 * 브라우저 쪽 웹 푸시 구독 (DEC-074, S-71). 서버는 endpoint 로 구독을 upsert 한다.
 * - 켜기: 권한 요청 → VAPID 공개키로 구독 → 서버 등록.
 * - 앱을 열 때: 브라우저에 구독이 있으면 서버에 다시 등록(교체·로그인 사용자 변경을 메운다).
 * - 로그아웃: 서버에서만 해제한다. 브라우저 구독은 남아 다시 로그인하면 위 재등록이 되살린다.
 * - '이 기기 알림 끄기': 브라우저 구독까지 지운다(그래야 재등록이 되살리지 않는다).
 */

type PublicKeyDto = components['schemas']['PushPublicKeyDto'];
export type TestPushResult = components['schemas']['TestPushResultDto'];

export function pushApiAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** base64url → 바이트. applicationServerKey 형식 */
export function base64UrlToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameBytes(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return true; // 브라우저가 알려 주지 않으면 같다고 본다
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

export async function fetchPublicKey(): Promise<string | null> {
  return (await api<PublicKeyDto>('GET', '/push/public-key')).publicKey;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  // PwaClient 가 이미 등록했으면 같은 등록을 돌려준다
  await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  return navigator.serviceWorker.ready;
}

/** 이 브라우저의 현재 구독. 서비스 워커가 아직 없으면 null */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushApiAvailable()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

async function register(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  await api('POST', '/push/subscriptions', {
    endpoint: sub.endpoint,
    expirationTime: sub.expirationTime,
    keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
  });
}

/** 키가 바뀌었으면(서버 키 교체) 옛 구독을 지우고 새로 만든다 */
async function subscribeWith(
  reg: ServiceWorkerRegistration,
  publicKey: string,
): Promise<PushSubscription> {
  const key = base64UrlToBytes(publicKey);
  const existing = await reg.pushManager.getSubscription();
  if (existing && sameBytes(existing.options.applicationServerKey, key)) return existing;
  if (existing) await existing.unsubscribe();
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

export type EnableResult = 'subscribed' | 'denied' | 'dismissed' | 'unavailable';

/** '알림 켜기' 버튼. 권한 대화상자는 사용자 동작 안에서만 띄울 수 있다 */
export async function enablePush(): Promise<EnableResult> {
  if (!pushApiAvailable()) return 'unavailable';
  const publicKey = await fetchPublicKey();
  if (!publicKey) return 'unavailable';
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'dismissed';
  const sub = await subscribeWith(await registration(), publicKey);
  await register(sub);
  return 'subscribed';
}

/** '이 기기 알림 끄기': 서버 해제 + 브라우저 구독 삭제 */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await serverUnsubscribe(sub.endpoint);
  await sub.unsubscribe();
}

async function serverUnsubscribe(endpoint: string): Promise<void> {
  try {
    await api('POST', '/push/subscriptions/unsubscribe', { endpoint });
  } catch (e) {
    // 404 = 이미 해제됐거나 다른 계정의 구독. 어느 쪽이든 할 일이 없다
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }
}

/**
 * 앱을 열 때(로그인 영역). 권한이 있고 브라우저 구독이 있을 때만 서버에 다시 등록한다.
 * 구독이 없으면 만들지 않는다 — 사용자가 끈 기기를 되살리지 않기 위해서다.
 */
export async function syncPush(): Promise<void> {
  if (!pushApiAvailable() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.getRegistration('/');
  const existing = reg ? await reg.pushManager.getSubscription() : null;
  if (!reg || !existing) return;
  const publicKey = await fetchPublicKey();
  if (!publicKey) return;
  await register(await subscribeWith(reg, publicKey));
}

/** 로그아웃 직전. 서버에서만 해제한다. 실패해도 로그아웃은 막지 않는다(최대 3초) */
export async function unsubscribeOnLogout(): Promise<void> {
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    await Promise.race([
      serverUnsubscribe(sub.endpoint),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch {
    // 무시
  }
}

export async function testPush(endpoint: string): Promise<TestPushResult> {
  return api<TestPushResult>('POST', '/push/test', { endpoint });
}
