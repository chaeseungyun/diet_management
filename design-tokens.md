# 식단·재고·체중 관리 웹앱 — 디자인 토큰과 shadcn/ui 적용 지침

버전: v0.1 (2026-11-03) / 토큰 파일: [`design/globals.css`](design/globals.css) (Claude Design으로 생성한 컬러 토큰 v0.1을 그대로 복사) / 관련: [`screens.md`](screens.md), [`requirements-phase1.md`](requirements-phase1.md) NFR-01

shadcn/ui(Tailwind v4, CSS 변수 방식) 컴포넌트에 이 토큰을 연결한다. 색상 값은 토큰 파일이 **기준**이며 이 문서는 적용 방법·의미 매핑·주의점을 남긴다. 값 변경은 토큰 파일을 고치고 이 문서의 표를 맞춘다. 토큰 값 자체는 사용자가 디자인 도구로 뽑은 결과라 ‘확정’으로 다루고, §3 도메인 매핑과 §4 컴포넌트 확장은 **[제안]**이다.

## 1. 토큰 파일 개요

- 바탕 아이보리(`#FAF8F2`) + 카드 흰색 + 포인트 Fresh Leaf(`#3FBF7F`). 다크 모드는 Warm Ink(`#171612`) 바탕.
- `--radius: 0.75rem`.
- shadcn 기본 변수 전체(`background`~`sidebar-ring`, `chart-1~5`)를 정의하고, 기본에 없는 4종을 **추가**한다: `--destructive-foreground`, `--warning(-foreground)`, `--info(-foreground)`, `--planned`.
- 색상 표기는 hex. shadcn v4 기본 템플릿은 oklch를 쓰지만 변수 값 형식은 자유라 그대로 써도 된다. `--planned`만 `color-mix(in oklab, …)`로 primary 35% + card 혼합이다.
- `@theme inline` 블록이 `--color-*`로 노출하므로 Tailwind 유틸리티 `bg-warning`, `text-info-foreground`, `bg-planned` 등이 바로 쓰인다.

## 2. 적용 방법 (Next.js + Tailwind v4 + shadcn/ui)

1. `npx shadcn@latest init` (스타일: new-york, CSS variables: yes, base color는 무엇이든 교체되므로 무관).
2. 생성된 `app/globals.css`에서 **`:root`, `.dark`, `@theme inline` 세 블록만** [`design/globals.css`](design/globals.css) 내용으로 교체한다. 아래는 유지한다.

```css
@import "tailwindcss";
@import "tw-animate-css";
@custom-variant dark (&:is(.dark *));

/* :root / .dark / @theme inline ← design/globals.css로 교체 */

@layer base {
  * { @apply border-border outline-ring/50; }
  body { @apply bg-background text-foreground; }
}
```

3. 다크 모드는 `html.dark` 클래스 토글 방식. `next-themes`로 시스템/라이트/다크를 제공한다(설정 화면 S-70). 기본값은 시스템 따름 **[제안]**.
4. 토큰 밖의 임의 hex·Tailwind 팔레트 색(`bg-green-500` 등)을 컴포넌트에 직접 쓰지 않는다. 필요한 색이 없으면 토큰을 추가한다.
5. 도메인 상태 → 토큰 매핑(§3)은 한 곳(예: `lib/status-style.ts`)에 두고 화면마다 다시 정하지 않는다.

## 3. 도메인 상태 ↔ 토큰 매핑 [제안]

토큰 파일 주석의 용도 설명을 기준으로 삼고, 문서에 없는 상태는 가까운 의미로 배정했다. 모든 상태는 색 외에 **텍스트 또는 아이콘**을 함께 둔다(NFR-01).

| 도메인 상태 (근거) | 배경 | 글자·아이콘 | 비고 |
| --- | --- | --- | --- |
| 먹었음 배지, 주요 버튼, 진행률 채움 (FR-05) | `primary` | `primary-foreground` | 토큰 주석 그대로 |
| 먹었음 카드 강조, hover·선택, 초록 텍스트·링크 | `accent` | `accent-foreground` | 배지는 `accent` 배경 + `accent-foreground` 글자 |
| 계획 포함(미기록) 예상 진행률 (FR-06 “예상 계획 합계”) | `planned` | — | 기록된 합계는 `primary`, 그 위에 미기록 예정분을 `planned`로 이어 그림 |
| 미기록 (FR-05) | 없음(외곽선 `border`) | `muted-foreground` | 빈 원 아이콘 |
| 안 먹음 (FR-05) | `muted` | `muted-foreground` | 대시 아이콘 |
| 외부 식사 (FR-04·05) | `info` | `info-foreground` | 토큰 주석 그대로 |
| 영양 미상·영양 정보 미등록·영양 불완전 (FR-02·06) | `warning` | `warning-foreground` | 토큰 주석 그대로 |
| 재고 확인 필요(음수 원장)·소진 임박·추정 신뢰도 낮음 (FR-03·08) | `warning` | `warning-foreground` | 토큰 주석 “재고 확인 필요” |
| 소진(잔량 0), 전송 실패, 삭제·취소 버튼, 폼 오류 (FR-08, NFR-03) | `destructive` | `destructive-foreground` | 텍스트만 쓸 때는 `text-destructive` |
| 예측 불가·예정 소비 없음·데이터 없음·배송 중 (FR-06·08) | 없음 | `muted-foreground` | 강조하지 않음 |
| 계획 없음 슬롯 | `secondary` | `secondary-foreground` | 낮은 강조 |

### 차트 색 (고정 의미, 시리즈 순서로 돌리지 않음)

| 토큰 | 의미 | 사용 화면 |
| --- | --- | --- |
| `chart-1` | 단백질 | S-10 영양 막대, S-60 |
| `chart-2` | 탄수화물 | 같음 |
| `chart-3` | 지방 | 같음 |
| `chart-4` | 체중 측정값 선·점 | S-50, S-60 |
| `chart-5` | 목표선·보조선(기준선, 평균선) | S-50, S-60 |

열량(kcal) 진행률은 차트 색이 아니라 `primary`(기록) + `planned`(계획 포함)를 쓴다.

## 4. shadcn 컴포넌트 확장 [제안]

기본 shadcn 컴포넌트는 `warning`·`info`·`planned`를 모르므로 variant를 추가한다. 컴포넌트 파일을 복사해 쓰는 shadcn 방식이라 수정이 정상 경로다.

| 컴포넌트 | 추가 variant | 클래스 |
| --- | --- | --- |
| Badge | `success` | `bg-accent text-accent-foreground border-transparent` |
| Badge | `warning` | `bg-warning text-warning-foreground border-transparent` |
| Badge | `info` | `bg-info text-info-foreground border-transparent` |
| Badge | `outline`(기본 제공) | 미기록용, `text-muted-foreground` 추가 |
| Alert | `warning`, `info` | Badge와 같은 조합. 영양 불완전 안내, 재고 추정 신뢰도 안내 |
| Button | `destructive`(기본 제공) | shadcn v4 기본은 `text-white`인데 토큰에 `destructive-foreground`가 있으므로 `text-destructive-foreground`로 바꿔 다크 모드 대비를 유지 |
| Progress | 2단 채움 | 기본 Progress는 채움 1개. `primary`(기록) 위에 `planned`(계획) 구간을 추가로 그리는 래퍼 컴포넌트를 만든다. 목표 초과 구간은 `destructive`가 아닌 `warning` **[제안]** |
| Sidebar | — | 토큰 `sidebar-*`가 이미 정의되어 있어 PC 레이아웃에 바로 사용 |
| Chart (Recharts) | `ChartConfig` | 시리즈 color를 `var(--chart-1)`처럼 토큰으로 지정하고 §3 의미를 고정 |

## 5. 대비 검토 (2026-11-03, WCAG 상대 휘도 공식으로 계산)

글자 쌍은 라이트·다크 모두 AA(4.5:1)를 넘는다. 비텍스트(3:1) 기준에 못 미치는 쌍이 라이트 모드에 세 개 있어 사용 규칙으로 보완한다.

| 쌍 | 라이트 | 다크 | 판정 |
| --- | ---: | ---: | --- |
| foreground / background | 16.2 | 15.7 | 통과 |
| primary-foreground / primary | 6.5 | 8.3 | 통과 (토큰 주석 6.5:1과 일치) |
| accent-foreground / accent | 6.4 | 8.8 | 통과 |
| muted-foreground / card | 5.7 | 6.6 | 통과 |
| destructive-foreground / destructive | 5.1 | 6.4 | 통과 |
| warning-foreground / warning | 4.9 | 7.4 | 통과 (라이트는 여유 적음, 작은 글자에 굵기 보완) |
| info-foreground / info | 5.3 | 6.8 | 통과 |
| primary / card (진행률 채움, 비텍스트) | 2.3 | 8.6 | **라이트 미달** |
| chart-1 단백질 / card | 3.4 | 6.6 | 통과 |
| chart-2 탄수화물 / card | 2.2 | 9.6 | **라이트 미달** |
| chart-3 지방 / card | 5.0 | 5.3 | 통과 |
| chart-5 보조선 / card | 2.5 | 2.9 | **양쪽 미달** (보조선이라 허용) |

보완 규칙 **[제안]**:

- 진행률 바는 트랙 색(`muted`)과 1px `border`를 두어 채움 경계를 색 대비에만 맡기지 않는다. 수치 텍스트를 항상 병기한다.
- 차트는 범례·직접 레이블·툴팁을 두고, 탄수화물 막대·선에 1px 외곽선(`card-foreground` 20%) 또는 패턴을 더한다. 색만으로 시리즈를 구분하게 하지 않는다.
- `chart-5`는 점선 보조선 전용이며 데이터 시리즈에 쓰지 않는다.
- `primary`를 글자색으로 쓰지 않는다. 초록 글자는 `accent-foreground`를 쓴다.

## 6. 미정

1. 폰트(한글 본문·숫자 표기), 간격 스케일, 그림자: 토큰 파일에 없음. shadcn 기본 + 시스템 폰트로 시작 **[제안]**.
2. 다크 모드 기본값(시스템 따름 vs 라이트 고정).
3. §3 매핑 중 문서 근거가 없는 항목(소진 = destructive, 계획 없음 = secondary, 목표 초과 = warning)의 확정.
4. `--planned`의 `color-mix` 지원 범위: 검증 대상 기기(갤럭시 Chrome, iPhone Safari)에서 실기기 확인. 미지원 브라우저가 있으면 고정 hex로 대체.

## 7. 토큰 파일 전문

[`design/globals.css`](design/globals.css)와 동일하다. 값이 어긋나면 파일이 우선한다.

```css
/* 식단 관리 앱 · 컬러 토큰 v0.1
 * shadcn/ui (Tailwind v4) 기준. 기존 globals.css의 :root / .dark / @theme inline 블록을 이 내용으로 교체.
 * 바탕 아이보리 + 카드 흰색 + 포인트 Fresh Leaf.
 * shadcn 기본 변수 외 추가: --destructive-foreground, --warning(-foreground), --info(-foreground), --planned
 */

:root {
  --radius: 0.75rem;

  --background: #FAF8F2;            /* Ivory · 페이지 바탕 */
  --foreground: #1C1B17;
  --card: #FFFFFF;                  /* White · 카드 */
  --card-foreground: #1C1B17;
  --popover: #FFFFFF;
  --popover-foreground: #1C1B17;

  --primary: #3FBF7F;               /* Fresh Leaf · 먹었음·주요 버튼·진행률 */
  --primary-foreground: #0D2B1C;    /* 밝은 초록 위에는 어두운 글자 (6.5:1) */
  --secondary: #F1EEE4;
  --secondary-foreground: #1C1B17;
  --muted: #F1EEE4;
  --muted-foreground: #6B675C;
  --accent: #E5F5EB;                /* hover·선택·먹었음 배지 */
  --accent-foreground: #14633F;     /* 초록 텍스트·링크 */

  --destructive: #C73E29;
  --destructive-foreground: #FFFFFF;
  --warning: #FDF1DC;               /* 영양 미상·재고 확인 필요 */
  --warning-foreground: #9A5B00;
  --info: #E8EFFB;                  /* 외부 식사 */
  --info-foreground: #2F5FB3;

  --border: #E7E3D7;
  --input: #E2DED1;
  --ring: #3FBF7F;

  --planned: color-mix(in oklab, var(--primary) 35%, var(--card)); /* 계획 포함(미기록) 진행률 */

  --chart-1: #1E9E64;               /* 단백질 */
  --chart-2: #E2A23B;               /* 탄수화물 */
  --chart-3: #4C6BC0;               /* 지방 */
  --chart-4: #3A3832;               /* 체중 선 */
  --chart-5: #A8A396;               /* 목표·보조선 */

  --sidebar: #FFFFFF;
  --sidebar-foreground: #1C1B17;
  --sidebar-primary: #3FBF7F;
  --sidebar-primary-foreground: #0D2B1C;
  --sidebar-accent: #E5F5EB;
  --sidebar-accent-foreground: #14633F;
  --sidebar-border: #E7E3D7;
  --sidebar-ring: #3FBF7F;
}

.dark {
  --background: #171612;            /* Warm Ink */
  --foreground: #F2EFE4;            /* 아이보리가 글자색으로 */
  --card: #201F1A;
  --card-foreground: #F2EFE4;
  --popover: #201F1A;
  --popover-foreground: #F2EFE4;

  --primary: #52D190;
  --primary-foreground: #0B2618;
  --secondary: #2A2923;
  --secondary-foreground: #F2EFE4;
  --muted: #2A2923;
  --muted-foreground: #A8A396;
  --accent: #1D3326;
  --accent-foreground: #86E3B0;

  --destructive: #F0745C;
  --destructive-foreground: #2A0D07;
  --warning: #3A2C12;
  --warning-foreground: #F2B54D;
  --info: #1C2740;
  --info-foreground: #8DB0F2;

  --border: #33312A;
  --input: #3A3830;
  --ring: #52D190;

  --chart-1: #3DB97C;
  --chart-2: #F0BE63;
  --chart-3: #6F8FE6;
  --chart-4: #E9E5D8;
  --chart-5: #6B675C;

  --sidebar: #201F1A;
  --sidebar-foreground: #F2EFE4;
  --sidebar-primary: #52D190;
  --sidebar-primary-foreground: #0B2618;
  --sidebar-accent: #1D3326;
  --sidebar-accent-foreground: #86E3B0;
  --sidebar-border: #33312A;
  --sidebar-ring: #52D190;
}

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --color-info: var(--info);
  --color-info-foreground: var(--info-foreground);
  --color-planned: var(--planned);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
}
```
