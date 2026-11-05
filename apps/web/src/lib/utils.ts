import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn/ui 관례의 클래스 병합 (design-tokens.md §2) */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** 로그아웃 시 사용자별 로컬 임시 입력 삭제 (NFR-04). 임시 입력은 `draft:` 접두사로 저장한다. */
export function clearLocalDrafts(): void {
  try {
    const keys = Object.keys(window.localStorage).filter((k) => k.startsWith('draft:'));
    for (const k of keys) window.localStorage.removeItem(k);
  } catch {
    // 비공개 모드 등 저장소 접근 실패는 무시
  }
}
