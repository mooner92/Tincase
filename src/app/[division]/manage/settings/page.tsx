// `/{slug}/manage/settings` — 부서 설정 (PG §5). lead 전용.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/server/db';
import { getPageScope } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { TemplateManager } from '@/components/TemplateManager';
import { RuleEditor } from '@/components/RuleEditor';
import { toKstIso } from '@/lib/week';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const ps = await getPageScope();
  if (!ps.ok) return noticeFor(ps.code, ps.message);
  if (!ps.scope.isLead && !ps.scope.readAll) notFound();
  const { scope } = ps;

  const [template, users] = await Promise.all([
    prisma.template.findFirst({ where: { divisionId: scope.division.id, isActive: true } }),
    prisma.user.findMany({
      where: { divisionId: scope.division.id, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
  ]);

  return (
    <main className="mt-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-900">부서 설정</h1>
        <Link href={`/${scope.division.slug}/manage`} className="text-sm text-blue-700 hover:underline">
          ← 수합 관리로
        </Link>
      </div>

      {/* ② 부서 양식 (PG-28~30) */}
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-500">부서 양식</h2>
        <TemplateManager
          current={
            template && {
              version: template.version,
              uploadedAtKst: toKstIso(template.uploadedAt).slice(0, 16).replace('T', ' '),
            }
          }
        />
      </section>

      {/* ① 작성 안내 + 병합 규칙 (PG-25~27) */}
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-500">작성 안내 · 병합 규칙</h2>
        <RuleEditor initialRule={scope.division.mergeRuleText} initialGuide={scope.division.guideText} />
      </section>

      {/* ③ 제출 대상 — 읽기 전용 (PG-31/32, DM-04) */}
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-500">제출 대상</h2>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          {users.map((u) => (
            <li key={u.id} className={u.onRoster ? 'text-slate-800' : 'text-slate-400 line-through'}>
              {u.name}
              {u.divisionRole === 'lead' && <span className="ml-1 rounded bg-blue-50 px-1 text-[11px] text-blue-700">담당</span>}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-400">
          명단·순서 변경은 운영자 소관입니다 — 운영자(최명헌)에게 요청하세요. {/* PG-32 */}
        </p>
      </section>
    </main>
  );
}
