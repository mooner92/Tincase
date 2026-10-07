// `/guide` — 사용 안내 (로그인한 사람 누구나, PG-40).
//
// 화면은 애니메이션으로 보여준다. 글로 "제출 버튼을 누르고…"라고 쓰면
// 읽는 사람이 자기 화면과 대조해야 하는데, 움직이는 화면은 대조가 필요 없다.
//
// 자료는 **데모 DB로 녹화한 것**이라 사람 이름·업무 내용이 전부 가공이다
// (scripts/seed-demo.ts). 실제 화면을 찍어 두면 저장소가 public이라 개인정보가 남는다.
import { redirect } from 'next/navigation';
import { requirePageScope } from '@/server/page-scope';
import { canScheduleDeadlines, rollupNav } from '@/server/authz';
import { noticeFor } from '@/components/Notice';
import { AppHeader } from '@/components/AppHeader';
import { AppFooter } from '@/components/AppFooter';
import { monthlyMondayOf, toKstIso } from '@/lib/week';

export const dynamic = 'force-dynamic';

interface Clip {
  id: string;
  step: string;
  title: string;
  lead: string;
  points: string[];
}

const SUBMIT: Clip[] = [
  {
    id: 'submit',
    step: '01',
    title: '빈 양식 받아서 올리기',
    lead: '한글로 작성하던 방식 그대로입니다. 메일 대신 이 화면에 올리는 것만 다릅니다.',
    points: [
      '[양식 다운로드] — 파일명에 이번 주차가 자동으로 들어갑니다',
      '작성한 hwp 파일을 점선 안에 끌어다 놓으면 제출됩니다',
      '같은 주에 다시 올리면 새 버전으로 저장됩니다 — 이전 것을 지울 필요가 없습니다',
    ],
  },
  {
    id: 'compose',
    step: '02',
    title: '웹에서 바로 작성하기',
    lead: '한글을 열지 않고 화면에서 바로 씁니다. 한글 표를 복사해 붙여넣는 것도 됩니다.',
    points: [
      '[웹에서 작성] → 실적 · 계획 · 특이사항을 칸에 채웁니다',
      '한글에서 표를 복사(Ctrl+C)해 첫 칸에 붙여넣으면(Ctrl+V) 여러 줄이 한 번에 들어갑니다',
      '작성 중인 내용은 자동으로 저장됩니다 — 새로고침해도 남아 있습니다',
    ],
  },
  {
    id: 'cancel',
    step: '03',
    title: '잘못 낸 것 취소하기',
    lead: '다른 주차 파일을 올렸거나 실수로 제출했다면 되돌릴 수 있습니다.',
    points: [
      '[제출 취소] — 그 주에 올린 파일이 모두 지워지고 미제출 상태가 됩니다',
      '되돌릴 수 없습니다. 취소하면 다시 올려야 합니다',
      '마감(목요일 14:00) 후에는 취소할 수 없습니다 — 담당자에게 말씀해 주세요',
    ],
  },
];

const LEADS: Clip[] = [
  {
    id: 'merge',
    step: '04',
    title: '수합하고 병합하기',
    lead: '부서담당자 화면입니다. 누가 냈는지 보고, 모인 문서를 하나로 합칩니다.',
    points: [
      '표에서 누가 냈는지 · 언제 냈는지 한눈에 보입니다',
      '[열기] — 파일을 받지 않고 내용을 화면에서 바로 확인합니다',
      '[지금 병합] — 중복을 정리해 하나의 hwp로 합칩니다 (수십 초)',
      '완성된 병합본을 내려받아 그대로 제출하면 끝입니다',
    ],
  },
];

function ClipCard({ c }: { c: Clip }) {
  return (
    <section className="card card-feature overflow-hidden">
      <div className="px-7 pt-6 pb-5">
        <p className="text-xs font-semibold tracking-[0.12em] text-brand uppercase">STEP {c.step}</p>
        <h3 className="display mt-1 text-[22px]">{c.title}</h3>
        <p className="mt-1.5 text-[15px] text-body">{c.lead}</p>
      </div>

      {/*
        시연 화면은 흰 바탕이고 안내 페이지도 흰 바탕이라, 그냥 얹으면
        **어디까지가 화면이고 어디부터가 페이지인지** 구별되지 않는다.
        그래서 브라우저 창 모양의 틀에 넣는다 — 테두리·상단 바·그림자 세 가지가
        "이건 화면 속 화면"이라고 말해 준다.
      */}
      <div className="bg-[#e7e9ea] px-5 py-6 sm:px-7">
        <figure className="overflow-hidden rounded-xl border border-border-strong bg-canvas shadow-[0_10px_28px_rgba(10,10,10,0.13)]">
          <div className="flex items-center gap-1.5 border-b border-hairline bg-surface-soft px-3.5 py-2.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-border-strong" />
            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-border-strong" />
            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-border-strong" />
            <span className="ml-2 truncate text-[12px] text-muted">{c.title}</span>
          </div>
          {/* WebP는 GIF와 같은 그림인데 용량이 1/6이다. 웹에서는 이쪽을 쓴다 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/guide/${c.id}.webp`}
            alt={`${c.title} 화면 시연`}
            className="block w-full"
            loading="lazy"
          />
        </figure>
      </div>

      <div className="px-7 pt-5 pb-6">
        <ul className="space-y-2">
          {c.points.map((p) => (
            <li key={p} className="flex gap-2.5 text-[15px] text-body">
              <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
        <a
          href={`/guide/${c.id}.gif`}
          download
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          GIF로 받기 <span aria-hidden>↓</span>
          <span className="text-muted-soft">— 한글 문서·메일에 붙여넣을 때</span>
        </a>
      </div>
    </section>
  );
}

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

export default async function GuidePage() {
  // AU-22 — 표준 진입점. 미인증·초기 비밀번호 미변경은 여기서 내보낸다.
  // 이 페이지만 `getPageScope()`를 직접 써서 비밀번호 강제 변경이 빠져 있었다 (v1.23.1에서 고침)
  const ps = await requirePageScope();
  if (!ps.ok) return noticeFor(ps.code, ps.message);
  const { scope } = ps;
  const examples = monthlyExamples(new Date());

  // RU-31·32 — 취합 메뉴와 매뉴얼은 할 수 있는 사람에게만 (TACP-9)
  const rnav = await rollupNav(scope);

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader
        slug={scope.division.slug}
        divisionName={scope.division.nameKo}
        userName={scope.user.name}
        isLead={scope.isManager || scope.readAll}
        isOperator={scope.user.isOperator}
        readAll={scope.readAll}
        {...rnav}
        viaCloudflare={scope.source === 'cloudflare'}
        notifyEnabled={ps.scope.user.notifyEnabled}
      />

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-5 pt-10 pb-8">
        <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">사용 안내</p>
        <h1 className="display mt-1 text-[32px] leading-[1.15]">주간 업무일지, 이렇게 냅니다</h1>
        <p className="mt-2 max-w-[54ch] text-[15px] text-body">
          메일로 주고받던 것을 화면에서 처리합니다. 작성하는 내용과 양식은 그대로이고,
          <strong className="font-semibold text-ink"> 내는 곳만 바뀝니다.</strong>
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <span className="badge-pill">마감 매주 목요일 14:00</span>
          <span className="badge-pill">한글(.hwp) · 최대 20MB</span>
          <span className="badge-pill">다시 올리면 새 버전</span>
          <span className="badge-pill bg-brand-soft text-brand">그 달 마지막 주는 월간</span>
        </div>

        <h2 className="display mt-12 mb-1 text-[22px]">제출하는 분</h2>
        <p className="mb-5 text-sm text-muted">셋 중 편한 방법을 쓰시면 됩니다.</p>
        <div className="space-y-8">
          {SUBMIT.map((c) => (
            <ClipCard key={c.id} c={c} />
          ))}
        </div>

        <h2 className="display mt-14 mb-1 text-[22px]">부서담당자</h2>
        <p className="mb-5 text-sm text-muted">부서원 것을 모아 하나로 합치는 화면입니다.</p>
        <div className="space-y-8">
          {LEADS.map((c) => (
            <ClipCard key={c.id} c={c} />
          ))}
        </div>

        {/* RU-30 — 실·팀 담당자의 마지막 단계. 위로 보내는 것까지가 담당자의 일이다 */}
        {scope.isManager && (
          <section className="card mt-8 px-7 py-6">
            <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">04+</p>
            <h3 className="display mt-1 text-lg">검토가 끝나면 위로 제출하기</h3>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[15px] text-body">
              <li>[수합 관리] 맨 아래 <strong className="text-ink">「○○본부에 제출」</strong> 카드 — 본부 밖 부서나 혼자 쓰는 본부는 「총괄에 제출」입니다</li>
              <li>누르는 순간의 병합본이 <strong className="text-ink">사본으로</strong> 갑니다. 그 뒤에 고치면 카드에 「바뀜」이 뜨고, [다시 제출]해야 바뀐 것이 갑니다</li>
              <li>잘못 냈으면 [제출 취소] — 받는 쪽 화면에서 「미제출」로 보입니다</li>
            </ol>
          </section>
        )}

        {/* RU-31 — 본부 담당자·본부장 매뉴얼 */}
        {rnav.hqDesk && (
          <>
            <h2 className="display mt-14 mb-1 text-[22px]">본부 담당자</h2>
            <p className="mb-5 text-sm text-muted">산하 실·팀이 낸 것을 순서대로 이어 붙여, 본부장 검토 뒤 총괄에 냅니다.</p>
            <section className="card px-7 py-6">
              <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">07</p>
              <h3 className="display mt-1 text-lg">본부 취합</h3>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[15px] text-body">
                <li>상단 메뉴 <strong className="text-ink">[본부 취합]</strong> — 산하 실·팀마다 「제출됨 · 시각 · 누가」 또는 「미제출」이 보입니다</li>
                <li><strong className="text-ink">이어 붙이는 순서</strong>를 ▲▼로 정하고 [순서 저장] — 다음 주에도 그 순서입니다. 메모는 본부장·총괄이 읽는 설명입니다</li>
                <li>[이어 붙이기] — 낸 실·팀만 순서대로 한 문서가 됩니다. [본부본 받기]로 열어 본부장 검토를 받으세요</li>
                <li>검토가 끝나면 맨 아래 <strong className="text-ink">[총괄에 제출]</strong></li>
              </ol>
              <ul className="mt-4 space-y-1 text-sm text-muted">
                <li>· 실·팀 <strong className="text-body">안의 내용·순서는 바꾸지 않습니다</strong>. 고칠 곳은 그 실·팀이 고쳐 다시 내고, 여기서 다시 이어 붙입니다</li>
                <li>· 이어 붙인 뒤 실·팀이 다시 내거나 취소하면 「바뀜」이 뜹니다 — 다시 이어 붙이세요</li>
                <li>· 본부가 보는 것은 실·팀이 <strong className="text-body">보낸 것</strong>뿐입니다. 부서원 개인 제출물은 그 실·팀의 몫입니다</li>
              </ul>
            </section>
          </>
        )}

        {/* WA-20 · HM-47 — 담당자 첨삭과 부서장 승인. 할 수 있는 사람에게만 (TACP-9) */}
        {scope.isManager && (
          <div className="mt-8 space-y-6">
            <section className="card px-7 py-6">
              <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">고치기</p>
              <h3 className="display mt-1 text-lg">부서원 업무일지를 직접 고치기 (첨삭)</h3>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[15px] text-body">
                <li>[수합 관리]에서 이름을 눌러 제출물을 엽니다</li>
                <li>오른쪽 위 <strong className="text-ink">[고치기]</strong> → 표를 고치고 <strong className="text-ink">[고쳐서 저장]</strong></li>
                <li>병합본에 넣으려면 <strong className="text-ink">[다시 병합]</strong>을 누릅니다</li>
              </ol>
              <ul className="mt-4 space-y-1 text-sm text-muted">
                <li>· 덮어쓰지 않습니다 — 그 사람의 <strong className="text-body">새 판</strong>이 생기고 원래 판은 그대로 남습니다</li>
                <li>· 판 목록과 본인의 [내 이력]에 「○○ 고침」이 표시됩니다</li>
                <li>· 마감이 지나도 고칠 수 있습니다. 가장 최근 판만 고칠 수 있습니다</li>
              </ul>
            </section>
            {scope.isHead && (
              <section className="card px-7 py-6">
                <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">부서장</p>
                <h3 className="display mt-1 text-lg">병합본 검토하고 승인하기</h3>
                <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[15px] text-body">
                  <li>「병합본 검토 부탁드려요」 알림을 받으면 [보관함]이나 [수합 관리]에서 병합본을 엽니다</li>
                  <li>고칠 곳이 있으면 고쳐서 <strong className="text-ink">[수정 저장]</strong> — <strong className="text-ink">그 저장이 곧 승인</strong>입니다</li>
                  <li>고칠 것이 없으면 <strong className="text-ink">[고칠 것 없음 · 승인]</strong></li>
                </ol>
                <p className="mt-3 text-sm text-muted">
                  승인하는 순간 담당자에게 「승인 완료 · 바뀐 곳」 알림이 갑니다 — 담당자가 언제·무엇이 바뀌었는지 바로 압니다.
                </p>
              </section>
            )}
          </div>
        )}

        {/*
          WS-19 · TACP-20 — 총괄담당 매뉴얼. 이 일을 할 수 있는 사람에게만 보인다 (TACP-9).
          글로 적는다 — 이 절은 쓰는 사람이 한두 명이고, 연휴에만 꺼내 보는 절차라
          「무엇을 붙여넣고 무엇을 확인하나」가 정확히 적혀 있는 편이 낫다.
        */}
        {canScheduleDeadlines(scope.user) && (
          <>
            <h2 className="display mt-14 mb-1 text-[22px]">총괄담당</h2>
            <p className="mb-5 text-sm text-muted">
              전 부서의 업무일지를 보고, 연휴로 바뀐 마감을 전 부서에 한꺼번에 적용합니다.
            </p>
            <div className="space-y-6">
              <section className="card px-7 py-6">
                <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">05</p>
                <h3 className="display mt-1 text-lg">전 부서가 무엇을 냈는지 보기</h3>
                <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[15px] text-body">
                  <li>상단 메뉴 <strong className="text-ink">[전사 현황]</strong> — 이번 주 누가 냈는지 조직도로 보입니다</li>
                  <li>아래 <strong className="text-ink">「부서별」</strong>에서 부서를 골라 [수합 관리] — 제출물을 열어 보고, 지난 주차도 고를 수 있습니다</li>
                  <li>[보관함] — 그 부서의 병합본(hwp)을 받습니다</li>
                  <li>다른 부서 화면은 <strong className="text-ink">보기만</strong> 됩니다. 들어간 기록은 남습니다</li>
                </ol>
              </section>

              <section className="card px-7 py-6">
                <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">06</p>
                <h3 className="display mt-1 text-lg">연휴로 마감이 바뀌었을 때</h3>
                <p className="mt-2 text-[15px] text-body">
                  취합게시판(NAMS)에 올린 작성 요청 본문을 <strong className="text-ink">그대로 붙여넣으면</strong>{' '}
                  날짜·시각·이유를 읽어 그 주 전 부서의 마감을 바꿉니다.
                </p>
                <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[15px] text-body">
                  <li>[전사 현황] 맨 위 <strong className="text-ink">「주차 마감」</strong> → [마감 바꾸기]</li>
                  <li>
                    [공지 붙여넣기]에 요청 본문을 통째로 붙여넣습니다. 이런 문장을 읽습니다 —{' '}
                    <span className="text-muted">「제출 기한은 10월 07(수) 오후 3시입니다」</span>
                  </li>
                  <li>
                    [미리보기] — 어느 주차의 마감이 언제로 바뀌는지, 알림·병합이 몇 시에 나가는지 확인합니다.{' '}
                    <strong className="text-ink">이 단계에서는 아직 아무것도 바뀌지 않습니다</strong>
                  </li>
                  <li>[이대로 적용] — 부서원 화면의 마감이 빨갛게 바뀌고 이유가 한 줄 붙습니다</li>
                </ol>
                <ul className="mt-4 space-y-1 text-sm text-muted">
                  <li>· 공지의 시각은 <strong className="text-body">대외 마감</strong>입니다. 부서 마감은 자동으로 <strong className="text-body">한 시간 앞</strong>으로 잡힙니다 (대외 15:00 → 부서 14:00)</li>
                  <li>· 요일이 날짜와 맞지 않으면 적용하지 않습니다 — 공지를 먼저 확인해 주세요</li>
                  <li>· 그 주에만 걸립니다. <strong className="text-body">다음 주는 손대지 않아도 평소대로</strong> 돌아갑니다</li>
                  <li>· 이미 지난 알림은 다시 나가지 않습니다. 대신 마감 당일 09:00 알림이 나갑니다</li>
                  <li>· 이미 지난 마감은 옮길 수 없습니다. 잘못 넣었으면 마감 전에 [평소대로 되돌리기]</li>
                  <li>· 붙여넣기가 안 되면 [직접 입력]에서 대외 마감 날짜·시각을 고르면 됩니다</li>
                </ul>
              </section>

              {rnav.orgDesk && (
                <section className="card px-7 py-6">
                  <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">08</p>
                  <h3 className="display mt-1 text-lg">전사 취합 — 한 번에 최종본 만들기</h3>
                  <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[15px] text-body">
                    <li>상단 메뉴 <strong className="text-ink">[전사 취합]</strong> — 본부·부서마다 도착했는지, 본부 안에서는 실·팀이 어디까지 왔는지 보입니다</li>
                    <li>본부 순서를 ▲▼로 정하고 [순서 저장] (한 번 정하면 매주 그대로)</li>
                    <li>[이어 붙이기] — 도착한 것만 순서대로 한 문서가 됩니다. [전사본 받기]로 받아 한글에서 다듬어 NAMS에 올립니다</li>
                    <li>늦게 도착한 곳이 있으면 [다시 이어 붙이기] — 「바뀜」 표시가 알려 줍니다</li>
                  </ol>
                  <ul className="mt-4 space-y-1 text-sm text-muted">
                    <li>· 「Tincase 밖에서 내는 곳」은 아직 취합게시판으로 받는 부서입니다. 전사본에 직접 넣어 주세요</li>
                    <li>· 남의 부서를 대신 내지는 않습니다 — 안 온 곳은 「도착 전」으로 남습니다</li>
                  </ul>
                </section>
              )}
            </div>
          </>
        )}

        <h2 className="display mt-14 mb-4 text-[22px]">자주 묻는 것</h2>
        <div className="card divide-y divide-hairline-soft">
          {[
            ['주간과 월간은 어떻게 구분되나요?', `그 달의 마지막 날이 들어 있는 주가 마지막 주이고, 그 주에는 월간 업무일지를 냅니다. ${examples.map((e) => `${e.month}은 ${e.range} — ${e.note}`).join('. ')}. 월간 주에는 제출 화면 위쪽에 초록색 [월간] 표시가 뜹니다.`],
            ['월간에는 뭘 더 써야 하나요?', '한 주가 아니라 한 달치를 정리합니다. 양식과 마감(목요일 14:00)은 주간과 같고, 분량이 늘어납니다. 병합본 파일 이름도 "월간업무"로 나옵니다.'],
            ['알림은 언제 오나요?', '아직 내지 않은 분에게만 갑니다 — 마감 전날 11:45, 마감 당일 09:00, 마감 1시간 전, 마감 10분 전. 이미 냈으면 오지 않습니다. 사내 메신저 알림함으로 옵니다.'],
            ['연휴 때 마감이 바뀌면요?', '그 주만 마감이 당겨지고, 제출 화면의 마감 표시가 빨갛게 바뀌며 이유가 함께 나옵니다. 알림도 바뀐 마감에 맞춰 나갑니다. 다음 주에는 평소대로 돌아갑니다.'],
            ['마감을 놓치면 어떻게 되나요?', '마감 후에는 제출도 취소도 되지 않습니다. 담당자에게 말씀해 주세요 — 예외는 시스템이 아니라 사람이 판단할 일입니다.'],
            ['같은 주에 두 번 내도 되나요?', '됩니다. 다시 올리면 새 버전으로 저장되고 마지막 것이 병합에 들어갑니다. 이전 버전도 남아 있어 필요하면 다시 받을 수 있습니다.'],
            ['다른 사람이 낸 내용을 볼 수 있나요?', '부서원끼리는 누가 언제 냈는지만 봅니다. 파일 내용은 부서담당자부터 볼 수 있습니다.'],
            ['비밀번호를 잊었습니다', 'AI홍보전략실 운영자에게 요청하시면 새로 발급해 드립니다. 처음 받은 비밀번호는 첫 로그인 때 반드시 바꾸게 되어 있습니다.'],
            ['화면 속 이름은 누구인가요?', '전부 가공 인물입니다. 안내 자료를 만들려고 별도의 예시 부서를 만들어 녹화했습니다.'],
          ].map(([q, a]) => (
            <div key={q} className="px-6 py-5">
              <p className="font-semibold text-ink">{q}</p>
              <p className="mt-1 text-[15px] text-body">{a}</p>
            </div>
          ))}
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
