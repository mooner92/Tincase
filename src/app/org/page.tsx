// `/org` — 「전사」 화면 하나 (PG-49f · PG-51). 총괄·운영자.
//
// 2026-10-07 (사용자: 전사 한 화면으로 단순화) — 그 전까지 「전사」 메뉴는 [현황](/ops/monitor)·[취합](/org) 두 탭이었다.
// 같은 부서를 두 모양(본부별 팀 막대 · 섹션 판)으로 두 번 보여 주었고, 주차 고르기는 한쪽에, 일정 카드는 다른 쪽에 있었다.
// 이제 위에서 아래로 한 번만 읽는다: 머리글(주차 · 마감 한 줄 · [일정 바꾸기]) → 섹션 표(제출 · 최종본에) → 전사 취합본 만들기.
// `/ops/monitor`는 여기로 보낸다 — 옛 주소·알림 링크가 끊기지 않게.
//
// 무엇을 그릴지는 `orgPageView` 하나가 정한다(TACP-9·12): 제출 열·감사 링크는 전 부서를 읽는 사람(readAll),
// 최종본 열·파일 올리기·만들기·섹션 구성 편집은 전사 취합의 문(canOpenOrgDesk — 3단계가 꺼져 있으면 총괄에게도 없다, RU-52).
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requirePageScope } from '@/server/page-scope';
import { orgPageView, rollupNav } from '@/server/authz';
import { noticeFor } from '@/components/Notice';
import { AppHeader } from '@/components/AppHeader';
import { AppFooter } from '@/components/AppFooter';
import { WeekPicker } from '@/components/WeekPicker';
import { OrgBoard } from '@/components/OrgBoard';
import { OrgRunCard } from '@/components/OrgRunCard';
import { SectionEditor } from '@/components/SectionEditor';
import { NudgeButton } from '@/components/NudgeButton';
import { ScheduleFold } from '@/components/ScheduleFold';
import { WeekSchedule } from '@/components/WeekSchedule';
import { orgBoard } from '@/server/org-board';
import { deadlineStatus } from '@/server/slot-deadline';
import { loadOrgSetting } from '@/server/rollup/tree';
import { rollupSlot } from '@/server/rollup/slot';
import { stageCells, stageTimes } from '@/server/rollup/schedule';
import { weekOptions } from '@/server/rollup/view';
import { currentWeek, formatDeadlineKo } from '@/lib/week';
import { STAGE_HQ, STAGE_UNIT } from '@/lib/rollup-stages';

export const dynamic = 'force-dynamic';

const side = 'text-muted underline-offset-2 hover:text-ink hover:underline';

export default async function OrgPage({ searchParams }: { searchParams: Promise<{ isoKey?: string; edit?: string }> }) {
  const ps = await requirePageScope();
  if (!ps.ok) return noticeFor(ps.code, ps.message);
  const scope = ps.scope;
  const can = await orgPageView(scope);
  if (!can.open) notFound(); // TACP-5 — 존재 은닉
  const sp = await searchParams;
  const slot = await rollupSlot(sp.isoKey ?? null);
  // 지난 주차를 보는 동안에는 화면 안의 링크(본부 취합·편집 닫기)도 그 주차를 들고 다닌다
  const weekQuery = slot.isoKey === currentWeek().isoKey ? '' : `isoKey=${slot.isoKey}`;
  const href = (extra?: string) => {
    const q = [weekQuery, extra].filter(Boolean).join('&');
    return q ? `/org?${q}` : '/org';
  };
  const [board, weeks, nav, t] = await Promise.all([orgBoard(slot, can, weekQuery), weekOptions(slot), rollupNav(scope), stageTimes(slot)]);
  // WS-19l — 「주차 일정」 카드는 바꿀 수 있는 것이 하나라도 있는 사람에게만: 마감 바꾸기(TACP-20) · 3단계 스위치와 간격(취합과 같은 문).
  // 위의 읽기 뒤에 — deadlineStatus는 다음 주 주차를 만들 수 있어서(upsert) 다른 주차 읽기와 겹치지 않게 한다
  const setting = can.desk ? await loadOrgSetting() : null;
  const schedule = can.schedule || setting ? await deadlineStatus() : null;
  const editing = sp.edit === 'sections' ? board.editor : null; // 편집기 값은 취합을 여는 사람에게만 온다

  const deadlineKo = formatDeadlineKo(t.anchor);
  const stages = t.enabled ? stageCells(t.anchor, t) : null;
  const summary = (
    <span>
      마감 <strong className="text-ink">{deadlineKo}</strong>
      {/* RU-59 — 두 기한은 어디서나 같은 이름 한 쌍. /hq 머리·일정 카드·알림과 같은 말이다 */}
      {stages && (
        <>
          {' '}
          · {STAGE_UNIT} {stages.unitDueKo} · {STAGE_HQ} <strong className="text-ink">{stages.hqDueKo}</strong>
        </>
      )}
      {/* RU-52 — 꺼져 있을 때 최종본 열을 보는 사람은 켜는 사람(운영자)뿐이다. 총괄에게는 아직 안 보인다는 것을 잊지 않게 */}
      {!t.enabled && can.desk && <span className="ml-2 text-xs font-semibold text-warning">3단계 꺼짐</span>}
    </span>
  );
  const totals = board.totals;
  const pct = totals && totals.roster > 0 ? Math.round((totals.submitted / totals.roster) * 100) : 0;
  const sectionCount = board.rows.filter((r) => r.no !== null).length;

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader
        slug={scope.division.slug}
        divisionName={scope.division.nameKo}
        userName={scope.user.name}
        isLead={scope.isManager || scope.readAll}
        isOperator={scope.user.isOperator}
        readAll={scope.readAll}
        {...nav}
        viaCloudflare={scope.source === 'cloudflare'}
        notifyEnabled={scope.user.notifyEnabled}
      />
      <main className="mx-auto w-full max-w-[1120px] flex-1 px-5 pt-8 pb-10">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="page-title">전사</h1>
            <WeekPicker weeks={weeks} selected={slot.isoKey} baseHref="/org" />
          </div>
          {/* PG-49c · PG-51f — 곁가지는 구석에 작게. 누르면 404인 링크는 그리지 않는다 (TACP-9) */}
          <nav aria-label="전사 곁가지" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {can.progress && (
              <>
                <Link href="/ops/audit" className={side}>
                  감사 로그
                </Link>
                <a href={`/api/ops/report?isoKey=${slot.isoKey}`} className={side}>
                  감사 문서
                </a>
                <a href={`/api/ops/report?isoKey=${slot.isoKey}&format=csv`} className={side}>
                  CSV
                </a>
              </>
            )}
            {can.desk && (
              <Link href={href('edit=sections')} className={side} aria-current={editing ? 'page' : undefined}>
                섹션 구성 편집
              </Link>
            )}
            {can.operate && (
              <Link href="/ops" className={side}>
                ← 운영
              </Link>
            )}
          </nav>
        </div>

        {schedule ? (
          <ScheduleFold summary={summary}>
            <WeekSchedule
              weeks={schedule.weeks}
              canSchedule={can.schedule}
              rollup={setting && { enabled: setting.enabled, unitDueMinutes: setting.unitDueMinutes, hqDueMinutes: setting.hqDueMinutes }}
            />
          </ScheduleFold>
        ) : (
          <p className="mt-1.5 text-[15px] text-muted">{summary}</p>
        )}

        {editing ? (
          <div className="mt-6">
            <SectionEditor sections={editing.sections} divisions={editing.divisions} closeHref={href()} />
          </div>
        ) : (
          <>
            {/* 합계는 표의 머리에 — 카드 밖에 떠 있던 큰 숫자를 표와 한 카드로 (CP-97) */}
            <div className="mt-6">
              <OrgBoard
                rows={board.rows}
                columns={{ progress: can.progress, final: can.desk }}
                isoKey={slot.isoKey}
                weekLabel={slot.label}
                deadlineText={deadlineKo}
                head={
                  <div className="card-head items-center">
                    <p className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm text-muted">
                      {totals && (
                        <span>
                          제출 <strong className="text-[26px] font-semibold text-ink tabular-nums">{totals.submitted}</strong>
                          <span className="tabular-nums"> / {totals.roster}명 · {pct}%</span>
                        </span>
                      )}
                      {board.ready !== null && (
                        <span>
                          최종본 <strong className="text-[26px] font-semibold text-ink tabular-nums">{board.ready}</strong>
                          <span className="tabular-nums"> / {sectionCount}섹션</span>
                        </span>
                      )}
                      {board.capturedAtKst && <span className="text-xs">{board.capturedAtKst}</span>}
                    </p>
                    {/* 전사 미제출 — 본 다음 할 일은 언제나 「알려주기」다. 섹션별 명단은 표의 막대를 누르면 나온다 */}
                    {totals && totals.missing.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-body">
                          미제출 <strong className="text-ink">{totals.missing.length}명</strong>
                        </span>
                        <NudgeButton names={totals.missing} deadlineText={deadlineKo} weekLabel={slot.label} />
                      </div>
                    )}
                  </div>
                }
              />
            </div>
            {can.progress && (
              <p className="mt-2 px-1 text-xs leading-5 text-muted">
                {board.excludedNote && board.excludedNote.divisions > 0 && (
                  <>
                    업무일지를 내지 않는 부서 {board.excludedNote.divisions}곳({board.excludedNote.people}명)은 세지 않습니다 ·{' '}
                  </>
                )}
                숫자는 명단 기준 · 팀 이름을 누르면 수합 관리(읽기 전용, 기록이 남습니다)
              </p>
            )}

            {board.ready !== null && (
              <div className="mt-6">
                <OrgRunCard isoKey={slot.isoKey} ready={board.ready} run={board.run} coverage={board.coverage ?? []} />
              </div>
            )}
          </>
        )}
      </main>
      <AppFooter />
    </div>
  );
}
