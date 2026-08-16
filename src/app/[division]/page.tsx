// `/{slug}` — member 메인 (S-06 §2). 제출이 주인공: 히어로(주차·마감) + 7/5 그리드.
import { prisma } from '@/server/db';
import { redirect } from 'next/navigation';
import { getPageScope, getDivisionView } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { ensureCurrentSlot, effectiveDeadline, divisionStatus } from '@/server/worklog';
import { formatDeadlineKo, isLocked, toKstIso } from '@/lib/week';
import { DeadlineCountdown } from '@/components/DeadlineCountdown';
import { SubmitChoice } from '@/components/SubmitChoice';
import { MySubmissionCard } from '@/components/MySubmissionCard';

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

  const [mySubmission, template, { members }] = await Promise.all([
    isOwn
      ? prisma.submission.findFirst({ where: { userId: scope.user.id, weekSlotId: slot.id, isLatest: true } })
      : null,
    prisma.template.findFirst({ where: { divisionId: division.id, isActive: true } }),
    divisionStatus(division.id, slot.id),
  ]);

  const guideLines = division.guideText.split('\n').filter(Boolean);
  const submitted = members.filter((m) => m.status === 'submitted').length;

  return (
    <main className="pt-10">
      {/* 히어로 — 주차가 이 페이지의 제목이다 (hero-band) */}
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
            {slot.year}년 · 이번 주차
          </p>
          <h1 className="display mt-1 text-[40px] leading-[1.1]">{slot.label}</h1>
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
              <SubmitChoice hasPrevious={!!mySubmission} isoKey={slot.isoKey} guideLines={guideLines} />
            </section>
          ) : !isOwn ? (
            <section className="card px-6 py-5 text-sm text-muted">
              내 부서가 아니므로 제출할 수 없습니다. 제출은 소속 부서 페이지에서만 가능합니다.
            </section>
          ) : !scope.user.onRoster ? (
            <section className="card px-6 py-5 text-sm text-muted">
              제출 대상이 아닙니다. 제출이 필요하면 운영자에게 요청해 주세요.
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
                    {m.latest && (
                      <span className="text-xs text-muted-soft">{toKstIso(m.latest.uploadedAt).slice(11, 16)}</span>
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
