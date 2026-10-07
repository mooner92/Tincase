// `/{slug}/manage/settings` — 부서 설정 (PG §5 · PG-53). lead 전용.
// 카드 넷: 부서 양식 · 작성 안내 · 병합 설정 · 제출 대상. 카드 안에 카드를 두지 않는다 (CP-97).
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/server/db';
import { getPageScope, getDivisionView } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { TemplateManager } from '@/components/TemplateManager';
import { RuleEditor } from '@/components/RuleEditor';
import { toPlan } from '@/server/merge/rules';
import { toKstIso } from '@/lib/week';

/** 타 부서 설정은 열람만 — 실수로 내 부서를 고치는 사고를 구조적으로 막는다 (AU-16) */
function ReadOnlyNotice({ what, detail }: { what: string; detail?: string }) {
  return (
    <p className="callout callout-warn">
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
  // HM-48 — 엔진과 **같은 해석**으로 보여준다. DB에 모르는 값이 있으면 엔진이 기본값으로 돌므로 화면도 그렇게
  const plan = toPlan(division);

  const [template, users, standard] = await Promise.all([
    prisma.template.findFirst({ where: { divisionId: division.id, isActive: true } }),
    prisma.user.findMany({
      where: { divisionId: division.id, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.standardTemplate.findFirst({ where: { isActive: true } }),
  ]);

  return (
    <main className="pt-8">
      {/* 「← 수합 관리로」는 뺐다 — 상단 메뉴의 [수합 관리]와 같은 곳이다 */}
      <h1 className="page-title">부서 설정</h1>
      <p className="page-sub">양식·작성 안내·병합 방식을 정합니다. 부서원에게 바로 반영됩니다.</p>

      <div className="mt-6 space-y-4 lg:space-y-6">
        {/* ② 부서 양식 (PG-28~30) */}
        <section className="card" aria-labelledby="template">
          <h2 id="template" className="card-title">
            부서 양식
          </h2>
          {/* WA-33 — 업로드가 닫혀도 이 양식은 남는다. 웹 작성 제출물이 이 양식으로 만들어진다 */}
          <p className="card-desc">부서원 업무일지가 이 hwp 양식으로 만들어집니다.</p>
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
              <ReadOnlyNotice what="양식" detail={template ? `현재 v${template.version} 등록됨` : '등록된 양식 없음'} />
            )}
          </div>
        </section>

        {/* ① 작성 안내 + 병합 규칙 (PG-25~27) — RuleEditor가 카드 둘(작성 안내 · 병합 설정)을 그린다 */}
        {isOwn ? (
          <RuleEditor
            initialCategories={division.mergeCategories}
            initialDedupe={division.mergeDedupe}
            initialDropNotes={division.mergeDropNotes}
            initialSort={plan.sort}
            initialUndated={plan.undated}
            initialRule={division.mergeRuleText}
            initialGuide={division.guideText}
            initialEmptyWords={division.emptyWords}
            initialEmphasisWords={division.emphasisWords}
          />
        ) : (
          <section className="card" aria-labelledby="merge-settings">
            <h2 id="merge-settings" className="card-title">
              작성 안내 · 병합 설정
            </h2>
            <div className="mt-4 space-y-3">
              <ReadOnlyNotice what="병합 설정 · 작성 안내" />
              <pre className="callout callout-muted max-h-60 overflow-auto text-xs leading-5 whitespace-pre-wrap">
                {[
                  division.mergeCategories && `분류 순서: ${division.mergeCategories}`,
                  `중복 묶기: ${division.mergeDedupe ? '켬' : '끔'}`,
                  `정렬: ${plan.sort === 'date' ? `일자 순 (날짜 없는 줄 ${plan.undated === 'first' ? '앞' : '뒤'})` : '제출자 순'}`,
                  division.mergeRuleText && `지침: ${division.mergeRuleText}`,
                  division.guideText,
                ]
                  .filter(Boolean)
                  .join('\n') || '(비어 있음)'}
              </pre>
            </div>
          </section>
        )}

        {/* ③ 제출 대상 — 읽기 전용 (PG-31/32, DM-04) */}
        <section className="card" aria-labelledby="roster">
          <h2 id="roster" className="card-title">
            제출 대상
          </h2>
          <p className="card-desc">집계에 드는 사람입니다. 취소선은 제외된 사람입니다.</p>
          <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
            {users.map((u) => (
              <li key={u.id} className={u.onRoster ? 'text-ink' : 'text-muted-soft line-through'}>
                {u.name}
                {u.divisionRole === 'lead' && <span className="chip chip-muted ml-1.5 px-2 text-xs">담당</span>}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">
            명단·순서 변경은 운영자 소관입니다 — 운영자에게 요청하세요. {/* PG-32 */}
          </p>
        </section>
      </div>
    </main>
  );
}
