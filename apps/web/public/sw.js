/*
 * 서비스 워커 (DEC-073). 1차는 푸시 수신과 알림 탭 처리만 한다.
 * - fetch 처리기를 두지 않는다: 오프라인 캐시는 1차 범위 밖(DEC-032)이고, 캐시된 API 응답이
 *   재고·기록 상태를 낡게 보여 주는 위험이 더 크다. 모든 요청은 평소처럼 네트워크로 간다.
 * - 업무 규칙을 두지 않는다(NFR-07). 보낼지 말지는 서버가 정하고, 여기서는 받은 것을 그대로 띄운다.
 *   아이폰은 푸시를 받고 알림을 띄우지 않으면 구독을 끊을 수 있으므로 push 마다 반드시 표시한다.
 * - 이 파일은 캐시하지 않도록 next.config.ts 에서 Cache-Control: no-cache 로 내보낸다.
 *
 * 푸시 본문(JSON, 서버가 보냄): { title, body?, url?, tag? }
 *   url  = 알림을 탭했을 때 열 같은 오리진 경로(예: /day/2026-11-08). 없거나 잘못되면 '/'.
 *   tag  = 같은 tag 의 알림은 새것으로 바뀐다(같은 끼니 재알림이 쌓이지 않게).
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function readPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    return { body: event.data.text() };
  }
}

/** 같은 오리진의 경로만 허용한다. 그 밖은 '/' */
function safePath(url) {
  if (typeof url !== 'string') return '/';
  try {
    const u = new URL(url, self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search : '/';
  } catch {
    return '/';
  }
}

self.addEventListener('push', (event) => {
  const data = readPayload(event);
  const tag = typeof data.tag === 'string' && data.tag ? data.tag : undefined;
  const title = typeof data.title === 'string' && data.title ? data.title : '식단 관리';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : undefined,
      tag,
      // 같은 tag 로 덮어쓸 때(재알림)도 소리·진동을 다시 낸다. 기본값 false 면 조용히 교체만 된다.
      // tag 가 없거나 빈 문자열인데 true 면 TypeError 라 tag 가 있을 때만.
      renotify: tag !== undefined,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      lang: 'ko',
      data: { url: safePath(data.url) },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const same = wins.find((w) => new URL(w.url).pathname === path);
      if (same) return same.focus();
      const any = wins[0];
      if (any && 'navigate' in any) {
        await any.focus();
        return any.navigate(path);
      }
      return self.clients.openWindow(path);
    })(),
  );
});
