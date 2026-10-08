// 수합 관리 화면 (서버 컴포넌트) — 현재/과거 주차 공용 (PG §4 · PG-52)
//
// 위에서 아래로 담당자가 한 주에 하는 순서 그대로: 제출 현황 → 병합본(검토) → 위로 제출 → 부서원 표.
// 2026-10-07 — 요약을 짙은 초록 띠로 칠하던 것을 흰 카드로 바꿨다(CP-100: 큰 초록 면 금지).
// 긴 표가 맨 위에 있으면 병합본·제출 카드가 스크롤 아래로 밀려 「할 일」이 안 보였다.
//
// 2026-10-08 (PG-72·73 — 기능 정리) — 머리는 주차 고르기(달마다 묶음 + ‹ ›)와 오른쪽 구석의 작은 `부서 설정` 링크.
// 받기는 하나씩(전체 zip·줄 [받기] 없음), 진단 줄(「규칙 바뀜」·「빠진 사람」·집계 제외 각주)은 걷었다.
import Link from 'next/link';
import { prisma } from '@/server/db';
import type { Division } from '@prisma/client';
import { divisionStatus, divisionWeeks, effectiveDeadline, ensureCurrentSlot } from '@/server/worklog';
import { formatDeadlineKo, isLocked, toKstIso, currentWeek, slotKind } from '@/lib/week';
import { isOpenNow, OPEN_MINUTES } from '@/lib/deadline';
import { openingOf } from '@/server/deadline';
import { DeadlineOpener } from '@/components/DeadlineOpener';
import { CopyMissingButton } from '@/components/CopyMissingButton';
import { SlotSelector } from '@/components/SlotSelector';
import { SubmissionTableClient, type MemberRow } from '@/components/SubmissionTableClient';
import { MergePanel, type MergeGroupView, type MergeStateView } from '@/components/MergePanel';
import { ReportSubmitCard } from '@/components/ReportSubmitCard';
import { reportState } from '@/server/rollup/report';
import { rollupEnabled } from '@/server/rollup/schedule';
import { latestReview } from '@/server/merge/review';
import { latestEdits } from '@/server/merge/edits';
import { readStoredFile, sha256 } from '@/server/storage';
import { boardTitle } from '@/lib/docname';
import { differingGroups } from '@/lib/merge-rows';
import { notFound } from 'next/navigation';

/** 실행 기록(`MergeRun.reviewJson`)에서 이 화면이 읽는 것만 (HM-26). `missing`·`categories`도 기록에는 남는다 */
interface ReviewPayload {
  groups: MergeGroupView[];
  model: { used: boolean; reason: string | null };
  /** HM-33 — 확인이 필요한 행. 옛 실행에는 없다 */
  flagged?: MergeStateView['flagged'];
}

export async function ManageView({
  division,
  isoKey,
  canMerge,
  canDownloadMerged,
  canDeleteAny,
  canEditMerged,
  canApprove = false,
  canSendReport = false,
}: {
  division: Division; // ★ 해석된 부서. scope.division을 쓰면 타 부서 열람 시 어긋난다
  isoKey?: string;
  /** 병합 실행 — 내 부서 담당자만 (TACP-6: 쓰기는 신원의 부서에만) */
  canMerge: boolean;
  /** 병합본 내려받기 — 담당자 이상 (TACP §3.2) */
  canDownloadMerged: boolean;
  /** 제출물 삭제 — operator 전용 (TACP-14). 담당자에게는 주지 않는다 */
  canDeleteAny: boolean;
  /** 병합본 수정 — 담당자 + 내 부서 (TACP-15). 총괄은 열람까지다 */
  canEditMerged: boolean;
  /** HM-47 — 승인 버튼. 내 부서의 head에게만 (TACP-16) */
  canApprove?: boolean;
  /** RU-30 — 위로 [제출] 카드. 내 부서의 lead·head에게만 (TACP-21 `canSendReport`). 총괄·운영자도 대신 내지 않는다 */
  canSendReport?: boolean;
}) {
  const now = new Date();
  await ensureCurrentSlot(now);
  const currentKey = currentWeek(now).isoKey;

  const slot = isoKey
    ? await prisma.weekSlot.findUnique({ where: { isoKey } })
    : await prisma.weekSlot.findUnique({ where: { isoKey: currentKey } });
  if (!slot) notFound(); // 없는 isoKey

  const [{ members, extras, summary }, slotList] = await Promise.all([
    divisionStatus(division.id, slot.id),
    divisionWeeks(division.id, slot.id), // PG-72 — 근거 있는 주 + 이번 주 + 보는 주
  ]);

  // RU-30 — 위로 [제출]. 내 부서 lead·head에게만 그린다 (TACP-21·TACP-9). `canMerge`가 아니다 — 거기엔 readAll이
  // 섞여 있어 총괄에게 누르면 404인 버튼이 보였다. 꺼진 부서면 보낼 곳이 없어 null
  const report = canSendReport && (await rollupEnabled()) ? await reportState(division.id, slot, 'unit') : null;

  // HM-26 — 최신 실행 하나만 본다. 재실행하면 새 기록이 쌓이고 최신이 유효하다
  const lastRun = await prisma.mergeRun.findFirst({
    where: { divisionId: division.id, weekSlotId: slot.id },
    orderBy: { startedAt: 'desc' },
  });
  const review = lastRun?.reviewJson ? (JSON.parse(lastRun.reviewJson) as ReviewPayload) : null;
  // HM-47 — 이 화면이 보여 주는 **판**. [승인]이 이 판에만 붙도록 그대로 돌려보낸다
  let mergedSha: string | null = null;
  if (lastRun?.status === 'succeeded' && lastRun.outputPath) {
    try {
      mergedSha = sha256(await readStoredFile(lastRun.outputPath));
    } catch {
      mergedSha = null; // 파일이 없으면 승인도 못 한다 — 서버가 409로 답한다
    }
  }
  const mergeState: MergeStateView = {
    runId: lastRun?.status === 'succeeded' ? lastRun.id : null,
    sha256: mergedSha,
    status: (lastRun?.status as MergeStateView['status']) ?? 'none',
    finishedAtKst: lastRun?.finishedAt ? toKstIso(lastRun.finishedAt).slice(5, 16).replace('T', ' ') : null,
    rowCounts: lastRun?.rowCounts ? JSON.parse(lastRun.rowCounts) : null,
    warnings: lastRun?.warnings ? JSON.parse(lastRun.warnings) : [],
    errorText: lastRun?.errorText ?? null,
    // S8 — 묶음 원문은 실행 기록에 남기고 화면에는 수만 보낸다. 클라이언트로 원문을 다 실어 보낼 이유가 없다
    differing: differingGroups(review?.groups ?? []),
    modelUsed: review?.model?.used ?? false,
    modelReason: review?.model?.reason ?? null,
    sourceCount: lastRun?.sourceIds ? (JSON.parse(lastRun.sourceIds) as string[]).length : 0,
    flagged: review?.flagged ?? [],
    review: lastRun?.status === 'succeeded' ? await latestReview(division.id, slot.id) : null,
    hasHead: (await prisma.user.count({ where: { divisionId: division.id, isActive: true, divisionRole: 'head' } })) > 0,
    // HM-49 — 마지막 실행이 실패했어도 덮이는 것은 최신 **성공** 실행의 파일이다. 그래서 따로 찾는다
    edits: (await latestEdits(division.id, slot.id))?.edits ?? null,
  };

  const deadline = effectiveDeadline(slot, division);
  const closed = isLocked(slot, division, now);
  // DM-20 — 담당자가 잠시 열어 두었는가
  const opening = await openingOf(division.id, slot.id);
  const opened = isOpenNow(opening, now);
  const locked = closed && !opened;
  const openUntilKo = opening ? toKstIso(opening.openUntil).slice(11, 16) : null;
  const missing = members.filter((m) => m.status === 'missing').map((m) => m.user.name);
  const pct = summary.roster > 0 ? Math.round((summary.submitted / summary.roster) * 100) : 0;
  // DM-17 — 병합은 **모인 파일 전부**를 다룬다 (명단 밖 제출 포함).
  // 진척률(submitted/roster)과 다른 수다. 이걸 같은 수로 쓰면 추가 제출만 있을 때
  // "제출된 파일이 없습니다"라고 하면서 병합은 되는 모순이 생긴다
  const collected = summary.submitted + summary.extras;

  // HM-47 · CP-99 — 부서장이 승인할 판이 있으면 그 화면의 주 버튼은 [승인]이다. 그동안 [위로 제출]은 보조로 물러난다
  const awaitingMyApproval =
    canApprove && mergeState.status === 'succeeded' && (!mergeState.review || mergeState.review.changedAfter);
  // RU-30 — 부서장이 있는 부서에서 지금 판이 아직 승인 전이면 [위로 제출] 카드가 같은 줄에 그렇게 말하고 보조로 물러난다.
  // 승인 상태가 병합본 카드에만 있으면, 바로 아래 초록 [제출]이 「승인 전에 보내도 된다」로 읽혔다(2026-10-08)
  const headApproval =
    mergeState.hasHead && mergeState.status === 'succeeded'
      ? !mergeState.review
        ? ('pending' as const)
        : mergeState.review.changedAfter
          ? ('changed' as const)
          : null
      : null;
  const toRow = (m: (typeof members)[number]): MemberRow => ({
    user: { id: m.user.id, name: m.user.name },
    status: m.status,
    latest: m.latest && {
      id: m.latest.id,
      version: m.latest.version,
      uploadedAtKst: toKstIso(m.latest.uploadedAt).slice(5, 16).replace('T', ' '),
    },
    versionCount: m.versionCount,
    notifiedAtKst: m.notifiedAtKst,
  });

  return (
    <main className="pt-8">
      <div className="page-head">
        <h1 className="page-title flex flex-wrap items-center gap-2.5">
          {slot.year}년 {slot.label}
          {/* WS-14 — 이 주에 모으는 것이 월간이면 담당자가 먼저 알아야 한다 */}
          {slotKind(slot) === 'monthly' && <span className="chip chip-ok">{slot.month}월 월간</span>}
        </h1>
        <div className="flex w-full flex-wrap items-center justify-end gap-x-4 gap-y-2 sm:w-auto">
          <SlotSelector
            baseHref={`/${division.slug}/manage`}
            selected={slot.isoKey}
            roster={slotList.roster}
            slots={slotList.slots.map((s) => ({
              isoKey: s.isoKey,
              label: s.label,
              year: s.year,
              month: s.month,
              submitted: slotList.submittedOf(s.id),
              isCurrent: s.isoKey === currentKey,
              monthly: slotKind(s) === 'monthly',
            }))}
          />
          {/*
            PG-72 · S6 — 부서 설정은 메뉴가 아니라 여기서 들어간다. 매주 하는 일이 아니라(양식은 온보딩 때 한 번, 분류 순서는
            한 곳이 쓴다) 상단 메뉴 한 칸을 차지할 일이 아니다. 이 화면을 보는 사람(canManage)이 예전에 그 메뉴를 보던 사람이다
          */}
          <Link href={`/${division.slug}/manage/settings`} className="text-sm text-muted underline underline-offset-2 hover:text-ink">
            부서 설정
          </Link>
        </div>
      </div>

      <div className="mt-6 space-y-4 lg:space-y-6">
        {/* StatusSummary (CP-44~47) — 흰 카드 하나: 숫자 · 막대 · 마감 칩 · 미제출 복사 */}
        <section data-guide="status-card" className="card" aria-labelledby="status-summary">
          <div className="card-head">
            <div>
              <h2 id="status-summary" className="card-title">
                제출 현황
              </h2>
              <p className="mt-2 flex items-baseline gap-2 tabular-nums">
                <span className="text-[40px] leading-none font-semibold tracking-tight text-ink">{summary.submitted}</span>
                <span className="text-[17px] text-muted">/ {summary.roster}</span>
                {summary.missing === 0 && summary.roster > 0 && (
                  <span className="chip chip-ok ml-1 self-center">
                    <span aria-hidden className="dot" />
                    전원 제출
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-col items-start gap-1.5 sm:items-end">
              {/*
                WS-18 — 예외 주차면 이 칩이 붉어진다. 부서원 화면과 같은 규칙이다 —
                새 요소를 더하지 않고 **이미 보는 것의 색을 바꾼다.**
              */}
              <span
                className={`chip ${
                  opened ? 'chip-warn' : slot.deadlineNote && !locked ? 'chip-error font-semibold' : 'chip-muted'
                }`}
              >
                {/* 열려 있을 땐 원래 마감 날짜가 아니라 **언제까지인지**가 알아야 할 것이다 */}
                {opened
                  ? `열어 둠 · ${openUntilKo}까지`
                  : `${locked ? '마감됨' : '진행 중'} · ${formatDeadlineKo(deadline)}`}
              </span>
              {slot.deadlineNote && <p className="text-xs text-muted sm:text-right">{slot.deadlineNote}</p>}
            </div>
          </div>

          <div
            className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-surface-strong"
            role="progressbar"
            aria-label="제출 진행"
            aria-valuenow={summary.submitted}
            aria-valuemin={0}
            aria-valuemax={summary.roster}
          >
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
          </div>

          {(missing.length > 0 || (canMerge && closed)) && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <CopyMissingButton names={missing} />
              {/*
                DM-20 — 마감이 지난 뒤에만 보인다. 마감 전에는 누구나 낼 수 있으므로
                열 것이 없고, 그때 버튼이 있으면 «지금도 잠겨 있나?»로 읽힌다 (TACP-9).
              */}
              {canMerge && closed && (
                <DeadlineOpener
                  open={opened}
                  openUntilKo={openUntilKo}
                  openedBy={opening?.openedBy ?? null}
                  minutes={OPEN_MINUTES}
                />
              )}
            </div>
          )}
          {/*
            CP-106a · HM-49 — 고친 병합본은 닫힌 뒤에도 다시 만들지 않는다. 그때만 한 줄 — 늦게 낸 사람이 들어갔다고 믿지 않게.
            열어 둔 것 자체는 칩(「열어 둠 · …까지」)과 [지금 닫기]가 말한다 (2026-10-08 사용자: 주석 걷기)
          */}
          {opened && mergeState.edits && <p className="callout callout-warn mt-4">고친 병합본은 자동 재병합 안 함</p>}
        </section>

        {/* HM-26 — 병합 결과. 목요일 14:10에 이게 이미 준비돼 있는 게 목표다 */}
        <MergePanel
          state={mergeState}
          isoKey={slot.isoKey}
          divisionSlug={division.slug}
          title={boardTitle(slot.month, slot.label, division.nameKo, slotKind(slot))}
          canRun={canMerge}
          canEditMerged={canEditMerged}
          canApprove={canApprove}
          canDownload={canDownloadMerged}
          submitted={collected}
        />

        {report && (
          <ReportSubmitCard
            isoKey={slot.isoKey}
            primary={!awaitingMyApproval}
            headApproval={headApproval}
            state={{
              ...report,
              current: report.current && {
                ...report.current,
                submittedAtKst: toKstIso(report.current.submittedAt).slice(5, 16).replace('T', ' '),
              },
            }}
          />
        )}

        {/* SubmissionTable + 드로어 (CP-48~53, PG-19/20). 전체 zip·줄 [받기]·집계 제외 각주는 걷었다 (PG-73) */}
        <SubmissionTableClient
          caption={`${division.nameKo} ${slot.label} 제출 현황`}
          title={`부서원 ${members.length}명`}
          members={members.map(toRow)}
          canDelete={canDeleteAny}
        />

        {/* DM-17 — 명단 밖인데 낸 사람. 분모에는 없지만 병합에는 들어간다 */}
        {extras.length > 0 && (
          <SubmissionTableClient
            caption={`${division.nameKo} ${slot.label} 추가 제출`}
            title="추가 제출"
            members={extras.map(toRow)}
            canDelete={canDeleteAny}
          />
        )}
      </div>
    </main>
  );
}
