'use client';

import { useRef, useState } from 'react';
import { ImageOff, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import {
  API_PREFIX,
  PHOTO_MAX_PER_RECORD,
  PHOTO_MAX_RETENTION_DAYS,
  PHOTO_MAX_UPLOAD_BYTES,
} from '@diet/shared';
import type { Schemas } from '@/lib/api';
import { api, upload } from '@/lib/client';
import { ERROR_MESSAGES } from '@/lib/error-messages';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { StatusBanner, useStatus } from '@/components/ui/status';
import { cn } from '@/lib/utils';

export type MealPhoto = Schemas['MealPhotoDto'];

/** 서버가 받는 형식 (DEC-086). 아이폰은 이 목록에 HEIC 가 없으면 JPEG 로 바꿔서 넘긴다 */
const ACCEPT = 'image/jpeg,image/png,image/webp';
const ACCEPT_TYPES = new Set(ACCEPT.split(','));

function photoUrl(id: string, thumb = false): string {
  return `${API_PREFIX}/meal-photos/${id}${thumb ? '?size=thumb' : ''}`;
}

/** 아직 기록에 붙지 않은 임시 사진을 지운다. 실패해도 24시간 뒤 서버가 지운다 (DEC-087) */
export function discardDraftPhotos(photos: MealPhoto[]): void {
  for (const p of photos) {
    if (!p.mealRecordId) void api('DELETE', `/meal-photos/${p.id}`).catch(() => undefined);
  }
}

/**
 * 식사 사진 (EXT-02a, DEC-086): 썸네일 줄 → 누르면 전체 보기.
 * edit 를 주면 '사진 추가'·삭제가 붙는다. 저장된 기록(recordId)에는 올리는 즉시 붙고,
 * 아직 저장 전이면 임시 사진으로 올려 두었다가 부모가 기록 저장의 photoIds 로 붙인다.
 */
export function MealPhotos({
  photos,
  edit,
  compact = false,
  className,
}: {
  photos: MealPhoto[];
  edit?: {
    /** 저장된 '먹었음' 기록의 id. 없으면 임시 사진으로 올린다 */
    recordId: string | null;
    onChange: (next: MealPhoto[]) => void;
  };
  /** 오늘 화면 카드용 작은 썸네일 */
  compact?: boolean;
  className?: string;
}) {
  const { status, run, set } = useStatus();
  const input = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<MealPhoto | null>(null);
  const [busy, setBusy] = useState(false);

  // 보관 기간이 지난 자리는 장수에 세지 않는다(서버와 같은 기준)
  const room = PHOTO_MAX_PER_RECORD - photos.filter((p) => !p.expired).length;
  const tile = compact ? 'size-12' : 'size-16';

  async function add(files: File[]) {
    if (!edit || files.length === 0) return;
    const picked = files.slice(0, room);
    let next = photos;
    setBusy(true);
    try {
      for (const file of picked) {
        if (!ACCEPT_TYPES.has(file.type)) {
          set({ kind: 'error', message: ERROR_MESSAGES.PHOTO_UNSUPPORTED });
          return;
        }
        if (file.size > PHOTO_MAX_UPLOAD_BYTES) {
          set({ kind: 'error', message: '사진 한 장은 10 MB까지 올릴 수 있어요.' });
          return;
        }
        const form = new FormData();
        form.append('file', file);
        if (edit.recordId) form.append('mealRecordId', edit.recordId);
        const saved = await run(
          () => upload<MealPhoto>('/meal-photos', form),
          files.length > room
            ? `사진은 한 끼에 ${PHOTO_MAX_PER_RECORD}장까지 넣었어요`
            : '사진을 올렸어요',
          { messages: { PAYLOAD_TOO_LARGE: '사진 한 장은 10 MB까지 올릴 수 있어요.' } },
        );
        // 한 장씩 반영한다: 중간에 실패해도 올라간 사진은 화면에 남는다
        next = [...next, saved];
        edit.onChange(next);
      }
    } catch {
      // 배너가 표시한다
    } finally {
      setBusy(false);
    }
  }

  async function remove(photo: MealPhoto) {
    if (!edit) return;
    setBusy(true);
    try {
      await run(() => api('DELETE', `/meal-photos/${photo.id}`), '사진을 지웠어요');
      setViewing(null);
      edit.onChange(photos.filter((p) => p.id !== photo.id));
    } catch {
      // 배너
    } finally {
      setBusy(false);
    }
  }

  if (!edit && photos.length === 0) return null;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <ul className="flex flex-wrap gap-2">
        {photos.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => setViewing(p)}
              aria-label={p.expired ? '사진 보관 기간 지남' : '사진 크게 보기'}
              className={cn(
                tile,
                'block overflow-hidden rounded-lg border border-border bg-muted text-muted-foreground',
              )}
            >
              {p.expired ? (
                <span className="flex size-full items-center justify-center">
                  <ImageOff className="size-5" />
                </span>
              ) : (
                // 쿠키 인증이 필요한 같은 오리진 API 이미지라 next/image 를 쓰지 않는다
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoUrl(p.id, true)}
                  alt="식사 사진"
                  loading="lazy"
                  className="size-full object-cover"
                />
              )}
            </button>
          </li>
        ))}
        {edit && room > 0 ? (
          <li>
            <button
              type="button"
              disabled={busy}
              onClick={() => input.current?.click()}
              aria-label="사진 추가"
              className={cn(
                tile,
                'flex flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-border text-muted-foreground hover:bg-accent/50 disabled:opacity-50',
              )}
            >
              {busy ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <ImagePlus className="size-5" />
              )}
              {compact ? null : <span className="text-[11px]">사진 추가</span>}
            </button>
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                // 같은 파일을 다시 고를 수 있게 비운다
                e.target.value = '';
                void add(files);
              }}
            />
          </li>
        ) : null}
      </ul>
      {edit && !compact ? (
        <p className="text-xs text-muted-foreground">
          사진은 최대 {PHOTO_MAX_RETENTION_DAYS}일 보관 뒤 자동 삭제됩니다. 기록·영양 값은 남습니다.
          한 끼에 {PHOTO_MAX_PER_RECORD}장까지.
        </p>
      ) : null}
      <StatusBanner status={status} />

      <Dialog open={viewing !== null} onClose={() => setViewing(null)} title="식사 사진">
        {viewing?.expired ? (
          <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            사진 보관 기간이 지나 사진은 지워졌어요. 기록과 영양 값은 그대로 남아 있어요.
          </p>
        ) : viewing ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl(viewing.id)}
            alt="식사 사진"
            width={viewing.width}
            height={viewing.height}
            className="max-h-[65dvh] w-full rounded-lg object-contain"
          />
        ) : null}
        {edit && viewing ? (
          <Button variant="outline" disabled={busy} onClick={() => remove(viewing)}>
            <Trash2 className="size-4" />
            {viewing.expired ? '이 자리 지우기' : '사진 삭제'}
          </Button>
        ) : null}
      </Dialog>
    </div>
  );
}
