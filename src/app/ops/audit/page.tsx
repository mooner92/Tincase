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
import { canOperate, rollupNav } from '@/server/authz';
import { AppHeader } from '@/components/AppHeader';
import { AppFooter } from '@/components/AppFooter';
import { toKstIso } from '@/lib/week';

export const dynamic = 'force-dynamic';

/** 사람이 읽는 말로. 코드값을 그대로 보여주면 로그를 읽는 게 일이 된다 */
// 코드값이 화면에 그대로 나가면(「report_submit」·「rollup」) 읽는 사람이 번역해야 한다 — AuditAction 전부를 적는다
const ACTION_KO: Record<string, { label: string; tone: 'normal' | 'watch' | 'strong' }> = {
  upload: { label: '제출', tone: 'normal' },
  delete: { label: '제출물 삭제', tone: 'strong' },
  notify_pref: { label: '알림 설정', tone: 'normal' },
  roster_sync: { label: '인원 최신화', tone: 'watch' },
  deadline_open: { label: '마감 열기', tone: 'watch' },
  deadline_close: { label: '마감 닫기', tone: 'normal' },
  setup_link: { label: '설정 링크 발송', tone: 'watch' },
  setup_done: { label: '비밀번호 설정', tone: 'normal' },
  deadline_override: { label: '마감 변경', tone: 'watch' },
  report_submit: { label: '위로 제출', tone: 'normal' },
  report_withdraw: { label: '제출 취소', tone: 'watch' },
  rollup: { label: '이어 붙이기', tone: 'normal' },
  rollup_order: { label: '순서 변경', tone: 'watch' },
  submission_revise: { label: '제출물 고침', tone: 'watch' },
  approve: { label: '승인', tone: 'normal' },
  edit: { label: '병합본 수정', tone: 'watch' },
  withdraw_upload: { label: '올린 파일 취소', tone: 'watch' },
  login_ok: { label: '로그인', tone: 'normal' },
  login_fail: { label: '로그인 실패', tone: 'watch' },
  password_change: { label: '비밀번호 변경', tone: 'normal' },
  forgot: { label: '재설정 요청', tone: 'normal' },
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
  normal: 'chip-muted',
  watch: 'chip-warn',
  strong: 'chip-error',
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
        isLead={scope.isManager || scope.readAll}
        isOperator={scope.user.isOperator}
        readAll={scope.readAll}
        {...(await rollupNav(scope))}
        viaCloudflare={scope.source === 'cloudflare'}
        notifyEnabled={ps.scope.user.notifyEnabled}
      />
      <div className="mx-auto w-full max-w-[1120px] flex-1 px-5 pt-8 pb-8">
        {/* 제목은 다른 화면과 같은 크기 — 「60 건」 같은 큰 숫자가 제목 자리에 있으면 무슨 화면인지 한 번 더 읽어야 한다 */}
        <div className="page-head">
          <div>
            <h1 className="page-title">감사 로그</h1>
            <p className="page-sub">
              최근 {days}일 · {total}건
              {crossReads > 0 && (
                <>
                  {' · '}타 부서 열람 <span className="font-semibold text-body">{crossReads}건</span> — 경계를 넘은 접근입니다
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            {/* TACP-9 — 「운영」은 운영자만 연다. 총괄에게 그리면 누르는 순간 404다 */}
            {canOperate(scope.user) && (
              <Link href="/ops" className="btn-ghost">
                ← 운영
              </Link>
            )}
            {[7, 30, 90].map((d) => (
              <Link key={d} href={qs({ days: String(d) })} className={`tab-pill ${days === d ? 'tab-pill-active' : ''}`}>
                {d}일
              </Link>
            ))}
          </div>
        </div>

        {/* 행동별 필터 — 무엇이 얼마나 일어났는지가 목록보다 먼저 보여야 한다. 페이지 탭이라 밑줄 (CP-100) */}
        <nav aria-label="행동별 필터" className="mt-6 flex flex-wrap gap-x-5 gap-y-1 border-b border-hairline">
          <Link href={qs({ action: undefined })} className={`tab-line ${!sp.action ? 'tab-line-active' : ''}`}>
            전체
          </Link>
          {[...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([action, n]) => (
              <Link
                key={action}
                href={qs({ action })}
                className={`tab-line ${sp.action === action ? 'tab-line-active' : ''}`}
              >
                {ACTION_KO[action]?.label ?? action}
                <span className="text-xs text-muted tabular-nums">{n}</span>
              </Link>
            ))}
        </nav>

        {sp.actor && (
          <p className="mt-3 text-sm text-body">
            <span className="font-medium">{sp.actor}</span>의 기록만 보는 중 ·{' '}
            <Link href={qs({ actor: undefined })} className="underline underline-offset-2">
              전체 보기
            </Link>
          </p>
        )}

        <section className="card card-flush mt-4 overflow-x-auto">
          {logs.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted">해당 기간에 기록이 없습니다.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>시각</th>
                  <th>한 사람</th>
                  <th>행동</th>
                  <th>부서</th>
                  <th>대상</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => {
                  const a = ACTION_KO[l.action] ?? { label: l.action, tone: 'normal' as const };
                  return (
                    <tr key={l.id}>
                      <td className="text-xs whitespace-nowrap text-muted">
                        {toKstIso(l.at).slice(5, 16).replace('T', ' ')}
                      </td>
                      <td className="whitespace-nowrap">
                        <Link href={qs({ actor: l.actor })} className="text-ink hover:underline">
                          {l.actor.replace('@kei.re.kr', '')}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap">
                        <span className={`chip text-xs ${TONE[a.tone]}`}>{a.label}</span>
                      </td>
                      <td className="whitespace-nowrap text-muted">
                        {l.divisionId ? (divName.get(l.divisionId) ?? '—') : '—'}
                      </td>
                      {/* 대상은 대개 내부 id다 — 읽을 일이 드물어 흐리게, 한 줄로 자른다 (title로 전체를 본다) */}
                      <td
                        className="max-w-[320px] truncate font-mono text-xs text-muted"
                        title={`${l.target ?? ''}${l.detail ? ` ${l.detail}` : ''}`}
                      >
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
          <p className="mt-3 text-xs text-muted">
            최근 {logs.length}건만 표시했습니다 (전체 {total}건). 기간·행동을 좁혀 보세요.
          </p>
        )}
      </div>
      <AppFooter />
    </div>
  );
}
