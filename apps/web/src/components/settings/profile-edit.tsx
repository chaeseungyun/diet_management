'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  AVATAR_VIEW_PX,
  NICKNAME_MAX_LENGTH,
  PHOTO_MAX_UPLOAD_BYTES,
  STATUS_MESSAGE_MAX_LENGTH,
} from '@diet/shared';
import type { MeDto } from '@/lib/api';
import { upload } from '@/lib/client';
import { ERROR_MESSAGES, type ErrorMessageOptions } from '@/lib/error-messages';
import { PHOTO_ACCEPT, PHOTO_ACCEPT_TYPES, shrinkPhoto } from '@/lib/photo-file';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { StatusBanner, useStatus } from '@/components/ui/status';

/** 이 화면에서는 사진 오류를 프로필 사진 말로 안내한다 (DEC-079·104) */
const ERRORS: ErrorMessageOptions = {
  messages: {
    PHOTO_DAILY_LIMIT: '오늘은 프로필 사진을 더 바꿀 수 없어요. 내일 다시 해 주세요.',
    PHOTO_STORAGE_FULL:
      '사진 저장 공간이 가득 차서 지금은 사진을 바꿀 수 없어요. 사진 없이 저장할 수 있어요.',
    PAYLOAD_TOO_LARGE: '사진이 너무 커요. 10 MB까지 올릴 수 있어요.',
  },
  fields: { nickname: '닉네임', statusMessage: '상태 메시지' },
};

/**
 * S-74 프로필 편집 (DEC-104): 사진·닉네임·상태 메시지.
 * 사진은 고르면 미리보기만 바뀌고, '저장' 을 눌러야 글자와 함께 요청 하나로 서버에 올라간다.
 * 저장하지 않고 나가면 아무것도 바뀌지 않는다.
 */
export function ProfileEdit({ me: initial }: { me: MeDto }) {
  // 저장 응답으로 바꿔 든다: 새로 고침을 기다리지 않고 새 사진·글자를 기준으로 그린다
  const [me, setMe] = useState(initial);
  const router = useRouter();
  const { status, run, set } = useStatus();
  const input = useRef<HTMLInputElement>(null);
  const [nickname, setNickname] = useState(me.nickname);
  const [statusMessage, setStatusMessage] = useState(me.statusMessage ?? '');
  // 고른 사진(아직 올리지 않음)과 그 미리보기 주소
  const [picked, setPicked] = useState<{ file: File; url: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  // 화면을 떠나면 미리보기 주소를 놓아준다
  useEffect(
    () => () => {
      if (pickedRef.current) URL.revokeObjectURL(pickedRef.current.url);
    },
    [],
  );

  const hasPhoto = picked !== null || (me.avatarId !== null && !removing);
  const dirty =
    nickname.trim() !== me.nickname ||
    statusMessage.trim() !== (me.statusMessage ?? '') ||
    picked !== null ||
    (removing && me.avatarId !== null);

  function clearPicked() {
    if (picked) URL.revokeObjectURL(picked.url);
    setPicked(null);
  }

  async function pick(original: File | undefined) {
    if (!original) return;
    // 고르는 순간 먼저 거른다. 확정 판정은 저장할 때 서버가 한다
    if (!PHOTO_ACCEPT_TYPES.has(original.type)) {
      set({ kind: 'error', message: ERROR_MESSAGES.PHOTO_UNSUPPORTED });
      return;
    }
    const file = await shrinkPhoto(original, AVATAR_VIEW_PX);
    if (file.size > PHOTO_MAX_UPLOAD_BYTES) {
      set({ kind: 'error', message: '사진은 10 MB까지 올릴 수 있어요.' });
      return;
    }
    clearPicked();
    setPicked({ file, url: URL.createObjectURL(file) });
    setRemoving(false);
    set({ kind: 'idle' });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const form = new FormData();
    form.append('nickname', nickname.trim());
    form.append('statusMessage', statusMessage.trim());
    if (picked) form.append('file', picked.file);
    else if (removing) form.append('removeAvatar', 'true');
    setBusy(true);
    try {
      const saved = await run(
        () => upload<MeDto>('/me/profile', form, 'PUT'),
        '프로필을 저장했어요',
        ERRORS,
      );
      setMe(saved);
      clearPicked();
      setRemoving(false);
      setNickname(saved.nickname);
      setStatusMessage(saved.statusMessage ?? '');
      router.refresh();
    } catch {
      // 배너가 표시한다. 고른 사진과 적은 내용은 그대로 둔다
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-3">
        <Avatar
          userId={me.id}
          nickname={nickname || me.nickname}
          avatarId={removing ? null : me.avatarId}
          src={picked?.url}
          className="size-28 text-4xl"
        />
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {hasPhoto ? '사진 바꾸기' : '사진 고르기'}
          </Button>
          {hasPhoto ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                clearPicked();
                setRemoving(true);
              }}
            >
              사진 지우기
            </Button>
          ) : null}
          {picked || removing ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                clearPicked();
                setRemoving(false);
              }}
            >
              되돌리기
            </Button>
          ) : null}
        </div>
        <input
          ref={input}
          type="file"
          accept={PHOTO_ACCEPT}
          hidden
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            // 같은 파일을 다시 골라도 change 가 나게 비운다
            e.target.value = '';
          }}
        />
        {picked || (removing && me.avatarId) ? (
          <p className="text-xs text-muted-foreground">
            아직 저장되지 않았어요. &apos;저장&apos;을 눌러야 바뀌어요.
          </p>
        ) : null}
      </div>

      <Field label="닉네임" htmlFor="nick">
        <Input
          id="nick"
          required
          maxLength={NICKNAME_MAX_LENGTH}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
      </Field>
      <Field
        label="상태 메시지"
        htmlFor="status-message"
        hint={`${statusMessage.length}/${STATUS_MESSAGE_MAX_LENGTH}자 · 비워 두면 보이지 않아요`}
      >
        <Input
          id="status-message"
          maxLength={STATUS_MESSAGE_MAX_LENGTH}
          value={statusMessage}
          onChange={(e) => setStatusMessage(e.target.value)}
        />
      </Field>

      <p className="text-xs text-muted-foreground">
        사진·닉네임·상태 메시지는 친구에게 보이고, 친구의 끼니 댓글창에서는 그 친구의 다른
        친구에게도 보여요. 끼니 공개 범위와는 상관없어요.
      </p>

      <StatusBanner status={status} />
      <Button type="submit" disabled={busy || !dirty || nickname.trim() === ''}>
        {busy ? '저장 중…' : '저장'}
      </Button>
    </form>
  );
}
