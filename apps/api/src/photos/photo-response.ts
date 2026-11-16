import { StreamableFile } from '@nestjs/common';
import type { ReadStream } from 'node:fs';
import type { Request, Response } from 'express';

/**
 * 사진 파일 응답 (DEC-086). 내용은 바뀌지 않지만 삭제·만료·로그아웃·공유 끄기 뒤에는 보이면 안 된다.
 * 그래서 매번 서버에 묻게 하고(no-cache), 그대로면 본문 없이 304 로 답한다.
 */
export function sendPhoto(
  req: Request,
  res: Response,
  id: string,
  variant: 'view' | 'thumb',
  opened: { stream: ReadStream; length: number },
): StreamableFile | undefined {
  const etag = `"${id}-${variant}"`;
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('ETag', etag);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.headers['if-none-match'] === etag) {
    opened.stream.destroy();
    res.status(304);
    return undefined;
  }
  return new StreamableFile(opened.stream, { type: 'image/jpeg', length: opened.length });
}
