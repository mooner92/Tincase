// `/{slug}` — member 메인 (S-06 §2 · PG-12). 카드 둘: 「이번 주 업무일지」(제출) + 「부서 제출 현황」.
//
// 2026-10-07 (사용자: 「컴포넌트별로 구분이 잘 안되는 부분들이 있어. 단순화해줘」) — 그 전에는 한 화면에
// 초록 칠한 완료 카드 · 라벨+탭+점선 상자 · 회색 작성 안내 · 테두리 양식 카드 · 테두리 현황 카드, 모양이 다섯이었다.
// 이제 제출에 관한 것은 전부 카드 하나 안에 있다: 상태 칩 → 내가 낸 것 → 할 일 하나.
import { prisma } from '@/server/db';
import { redirect } from 'next/navigation';
import { getPageScope, getDivisionView } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { ensureCurrentSlot, effectiveDeadline, divisionStatus } from '@/server/worklog';
import { formatDeadlineKo, formatSubmittedKo, isLocked, slotKind, toKstIso } from '@/lib/week';
import { isOpenNow } from '@/lib/deadline';
import { openingOf } from '@/server/deadline';
import { hwpUploadOpen } from '@/server/submit-mode';
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
  /*
   * DM-20 — 담당자가 마감을 잠시 열어 두었으면 낼 수 있다.
   * **부서원 화면에도 보여야 한다** — 열어 놓고 알리지 않으면 아무도 안 낸다.
   */
  const opening = await openingOf(division.id, slot.id);
  const opened = isOpenNow(opening, now);
  const locked = isLocked(slot, division, now) && !opened;
  const nextOpens = new Date(slot.opensAt.getTime() + 7 * 86400_000);

  const [mySubmission, template, { members, extras }] = await Promise.all([
    isOwn
      ? prisma.submission.findFirst({ where: { userId: scope.user.id, weekSlotId: slot.id, isLatest: true } })
      : null,
    prisma.template.findFirst({ where: { divisionId: division.id, isActive: true } }),
    divisionStatus(division.id, slot.id),
  ]);

  const guideLines = division.guideText.split('\n').filter(Boolean);
  // PG-11 · WA-32 — 업로드가 닫힌 서버면 제출은 웹 작성 하나, 「양식 받기」 카드도 없다
  const uploadOpen = hwpUploadOpen();

  /*
   * WA-10 — **지난번에 낸 것**. 「지난주」가 아니다 — 휴가로 한 주 걸렀으면
   * 그 전 것을 보여줘야 한다. 이번 주 실적은 대개 지난번 계획에 적은 그 일이다.
   */
  // 받는 곳은 「양식 받기」 카드뿐이다 — 카드가 없으면(PG-11) 읽지도 않는다
  const previousSubmission = canSubmit && uploadOpen
    ? await prisma.submission.findFirst({
        where: {
          userId: scope.user.id,
          isLatest: true,
          weekSlot: { opensAt: { lt: slot.opensAt } },
        },
        include: { weekSlot: true },
        orderBy: { weekSlot: { opensAt: 'desc' } },
      })
    : null;
  // WS-14 — 그 달 마지막 주에는 월간 업무일지를 낸다. 주차는 그대로이고 '무엇을 내는가'가 바뀐다
  const monthly = slotKind(slot) === 'monthly';
  const submitted = members.filter((m) => m.status === 'submitted').length;

  // PG-12 — 제출 카드는 내 부서일 때만 그린다. 남의 부서를 읽는 사람(총괄·운영자)에게 「제출할 수 없습니다」
  // 카드를 보여 주는 건 할 수 없는 일을 그리는 것이다 (TACP-9). 그 사람에게는 현황 카드 하나다
  const canCompose = canSubmit && !locked && !!template;

  return (
    <main className="pt-8">
      {/* 주차가 이 페이지의 제목이다. 마감은 그 바로 밑 한 줄 — 배지와 카운트다운을 따로 두면 눈이 두 번 간다 */}
      <div>
        <h1 className="page-title flex flex-wrap items-center gap-2.5">
          {slot.label}
          {monthly && <span className="chip chip-ok">월간</span>}
        </h1>
        {/*
          * WS-18 — **이번 주만 마감이 다를 때.** 사람들은 「목요일 14시」를 몸으로 기억하고
          * 있어서 요일이 바뀐 것을 안 읽는다. 그렇다고 큰 안내 상자를 얹으면 매주 보는 화면이
          * 시끄러워지고, 시끄러운 것은 곧 무시된다.
          *
          * 그래서 **새 요소를 더하지 않고 이미 보는 것의 색을 바꾼다** — 마감 시각이 빨간 볼드가 되고,
          * 그 밑에 이유가 한 줄 붙는다. 시선이 어차피 가는 자리다.
          */}
        <p className="page-sub flex flex-wrap items-center gap-x-2 gap-y-1">
          {locked ? (
            <span>
              마감됨 · <span className="text-body">{formatDeadlineKo(deadline)}</span>
            </span>
          ) : opened ? (
            /* 마감은 지났지만 담당자가 열어 두었다 — 언제까지인지가 제일 중요하다 */
            <span className="chip chip-warn">
              마감 후 열림 · {opening ? toKstIso(opening.openUntil).slice(11, 16) : ''}까지
            </span>
          ) : (
            <>
              <span>
                마감{' '}
                <strong className={slot.deadlineNote ? 'font-semibold text-error' : 'font-semibold text-ink'}>
                  {formatDeadlineKo(deadline)}
                </strong>
              </span>
              <span aria-hidden>·</span>
              <DeadlineCountdown deadlineAtMs={deadline.getTime()} serverNowMs={now.getTime()} />
            </>
          )}
        </p>
        {slot.deadlineNote && (
          <p className="mt-1 text-sm text-muted">
            <strong className="font-semibold text-error">이번 주만 변경</strong> · {slot.deadlineNote}
          </p>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 items-start gap-4 lg:grid-cols-12 lg:gap-6">
        {isOwn && (
          <section className="card lg:col-span-7" aria-labelledby="this-week">
            <div className="card-head">
              <div className="min-w-0">
                <h2 id="this-week" className="card-title">
                  이번 주 업무일지
                </h2>
                <p className="card-desc">
                  {mySubmission
                    ? `v${mySubmission.version} · ${toKstIso(mySubmission.uploadedAt).slice(5, 16).replace('T', ' ')}에 냈습니다`
                    : locked
                      ? `다음 주차는 ${formatDeadlineKo(nextOpens).replace(/ \d{2}:\d{2}$/, '')} 00:00에 열립니다.`
                      : uploadOpen
                        ? '화면에서 바로 적거나, 한글 파일을 올려 냅니다.'
                        : '한글을 열지 않고 화면에서 바로 적어 냅니다. 제출하면 부서 양식으로 만들어집니다.'}
                </p>
              </div>
              {mySubmission ? (
                <span className="chip chip-ok">
                  <span aria-hidden className="dot" />
                  제출 완료
                </span>
              ) : (
                <span className="chip chip-muted">{locked ? '마감됨' : '미제출'}</span>
              )}
            </div>

            {monthly && (
              <p className="callout callout-info mt-4">
                <strong className="font-semibold">이번 주는 {slot.month}월 월간 업무일지입니다.</strong> 그 달의 마지막 날이
                이번 주에 있습니다 — 한 주가 아니라 <strong className="font-semibold">한 달치</strong>를 정리해 주세요.
                마감·제출 방법은 평소와 같습니다.
              </p>
            )}

            {/*
              DM-16 — 집계 제외자(부서장·휴직 등)도 낼 수 있다. 다만 현황의 분모에 없어서
              "내 이름이 왜 없지?"가 되므로, 그 이유를 여기서 먼저 밝힌다.
            */}
            {canCompose && !scope.user.onRoster && (
              <p className="callout callout-muted mt-4">
                집계 대상에서 빠져 있어 현황에는 이름이 표시되지 않습니다
                {scope.user.rosterNote ? ` (사유: ${scope.user.rosterNote})` : ''}.{' '}
                <strong className="font-semibold text-ink">제출은 지금 하실 수 있고</strong>, 내시면 담당자 화면에
                «추가 제출»로 표시되며 병합에도 들어갑니다.
              </p>
            )}

            {/* PG-09 — 양식이 없으면 웹 작성도 못 한다 (제출물이 부서 양식으로 만들어진다). 잠긴 주에는 그릴 것이 없다 */}
            {!locked && !template && (
              <p className="callout callout-warn mt-4">등록된 부서 양식이 없습니다. 담당자에게 양식 등록을 요청하세요.</p>
            )}

            {/*
              할 일은 한 줄에 — 낸 것이 있으면 [다시 작성 · 열어보기 · 받기 · 취소], 없으면 [작성하기] 하나.
              PG-08 — 잠기면 작성 버튼은 DOM에서 빠진다. 업로드가 열린 서버(PG-11)는 탭·드롭존이 이 줄 아래로 내려간다
            */}
            {(canCompose || mySubmission) && (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                {canCompose && (
                  <SubmitChoice
                    hasPrevious={!!mySubmission}
                    isoKey={slot.isoKey}
                    guideLines={guideLines}
                    emptyWordsRaw={view.division.emptyWords}
                    uploadOpen={uploadOpen}
                  />
                )}
                {mySubmission && (
                  <MySubmissionCard
                    submissionId={mySubmission.id}
                    userId={scope.user.id}
                    userName={scope.user.name}
                    version={mySubmission.version}
                    canCancel={!locked} /* TACP-14 — 마감 후에는 렌더하지 않는다 */
                  />
                )}
              </div>
            )}

            {/*
              PG-11 — 빈 양식도 지난번 hwp도 「한글에서 고쳐 올리려고」 받는 것이다. 업로드가 닫히면 받을 이유가 없다.
              지난번 것은 웹 작성의 「지난번에 낸 것」 패널(WA-10)과 [내 이력]이 보여준다.
              작성 안내도 여기 둔다 — 웹 작성은 작성 화면 맨 위에 같은 안내가 있어 이 화면에서는 뺐다(두 번 보이면 둘 다 안 읽힌다)
            */}
            {uploadOpen && (
              template && (
                <div className="card-section">
                  {/* WA-10 — 「빈 양식」이었으나 지난번 낸 것도 여기서 받는다. 제목이 내용을 덮어야 한다 */}
                  <h3 className="text-[15px] font-semibold text-ink">양식 받기</h3>
                  <p className="mt-0.5 text-sm text-muted">한글로 적어 올릴 때 · 파일명에 이번 주차가 자동으로 들어갑니다.</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 파일 다운로드, 클라이언트 내비게이션 아님 */}
                    <a href="/api/template" className="btn-secondary btn-sm">
                      양식 다운로드
                    </a>
                    {/* WA-10 — 지난번 낸 것. 없으면 아예 렌더하지 않는다 (빈 안내는 자리만 먹는다) */}
                    {previousSubmission && (
                      <a href={`/api/submissions/${previousSubmission.id}/download`} className="btn-ghost">
                        지난 {previousSubmission.weekSlot.label} 받기
                      </a>
                    )}
                  </div>
                  {/* 작성 안내 (CP-21/22) */}
                  {guideLines.length > 0 && (
                    <ul className="mt-4 space-y-1 text-sm leading-6 text-body">
                      {guideLines.map((l) => (
                        <li key={l} className="flex items-baseline gap-2.5">
                          <span aria-hidden className="dot relative -top-px text-border-strong" />
                          {l}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            )}
          </section>
        )}

        {/* 부서 현황 — member에게도 공개 (AU-06 v2.1). 파일 링크 없음 (CP-87~89) */}
        {/* 남의 부서를 읽는 사람에게는 이 카드 하나뿐이라 조금 넓게 */}
        <section className={`card ${isOwn ? 'lg:col-span-5' : 'lg:col-span-7'}`} aria-labelledby="division-status">
          <div className="card-head items-baseline">
            <h2 id="division-status" className="card-title">
              부서 제출 현황
            </h2>
            <span className="text-sm text-muted tabular-nums">
              <strong className="text-[17px] font-semibold text-ink">{submitted}</strong> / {members.length}
              {extras.length > 0 && <span> +{extras.length}</span>}
            </span>
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
            {members.map((m) => {
              const mine = m.user.id === scope.user.id;
              const done = m.status === 'submitted';
              return (
                <li key={m.user.id} className={`flex min-w-0 items-center gap-2 ${mine ? 'font-semibold' : ''}`}>
                  <span aria-hidden className={done ? 'dot text-success' : 'dot dot-hollow text-border-strong'} />
                  <span className={`truncate ${done ? 'text-ink' : 'text-muted'}`}>
                    {m.user.name}
                    {mine && ' (나)'}
                    <span className="sr-only">{done ? ' 제출' : ' 미제출'}</span>
                  </span>
                  {m.latest ? (
                    <span className="text-xs font-normal whitespace-nowrap text-muted-soft tabular-nums">
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
    </main>
  );
}
