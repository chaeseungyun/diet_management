import { PHOTO_VIEW_PX } from '@diet/shared';

/** 서버가 받는 형식 (DEC-086). 아이폰은 이 목록에 HEIC 가 없으면 JPEG 로 바꿔서 넘긴다 */
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';
export const PHOTO_ACCEPT_TYPES = new Set(PHOTO_ACCEPT.split(','));

/**
 * 올리기 전에 서버 보관 크기(긴 변 maxPx, 기본 PHOTO_VIEW_PX)로 줄여 JPEG 로 굽는다 (DEC-088).
 * 보내는 양을 줄여 빠르게 하려는 것일 뿐이다: 검증·다시 굽기·메타데이터 제거는 그대로 서버가 한다.
 * 줄일 수 없거나 줄여도 작아지지 않으면 원본을 그대로 돌려준다.
 */
export async function shrinkPhoto(file: File, maxPx: number = PHOTO_VIEW_PX): Promise<File> {
  try {
    // 방향(EXIF)을 적용해 푼다. 구운 결과에는 EXIF 가 없으므로 여기서 돌려 둬야 한다
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      // 투명 배경은 서버와 같이 흰색으로 깐다
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.9),
      );
      // 브라우저가 JPEG 로 굽지 못하면 다른 형식을 돌려줄 수 있다
      if (!blob || blob.type !== 'image/jpeg' || blob.size >= file.size) return file;
      return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}
