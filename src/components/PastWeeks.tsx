'use client';
// CP-113 — 부서원 홈의 **지난 주차** (PG-68·69). 「내 이력」(내 제출)과 「보관함」(부서 병합본)을 한 목록으로 합쳤다.
//
// 한 주 = 한 줄: 주차 · 상태 · [내 일지] · [병합본]. 날짜·버전·시각은 줄에 쓰지 않는다 — 열면 드로어 머리에 있다.
// 쌓이면 달로 묶고(최근 12개월), 그보다 오래된 것은 해마다 한 줄로 접는다 — 몇 해가 지나도 첫 화면 줄 수가 늘지 않게.
// 묶기·접기는 순수 함수(`groupPast`)가 정하고 여기서는 그리기만 한다.
//
// 펼침은 네이티브 `<details>`다. 키보드·화면 읽기·열림 상태 읽기가 따로 짜지 않아도 된다.
// `open`은 처음 값일 뿐이라, 새로 고침이 같은 값을 다시 주면 사람이 연 달은 열린 채로 남는다(69d).
import { Fragment, useRef, useState } from 'react';
import type { MonthGroup, PastGroups, PastWeek } from '@/lib/week-groups';
import { FileDrawer } from './FileDrawer';
import { MergedDrawer } from './MergedDrawer';

type Opened = { kind: 'mine'; id: string } | { kind: 'doc'; isoKey: string } | null;

/** 69e — 그 달의 줄을 오래된 것부터 점으로. 글자(`3/4`)가 옆에 있으므로 색만으로 말하지 않는다(CP-05) */
function WeekDots({ marks, done }: { marks: boolean[]; done: number }) {
  return (
    <span role="img" aria-label={`${marks.length}주 중 ${done}주 제출`} className="flex items-center gap-1">
      {marks.map((x, i) => (
        <span key={i} className={x ? 'dot text-success' : 'dot dot-hollow text-border-strong'} />
      ))}
    </span>
  );
}

export function PastWeeks({
  groups,
  showMissing,
  divisionSlug,
  me,
}: {
  groups: PastGroups;
  /** user.onRoster — 집계 제외인 사람에게는 점·수·「미제출」이 없다 (69e · D17) */
  showMissing: boolean;
  divisionSlug: string;
  me: { id: string; name: string };
}) {
  const [opened, setOpened] = useState<Opened>(null);
  // 닫으면 누른 단추로 초점을 돌린다 — 드로어는 그 일을 하지 않는다(FileDrawer)
  const opener = useRef<HTMLButtonElement | null>(null);

  // CP-104 — 사용 안내의 「내 일지」는 목록에서 처음 보이는 [내 일지] 하나를 가리킨다
  const firstMine = [...groups.recent.flatMap((m) => m.weeks), ...groups.older.flatMap((y) => y.months.flatMap((m) => m.weeks))].find(
    (w) => w.mine,
  )?.isoKey;

  const open = (e: React.MouseEvent<HTMLButtonElement>, next: Opened) => {
    opener.current = e.currentTarget;
    setOpened(next);
  };
  const close = () => {
    setOpened(null);
    opener.current?.focus();
  };

  const row = (w: PastWeek) => (
    /*
      640px 이상: 주차 | 상태 | 내 일지 | 병합본 — 버튼 칸은 자리가 정해져 있어 없는 쪽은 빈칸이다(세로줄이 흐트러지지 않게).
      640px 미만: 주차와 버튼 둘이 한 줄, 상태는 그 아래 — 가로 스크롤 없이 400px에 들어간다(66c)
    */
    <li
      key={w.isoKey}
      className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center gap-x-1 px-5 py-1.5 sm:min-h-11 sm:grid-cols-[8.5rem_minmax(0,1fr)_4.5rem_4.5rem] sm:py-0 sm:pr-5 sm:pl-10"
    >
      <span className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 text-[15px] text-ink">
        {w.label}
        {w.monthly && <span className="chip chip-ok px-2 text-xs">월간</span>}
      </span>
      <span className="col-start-1 row-start-2 text-[13px] sm:col-start-2 sm:row-start-1 sm:text-sm">
        {w.mine ? (
          <span className="inline-flex items-center gap-1.5 text-body">
            <span aria-hidden className="dot text-success" />
            제출
            {/* TACP-22 — 담당자가 고친 판. 누가 고쳤는지는 열면 드로어 머리에 있다(PG-66e — 홈에 남의 이름이 없다) */}
            {w.mine.edited && <span className="text-warning">· 고침</span>}
          </span>
        ) : showMissing ? (
          <span className="inline-flex items-center gap-1.5 text-muted">
            <span aria-hidden className="dot dot-hollow text-border-strong" />
            미제출
          </span>
        ) : null}
      </span>
      <span className="col-start-2 row-start-1 sm:col-start-3">
        {w.mine && (
          <button
            data-guide={w.isoKey === firstMine ? 'past-open' : undefined}
            aria-label={`${w.label} 내 일지 열기`}
            onClick={(e) => open(e, { kind: 'mine', id: w.mine!.id })}
            className="btn-ghost w-full px-1 pointer-coarse:h-11"
          >
            내 일지
          </button>
        )}
      </span>
      <span className="col-start-3 row-start-1 sm:col-start-4">
        {w.doc && (
          <button
            aria-label={`${w.label} 병합본 열기`}
            onClick={(e) => open(e, { kind: 'doc', isoKey: w.isoKey })}
            className="btn-ghost w-full px-1 pointer-coarse:h-11"
          >
            병합본
          </button>
        )}
      </span>
    </li>
  );

  const month = (m: MonthGroup, nested = false) => (
    <li key={m.key} className="border-t border-hairline-soft">
      <details className="fold" open={m.open}>
        {/* summary 안에 제목 요소를 두지 않는다 — 읽기 프로그램에 따라 「버튼 안의 제목」이 된다 */}
        <summary className={nested ? 'pl-10' : undefined}>
          <span className="text-[15px] font-semibold text-ink">
            <span className="sr-only">{m.year}년 </span>
            {m.month}월
          </span>
          <span className="flex-1" />
          {showMissing && <WeekDots marks={m.marks} done={m.done} />}
          {showMissing && (
            <span className="w-10 text-right text-sm text-muted tabular-nums">
              {m.done}/{m.total}
            </span>
          )}
        </summary>
        <ol className="pb-1.5">{m.weeks.map(row)}</ol>
      </details>
    </li>
  );

  return (
    <section data-guide="past-weeks" aria-labelledby="past-weeks-title" className="card card-flush lg:col-span-7">
      <h2 id="past-weeks-title" className="card-title px-5 pt-5 pb-3 sm:px-6">
        지난 주차
      </h2>
      <ol>
        {groups.recent.map((m) => (
          <Fragment key={m.key}>
            {/* 69b — 해가 바뀌는 자리. 읽기 프로그램은 달 이름의 숨은 해로 듣는다 */}
            {m.yearBreak !== null && (
              <li aria-hidden className="flex items-center gap-2 border-t border-hairline-soft px-5 pt-3 pb-1 text-xs font-medium text-muted">
                <span className="w-4 border-t border-hairline" />
                {m.yearBreak}
                <span className="flex-1 border-t border-hairline" />
              </li>
            )}
            {month(m)}
          </Fragment>
        ))}
        {/* 69c — 12개월보다 오래된 것은 해마다 한 줄. 펼치면 그해 달 줄(모두 접힘) */}
        {groups.older.map((y) => (
          <li key={y.year} className="border-t border-hairline-soft">
            <details className="fold">
              <summary>
                <span className="text-[15px] font-semibold text-ink">{y.label}</span>
                <span className="flex-1" />
                {showMissing && (
                  <span className="min-w-10 text-right text-sm text-muted tabular-nums">
                    {y.done}/{y.total}
                  </span>
                )}
              </summary>
              <ol>{y.months.map((m) => month(m, true))}</ol>
            </details>
          </li>
        ))}
      </ol>

      <FileDrawer
        openId={opened?.kind === 'mine' ? opened.id : null}
        members={[{ userId: me.id, name: me.name, latestId: opened?.kind === 'mine' ? opened.id : null }]}
        onClose={close}
        onNavigate={(id) => setOpened({ kind: 'mine', id })}
      />
      <MergedDrawer
        open={opened?.kind === 'doc'}
        onClose={close}
        isoKey={opened?.kind === 'doc' ? opened.isoKey : ''}
        divisionSlug={divisionSlug}
        canEdit={false}
        variant="view"
      />
    </section>
  );
}
