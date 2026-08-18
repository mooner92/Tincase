// `/guide` — 사용 안내 (로그인한 사람 누구나, PG-40).
//
// 화면은 애니메이션으로 보여준다. 글로 "제출 버튼을 누르고…"라고 쓰면
// 읽는 사람이 자기 화면과 대조해야 하는데, 움직이는 화면은 대조가 필요 없다.
//
// 자료는 **데모 DB로 녹화한 것**이라 사람 이름·업무 내용이 전부 가공이다
// (scripts/seed-demo.ts). 실제 화면을 찍어 두면 저장소가 public이라 개인정보가 남는다.
import { redirect } from 'next/navigation';
import { getPageScope } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { AppHeader } from '@/components/AppHeader';
import { AppFooter } from '@/components/AppFooter';

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

export default async function GuidePage() {
  const ps = await getPageScope();
  if (!ps.ok) {
    if (ps.code === 'unauthenticated') redirect('/login');
    return noticeFor(ps.code, ps.message);
  }
  const { scope } = ps;

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader
        slug={scope.division.slug}
        divisionName={scope.division.nameKo}
        userName={scope.user.name}
        isLead={scope.isLead || scope.readAll}
        isOperator={scope.user.isOperator}
        viaCloudflare={scope.source === 'cloudflare'}
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

        <h2 className="display mt-14 mb-4 text-[22px]">자주 묻는 것</h2>
        <div className="card divide-y divide-hairline-soft">
          {[
            ['마감을 놓치면 어떻게 되나요?', '마감 후에는 제출도 취소도 되지 않습니다. 담당자에게 말씀해 주세요 — 예외는 시스템이 아니라 사람이 판단할 일입니다.'],
            ['같은 주에 두 번 내도 되나요?', '됩니다. 다시 올리면 새 버전으로 저장되고 마지막 것이 병합에 들어갑니다. 이전 버전도 남아 있어 필요하면 다시 받을 수 있습니다.'],
            ['다른 사람이 낸 내용을 볼 수 있나요?', '부서원끼리는 누가 언제 냈는지만 봅니다. 파일 내용은 부서담당자부터 볼 수 있습니다.'],
            ['비밀번호를 잊었습니다', '운영자(AI홍보전략실 최명헌)에게 요청하시면 새로 발급해 드립니다. 처음 받은 비밀번호는 첫 로그인 때 반드시 바꾸게 되어 있습니다.'],
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
