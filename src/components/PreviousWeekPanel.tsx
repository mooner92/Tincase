'use client';
// WA-11/12 — 웹 작성 드로어 안의 **「지난번에 낸 것」** 패널.
//
// 이번 주 실적은 대개 **지난주 계획에 적은 그 일**이다. 그런데 지금은 그걸 보려면
// hwp를 받아 한글을 열어야 한다 — 웹에서 적는 사람에게는 그게 「한글을 여는 유일한 이유」가
// 된다. 병합본 드로어를 만든 것과 똑같은 이유로 여기에 붙인다.
//
// **보여주기만 하면 절반이다.** 보고 나서 손으로 옮겨 적어야 하면 결국 한글에서 복사하던
// 것과 같은 수고다. 그래서 **옮기는 버튼**까지 둔다:
//
//   행마다 「+」         같은 표로 (상시 반복 업무 — 「정기간행물 발간 진행」 같은 것)
//                       ★ 반각이다. 전각 더하기(U+FF0B)는 페이퍼로지에 없어서
//                         그 글자만 시스템 글꼴로 새고, 한 줄 안에서 서체가 바뀐다 (UI-T90)
//   계획 표에 「실적으로」 지난주 계획을 **이번 주 실적으로** 통째로 (이게 주된 동선이다)
//
// **주차를 고를 수 있다 (WA-12).** 기본은 가장 최근 것이지만, 휴가로 한 주 걸렀거나
// 월간(한 달치 정리)을 쓸 때는 더 뒤를 봐야 한다. 칩을 누르면 그 주차만 새로 읽는다 —
// 목록은 미리 받아 두고 **파일은 고른 한 건만** 읽으므로 열 때 느려지지 않는다.
//
// **기본은 펼침이다 (WA-13).** 처음에는 접어 뒀다 — 펼쳐 두면 쓸 칸이 아래로 밀린다는
// 이유였는데, 실제로는 **있는 줄도 몰랐다**:
//
//   「가독성이 너무 떨어져서 이런게 있는지도 잘 모르겠어 … 디폴트로 접혀있어서 확인도 어려워」
//
// 접힌 것이 문제의 전부는 아니었다. 이 드로어 위쪽에는 띠가 연달아 셋 있었다 —
// 붙여넣기 안내(초록), 작성 안내(회색), 그리고 이것(회색). 셋이 같은 모양이라
// 눈이 「또 안내문」으로 읽고 건너뛴다. 그래서 **띠에서 빼내 카드로** 만든다:
// 흰 바탕 + 테두리라 평평한 띠들 사이에서 저절로 도드라지고, 색을 더 쓰지 않아
// 정작 써야 할 표보다 시끄러워지지도 않는다.
//
// 펼쳐도 커지지 않게 본문 높이를 묶어 둔다 — 참고가 화면을 차지하면 그건 그것대로 방해다.
import { useCallback, useEffect, useState } from 'react';

export interface PrevRow {
  content: string;
  date: string;
  place: string;
  attendee: string;
}
export interface PrevItem {
  submissionId: string;
  isoKey: string;
  label: string;
  uploadedAtKst: string;
}
export interface PrevData {
  found: boolean;
  items: PrevItem[];
  submissionId?: string;
  slot?: { isoKey: string; label: string; year: number };
  uploadedAtKst?: string;
  rows?: { achievements: PrevRow[]; plans: PrevRow[]; notes: PrevRow[] } | null;
}

type Bucket = 'achievements' | 'plans' | 'notes';

const SECTIONS: { key: Bucket; no: number; title: string }[] = [
  { key: 'achievements', no: 1, title: '주요 업무실적' },
  { key: 'plans', no: 2, title: '주요 업무계획' },
  { key: 'notes', no: 3, title: '기타 특이사항' },
];

export function PreviousWeekPanel({
  isoKey,
  onCopyRow,
  onCopyPlansToAchievements,
}: {
  isoKey: string;
  /** 한 줄을 그 표에 넣는다 */
  onCopyRow: (bucket: Bucket, row: PrevRow) => void;
  /** 지난주 계획 전부를 이번 주 실적으로 */
  onCopyPlansToAchievements: (rows: PrevRow[]) => void;
}) {
  const [data, setData] = useState<PrevData | null>(null);
  const [open, setOpen] = useState(true); // WA-13 — 접어 두면 있는 줄도 모른다
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(
    (submissionId?: string) => {
      const q = new URLSearchParams({ isoKey });
      if (submissionId) q.set('submissionId', submissionId);
      setLoading(true);
      return fetch(`/api/my/previous?${q}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => setData(j))
        .catch(() => setData(null))
        .finally(() => setLoading(false));
    },
    [isoKey],
  );

  useEffect(() => {
    let alive = true;
    // 첫 로드에서 취소된 응답이 나중 상태를 덮지 않게 한다
    fetch(`/api/my/previous?isoKey=${encodeURIComponent(isoKey)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setData(j))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [isoKey]);

  const say = (t: string) => {
    setFlash(t);
    setTimeout(() => setFlash(null), 1800);
  };

  // 낸 적이 없으면 **아무것도 그리지 않는다** — 「없습니다」 줄도 자리를 차지한다
  if (!data?.found || !data.slot) return null;

  const rows = data.rows;
  const counts = rows
    ? { a: rows.achievements.length, p: rows.plans.length, n: rows.notes.length }
    : null;

  return (
    /*
      띠가 아니라 **카드**이고, 머리 영역이 아니라 **본문 맨 위**에 있다.

      띠였을 때는 위쪽 안내 띠 둘과 같은 모양이라 눈이 「또 안내문」으로 읽고 건너뛰었다.
      그렇다고 머리 영역에 카드로 두면 그 높이만큼 **쓸 칸이 영영 밀린다** — 참고하려고
      만든 것이 정작 쓰는 자리를 빼앗는다.

      본문 맨 위면 둘 다 풀린다: 열자마자 제일 먼저 보이고, 쓰기 시작하면 스크롤로 비켜난다.
    */
    <div className="mb-5">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex items-center gap-1.5 text-sm font-semibold text-ink hover:underline"
          >
            <span aria-hidden className="text-[10px] text-muted">
              {open ? '▾' : '▸'}
            </span>
            지난번에 낸 것
            <span className="font-normal text-muted">· {data.slot.label}</span>
          </button>
          {counts && (
            <span className="text-xs text-muted">
              실적 {counts.a} · 계획 {counts.p}
              {counts.n > 0 && ` · 특이 ${counts.n}`}
            </span>
          )}

          {/*
            주된 동선 — 지난주 계획이 이번 주 실적이 된다.
            **채운 버튼**이라야 눈이 여기에 멈춘다. 테두리만 있는 버튼은 옆의 글자와 섞였다.
            접혀 있어도 누를 수 있게 머리줄에 둔다.
          */}
          {rows && rows.plans.length > 0 && (
            <button
              onClick={() => {
                onCopyPlansToAchievements(rows.plans);
                say(`계획 ${rows.plans.length}줄을 실적에 넣었습니다`);
              }}
              className="ml-auto rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-canvas transition-colors hover:bg-ink-active"
            >
              계획 {rows.plans.length}줄을 이번 주 실적으로
            </button>
          )}
          {flash && <span className="text-xs font-semibold text-success">{flash}</span>}
        </div>

        {open && (
          <div className="border-t border-hairline-soft bg-surface-soft/60 px-3.5 py-2.5">
            {/*
              WA-12 — 주차 고르기. 낸 주차만 나온다 — 안 낸 주를 흐리게 늘어놓으면
              «내가 그때 안 냈구나»를 매번 확인시킬 뿐이고, 여기서 할 수 있는 일도 없다.
            */}
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {data.items.length > 1 &&
                data.items.map((it) => {
                  const on = it.submissionId === data.submissionId;
                  return (
                    <button
                      key={it.submissionId}
                      onClick={() => !on && load(it.submissionId)}
                      aria-pressed={on}
                      className={
                        'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ' +
                        (on
                          ? 'bg-ink text-canvas'
                          : 'border border-hairline bg-canvas text-muted hover:border-ink hover:text-ink')
                      }
                    >
                      {it.label}
                    </button>
                  );
                })}
              {loading && <span className="text-[11px] text-muted-soft">불러오는 중…</span>}
              {data.submissionId && (
                <a
                  href={`/api/submissions/${data.submissionId}/download`}
                  className="ml-auto text-[11px] text-muted underline underline-offset-2 hover:text-ink"
                >
                  hwp로 받기
                </a>
              )}
            </div>

            {/* 지난주가 길어도 표를 덮지 않게 묶는다 */}
            <div className="max-h-56 overflow-y-auto">
              {!rows ? (
                <p className="text-xs text-muted">
                  파일을 읽지 못했습니다. [hwp로 받기]로 내려받아 확인해 주세요.
                </p>
              ) : SECTIONS.every((s) => rows[s.key].length === 0) ? (
                <p className="text-xs text-muted">이 주차에는 적은 내용이 없습니다.</p>
              ) : (
                SECTIONS.filter((s) => rows[s.key].length > 0).map((s) => (
                  <section key={s.key} className="mb-2.5 last:mb-0">
                    <h4 className="mb-1 text-[11px] font-semibold text-muted">
                      {s.no}. {s.title}
                    </h4>
                    <ul className="space-y-0.5">
                      {rows[s.key].map((r, i) => (
                        <li
                          key={i}
                          className="group flex items-start gap-2 rounded px-1.5 py-1 text-xs hover:bg-canvas"
                        >
                          <span className="min-w-0 flex-1 text-body">
                            {r.content}
                            {(r.date || r.place || r.attendee) && (
                              <span className="ml-1.5 text-muted-soft">
                                {[r.date, r.place, r.attendee].filter(Boolean).join(' · ')}
                              </span>
                            )}
                          </span>
                          {/*
                            반복 업무를 같은 표로 한 줄씩.

                            **항상 보인다.** 처음엔 hover에서만 나타나게 했는데, 휴대폰·태블릿에는
                            hover가 없어서 그 버튼에 영영 닿을 수 없다 — 있는 줄도 모른다.
                            대신 평소엔 흐리게 두고 가리킬 때 진해진다.
                          */}
                          <button
                            onClick={() => {
                              onCopyRow(s.key, r);
                              say('한 줄 넣었습니다');
                            }}
                            aria-label={`${s.title}에 「${r.content}」 넣기`}
                            title={`${s.title}에 이 줄 넣기`}
                            className="shrink-0 rounded border border-hairline bg-canvas px-1.5 py-0.5 text-[11px] font-medium text-muted hover:border-ink hover:text-ink"
                          >
                            +
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
