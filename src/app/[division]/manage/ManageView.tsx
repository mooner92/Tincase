// 수합 관리 화면 (서버 컴포넌트) — 현재/과거 주차 공용 (PG §4)
import { prisma } from '@/server/db';
import type { Scope } from '@/server/authz';
import { divisionStatus, divisionSlots, effectiveDeadline, ensureCurrentSlot } from '@/server/worklog';
import { formatDeadlineKo, isLocked, toKstIso, currentWeek } from '@/lib/week';
import { CopyMissingButton } from '@/components/CopyMissingButton';
import { SlotSelector } from '@/components/SlotSelector';
import { SubmissionTableClient, type MemberRow } from '@/components/SubmissionTableClient';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export async function ManageView({ scope, isoKey }: { scope: Scope; isoKey?: string }) {
  const now = new Date();
  await ensureCurrentSlot(now);
  const currentKey = currentWeek(now).isoKey;

  const slot = isoKey
    ? await prisma.weekSlot.findUnique({ where: { isoKey } })
    : await prisma.weekSlot.findUnique({ where: { isoKey: currentKey } });
  if (!slot) notFound(); // 없는 isoKey (PG-28 상당)

  const [{ members, offRoster, summary }, slotList] = await Promise.all([
    divisionStatus(scope.division.id, slot.id),
    divisionSlots(scope.division.id),
  ]);

  const deadline = effectiveDeadline(slot, scope.division);
  const locked = isLocked({ opensAt: slot.opensAt }, scope.division, now);
  const missing = members.filter((m) => m.status === 'missing').map((m) => m.user.name);
  const pct = summary.roster > 0 ? Math.round((summary.submitted / summary.roster) * 100) : 0;

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
    <main className="mt-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-slate-900">
          수합 관리
          <Link
            href={`/${scope.division.slug}/manage/settings`}
            className="ml-3 align-middle text-sm font-normal text-blue-700 hover:underline"
          >
            부서 설정
          </Link>
        </h1>
        <SlotSelector
          baseHref={`/${scope.division.slug}/manage`}
          selected={slot.isoKey}
          roster={slotList.roster}
          slots={slotList.slots.map((s) => ({
            isoKey: s.isoKey,
            label: s.label,
            year: s.year,
            submitted: slotList.submittedOf(s.id),
            isCurrent: s.isoKey === currentKey,
          }))}
        />
      </div>

      {/* StatusSummary (CP-44~47) */}
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-2xl font-bold text-slate-900">
            {summary.submitted} <span className="text-base font-normal text-slate-400">/ {summary.roster} 제출</span>
            {summary.missing === 0 && summary.roster > 0 && <span className="ml-2 text-green-600">✓ 전원 제출</span>}
          </p>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>
              마감 {formatDeadlineKo(deadline)} ·{' '}
              {locked ? (
                <span className="font-medium text-slate-500">마감됨</span>
              ) : (
                <span className="font-medium text-blue-700">진행 중</span>
              )}
            </span>
            <CopyMissingButton names={missing} />
          </div>
        </div>
        <div
          className="mt-3 h-2 w-full overflow-hidden rounded bg-slate-100"
          role="progressbar"
          aria-valuenow={summary.submitted}
          aria-valuemin={0}
          aria-valuemax={summary.roster}
        >
          <div className="h-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </section>

      {/* SubmissionTable + 드로어 (CP-48~53, PG-19/20) */}
      <SubmissionTableClient caption={`${scope.division.nameKo} ${slot.label} 제출 현황`} members={tableRows} />
      {offRoster.length > 0 && (
        <p className="px-1 text-xs text-slate-400">
          제출 대상 아님: {offRoster.map((u) => u.name).join(', ')} — 명단 변경은 운영자에게 (PG-31)
        </p>
      )}

      {/* BulkActions (CP-58~61) */}
      <section className="flex flex-wrap items-center gap-3">
        {summary.submitted > 0 ? (
          <a
            href={`/api/division/download-zip?slot=${slot.isoKey}`}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            전체 zip 받기 ({summary.submitted}개)
          </a>
        ) : (
          <button
            disabled
            title="제출된 파일이 없습니다"
            className="cursor-not-allowed rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-400"
          >
            전체 zip 받기 (0개)
          </button>
        )}
        <button
          disabled
          title="준비 중 (Phase 2)"
          className="cursor-not-allowed rounded-lg border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-medium text-slate-400"
        >
          자동 병합 <span className="text-xs">(준비 중)</span>
        </button>
      </section>
    </main>
  );
}
