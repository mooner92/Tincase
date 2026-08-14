// `/{slug}/manage/settings` — 부서 설정 (PG §5). lead 전용.
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/server/db';
import { getPageScope } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { TemplateManager } from '@/components/TemplateManager';
import { RuleEditor } from '@/components/RuleEditor';
import { toKstIso } from '@/lib/week';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const ps = await getPageScope();
  if (!ps.ok) {
    if (ps.code === 'unauthenticated') redirect('/login');
    return noticeFor(ps.code, ps.message);
  }
  if (ps.scope.user.mustChangePassword) redirect('/password?first=1'); // AU-22
  if (!ps.scope.isLead && !ps.scope.readAll) notFound();
  const { scope } = ps;

  const [template, users, standard] = await Promise.all([
    prisma.template.findFirst({ where: { divisionId: scope.division.id, isActive: true } }),
    prisma.user.findMany({
      where: { divisionId: scope.division.id, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.standardTemplate.findFirst({ where: { isActive: true } }),
  ]);

  return (
    <main className="mt-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-ink">부서 설정</h1>
        <Link href={`/${scope.division.slug}/manage`} className="text-sm text-ink underline underline-offset-2 hover:text-ink-active">
          ← 수합 관리로
        </Link>
      </div>

      {/* ② 부서 양식 (PG-28~30) */}
      <section className="card px-5 py-4">
        <h2 className="mb-3 text-sm font-semibold text-muted">부서 양식</h2>
        <TemplateManager
          hasStandard={!!standard}
          current={
            template && {
              version: template.version,
              uploadedAtKst: toKstIso(template.uploadedAt).slice(0, 16).replace('T', ' '),
            }
          }
        />
      </section>

      {/* ① 작성 안내 + 병합 규칙 (PG-25~27) */}
      <section className="card px-5 py-4">
        <h2 className="mb-3 text-sm font-semibold text-muted">작성 안내 · 병합 규칙</h2>
        <RuleEditor initialRule={scope.division.mergeRuleText} initialGuide={scope.division.guideText} />
      </section>

      {/* ③ 제출 대상 — 읽기 전용 (PG-31/32, DM-04) */}
      <section className="card px-5 py-4">
        <h2 className="mb-2 text-sm font-semibold text-muted">제출 대상</h2>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          {users.map((u) => (
            <li key={u.id} className={u.onRoster ? 'text-ink' : 'text-muted-soft line-through'}>
              {u.name}
              {u.divisionRole === 'lead' && <span className="ml-1 rounded bg-surface-card px-1 text-[11px] text-ink">담당</span>}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-soft">
          명단·순서 변경은 운영자 소관입니다 — 운영자(최명헌)에게 요청하세요. {/* PG-32 */}
        </p>
      </section>
    </main>
  );
}
