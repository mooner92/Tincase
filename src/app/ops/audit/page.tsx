// `/ops/audit` — 감사 로그 열람 (운영자·총괄).
//
// TACP-10이 "경계를 넘는 접근은 반드시 기록된다"고 못박았는데 **볼 화면이 없었다.**
// 아무도 안 보는 로그는 있으나 마나다. 기록의 목적은 보관이 아니라 확인이다.
//
// 총괄에게도 여는 이유: 자기가 남의 부서를 얼마나 열어봤는지는 본인이 먼저 알아야 한다.
// 감시가 아니라 자기 확인이다.
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/server/db';
import { getPageScope } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { AppHeader } from '@/components/AppHeader';
import { AppFooter } from '@/components/AppFooter';
import { toKstIso } from '@/lib/week';

export const dynamic = 'force-dynamic';

/** 사람이 읽는 말로. 코드값을 그대로 보여주면 로그를 읽는 게 일이 된다 */
const ACTION_KO: Record<string, { label: string; tone: 'normal' | 'watch' | 'strong' }> = {
  upload: { label: '제출', tone: 'normal' },
  download: { label: '내려받기', tone: 'normal' },
  download_zip: { label: '전체 zip', tone: 'normal' },
  preview: { label: '열람', tone: 'normal' },
  merge: { label: '병합 실행', tone: 'normal' },
  rule_update: { label: '설정 변경', tone: 'watch' },
  template_update: { label: '양식 교체', tone: 'watch' },
  reject: { label: '반려', tone: 'watch' },
  cross_division_read: { label: '타 부서 열람', tone: 'strong' },
  password_reset: { label: '비밀번호 초기화', tone: 'strong' },
};

const TONE = {
  normal: 'bg-surface-card text-body',
  watch: 'bg-warning-soft text-body-strong',
  strong: 'bg-error-soft text-body-strong',
} as const;

const PAGE = 200;

/** 렌더 밖에서 시각을 만든다 — 컴포넌트 본문의 Date.now()는 순수하지 않다 */
function sinceDays(days: number): Date {
  return new Date(Date.now() - days * 86400_000);
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; actor?: string; days?: string }>;
}) {
  const ps = await getPageScope();
  if (!ps.ok) {
    if (ps.code === 'unauthenticated') redirect('/login');
    return noticeFor(ps.code, ps.message);
  }
  const scope = ps.scope;
  if (scope.user.mustChangePassword) redirect('/password?first=1');
  if (!scope.readAll) notFound(); // TACP-5 존재 은닉

  const sp = await searchParams;
  const days = Math.min(Math.max(Number(sp.days ?? 30) || 30, 1), 365);
  const since = sinceDays(days);
  const where = {
    at: { gte: since },
    ...(sp.action ? { action: sp.action } : {}),
    ...(sp.actor ? { actor: sp.actor } : {}),
  };

  const [logs, total, byAction, divisions] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { at: 'desc' }, take: PAGE }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.groupBy({ by: ['action'], where: { at: { gte: since } }, _count: true }),
    prisma.division.findMany({ select: { id: true, nameKo: true } }),
  ]);
  const divName = new Map(divisions.map((d) => [d.id, d.nameKo]));

  const counts = new Map(byAction.map((a) => [a.action, a._count]));
  const crossReads = counts.get('cross_division_read') ?? 0;

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { action: sp.action, actor: sp.actor, days: String(days), ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/ops/audit?${p.toString()}`;
  };

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
      <div className="mx-auto w-full max-w-[1120px] flex-1 px-5 pt-8 pb-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">감사 로그 · 최근 {days}일</p>
            <p className="display mt-1 text-[36px] leading-none">
              {total}
              <span className="ml-2 text-[18px] text-muted">건</span>
            </p>
            {crossReads > 0 && (
              <p className="mt-1 text-xs text-body">
                타 부서 열람 <span className="font-semibold">{crossReads}건</span> — 경계를 넘은 접근입니다
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link href="/ops" className="tab-pill">
              ← 운영
            </Link>
            {[7, 30, 90].map((d) => (
              <Link key={d} href={qs({ days: String(d) })} className={`tab-pill ${days === d ? 'tab-pill-active' : ''}`}>
                {d}일
              </Link>
            ))}
          </div>
        </div>

        {/* 행동별 필터 — 무엇이 얼마나 일어났는지가 목록보다 먼저 보여야 한다 */}
        <div className="mt-4 flex flex-wrap gap-1.5">
          <Link href={qs({ action: undefined })} className={`tab-pill ${!sp.action ? 'tab-pill-active' : ''}`}>
            전체
          </Link>
          {[...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([action, n]) => (
              <Link
                key={action}
                href={qs({ action })}
                className={`tab-pill ${sp.action === action ? 'tab-pill-active' : ''}`}
              >
                {ACTION_KO[action]?.label ?? action} {n}
              </Link>
            ))}
        </div>

        {sp.actor && (
          <p className="mt-3 text-sm text-body">
            <span className="font-medium">{sp.actor}</span>의 기록만 보는 중 ·{' '}
            <Link href={qs({ actor: undefined })} className="underline underline-offset-2">
              전체 보기
            </Link>
          </p>
        )}

        <section className="card mt-4 overflow-hidden">
          {logs.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted">해당 기간에 기록이 없습니다.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-hairline text-xs text-muted">
                <tr className="text-left">
                  <th className="px-4 py-2 font-medium">시각</th>
                  <th className="px-4 py-2 font-medium">한 사람</th>
                  <th className="px-4 py-2 font-medium">행동</th>
                  <th className="px-4 py-2 font-medium">부서</th>
                  <th className="px-4 py-2 font-medium">대상</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => {
                  const a = ACTION_KO[l.action] ?? { label: l.action, tone: 'normal' as const };
                  return (
                    <tr key={l.id} className="border-b border-hairline-soft last:border-0">
                      <td className="px-4 py-1.5 font-mono text-xs whitespace-nowrap text-muted tabular-nums">
                        {toKstIso(l.at).slice(5, 16).replace('T', ' ')}
                      </td>
                      <td className="px-4 py-1.5 whitespace-nowrap">
                        <Link href={qs({ actor: l.actor })} className="hover:underline">
                          {l.actor.replace('@kei.re.kr', '')}
                        </Link>
                      </td>
                      <td className="px-4 py-1.5 whitespace-nowrap">
                        <span className={`badge-pill py-0 text-[11px] ${TONE[a.tone]}`}>{a.label}</span>
                      </td>
                      <td className="px-4 py-1.5 whitespace-nowrap text-muted">
                        {l.divisionId ? (divName.get(l.divisionId) ?? '—') : '—'}
                      </td>
                      <td className="max-w-[380px] truncate px-4 py-1.5 font-mono text-xs text-muted-soft">
                        {l.target ?? ''}
                        {l.detail ? ` ${l.detail}` : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {total > logs.length && (
          <p className="mt-3 text-xs text-muted-soft">
            최근 {logs.length}건만 표시했습니다 (전체 {total}건). 기간·행동을 좁혀 보세요.
          </p>
        )}
      </div>
      <AppFooter />
    </div>
  );
}
