import { Inject, Injectable } from '@nestjs/common';
import * as webpush from 'web-push';
import { ENV, type Env } from '../config/env';

/** 푸시 본문. 서비스 워커(public/sw.js)가 그대로 띄운다 */
export interface PushPayload {
  title: string;
  body?: string;
  /** 탭했을 때 열 같은 오리진 경로 */
  url?: string;
  /** 같은 tag 의 알림은 새것으로 바뀐다(재알림이 쌓이지 않게) */
  tag?: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * 발송 결과 분류 (DEC-075).
 * gone = 404·410: 구독이 죽었다 → revoked_at.
 * transient = 429·5xx·네트워크: 유예 안에서 다시 시도.
 * permanent = 그 밖(400·403·413 등): 다시 보내도 같다. 403 은 대개 VAPID 키 문제라 구독은 두고 사유만 남긴다.
 */
export type SendResult =
  | { kind: 'ok'; status: number }
  | { kind: 'gone'; status: number }
  | { kind: 'transient'; status: number | null; reason: string }
  | { kind: 'permanent'; status: number | null; reason: string };

export interface PushSender {
  send(target: PushTarget, payload: PushPayload): Promise<SendResult>;
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');

/** 폰이 꺼져 있어도 이 시간 안에만 전달한다. 유예 15분과 같은 이유로 늦은 '점심 기록' 알림을 막는다 */
export const PUSH_TTL_SECONDS = 15 * 60;

export function classify(status: number | null, message: string): SendResult {
  if (status !== null && status >= 200 && status < 300) return { kind: 'ok', status };
  if (status === 404 || status === 410) return { kind: 'gone', status };
  if (status === null || status === 429 || status >= 500) {
    return { kind: 'transient', status, reason: message.slice(0, 200) };
  }
  return { kind: 'permanent', status, reason: message.slice(0, 200) };
}

/** web-push(DEC-072) 로 VAPID 서명·본문 암호화·발송을 한다 */
@Injectable()
export class WebPushSender implements PushSender {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async send(target: PushTarget, payload: PushPayload): Promise<SendResult> {
    if (!this.env.pushEnabled) {
      return { kind: 'permanent', status: null, reason: 'push not configured' };
    }
    try {
      const res = await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        {
          TTL: PUSH_TTL_SECONDS,
          urgency: 'high',
          vapidDetails: {
            subject: this.env.VAPID_SUBJECT,
            publicKey: this.env.VAPID_PUBLIC_KEY,
            privateKey: this.env.VAPID_PRIVATE_KEY,
          },
        },
      );
      return classify(res.statusCode, '');
    } catch (e) {
      if (e instanceof webpush.WebPushError) return classify(e.statusCode, e.body || e.message);
      return classify(null, e instanceof Error ? e.message : String(e));
    }
  }
}
