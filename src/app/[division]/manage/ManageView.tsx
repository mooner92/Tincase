// 수합 관리 화면 (서버 컴포넌트) — 현재/과거 주차 공용 (PG §4)
// 요약은 teal 피처 카드(featured tier 패턴), 표는 캔버스 카드.
import { prisma } from '@/server/db';
import type { Division } from '@prisma/client';
import { divisionStatus, divisionSlots, effectiveDeadline, ensureCurrentSlot } from '@/server/worklog';
import { formatDeadlineKo, isLocked, toKstIso, currentWeek, slotKind } from '@/lib/week';
import { CopyMissingButton } from '@/components/CopyMissingButton';
import { SlotSelector } from '@/components/SlotSelector';
import { SubmissionTableClient, type MemberRow } from '@/components/SubmissionTableClient';
import { MergePanel, type MergeStateView } from '@/components/MergePanel';
import { notFound } from 'next/navigation';

interface ReviewPayload {
  groups: MergeStateView['groups'];
  model: { used: boolean; reason: string | null };
  categories: { order: string[] } | null;
  missing: string[];
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
}) {
  const now = new Date();
  await ensureCurrentSlot(now);
  const currentKey = currentWeek(now).isoKey;

  const slot = isoKey
    ? await prisma.weekSlot.findUnique({ where: { isoKey } })
    : await prisma.weekSlot.findUnique({ where: { isoKey: currentKey } });
  if (!slot) notFound(); // 없는 isoKey

  const [{ members, extras, offRoster, summary }, slotList] = await Promise.all([
    divisionStatus(division.id, slot.id),
    divisionSlots(division.id),
  ]);

  // HM-26 — 최신 실행 하나만 본다. 재실행하면 새 기록이 쌓이고 최신이 유효하다
  const lastRun = await prisma.mergeRun.findFirst({
    where: { divisionId: division.id, weekSlotId: slot.id },
    orderBy: { startedAt: 'desc' },
  });
  const review = lastRun?.reviewJson ? (JSON.parse(lastRun.reviewJson) as ReviewPayload) : null;
  const mergeState: MergeStateView = {
    status: (lastRun?.status as MergeStateView['status']) ?? 'none',
    finishedAtKst: lastRun?.finishedAt ? toKstIso(lastRun.finishedAt).slice(5, 16).replace('T', ' ') : null,
    trigger: lastRun ? ((JSON.parse(lastRun.ruleSnapshot) as { trigger?: 'auto' | 'manual' }).trigger ?? null) : null,
    rowCounts: lastRun?.rowCounts ? JSON.parse(lastRun.rowCounts) : null,
    warnings: lastRun?.warnings ? JSON.parse(lastRun.warnings) : [],
    errorText: lastRun?.errorText ?? null,
    groups: review?.groups ?? [],
    modelUsed: review?.model?.used ?? false,
    modelReason: review?.model?.reason ?? null,
    categoryOrder: review?.categories?.order ?? [],
    sourceCount: lastRun?.sourceIds ? (JSON.parse(lastRun.sourceIds) as string[]).length : 0,
    missing: review?.missing ?? [],
    flagged: review?.flagged ?? [],
  };

  const deadline = effectiveDeadline(slot, division);
  const locked = isLocked({ opensAt: slot.opensAt }, division, now);
  const missing = members.filter((m) => m.status === 'missing').map((m) => m.user.name);
  const pct = summary.roster > 0 ? Math.round((summary.submitted / summary.roster) * 100) : 0;
  // DM-17 — 병합·zip은 **모인 파일 전부**를 다룬다 (명단 밖 제출 포함).
  // 진척률(submitted/roster)과 다른 수다. 이걸 같은 수로 쓰면 추가 제출만 있을 때
  // "제출된 파일이 없습니다"라고 하면서 병합은 되는 모순이 생긴다
  const collected = summary.submitted + summary.extras;

  const tableRows: MemberRow[] = members.map((m) => ({
    user: { id: m.user.id, name: m.user.name },
    status: m.status,
    latest: m.latest && {
      id: m.latest.id,
      version: m.latest.version,
      byteSize: m.latest.byteSize,
      uploadedAtKst: toKstIso(m.latest.uploadedAt).slice(5, 16).replace('T', ' '),
    },
    versionCount: m.versionCount,
  }));

  return (
    <main className="pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">수합 관리</p>
          <h1 className="display mt-1 flex flex-wrap items-center gap-2.5 text-[32px] leading-[1.15]">
            {slot.year}년 {slot.label}
            {/* WS-14 — 이 주에 모으는 것이 월간이면 담당자가 먼저 알아야 한다 */}
            {slotKind(slot) === 'monthly' && (
              <span className="rounded-full bg-brand px-2.5 py-1 text-[13px] font-semibold text-white">
                {slot.month}월 월간
              </span>
            )}
          </h1>
        </div>
        <div className="pb-1">
          <SlotSelector
            baseHref={`/${division.slug}/manage`}
            selected={slot.isoKey}
            roster={slotList.roster}
            slots={slotList.slots.map((s) => ({
              isoKey: s.isoKey,
              label: s.label,
              year: s.year,
              submitted: slotList.submittedOf(s.id),
              isCurrent: s.isoKey === currentKey,
              monthly: slotKind(s) === 'monthly',
            }))}
          />
        </div>
      </div>

      {/* StatusSummary — teal 피처 카드 (CP-44~47) */}
      <section className="card-feature mt-6 bg-brand px-8 py-7 text-white">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-brand-tint uppercase">제출 현황</p>
            <p className="mt-1 text-[44px] leading-none font-semibold tracking-tight">
              {summary.submitted}
              <span className="text-xl font-normal text-white/60"> / {summary.roster}</span>
              {summary.missing === 0 && summary.roster > 0 && (
                <span className="ml-3 align-middle text-base font-medium text-brand-tint">✓ 전원 제출</span>
              )}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2.5">
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-[13px] font-medium ${
                locked ? 'bg-white/10 text-white/70' : 'bg-white/15 text-brand-tint'
              }`}
            >
              {locked ? '마감됨' : '진행 중'} · {formatDeadlineKo(deadline)}
            </span>
            <CopyMissingButton names={missing} />
          </div>
        </div>
        <div
          className="mt-5 h-2 w-full overflow-hidden rounded-full bg-white/15"
          role="progressbar"
          aria-valuenow={summary.submitted}
          aria-valuemin={0}
          aria-valuemax={summary.roster}
        >
          <div className="h-full rounded-full bg-brand-soft transition-all" style={{ width: `${pct}%` }} />
        </div>
      </section>

      {/* SubmissionTable + 드로어 (CP-48~53, PG-19/20) */}
      <div className="mt-6">
        <SubmissionTableClient
          caption={`${division.nameKo} ${slot.label} 제출 현황`}
          members={tableRows}
          canDelete={canDeleteAny}
        />
      </div>
      {/* DM-17 — 명단 밖인데 낸 사람. 분모에는 없지만 병합에는 들어간다 */}
      {extras.length > 0 && (
        <section className="mt-6">
          <h2 className="label">추가 제출 — 집계 대상은 아니지만 병합에 포함됩니다</h2>
          <SubmissionTableClient
            caption={`${division.nameKo} ${slot.label} 추가 제출`}
            members={extras.map((m) => ({
              user: { id: m.user.id, name: m.user.name },
              status: m.status,
              latest: m.latest && {
                id: m.latest.id,
                version: m.latest.version,
                byteSize: m.latest.byteSize,
                uploadedAtKst: toKstIso(m.latest.uploadedAt).slice(5, 16).replace('T', ' '),
              },
              versionCount: m.versionCount,
              notifiedAtKst: m.notifiedAtKst,
            }))}
            canDelete={canDeleteAny}
          />
        </section>
      )}

      {offRoster.length > 0 && (
        <p className="mt-2 px-1 text-xs text-muted-soft">
          집계 제외: {offRoster.map((u) => (u.note ? `${u.name}(${u.note})` : u.name)).join(', ')} —
          내실 수는 있고, 내시면 위에 «추가 제출»로 표시됩니다. 명단 변경은 운영자에게
        </p>
      )}

      {/* HM-26 — 병합 결과. 목요일 14:10에 이게 이미 준비돼 있는 게 목표다 */}
      <div className="mt-8">
        <MergePanel
          state={mergeState}
          isoKey={slot.isoKey}
          divisionSlug={division.slug}
          canRun={canMerge}
          canEditMerged={canEditMerged}
          canDownload={canDownloadMerged}
          submitted={collected}
        />
      </div>

      {/* BulkActions (CP-58~61) */}
      <section className="mt-6 flex flex-wrap items-center gap-3">
        {collected > 0 ? (
          <a
            href={`/api/division/download-zip?slot=${slot.isoKey}&division=${encodeURIComponent(division.slug)}`}
            className="btn-primary"
          >
            전체 zip 받기 ({collected}개)
          </a>
        ) : (
          <button disabled title="제출된 파일이 없습니다" className="btn-primary">
            전체 zip 받기 (0개)
          </button>
        )}
      </section>
    </main>
  );
}
