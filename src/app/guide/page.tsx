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
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requirePageScope } from '@/server/page-scope';
import { guideCaps, rollupNav } from '@/server/authz';
import { hwpUploadOpen } from '@/server/submit-mode';
import { noticeFor } from '@/components/Notice';
import { AppHeader } from '@/components/AppHeader';
import { AppFooter } from '@/components/AppFooter';
import { GuideSelf } from '@/components/GuideSelf';
import { monthlyMondayOf, toKstIso } from '@/lib/week';

export const dynamic = 'force-dynamic';
export const metadata = { title: '사용 안내' };

/**
 * 월간 주 예시를 **오늘 날짜에서 만든다** (WS-16).
 *
 * 처음에는 "2026년 5월은 31일이 일요일이라…"라고 적어 뒀는데, 그건 해가 바뀌는
 * 순간 낡은 안내가 된다. 규칙 자체가 날짜에서 계산되므로 예시도 그렇게 만든다 —
 * 몇 년 뒤에 열어도 그때의 이번 달·다음 달이 나온다.
 */
function monthlyExamples(now: Date): { month: string; range: string; note: string }[] {
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const kstNow = new Date(now.getTime() + 9 * 3600_000);
  const out = [];
  for (let i = 0; i < 2; i++) {
    const y = kstNow.getUTCFullYear();
    const m = kstNow.getUTCMonth() + 1 + i;
    const year = y + Math.floor((m - 1) / 12);
    const month = ((m - 1) % 12) + 1;
    const monday = monthlyMondayOf(year, month);
    const sunday = new Date(monday.getTime() + 6 * 86400_000);
    const md = (d: Date) => {
      const k = toKstIso(d); // YYYY-MM-DDTHH:mm:ss+09:00
      const [Y, M, D] = k.slice(0, 10).split('-').map(Number);
      return { Y, M, D, dow: DOW[new Date(Date.UTC(Y, M - 1, D)).getUTCDay()] };
    };
    const a = md(monday);
    const b = md(sunday);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const lastDow = DOW[new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay()];
    out.push({
      month: `${year}년 ${month}월`,
      range: `${a.M}월 ${a.D}일(${a.dow}) ~ ${b.M}월 ${b.D}일(${b.dow})`,
      note:
        b.M === month
          ? `말일 ${lastDay}일(${lastDow})로 그 주가 끝납니다`
          : `말일 ${lastDay}일(${lastDow})이 이 주에 있어, 주는 ${b.M}월로 넘어갑니다`,
    });
  }
  return out;
}

export default async function GuidePage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  // AU-22 — 표준 진입점. 미인증·초기 비밀번호 미변경은 여기서 내보낸다
  const ps = await requirePageScope();
  if (!ps.ok) return noticeFor(ps.code, ps.message);
  const { scope } = ps;
  // PG-59 — `?mode=present`도 발표 모드로 (회의 공지에 적기 쉬운 주소)
  if ((await searchParams).mode === 'present') redirect('/guide/present');

  const [caps, rnav] = await Promise.all([guideCaps(scope), rollupNav(scope)]);
  const has = new Set(caps);
  const examples = monthlyExamples(new Date());
  // WA-32 — 안내의 단계는 웹 작성만이다. 업로드가 아직 열린 서버(운영 1단계, ADR-0014)에서는 그 길이 있다는 것만 한 줄로
  const uploadOpen = hwpUploadOpen();

  // 단계 밖의 쓸모 있는 것 — 예전 안내의 글 매뉴얼에서 단계로 옮기지 않은 것만 남긴다. 역할 것은 그 역할에게만 (TACP-9)
  const faq: [string, string][] = [
    [
      '주간과 월간은 어떻게 구분되나요?',
      `그 달의 마지막 날이 들어 있는 주가 마지막 주이고, 그 주에는 월간 업무일지를 냅니다. ${examples
        .map((e) => `${e.month}은 ${e.range} — ${e.note}`)
        .join('. ')}. 월간 주에는 제출 화면 위쪽에 초록색 [월간] 표시가 뜹니다.`,
    ],
    ['월간에는 뭘 더 써야 하나요?', '한 주가 아니라 한 달치를 정리합니다. 양식과 마감(목요일 14:00)은 주간과 같고, 분량이 늘어납니다. 병합본 파일 이름도 "월간업무"로 나옵니다.'],
    ['알림은 언제 오나요?', '아직 내지 않은 분에게만 갑니다 — 마감 전날 11:45, 마감 당일 09:00, 마감 1시간 전, 마감 10분 전. 이미 냈으면 오지 않습니다. 사내 메신저 알림함으로 옵니다.'],
    ['연휴 때 마감이 바뀌면요?', '그 주만 마감이 당겨지고, 제출 화면의 마감 표시가 빨갛게 바뀌며 이유가 함께 나옵니다. 알림도 바뀐 마감에 맞춰 나갑니다. 다음 주에는 평소대로 돌아갑니다.'],
    ['마감을 놓치면 어떻게 되나요?', '마감 후에는 제출도 취소도 되지 않습니다. 담당자에게 말씀해 주세요 — 담당자가 마감을 잠시 열어 둘 수 있습니다.'],
    ['다른 사람이 낸 내용을 볼 수 있나요?', '부서원끼리는 누가 언제 냈는지만 봅니다. 업무일지 내용은 부서담당자부터 볼 수 있고, 마감 뒤 만들어진 부서 병합본은 [보관함]에서 모두 봅니다.'],
    ...(has.has('manager')
      ? ([
          [
            '부서원 업무일지를 직접 고칠 수 있나요?',
            '[수합 관리]에서 이름을 눌러 열고 오른쪽 위 [고치기] → 표를 고쳐 [고쳐서 저장]. 덮어쓰지 않고 그 사람의 새 판이 생기며, 판 목록과 본인의 [내 이력]에 「○○ 고침」이 남습니다. 병합본에 넣으려면 [다시 병합]을 누릅니다.',
          ],
        ] as [string, string][])
      : []),
    ...(has.has('schedule')
      ? ([
          [
            '연휴 마감을 바꿀 때 알아 둘 것은요?',
            '공지의 시각은 대외 마감이고, 부서 마감은 자동으로 한 시간 앞으로 잡힙니다(대외 15:00 → 부서 14:00). 요일이 날짜와 맞지 않으면 적용하지 않습니다. 이미 지난 알림은 다시 나가지 않고, 이미 지난 마감은 옮길 수 없습니다 — 잘못 넣었으면 마감 전에 [평소대로 되돌리기]. 붙여넣기가 안 되면 [직접 입력]에서 대외 마감을 고르면 됩니다.',
          ],
        ] as [string, string][])
      : []),
    ...(has.has('hq')
      ? ([['본부본을 본부에서 고칠 수 있나요?', '고치지 않습니다 — 실·팀 안의 내용은 그 실·팀의 것입니다. 고칠 곳은 그 실·팀이 고쳐 다시 내고, 본부에서 다시 이어 붙입니다.']] as [string, string][])
      : []),
    ['비밀번호를 잊었습니다', '로그인 화면의 [비밀번호를 잊으셨나요?]를 누르면 메신저로 재설정 링크가 옵니다. 처음 받은 비밀번호는 첫 로그인 때 반드시 바꾸게 되어 있습니다.'],
    ['화면 속 이름은 누구인가요?', '전부 지어낸 인물입니다. 안내 그림은 실제 데이터가 아닌 예시 데이터로 찍었습니다.'],
  ];

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
          notifyEnabled={scope.user.notifyEnabled}
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

        <div className="mt-5 flex flex-wrap gap-2 print:hidden">
          <span className="badge-pill">마감 매주 목요일 14:00</span>
          <span className="badge-pill">다시 내면 새 버전</span>
          {/* 규칙이지 상태가 아니다 — 초록(상태 색)을 쓰지 않는다 (CP-100) */}
          <span className="badge-pill">그 달 마지막 주는 월간</span>
        </div>

        <GuideSelf caps={caps} />

        {uploadOpen && (
          <p className="callout callout-muted mt-6 print:hidden">
            이 서버에서는 아직 한글 파일을 올려 내는 길도 열려 있습니다 — 「이번 주 업무일지」 카드의 [파일 올리기] 탭.
            안내는 웹에서 적는 방법만 보여 줍니다.
          </p>
        )}

        <h2 className="mt-12 mb-4 text-[17px] font-semibold text-ink print:hidden">자주 묻는 것</h2>
        <div className="card card-flush divide-y divide-hairline-soft print:hidden">
          {faq.map(([q, a]) => (
            <details key={q} className="disclosure group px-5 py-4 sm:px-6">
              <summary className="text-[15px]">{q}</summary>
              <p className="mt-2 text-[15px] leading-6 text-body">{a}</p>
            </details>
          ))}
        </div>
      </main>
      <div className="print:hidden">
        <AppFooter />
      </div>
    </div>
  );
}
