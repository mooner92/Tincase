// `/{slug}` — member 메인 (S-06 §2). 제출이 주인공: 히어로(주차·마감) + 7/5 그리드.
import { prisma } from '@/server/db';
import { redirect } from 'next/navigation';
import { getPageScope, getDivisionView } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { ensureCurrentSlot, effectiveDeadline, divisionStatus } from '@/server/worklog';
import { formatDeadlineKo, formatSubmittedKo, isLocked, slotKind, toKstIso } from '@/lib/week';
import { DeadlineCountdown } from '@/components/DeadlineCountdown';
import { SubmitChoice } from '@/components/SubmitChoice';
import { MySubmissionCard } from '@/components/MySubmissionCard';
import { BellIcon } from '@/components/BellIcon';

export const dynamic = 'force-dynamic';

export default async function MemberPage({ params }: { params: Promise<{ division: string }> }) {
  const ps = await getPageScope();
  if (!ps.ok) {
    if (ps.code === 'unauthenticated') redirect('/login');
    return noticeFor(ps.code, ps.message);
  }
  if (ps.scope.user.mustChangePassword) redirect('/password?first=1'); // AU-22
  const { division: slugParam } = await params;
  // ★ 반드시 해석된 부서를 쓴다 — scope.division을 쓰면 헤더와 본문이 어긋난다 (v1.3.1 수정)
  const view = await getDivisionView(slugParam);
  const { scope, division, isOwn, canSubmit } = view;
  const now = new Date();

  const slot = await ensureCurrentSlot(now);
  const deadline = effectiveDeadline(slot, division);
  const locked = isLocked({ opensAt: slot.opensAt }, division, now);
  const nextOpens = new Date(slot.opensAt.getTime() + 7 * 86400_000);

  const [mySubmission, template, { members, extras }] = await Promise.all([
    isOwn
      ? prisma.submission.findFirst({ where: { userId: scope.user.id, weekSlotId: slot.id, isLatest: true } })
      : null,
    prisma.template.findFirst({ where: { divisionId: division.id, isActive: true } }),
    divisionStatus(division.id, slot.id),
  ]);

  const guideLines = division.guideText.split('\n').filter(Boolean);
  // WS-14 — 그 달 마지막 주에는 월간 업무일지를 낸다. 주차는 그대로이고 '무엇을 내는가'가 바뀐다
  const monthly = slotKind(slot) === 'monthly';
  const submitted = members.filter((m) => m.status === 'submitted').length;

  return (
    <main className="pt-10">
      {/* 히어로 — 주차가 이 페이지의 제목이다 (hero-band) */}
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
            {slot.year}년 · {monthly ? `${slot.month}월 마지막 주` : '이번 주차'}
          </p>
          <h1 className="display mt-1 flex flex-wrap items-center gap-2.5 text-[40px] leading-[1.1]">
            {slot.label}
            {monthly && (
              <span className="rounded-full bg-brand px-3 py-1 text-[15px] font-semibold text-white">
                월간
              </span>
            )}
          </h1>
        </div>
        <div className="flex items-center gap-2 pb-1.5">
          {locked ? (
            <span className="badge-pill bg-surface-strong">마감됨 · {formatDeadlineKo(deadline)}</span>
          ) : (
            <>
              <span className="badge-pill">마감 {formatDeadlineKo(deadline)}</span>
              <DeadlineCountdown deadlineAtMs={deadline.getTime()} serverNowMs={now.getTime()} />
            </>
          )}
        </div>
      </section>

      {monthly && (
        <section className="mt-6 flex gap-3 rounded-[14px] border border-brand-tint bg-brand-soft px-5 py-4">
          <span aria-hidden className="mt-0.5 text-brand">◆</span>
          <div>
            <p className="font-semibold text-ink">이번 주는 {slot.month}월 월간 업무일지입니다</p>
            <p className="mt-1 text-[15px] text-body">
              그 달의 마지막 날이 이번 주에 있어 이번이 {slot.month}월의 마지막 주입니다.
              한 주가 아니라 <strong className="font-semibold text-ink">한 달치</strong>를 정리해 주세요 —
              주간보다 자세하고 분량도 많습니다. 마감·제출 방법은 평소와 같습니다.
            </p>
          </div>
        </section>
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* 좌측 7 — 제출 (주인공) */}
        <div className="space-y-6 lg:col-span-7">
          {mySubmission && (
            <MySubmissionCard
              submissionId={mySubmission.id}
              userId={scope.user.id}
              userName={scope.user.name}
              version={mySubmission.version}
              uploadedAtKst={toKstIso(mySubmission.uploadedAt).slice(5, 16).replace('T', ' ')}
              sizeKb={(mySubmission.byteSize / 1024).toFixed(1)}
              originalName={mySubmission.originalName}
              canCancel={!locked} /* TACP-14 — 마감 후에는 렌더하지 않는다 */
            />
          )}

          {/* PG-08 — 잠김이면 업로드 영역을 DOM에서 제거 */}
          {locked ? (
            !mySubmission && (
              <section className="card-feature bg-surface-strong px-7 py-10 text-center">
                <p className="display text-lg">이번 주차는 마감되었습니다</p>
                <p className="mt-2 text-sm text-muted">
                  다음 주차는 {formatDeadlineKo(nextOpens).replace(/ \d{2}:\d{2}$/, '')} 00:00에 열립니다.
                </p>
              </section>
            )
          ) : template && canSubmit ? (
            <section>
              <h2 className="label">{mySubmission ? '다시 제출 — 새 버전으로 저장됩니다' : '제출'}</h2>
              {/*
                DM-16 — 집계 제외자(부서장·휴직 등)도 낼 수 있다. 다만 오른쪽 현황의
                분모에 없어서 "내 이름이 왜 없지?"가 되므로, 그 이유를 여기서 먼저 밝힌다.
              */}
              {!scope.user.onRoster && (
                <p className="mb-3 rounded-lg bg-surface-soft px-4 py-2.5 text-sm text-body">
                  집계 대상에서 빠져 있어 오른쪽 현황에는 이름이 표시되지 않습니다
                  {scope.user.rosterNote ? ` (사유: ${scope.user.rosterNote})` : ''}.{' '}
                  <strong className="font-semibold text-ink">제출은 지금 하실 수 있고</strong>, 내시면
                  담당자 화면에 «추가 제출»로 표시되며 병합에도 들어갑니다.
                </p>
              )}
              <SubmitChoice hasPrevious={!!mySubmission} isoKey={slot.isoKey} guideLines={guideLines} />
            </section>
          ) : !isOwn ? (
            <section className="card px-6 py-5 text-sm text-muted">
              내 부서가 아니므로 제출할 수 없습니다. 제출은 소속 부서 페이지에서만 가능합니다.
            </section>
          ) : (
            <section className="card border-warning/40 bg-warning/5 px-6 py-5 text-sm text-body">
              등록된 부서 양식이 없습니다. 담당자에게 양식 등록을 요청하세요.
            </section>
          )}

          {/* 작성 안내 (CP-21/22) */}
          {guideLines.length > 0 && (
            <section className="card-cream px-7 py-6">
              <h2 className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">작성 안내</h2>
              <ul className="mt-3 space-y-1.5 text-sm leading-6 text-body">
                {guideLines.map((l) => (
                  <li key={l} className="flex gap-2">
                    <span aria-hidden className="text-brand">
                      ●
                    </span>
                    {l}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* 우측 5 — 양식·부서 현황 */}
        <div className="space-y-6 lg:col-span-5">
          <section className="card px-7 py-6">
            <h2 className="display text-lg">빈 양식 받기</h2>
            <p className="mt-1 text-sm text-muted">파일명에 이번 주차가 자동으로 들어갑니다.</p>
            {!template ? (
              <p className="mt-4 text-sm font-medium text-body-strong">아직 등록된 양식이 없습니다.</p>
            ) : isOwn ? (
              /* eslint-disable-next-line @next/next/no-html-link-for-pages -- 파일 다운로드, 클라이언트 내비게이션 아님 */
              <a href="/api/template" className="btn-primary mt-4">
                양식 다운로드
              </a>
            ) : (
              <p className="mt-4 text-sm font-medium text-body-strong">
                등록됨 — 양식 내려받기는 소속 부서원만 가능합니다.
              </p>
            )}
          </section>

          {/* 부서 현황 — member에게도 공개 (AU-06 v2.1). 파일 링크 없음 (CP-87~89) */}
          <section className="card px-6 py-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">부서 제출 현황</h2>
              <span className="text-sm font-semibold text-ink">
                {submitted}
                <span className="font-normal text-muted"> / {members.length}</span>
                {extras.length > 0 && <span className="font-normal text-muted"> +{extras.length}</span>}
              </span>
            </div>
            <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {members.map((m) => {
                const mine = m.user.id === scope.user.id;
                return (
                  <li key={m.user.id} className={`flex items-center gap-2 ${mine ? 'font-semibold' : ''}`}>
                    {m.status === 'submitted' ? (
                      <span className="text-success" aria-hidden>
                        ●
                      </span>
                    ) : (
                      <span className="text-hairline" aria-hidden>
                        ○
                      </span>
                    )}
                    <span className={m.status === 'submitted' ? 'text-ink' : 'text-muted-soft'}>
                      {m.user.name}
                      {mine && ' (나)'}
                    </span>
                    {m.latest ? (
                      <span className="text-xs whitespace-nowrap text-muted-soft">
                        {formatSubmittedKo(m.latest.uploadedAt, now)}
                      </span>
                    ) : (
                      /*
                        NT-31 — 안 낸 사람에게 «알림은 갔는지»를 보여준다.
                        **시각은 빼고 표식만** 남긴다: 알림은 부서 전원에게 같은 시각(마감 1시간 전)에
                        한 번 나가므로 사람마다 다르지 않다 — 시각을 적으면 제출 시각과 같은 회색·같은
                        자리에 놓여 눈이 헷갈린다. 알아야 할 것은 «갔다/안 갔다»뿐이다.
                        그래서 시각(제출)과 라벨(알림)로 **모양 자체를 다르게** 한다.
                      */
                      m.notifiedAtKst && (
                        <span title={`마감 알림을 보냈습니다 (${m.notifiedAtKst})`} className="text-muted-soft">
                          <BellIcon />
                          <span className="sr-only">알림 보냄 {m.notifiedAtKst}</span>
                        </span>
                      )
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
