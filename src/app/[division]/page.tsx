// `/{slug}` — member 메인 (S-06 §2). 제출이 주인공: 히어로(주차·마감) + 7/5 그리드.
import { prisma } from '@/server/db';
import { redirect } from 'next/navigation';
import { getPageScope } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { ensureCurrentSlot, effectiveDeadline, divisionStatus } from '@/server/worklog';
import { formatDeadlineKo, isLocked, toKstIso } from '@/lib/week';
import { DeadlineCountdown } from '@/components/DeadlineCountdown';
import { UploadDropzone } from '@/components/UploadDropzone';

export const dynamic = 'force-dynamic';

export default async function MemberPage() {
  const ps = await getPageScope();
  if (!ps.ok) {
    if (ps.code === 'unauthenticated') redirect('/login');
    return noticeFor(ps.code, ps.message);
  }
  if (ps.scope.user.mustChangePassword) redirect('/password?first=1'); // AU-22
  const { scope } = ps;
  const now = new Date();

  const slot = await ensureCurrentSlot(now);
  const deadline = effectiveDeadline(slot, scope.division);
  const locked = isLocked({ opensAt: slot.opensAt }, scope.division, now);
  const nextOpens = new Date(slot.opensAt.getTime() + 7 * 86400_000);

  const [mySubmission, template, { members }] = await Promise.all([
    prisma.submission.findFirst({ where: { userId: scope.user.id, weekSlotId: slot.id, isLatest: true } }),
    prisma.template.findFirst({ where: { divisionId: scope.division.id, isActive: true } }),
    divisionStatus(scope.division.id, slot.id),
  ]);

  const guideLines = scope.division.guideText.split('\n').filter(Boolean);
  const onRosterMe = scope.user.onRoster;
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
            <section className="card-feature bg-brand-mint/35 px-7 py-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="display text-xl">
                    <span aria-hidden className="mr-1.5 text-success">
                      ✓
                    </span>
                    제출 완료 <span className="text-muted">v{mySubmission.version}</span>
                  </p>
                  <p className="mt-1 text-sm text-body">
                    {toKstIso(mySubmission.uploadedAt).slice(5, 16).replace('T', ' ')} ·{' '}
                    {(mySubmission.byteSize / 1024).toFixed(1)} KB · {mySubmission.originalName}
                  </p>
                </div>
                <a href={`/api/submissions/${mySubmission.id}/download`} className="btn-oncolor">
                  내 파일 받기
                </a>
              </div>
            </section>
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
          ) : template && onRosterMe ? (
            <section>
              <h2 className="label">{mySubmission ? '다시 올리기 — 새 버전으로 저장됩니다' : '제출'}</h2>
              <UploadDropzone hasPrevious={!!mySubmission} />
            </section>
          ) : !onRosterMe ? (
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
                    <span aria-hidden className="text-brand-ochre">
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
          <section className="card-feature bg-brand-peach px-7 py-6">
            <h2 className="display text-lg">빈 양식 받기</h2>
            <p className="mt-1 text-sm text-body-strong">파일명에 이번 주차가 자동으로 들어갑니다.</p>
            {template ? (
              /* eslint-disable-next-line @next/next/no-html-link-for-pages -- 파일 다운로드, 클라이언트 내비게이션 아님 */
              <a href="/api/template" className="btn-primary mt-4">
                양식 다운로드
              </a>
            ) : (
              <p className="mt-4 text-sm font-medium text-body-strong">아직 등록된 양식이 없습니다.</p>
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
