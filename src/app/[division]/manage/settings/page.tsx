// `/{slug}/manage/settings` — 부서 설정 (PG-74). lead 전용. 들어가는 길은 수합 관리 머리의 작은 링크다 (PG-72).
//
// 2026-10-08 (S6 · R3 · R5 · R6 — ADR-0018) — 카드 둘: 부서 양식 · 분류 순서. 작성 안내·병합 설정의 나머지는 엔진의
// 고정값이 되었고(HM-51), 「제출 대상」 카드는 수합 관리 부서원 표·운영자 인원 드로어와 같은 것을 보였다.
// 타 부서를 읽는 사람에게는 같은 두 카드를 읽기로만 그린다 — 설정을 한 덩어리로 쏟던 읽기 전용 덤프는 지웠다.
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/server/db';
import { getPageScope, getDivisionView } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { TemplateManager } from '@/components/TemplateManager';
import { RuleEditor } from '@/components/RuleEditor';
import { parseCategories } from '@/server/merge/rules';
import { latestEdits } from '@/server/merge/edits';
import { currentWeek, toKstIso } from '@/lib/week';

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
  if (!view.canManage) notFound(); // AU-T89 — 부서원은 규칙을 읽지 못한다
  const { division, isOwn } = view;

  const [template, standard, thisWeek] = await Promise.all([
    prisma.template.findFirst({ where: { divisionId: division.id, isActive: true } }),
    prisma.standardTemplate.findFirst({ where: { isActive: true } }),
    prisma.weekSlot.findUnique({ where: { isoKey: currentWeek(new Date()).isoKey } }),
  ]);
  // CP-108 — 분류를 바꿔도 이미 만든 이번 주 병합본은 그대로다. 저장 뒤 그걸 말하려면 있는지·고쳤는지 알아야 한다
  const merged = isOwn && thisWeek ? await latestEdits(division.id, thisWeek.id) : null;
  // 엔진과 **같은 해석**으로 보여준다 (HM-18 — 구분자는 아무거나)
  const categories = parseCategories(division.mergeCategories);

  return (
    <main className="pt-8">
      <h1 className="page-title">부서 설정</h1>

      <div className="mt-6 space-y-4 lg:space-y-6">
        {/* 부서 양식 (PG-28·29) — 웹 작성 제출물이 이 양식으로 만들어진다 (WA-33) */}
        <section className="card" aria-labelledby="template">
          <h2 id="template" className="card-title">
            부서 양식
          </h2>
          <div className="mt-4">
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
              /* 타 부서 설정은 읽기만 — 실수로 내 부서를 고치는 사고를 구조적으로 막는다 (AU-17d) */
              <p className="callout callout-warn">
                읽기 전용<span className="ml-1 text-muted">· {template ? `현재 v${template.version} 등록됨` : '등록된 양식 없음'}</span>
              </p>
            )}
          </div>
        </section>

        {/* 분류 순서 (CP-118) */}
        {isOwn ? (
          <RuleEditor initialCategories={division.mergeCategories} thisWeekMerged={merged ? { edited: !!merged.edits } : null} />
        ) : (
          <section className="card" aria-labelledby="merge-settings">
            <h2 id="merge-settings" className="card-title">
              분류 순서
            </h2>
            {categories.length > 0 ? (
              <div className="mt-4 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                {categories.map((c) => (
                  <span key={c} className="chip chip-muted text-xs">
                    {c}
                  </span>
                ))}
                <span className="chip text-xs text-muted ring-1 ring-hairline ring-inset">기타</span>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">없음</p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
