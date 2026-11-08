'use client';

import { useState } from 'react';
import { CheckCircle2, CircleAlert, Share, SquarePlus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button, buttonClasses } from '@/components/ui/button';
import { kakaoOpenExternalUrl, promptInstall, usePwaEnv, type PwaEnv } from '@/lib/pwa';

/** S-72 설치 안내 본문. 환경을 판별해 그 기기에 맞는 방법 하나만 보인다 */
export function InstallGuide() {
  const env = usePwaEnv();
  if (!env) return <p className="text-sm text-muted-foreground">이 기기를 확인하는 중…</p>;
  return (
    <div className="flex flex-col gap-4">
      <StatusCard env={env} />
      <Steps env={env} />
      <p className="text-xs text-muted-foreground">
        알림을 받을 수 없는 기기에서도 오늘 화면에서 기록하지 않은 끼니를 확인할 수 있습니다.
      </p>
    </div>
  );
}

function StatusCard({ env }: { env: PwaEnv }) {
  const installed = env.standalone || env.installedNow;
  const push = env.pushSupported
    ? '이 기기에서 알림을 받을 수 있습니다.'
    : env.os === 'ios' && !env.standalone
      ? '아이폰은 홈 화면에 추가한 앱에서만 알림을 받을 수 있습니다(iOS 16.4 이상).'
      : '이 브라우저에서는 알림을 받을 수 없습니다.';
  return (
    <Card className="flex flex-col gap-2 p-4 text-sm">
      <Row
        ok={installed}
        text={installed ? '홈 화면 앱으로 쓰고 있습니다.' : '아직 브라우저에서 열려 있습니다.'}
      />
      <Row ok={env.pushSupported} text={push} />
    </Card>
  );
}

function Row({ ok, text }: { ok: boolean; text: string }) {
  const Icon = ok ? CheckCircle2 : CircleAlert;
  return (
    <p className="flex items-start gap-2">
      <Icon
        className={
          ok
            ? 'mt-0.5 size-4 shrink-0 text-accent-foreground'
            : 'mt-0.5 size-4 shrink-0 text-muted-foreground'
        }
        aria-hidden
      />
      <span>{text}</span>
    </p>
  );
}

const ShareIcon = () => (
  <Share className="inline size-4 align-text-bottom" aria-label="공유 버튼" />
);

function Steps({ env }: { env: PwaEnv }) {
  if (env.standalone || env.installedNow) {
    return (
      <Guide title="설치 완료">
        <li>홈 화면 아이콘으로 열면 주소창 없이 앱처럼 쓸 수 있습니다.</li>
        {env.os === 'ios' ? (
          <li>홈 화면 앱은 Safari 와 로그인이 따로라서, 처음 한 번은 앱에서 다시 로그인합니다.</li>
        ) : null}
      </Guide>
    );
  }
  if (env.inApp === 'kakaotalk') return <KakaoInApp />;
  if (env.inApp === 'other') return <OtherInApp os={env.os} />;
  if (env.canPrompt) return <PromptInstall />;
  if (env.os === 'ios') {
    if (env.browser === 'safari') {
      return (
        <Guide title="아이폰 Safari 에서 추가하기">
          <li>
            화면 아래(또는 위)의 공유 버튼 <ShareIcon /> 을 누릅니다.
          </li>
          <li>
            목록을 내려 <b>홈 화면에 추가</b>{' '}
            <SquarePlus className="inline size-4 align-text-bottom" aria-hidden /> 를 누릅니다.
          </li>
          <li>
            ‘웹 앱으로 열기’가 켜져 있는지 확인하고 <b>추가</b>를 누릅니다.
          </li>
          <li>홈 화면의 아이콘으로 열고, 처음 한 번 다시 로그인합니다.</li>
        </Guide>
      );
    }
    if (env.browser === 'chrome' || env.browser === 'edge') {
      return (
        <Guide title="아이폰 크롬·엣지에서 추가하기">
          <li>
            주소창 옆 공유 버튼 <ShareIcon /> 을 누릅니다.
          </li>
          <li>
            <b>홈 화면에 추가</b>를 누릅니다. 메뉴에 없으면 Safari 로 열어 추가합니다.
          </li>
          <li>홈 화면의 아이콘으로 열고, 처음 한 번 다시 로그인합니다.</li>
        </Guide>
      );
    }
    return (
      <Guide title="Safari 로 열어 주세요">
        <li>이 브라우저는 홈 화면 앱 추가를 지원하지 않을 수 있습니다.</li>
        <li>Safari 에서 이 주소를 열고 공유 → 홈 화면에 추가를 누릅니다.</li>
        <CopyLink />
      </Guide>
    );
  }
  if (env.os === 'android') {
    return (
      <Guide title="안드로이드에서 추가하기">
        <li>브라우저 메뉴(⋮ 또는 ≡)를 엽니다.</li>
        <li>
          <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>(삼성 인터넷은 ‘현재 페이지 추가 → 홈 화면’)를
          누릅니다.
        </li>
        <li>메뉴에 없으면 크롬이나 삼성 인터넷으로 열어 주세요.</li>
      </Guide>
    );
  }
  return (
    <Guide title="PC">
      <li>
        PC 에서는 설치하지 않아도 됩니다. 크롬·엣지는 주소창의 설치 아이콘으로 설치할 수 있습니다.
      </li>
      <li>알림은 휴대폰에 설치한 앱에서 받는 것을 권합니다.</li>
    </Guide>
  );
}

function Guide({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <h2 className="mb-2 text-base font-semibold">{title}</h2>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">{children}</ol>
    </Card>
  );
}

function PromptInstall() {
  const [result, setResult] = useState<string | null>(null);
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-base font-semibold">홈 화면에 설치</h2>
      <p className="text-sm text-muted-foreground">
        설치하면 주소창 없이 앱처럼 열리고, 알림을 받을 수 있습니다.
      </p>
      <Button
        onClick={async () => {
          const r = await promptInstall();
          setResult(
            r === 'accepted'
              ? '설치했습니다. 홈 화면의 아이콘으로 열어 주세요.'
              : r === 'dismissed'
                ? '설치를 취소했습니다. 브라우저 메뉴의 ‘앱 설치’로도 설치할 수 있습니다.'
                : '브라우저 메뉴의 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 눌러 주세요.',
          );
        }}
      >
        설치하기
      </Button>
      {result ? <p className="text-sm">{result}</p> : null}
    </Card>
  );
}

function KakaoInApp() {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-base font-semibold">카카오톡 안에서 열려 있습니다</h2>
      <p className="text-sm text-muted-foreground">
        카카오톡 안의 브라우저에서는 홈 화면 추가와 알림이 되지 않습니다. 기본 브라우저(아이폰은
        Safari)로 열어 설치해 주세요.
      </p>
      <a href={kakaoOpenExternalUrl(location.href)} className={buttonClasses('default')}>
        다른 브라우저로 열기
      </a>
    </Card>
  );
}

function OtherInApp({ os }: { os: PwaEnv['os'] }) {
  return (
    <Guide title="앱 안의 브라우저에서 열려 있습니다">
      <li>이 화면에서는 홈 화면 추가와 알림이 되지 않습니다.</li>
      <li>
        화면의 메뉴(⋯)에서 ‘다른 브라우저로 열기’를 누르거나, 주소를 복사해{' '}
        {os === 'ios' ? 'Safari' : '크롬·삼성 인터넷'}에 붙여 넣습니다.
      </li>
      <CopyLink />
    </Guide>
  );
}

function CopyLink() {
  const [copied, setCopied] = useState(false);
  return (
    <li className="list-none">
      <Button
        variant="outline"
        className="mt-1"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(location.origin + '/');
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? '주소를 복사했습니다' : '주소 복사'}
      </Button>
    </li>
  );
}
