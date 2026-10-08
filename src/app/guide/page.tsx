// `/guide` — 사용 안내, 혼자 보기 (PG-61). 로그인한 사람 누구나.
//
// 2026-10-08 — 빠르게 녹화한 GIF를 걷고 **한 장씩 넘기는 단계**로 바꿨다(PG-57). 움직이는 그림은 보는 사람이
// 속도를 정할 수 없어 「너무 빨라서 읽기 어렵다」였다. 같은 단계 목록을 11/2 운영회의에서는 발표 모드
// (`/guide/present`)로 넘기고, 그 뒤에는 각자 여기서 넘겨 본다.
//
// 그림은 전부 가짜 데이터로 찍은 것이다(`scripts/guide-capture.cjs` — PG-62). 저장소가 public이고,
// 실제 화면에는 동료의 이름과 업무가 그대로 나온다.
//
// 무엇을 그릴지(이 사람이 쓰는 장)는 `guideCaps` 하나가 정한다(TACP-9·12). 예전에는 이 페이지가
// 역할 플래그를 직접 보고 절을 걸렀다 — 같은 판정이 화면마다 따로 적히면 갈라진다.
//
// 2026-10-08 (R18) — 단계 밖에 붙어 있던 배지 셋·「자주 묻는 것」·월간 주 예시·업로드 안내 상자를 걷었다. 단계가 말하는 것을
// 다시 적은 글이었고, 알림 시각처럼 바뀌는 사실은 글로 두면 틀린 채 남는다(실제로 알림 FAQ가 그랬다).
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requirePageScope } from '@/server/page-scope';
import { guideCaps, rollupNav } from '@/server/authz';
import { noticeFor } from '@/components/Notice';
import { AppHeader } from '@/components/AppHeader';
import { AppFooter } from '@/components/AppFooter';
import { GuideSelf } from '@/components/GuideSelf';

export const dynamic = 'force-dynamic';
export const metadata = { title: '사용 안내' };

export default async function GuidePage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  // AU-22 — 표준 진입점. 미인증·초기 비밀번호 미변경은 여기서 내보낸다
  const ps = await requirePageScope();
  if (!ps.ok) return noticeFor(ps.code, ps.message);
  const { scope } = ps;
  // PG-59 — `?mode=present`도 발표 모드로 (회의 공지에 적기 쉬운 주소)
  if ((await searchParams).mode === 'present') redirect('/guide/present');

  const [caps, rnav] = await Promise.all([guideCaps(scope), rollupNav(scope)]);
  return (
    <div className="flex min-h-screen flex-col">
      <div className="print:hidden">
        <AppHeader
          slug={scope.division.slug}
          divisionName={scope.division.nameKo}
          userName={scope.user.name}
          isLead={scope.isManager || scope.readAll}
          isOperator={scope.user.isOperator}
          readAll={scope.readAll}
          {...rnav}
          viaCloudflare={scope.source === 'cloudflare'}
        />
      </div>

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-5 pt-8 pb-8 print:max-w-none print:p-0">
        <div className="page-head print:hidden">
          <div className="min-w-0">
            <h1 className="page-title">사용 안내</h1>
            <p className="page-sub">
              한 주의 흐름대로 한 장씩 넘겨 보세요. <strong className="font-semibold text-ink">내 역할의 장</strong>이 맨 앞에 있습니다.
            </p>
          </div>
          {/* PG-59 — 발표는 새 탭에서: 이 화면(목차)을 띄워 둔 채 발표 화면을 프로젝터로 보낸다 */}
          {/* 휴대폰에서 발표할 일은 없다 — 640px 이상에서만 */}
          <Link href="/guide/present" target="_blank" className="btn-ghost hidden sm:inline-flex">
            발표 모드로 보기 <span aria-hidden>↗</span>
          </Link>
        </div>

        <GuideSelf caps={caps} />
      </main>
      <div className="print:hidden">
        <AppFooter />
      </div>
    </div>
  );
}
