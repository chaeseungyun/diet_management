import { isAllowedPushEndpoint } from './push-endpoint';

describe('isAllowedPushEndpoint (SSRF 방지, DEC-074)', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://web.push.apple.com/QGx1',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
    'https://wns2-par02p.notify.windows.com/w/?token=x',
  ])('accepts %s', (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc', // https 아님
    'https://localhost/push',
    'https://169.254.169.254/latest/meta-data',
    'https://db:5432/',
    'https://evilfcm.googleapis.com.attacker.net/x', // 접미사 위장
    'https://notfcm.googleapis.com.evil/x',
    'https://fcm.googleapis.com:8443/x', // 포트 지정
    'https://user:pw@fcm.googleapis.com/x',
    'not a url',
  ])('rejects %s', (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(false);
  });
});
