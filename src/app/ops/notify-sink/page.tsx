// `/ops/notify-sink` — 가짜 알림 수신함 (PG-88 · NT-56 · TACP-26). 시험·시연 서버의 운영자만.
//
// 시험 서버는 알림을 실제 메신저가 아니라 같은 앱의 수신함(`/api/dev/messenger-sink`)으로 보낸다. 여기서 「무엇이 누구에게 언제」
// 갔는지 본다 — 새 것부터, 종류·받는 사람으로 거른다. 운영(시험·시연 아님)에서는 누구에게나 404다(있다는 것도 알리지 않는다).
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requirePageScope } from '@/server/page-scope';
import { canOperate, rollupNav } from '@/server/authz';
import { messengerSinkOpen, readSinkEntries } from '@/server/messenger-sink';
import { SINK_KIND_LABEL } from '@/lib/messenger-sink';
import { noticeFor } from '@/components/Notice';
import { AppHeader } from '@/components/AppHeader';
import { AppFooter } from '@/components/AppFooter';
import { toKstIso } from '@/lib/week';
import { getTour } from '@/server/tour';
import { ClearButton } from './ClearButton';

export const dynamic = 'force-dynamic';

/** 한 화면에 그리는 수 — 리허설 한 번은 백 통 남짓이다 */
const PAGE = 500;

const label = (base: string) => SINK_KIND_LABEL[base] ?? (base || '종류 없음');

export default async function NotifySinkPage({ searchParams }: { searchParams: Promise<{ kind?: string; to?: string }> }) {
  if (!messengerSinkOpen()) notFound(); // 운영 — 신원보다 먼저. 누구에게나 같은 404
  const ps = await requirePageScope();
  if (!ps.ok) return noticeFor(ps.code, ps.message);
  const scope = ps.scope;
  if (!canOperate(scope.user)) notFound(); // TACP-26 — 운영자만 (TACP-5 존재 은닉)

  const sp = await searchParams;
  const all = (await readSinkEntries()).reverse(); // 새 것부터
  const counts = new Map<string, number>();
  for (const e of all) counts.set(e.base, (counts.get(e.base) ?? 0) + 1);
  const shown = all
    .filter((e) => !sp.kind || e.base === sp.kind)
    .filter((e) => !sp.to || e.recipients.some((r) => r.employeeNo === sp.to))
    .slice(0, PAGE);
  const toName = sp.to ? all.flatMap((e) => e.recipients).find((r) => r.employeeNo === sp.to) : undefined;

  const qs = (patch: { kind?: string; to?: string }) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ kind: sp.kind, to: sp.to, ...patch })) if (v) p.set(k, v);
    const q = p.toString();
    return q ? `/ops/notify-sink?${q}` : '/ops/notify-sink';
  };

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader
        slug={scope.division.slug}
        divisionName={scope.division.nameKo}
        userName={scope.user.name}
        isLead={scope.isManager || scope.readAll}
        isOperator
        readAll={scope.readAll}
        {...(await rollupNav(scope))}
        viaCloudflare={scope.source === 'cloudflare'}
        tour={await getTour(scope, false)}
      />
      <main className="mx-auto w-full max-w-[1120px] flex-1 px-5 pt-8 pb-8">
        <div className="page-head">
          <div>
            <h1 className="page-title">알림 수신함</h1>
            <p className="page-sub">{all.length}건</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <Link href="/ops" className="btn-ghost">
              ← 운영
            </Link>
            <ClearButton disabled={all.length === 0} />
          </div>
        </div>

        <nav aria-label="종류별" className="mt-6 flex flex-wrap gap-x-5 gap-y-1 border-b border-hairline">
          <Link href={qs({ kind: undefined })} className={`tab-line ${!sp.kind ? 'tab-line-active' : ''}`}>
            전체
          </Link>
          {[...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([base, n]) => (
              <Link key={base} href={qs({ kind: base })} className={`tab-line ${sp.kind === base ? 'tab-line-active' : ''}`}>
                {label(base)}
                <span className="text-xs text-muted tabular-nums">{n}</span>
              </Link>
            ))}
        </nav>

        {sp.to && (
          <p className="mt-3 text-sm text-body">
            <span className="font-medium">{toName?.name || sp.to}</span> ·{' '}
            <Link href={qs({ to: undefined })} className="underline underline-offset-2">
              전체
            </Link>
          </p>
        )}

        <section className="card card-flush mt-4 overflow-x-auto">
          {shown.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted">없음</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>시각</th>
                  <th>받는 사람</th>
                  <th>종류</th>
                  <th>내용</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="text-xs whitespace-nowrap text-muted tabular-nums">{toKstIso(new Date(e.at)).slice(5, 19).replace('T', ' ')}</td>
                    <td className="text-sm">
                      {e.recipients.map((r) => (
                        <Link key={r.employeeNo} href={qs({ to: r.employeeNo })} className="block hover:underline" title={r.email || undefined}>
                          {r.name || r.employeeNo}
                          <span className="ml-1 text-xs text-muted">{r.email || r.employeeNo}</span>
                        </Link>
                      ))}
                    </td>
                    <td>
                      <Link href={qs({ kind: e.base })} className="chip chip-muted whitespace-nowrap" title={e.kind || undefined}>
                        {label(e.base)}
                      </Link>
                    </td>
                    <td className="min-w-[24rem] text-sm">
                      <p className="font-medium text-ink">{e.subject}</p>
                      <p className="mt-1 whitespace-pre-wrap text-body">{e.contents}</p>
                      {e.url && <p className="mt-1 text-xs break-all text-muted">{e.url}</p>}
                      <details className="mt-1 text-xs text-muted">
                        <summary className="cursor-pointer">원문</summary>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(e.form, null, 1)}</pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
      <AppFooter />
    </div>
  );
}
