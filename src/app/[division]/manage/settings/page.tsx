// `/{slug}/manage/settings` — 부서 설정 (PG §5). lead 전용.
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/server/db';
import { getPageScope, getDivisionView } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { TemplateManager } from '@/components/TemplateManager';
import { RuleEditor } from '@/components/RuleEditor';
import { toKstIso } from '@/lib/week';

/** 타 부서 설정은 열람만 — 실수로 내 부서를 고치는 사고를 구조적으로 막는다 (AU-16) */
function ReadOnlyNotice({ what, detail }: { what: string; detail?: string }) {
  return (
    <p className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-body-strong">
      다른 부서의 {what}은(는) 열람만 가능합니다. 변경은 해당 부서 담당자가 합니다.
      {detail && <span className="ml-1 text-muted">· {detail}</span>}
    </p>
  );
}

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ params }: { params: Promise<{ division: string }> }) {
  const ps = await getPageScope();
  if (!ps.ok) {
    if (ps.code === 'unauthenticated') redirect('/login');
    return noticeFor(ps.code, ps.message);
  }
  if (ps.scope.user.mustChangePassword) redirect('/password?first=1'); // AU-22
  const { division: slugParam } = await params;
  const view = await getDivisionView(slugParam);
  if (!view.canManage) notFound();
  const { division, isOwn } = view;

  const [template, users, standard] = await Promise.all([
    prisma.template.findFirst({ where: { divisionId: division.id, isActive: true } }),
    prisma.user.findMany({
      where: { divisionId: division.id, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.standardTemplate.findFirst({ where: { isActive: true } }),
  ]);

  return (
    <main className="mt-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">부서 설정</h1>
          <p className="mt-0.5 text-sm text-muted">양식·병합 방식·작성 안내를 정합니다. 부서원에게 바로 반영됩니다.</p>
        </div>
        <Link href={`/${division.slug}/manage`} className="text-sm text-ink underline underline-offset-2 hover:text-ink-active">
          ← 수합 관리로
        </Link>
      </div>

      {/* ② 부서 양식 (PG-28~30) */}
      <section className="card px-5 py-4">
        <h2 className="text-base font-semibold text-ink">부서 양식</h2>
        <p className="mt-0.5 mb-3.5 text-xs text-muted">부서원이 받아서 쓰는 hwp 원본입니다.</p>
        {isOwn ? (
        <TemplateManager
          hasStandard={!!standard}
          current={
            template && {
              version: template.version,
              uploadedAtKst: toKstIso(template.uploadedAt).slice(0, 16).replace('T', ' '),
            }
          }
        />
        ) : (
          <ReadOnlyNotice
            what="양식"
            detail={template ? `현재 v${template.version} 등록됨` : '등록된 양식 없음'}
          />
        )}
      </section>

      {/* ① 작성 안내 + 병합 규칙 (PG-25~27) */}
      <section className="card px-5 py-4">
        <h2 className="text-base font-semibold text-ink">병합 설정</h2>
        <p className="mt-0.5 mb-3.5 text-xs text-muted">마감 후 자동 병합이 어떻게 돌지 정합니다.</p>
        {isOwn ? (
          <RuleEditor
            initialCategories={division.mergeCategories}
            initialDedupe={division.mergeDedupe}
            initialDropNotes={division.mergeDropNotes}
            initialRule={division.mergeRuleText}
            initialGuide={division.guideText}
            initialEmptyWords={division.emptyWords}
          />
        ) : (
          <div className="space-y-3">
            <ReadOnlyNotice what="병합 설정 · 작성 안내" />
            <pre className="card-cream max-h-60 overflow-auto px-4 py-3 text-xs leading-5 whitespace-pre-wrap text-body">
              {[
                division.mergeCategories && `분류 순서: ${division.mergeCategories}`,
                `중복 묶기: ${division.mergeDedupe ? '켬' : '끔'}`,
                division.mergeRuleText && `지침: ${division.mergeRuleText}`,
                division.guideText,
              ]
                .filter(Boolean)
                .join('\n') || '(비어 있음)'}
            </pre>
          </div>
        )}
      </section>

      {/* ③ 제출 대상 — 읽기 전용 (PG-31/32, DM-04) */}
      <section className="card px-5 py-4">
        <h2 className="text-base font-semibold text-ink">제출 대상</h2>
        <p className="mt-0.5 mb-3 text-xs text-muted">집계에 드는 사람입니다. 취소선은 제외된 사람입니다.</p>
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
