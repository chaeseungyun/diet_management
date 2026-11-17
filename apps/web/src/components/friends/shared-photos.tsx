'use client';

import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { API_PREFIX } from '@diet/shared';
import type { Schemas } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';

type Photo = Schemas['SharedPhotoDto'];

/** 친구의 식사 사진(읽기 전용). 파일은 친구 전용 경로로 받는다 (DEC-090) */
export function SharedPhotos({ ownerId, photos }: { ownerId: string; photos: Photo[] }) {
  const [viewing, setViewing] = useState<Photo | null>(null);
  if (photos.length === 0) return null;
  const url = (id: string, thumb = false) =>
    `${API_PREFIX}/friends/${ownerId}/meal-photos/${id}${thumb ? '?size=thumb' : ''}`;

  return (
    <>
      <ul className="flex flex-wrap gap-2">
        {photos.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => setViewing(p)}
              aria-label={p.expired ? '사진 보관 기간 지남' : '사진 크게 보기'}
              className="block size-16 overflow-hidden rounded-lg border border-border bg-muted text-muted-foreground"
            >
              {p.expired ? (
                <span className="flex size-full items-center justify-center">
                  <ImageOff className="size-5" />
                </span>
              ) : (
                // 쿠키 인증이 필요한 같은 오리진 API 이미지라 next/image 를 쓰지 않는다
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url(p.id, true)}
                  alt="식사 사진"
                  loading="lazy"
                  className="size-full object-cover"
                />
              )}
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={viewing !== null} onClose={() => setViewing(null)} title="식사 사진">
        {viewing?.expired ? (
          <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            사진 보관 기간이 지나 사진은 지워졌어요.
          </p>
        ) : viewing ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url(viewing.id)}
            alt="식사 사진"
            width={viewing.width}
            height={viewing.height}
            className="max-h-[65dvh] w-full rounded-lg object-contain"
          />
        ) : null}
      </Dialog>
    </>
  );
}
