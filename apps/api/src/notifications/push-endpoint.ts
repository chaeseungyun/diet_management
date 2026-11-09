/**
 * 푸시 endpoint 검사 (DEC-074). 서버는 사용자가 보낸 endpoint 로 HTTP 요청을 보내므로,
 * 아무 URL 이나 받으면 내부망·메타데이터 주소로 요청을 보내게 만들 수 있다(SSRF).
 * https 이고 알려진 브라우저 푸시 서비스 호스트일 때만 받는다.
 */
const ALLOWED_HOST_SUFFIXES = [
  'fcm.googleapis.com', // 크롬·삼성 인터넷·오페라·안드로이드 엣지
  'push.apple.com', // Safari(web.push.apple.com)
  'push.services.mozilla.com', // 파이어폭스
  'notify.windows.com', // PC 엣지(WNS)
] as const;

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}
