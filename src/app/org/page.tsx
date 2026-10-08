// `/org` — 「전사」 화면 하나 (PG-49f · PG-51). 총괄·운영자.
//
// 2026-10-07 (사용자: 전사 한 화면으로 단순화) — 그 전까지 「전사」 메뉴는 [현황](/ops/monitor)·[취합](/org) 두 탭이었다.
// 같은 부서를 두 모양(본부별 팀 막대 · 섹션 판)으로 두 번 보여 주었고, 주차 고르기는 한쪽에, 일정 카드는 다른 쪽에 있었다.
// 이제 위에서 아래로 한 번만 읽는다: 머리글(주차 · 다가올 마감 줄 · [일정 바꾸기]) → 섹션 표(제출 · 최종본에) → 전사본.
// 2026-10-08 (사용자: 주석 걷기·일정 카드 단순화) — 표 밑 각주 한 줄을 걷고,
// 마감 줄은 다가올 주차만, [일정 바꾸기] 한 번에 입력칸이 열린다(WS-19l). [올리기]는 hwp 스위치를 따른다(RU-60).
// 2026-10-08(ADR-0015) — 전사본은 섹션 출처가 바뀌면 저절로 다시 만들어진다(RU-83). 이 화면은 그리기 전에 맞추고(읽기 수리) 보여 줄 뿐이다.
// 옛 `/ops/monitor`는 보내지 않는다 — 2026-10-08 지웠다(R17, 상단 메뉴 「전사」가 같은 길이다).
//
// 무엇을 그릴지는 `orgPageView` 하나가 정한다(TACP-9·12): 제출 열·감사 링크는 전 부서를 읽는 사람(readAll),
// 최종본 열·파일 올리기·전사본(실패 때 [다시 시도])·섹션 구성 편집은 전사 취합의 문(canOpenOrgDesk — 3단계가 꺼져 있으면 총괄에게도 없다, RU-52).
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requirePageScope } from '@/server/page-scope';
import { orgPageView, rollupNav } from '@/server/authz';
import { noticeFor } from '@/components/Notice';
import { AppHeader } from '@/components/AppHeader';
import { AppFooter } from '@/components/AppFooter';
import { getTour } from '@/server/tour';
import { WeekPicker } from '@/components/WeekPicker';
import { OrgBoard } from '@/components/OrgBoard';
import { OrgRunCard } from '@/components/OrgRunCard';
import { SectionEditor } from '@/components/SectionEditor';
import { NudgeButton } from '@/components/NudgeButton';
import { WeekSchedule } from '@/components/WeekSchedule';
import { orgBoard } from '@/server/org-board';
import { deadlineStatus, upcomingWeeks } from '@/server/slot-deadline';
import { loadOrgSetting } from '@/server/rollup/tree';
import { rollupSlot } from '@/server/rollup/slot';
import { stageTimes } from '@/server/rollup/schedule';
import { weekOptions } from '@/server/rollup/view';
import { hwpUploadOpen } from '@/server/submit-mode';
import { readRepairOrg } from '@/server/rollup/auto';
import { currentWeek, formatDeadlineKo } from '@/lib/week';

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
  // RU-72 — 그리기 **전에** 전사본을 맞춘다(읽기 수리). 취합을 여는 사람에게만 — 스위치가 꺼져 있으면 아무것도 하지 않는다
  if (can.desk) await readRepairOrg(slot);
  const [board, weeks, nav, t] = await Promise.all([
    orgBoard(slot, can, weekQuery, { email: scope.user.email }),
    weekOptions(slot),
    rollupNav(scope),
    stageTimes(slot),
  ]);
  // WS-19l — 머리글 마감 줄. 바꾸는 칸은 바꿀 수 있는 것이 있는 사람에게만: 마감 바꾸기(TACP-20) · 3단계 스위치와 간격(취합과 같은 문).
  // 위의 읽기 뒤에 — deadlineStatus는 다음 주 주차를 만들 수 있어서(upsert) 다른 주차 읽기와 겹치지 않게 한다
  const setting = can.desk ? await loadOrgSetting() : null;
  const schedule = await deadlineStatus();
  // 다가올 주차만 — 지난 마감은 보지 않는다 (2026-10-08 사용자: 「저번 주 몇 시 마감했는지 안 봐도 상관없어」).
  // 이번 주 줄은 그날 마지막 단계 기한까지 둔다 — 부서 마감 뒤 14~16시가 총괄이 그 기한을 보는 때다
  const upcoming = upcomingWeeks(schedule.weeks);
  const editing = sp.edit === 'sections' ? board.editor : null; // 편집기 값은 취합을 여는 사람에게만 온다
  // RU-60 — 게시판 hwp [올리기]는 취합의 문 + hwp 스위치(WA-30). 스위치는 submit-mode 하나에서 읽는다(WA-T33)
  const uploadOpen = hwpUploadOpen();

  const deadlineKo = formatDeadlineKo(t.anchor);
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
        tour={await getTour(scope, false)}
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

        <WeekSchedule
          weeks={upcoming}
          canSchedule={can.schedule}
          rollup={setting && { enabled: setting.enabled, unitDueMinutes: setting.unitDueMinutes, hqDueMinutes: setting.hqDueMinutes }}
        />

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
                canUpload={can.desk && uploadOpen}
                isoKey={slot.isoKey}
                weekLabel={slot.label}
                deadlineText={deadlineKo}
                head={
                  <div className="card-head items-center">
                    <p className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm text-muted">
                      {totals && (
                        // CP-104 — 사용 안내의 「제출」 단계(전사에서 몇 명이 냈나)가 이 합계를 가리킨다
                        <span data-guide="org-total">
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
            {board.ready !== null && (
              <div className="mt-6">
                <OrgRunCard
                  isoKey={slot.isoKey}
                  ready={board.ready}
                  run={board.run}
                  failed={board.failed}
                  changedSinceDownload={board.changedSinceDownload}
                  coverage={board.coverage ?? []}
                />
              </div>
            )}
          </>
        )}
      </main>
      <AppFooter />
    </div>
  );
}
