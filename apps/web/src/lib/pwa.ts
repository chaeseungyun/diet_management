'use client';

import { useSyncExternalStore } from 'react';

/**
 * PWA 설치·푸시 지원 환경 판별 (DEC-073, S-72). 화면 안내용이며 업무 규칙이 아니다.
 * 사용자 에이전트 판별은 안내 문구를 고르는 데만 쓴다. 기능 지원 여부는 API 존재로 본다.
 */

export type Os = 'ios' | 'android' | 'other';
export type Browser = 'safari' | 'chrome' | 'edge' | 'samsung' | 'firefox' | 'other';
export type InApp = 'kakaotalk' | 'other' | null;

export interface PwaEnv {
  os: Os;
  browser: Browser;
  /** 카카오톡·인스타그램 등 앱 안 브라우저. 설치·푸시가 안 된다 */
  inApp: InApp;
  /** 홈 화면 앱(standalone)으로 실행 중 */
  standalone: boolean;
  /** 이 환경에서 웹 푸시 API 가 있다(아이폰은 홈 화면 앱에서만 true) */
  pushSupported: boolean;
  notificationPermission: NotificationPermission | 'unsupported';
  /** 안드로이드 크롬 등에서 설치 대화상자를 우리가 띄울 수 있다 */
  canPrompt: boolean;
  installedNow: boolean;
}

export function detectOs(ua: string, maxTouchPoints = 0): Os {
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  // iPadOS 13+ Safari 는 맥 UA 를 쓴다
  if (/Macintosh/.test(ua) && maxTouchPoints > 1) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

export function detectBrowser(ua: string): Browser {
  if (/SamsungBrowser/.test(ua)) return 'samsung';
  if (/EdgiOS|EdgA|Edg\//.test(ua)) return 'edge';
  if (/FxiOS|Firefox\//.test(ua)) return 'firefox';
  if (/CriOS|Chrome\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}

export function detectInApp(ua: string): InApp {
  if (/KAKAOTALK/i.test(ua)) return 'kakaotalk';
  if (/NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp|; wv\)/i.test(ua)) {
    return 'other';
  }
  return null;
}

/** 카카오톡 인앱 브라우저에서 기본 브라우저로 현재 주소를 연다 */
export function kakaoOpenExternalUrl(href: string): string {
  return `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`;
}

/** 안드로이드에서 현재 주소를 크롬으로 연다(크롬이 없으면 아무 일도 일어나지 않을 수 있다) */
export function chromeIntentUrl(href: string): string {
  const u = new URL(href);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};package=com.android.chrome;end`;
}

// --- 설치 대화상자(beforeinstallprompt) 보관소 ---
// 이 이벤트는 페이지 로드 직후 한 번 오므로 루트 레이아웃의 PwaClient 가 받아 둔다.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installedNow = false;
let snapshot: PwaEnv | null = null;
const listeners = new Set<() => void>();

function emit() {
  snapshot = null;
  listeners.forEach((l) => l());
}

export function captureInstallPrompt(e: Event) {
  e.preventDefault(); // 브라우저 기본 미니 배너 대신 우리 버튼에서 띄운다
  deferred = e as BeforeInstallPromptEvent;
  emit();
}

export function markInstalled() {
  deferred = null;
  installedNow = true;
  emit();
}

/** 설치 대화상자를 띄운다. 띄울 수 없으면 null */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | null> {
  const e = deferred;
  if (!e) return null;
  deferred = null; // 한 이벤트는 한 번만 prompt 할 수 있다
  await e.prompt();
  const { outcome } = await e.userChoice;
  if (outcome === 'accepted') installedNow = true;
  emit();
  return outcome;
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

function readEnv(): PwaEnv {
  const ua = navigator.userAgent;
  const pushSupported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return {
    os: detectOs(ua, navigator.maxTouchPoints),
    browser: detectBrowser(ua),
    inApp: detectInApp(ua),
    standalone: isStandalone(),
    pushSupported,
    notificationPermission: 'Notification' in window ? Notification.permission : 'unsupported',
    canPrompt: deferred !== null,
    installedNow,
  };
}

function subscribe(l: () => void) {
  listeners.add(l);
  const mq = matchMedia('(display-mode: standalone)');
  mq.addEventListener('change', emit);
  return () => {
    listeners.delete(l);
    mq.removeEventListener('change', emit);
  };
}

function getSnapshot(): PwaEnv {
  if (!snapshot) snapshot = readEnv();
  return snapshot;
}

/** 브라우저에서만 값이 있다. 서버 렌더·첫 하이드레이션에서는 null */
export function usePwaEnv(): PwaEnv | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
