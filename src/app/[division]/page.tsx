// `/{slug}` — member 메인 (S-06 §2). 4상태: OPEN_EMPTY / OPEN_SUBMITTED / LOCKED_*
import { prisma } from '@/server/db';
import { getPageScope } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { ensureCurrentSlot, effectiveDeadline, divisionStatus } from '@/server/worklog';
import { formatDeadlineKo, isLocked, toKstIso } from '@/lib/week';
import { DeadlineCountdown } from '@/components/DeadlineCountdown';
import { UploadDropzone } from '@/components/UploadDropzone';

export const dynamic = 'force-dynamic';

export default async function MemberPage() {
  const ps = await getPageScope();
  if (!ps.ok) return noticeFor(ps.code, ps.message);
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

  return (
    <main className="mt-6 space-y-6">
      {/* WeekBanner (CP-07~10, PG-05) */}
      <section
        className={`rounded-xl border px-5 py-4 ${locked ? 'border-slate-200 bg-slate-100' : 'border-blue-100 bg-blue-50'}`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-lg font-bold text-slate-900">
            {slot.year}년 {slot.label}
          </h1>
          {locked ? (
            <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">마감됨</span>
          ) : (
            <DeadlineCountdown deadlineAtMs={deadline.getTime()} serverNowMs={now.getTime()} />
          )}
        </div>
        <p className="mt-1 text-sm text-slate-600">
          {locked
            ? `마감되었습니다. 다음 주차는 ${formatDeadlineKo(nextOpens).replace(/ \d{2}:\d{2}$/, '')} 00:00에 열립니다.`
            : `마감 ${formatDeadlineKo(deadline)}`}
        </p>
      </section>

      {/* ① 양식 받기 */}
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-500">① 양식 받기</h2>
        {template ? (
          /* eslint-disable-next-line @next/next/no-html-link-for-pages -- 파일 다운로드, 클라이언트 내비게이션 아님 */
          <a
            href="/api/template"
            className="mt-2 inline-block rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            빈 양식 다운로드
          </a>
        ) : (
          <p className="mt-2 text-sm text-slate-500">등록된 부서 양식이 없습니다. 담당자에게 양식 등록을 요청하세요.</p>
        )}
      </section>

      {/* ② 작성 안내 (CP-21/22) */}
      {guideLines.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-500">② 작성 안내</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {guideLines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      )}

      {/* ③ 제출 */}
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-500">③ 제출</h2>

        {mySubmission && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-green-50 px-4 py-3">
            <p className="text-sm text-green-900">
              ✓ 제출 완료 <span className="font-semibold">(v{mySubmission.version})</span>
              <span className="ml-2 text-green-700">
                {toKstIso(mySubmission.uploadedAt).slice(5, 16).replace('T', ' ')} ·{' '}
                {(mySubmission.byteSize / 1024).toFixed(1)} KB
              </span>
            </p>
            <a
              href={`/api/submissions/${mySubmission.id}/download`}
              className="rounded border border-green-300 px-3 py-1 text-xs font-medium text-green-800 hover:bg-green-100"
            >
              내 파일 받기
            </a>
          </div>
        )}

        {/* PG-08 — 잠김이면 업로드 영역을 DOM에서 제거 */}
        {locked ? (
          !mySubmission && (
            <p className="mt-3 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
              이번 주차는 마감되었습니다. 다음 주차에 제출해 주세요.
            </p>
          )
        ) : template && onRosterMe ? (
          <div className="mt-3">
            <UploadDropzone hasPrevious={!!mySubmission} />
          </div>
        ) : !onRosterMe ? (
          <p className="mt-3 text-sm text-slate-500">
            제출 대상이 아닙니다. 제출이 필요하면 운영자에게 요청해 주세요.
          </p>
        ) : null}
      </section>

      {/* 부서 현황 — member에게도 공개 (AU-06 v2.1). 파일 링크 없음, 업로드보다 시각적 우선순위 낮게 (CP-87~89) */}
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-500">부서 제출 현황</h2>
        <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
          {members.map((m) => {
            const mine = m.user.id === scope.user.id;
            return (
              <li key={m.user.id} className={`flex items-center gap-2 ${mine ? 'font-semibold' : ''}`}>
                {m.status === 'submitted' ? (
                  <span className="text-green-600" aria-hidden>
                    ●
                  </span>
                ) : (
                  <span className="text-slate-300" aria-hidden>
                    ○
                  </span>
                )}
                <span className={m.status === 'submitted' ? 'text-slate-800' : 'text-slate-400'}>
                  {m.user.name}
                  {mine && ' (나)'}
                </span>
                {m.latest && (
                  <span className="text-xs text-slate-400">{toKstIso(m.latest.uploadedAt).slice(11, 16)}</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
