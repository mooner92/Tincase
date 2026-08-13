// 수합 관리 화면 (서버 컴포넌트) — 현재/과거 주차 공용 (PG §4)
import { prisma } from '@/server/db';
import type { Scope } from '@/server/authz';
import { divisionStatus, divisionSlots, effectiveDeadline, ensureCurrentSlot } from '@/server/worklog';
import { formatDeadlineKo, isLocked, toKstIso, currentWeek } from '@/lib/week';
import { CopyMissingButton } from '@/components/CopyMissingButton';
import { SlotSelector } from '@/components/SlotSelector';
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

  return (
    <main className="mt-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-slate-900">수합 관리</h1>
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

      {/* SubmissionTable (CP-48~53) */}
      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <caption className="sr-only">
            {scope.division.nameKo} {slot.label} 제출 현황
          </caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th scope="col" className="px-4 py-2.5 font-medium">이름</th>
              <th scope="col" className="px-4 py-2.5 font-medium">상태</th>
              <th scope="col" className="px-4 py-2.5 font-medium">버전</th>
              <th scope="col" className="px-4 py-2.5 font-medium">제출시각</th>
              <th scope="col" className="px-4 py-2.5 font-medium">크기</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">받기</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr
                key={m.user.id}
                className={`border-b border-slate-100 last:border-0 ${m.status === 'missing' ? 'bg-slate-50/60' : ''}`}
              >
                <td className="px-4 py-2.5 font-medium text-slate-800">{m.user.name}</td>
                <td className="px-4 py-2.5">
                  {m.status === 'submitted' ? (
                    <span className="text-green-700">● 제출</span>
                  ) : (
                    <span className="text-slate-400">○ 미제출</span>
                  )}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-slate-600">
                  {m.latest ? (
                    m.versionCount > 1 ? (
                      // CP-51 대체: 네이티브 details로 버전 이력 (Sprint 1)
                      <details className="relative">
                        <summary className="cursor-pointer list-none text-blue-700 underline decoration-dotted">
                          v{m.latest.version} ({m.versionCount})
                        </summary>
                        <VersionList userId={m.user.id} weekSlotId={slot.id} />
                      </details>
                    ) : (
                      `v${m.latest.version}`
                    )
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-slate-600">
                  {m.latest ? toKstIso(m.latest.uploadedAt).slice(5, 16).replace('T', ' ') : '—'}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-slate-600">
                  {m.latest ? `${(m.latest.byteSize / 1024).toFixed(1)} KB` : '—'}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {m.latest && (
                    <a
                      href={`/api/submissions/${m.latest.id}/download`}
                      className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      ↓ 받기
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {offRoster.length > 0 && (
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
            제출 대상 아님: {offRoster.map((u) => u.name).join(', ')} — 명단 변경은 운영자에게 (PG-31)
          </p>
        )}
      </section>

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

/** 구버전 목록 — details 안에 서버 렌더 (CP-54~56 축약판) */
async function VersionList({ userId, weekSlotId }: { userId: string; weekSlotId: string }) {
  const versions = await prisma.submission.findMany({
    where: { userId, weekSlotId },
    orderBy: { version: 'desc' },
  });
  return (
    <ul className="absolute z-10 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
      {versions.map((v) => (
        <li key={v.id} className="flex items-center justify-between gap-2 px-2 py-1 text-xs">
          <span>
            v{v.version}
            {v.isLatest && <span className="ml-1 rounded bg-blue-50 px-1 text-blue-700">현재본</span>}
          </span>
          <span className="tabular-nums text-slate-400">{toKstIso(v.uploadedAt).slice(5, 16).replace('T', ' ')}</span>
          <a href={`/api/submissions/${v.id}/download`} className="text-blue-700 hover:underline">
            받기
          </a>
        </li>
      ))}
    </ul>
  );
}
