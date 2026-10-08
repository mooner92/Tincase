'use client';
// WA-06 — 웹에서 작성해 바로 제출 (S-10).
//
// 화면을 **한글 표와 같은 모양**으로 둔다. 부서원은 한글에서 그 표를 채워 왔으므로,
// 다른 배치를 내밀면 어디에 뭘 넣는지 다시 배워야 한다. 머리글을 그대로 두고
// 칸 너비도 비슷하게 맞춘다.
//
// `구분`은 시스템이 다시 매기므로(ABS-5) 입력칸이 아니라 **번호 표시**로 둔다.
import { flagWordOf, parseFlagWords } from '@/lib/empty-content';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseClipboardTable } from '@/lib/paste-table';
import { composerStart, dateHint, sameRows, type ComposerFrom } from '@/lib/composer';
import { PreviousWeekPanel, type PrevRow } from './PreviousWeekPanel';

export interface ComposerRow {
  content: string;
  date: string;
  place: string;
  attendee: string;
  /**
   * HM-37 — 「전체 공유·전달이 필요한 주요 사항」.
   *
   * 기획조정실 규칙이 「주요 사항에는 파란색으로 작성」인데, 웹에서 적는 사람에게
   * 「파란색으로 칠하세요」라고 할 수는 없다 — 색은 **수단**이지 뜻이 아니다.
   * 그래서 화면에서는 **체크 하나**로 받고, 문서로 나갈 때 파란색이 된다.
   * 규칙이 바뀌어 색이 달라져도 적는 사람은 아무것도 다시 배우지 않는다.
   */
  emphasis?: boolean;
}

type Bucket = 'achievements' | 'plans' | 'notes';

const SECTIONS: { key: Bucket; no: number; title: string; hint: string }[] = [
  { key: 'achievements', no: 1, title: '주요 업무실적', hint: '이번 주에 한 일' },
  { key: 'plans', no: 2, title: '주요 업무계획', hint: '다음 주에 할 일' },
  { key: 'notes', no: 3, title: '기타 특이사항', hint: '휴가·출장 등 · 없으면 비워 두세요' },
];

const blank = (): ComposerRow => ({ content: '', date: '', place: '', attendee: '', emphasis: false });
const draftKey = (isoKey: string) => `tincase.compose.${isoKey}`;

/** 브라우저 임시본 쓰기·지우기 — 저장소를 못 쓰면 임시 보관만 못 할 뿐이다 */
function writeDraft(isoKey: string, data: unknown) {
  try {
    localStorage.setItem(draftKey(isoKey), JSON.stringify(data));
  } catch {
    /* 사생활 보호 모드 등 */
  }
}
function dropDraft(isoKey: string) {
  try {
    localStorage.removeItem(draftKey(isoKey));
  } catch {
    /* 지우지 못해도 다음에 열 때 내용 비교(WA-37)가 다시 판정한다 */
  }
}

/** 브라우저 임시본 읽기 — 사생활 보호 모드 등에서 저장소가 던지면 없는 것으로 친다 */
function readDraft(isoKey: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(draftKey(isoKey));
  } catch {
    return null;
  }
}

export function WebComposer({
  isoKey,
  title,
  editedNote = null,
  initial,
  initialVersion,
  initialFailed = false,
  weekStartMs,
  onClose,
  emptyWordsRaw = '',
}: {
  isoKey: string;
  /** WA-38 — 「10월 1주차 업무일지」 · 「9월 월간 업무일지」. 「업무일지 작성」은 어느 주인지 말하지 않는다 */
  title: string;
  /** WA-38 — 담당자가 고친 판이면 「○○ 고침 · 10-07 15:20」 한 줄(TACP-22). 고치지 않았으면 없음 */
  editedNote?: string | null;
  /** WA-35 — 이번 주에 낸 판의 표 (「공유」 포함). 없으면 null */
  initial?: Record<Bucket, ComposerRow[]> | null;
  /** WA-35a — 그 판의 버전 ([지금 낸 v2로 다시 시작]) */
  initialVersion?: number;
  /** WA-35c — 낸 판이 있는데 못 불러왔다. 빈 표로 열되 그렇다고 말한다 */
  initialFailed?: boolean;
  /** WA-36a — 이번 주 월요일 00:00 KST. 일자 예시를 여기서 만든다 */
  weekStartMs: number;
  onClose: () => void;
  /** HM-33 — 부서가 정한 「내용 없음」 낱말 (`Division.emptyWords`). 비면 검사하지 않는다 */
  emptyWordsRaw?: string;
}) {
  const emptyWords = useMemo(() => parseFlagWords(emptyWordsRaw), [emptyWordsRaw]);
  /*
   * WA-35 — 시작점: 저장 안 한 임시본 > 지금 낸 판 > 빈 표 (composerStart).
   * `start`를 따로 들고 있는 것은 WA-35b 때문이다 — 사람이 아무것도 안 바꿨으면 임시본을 쓰지 않는다.
   * 연 것만으로 쓰면 빈 표·옛 판이 임시본이 되어, 다음에 열 때 지금 낸 판을 가린다.
   */
  const [start, setStart] = useState(() => composerStart(readDraft(isoKey), initial, blank));
  const [data, setData] = useState<Record<Bucket, ComposerRow[]>>(start.data);
  const from: ComposerFrom = start.from;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pasted, setPasted] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  /*
   * WA-37 — 「바뀌었나」는 **내용으로** 판정한다. 참조로 보던 예전 판정은 한 글자 쳤다 지워도 바뀐 것이라
   * 같은 내용의 새 판이 생겼다. 낸 판으로 연 화면은 내용이 같은 동안 [제출]이 꺼져 있다 — 보려고 연 사람이
   * 실수로 새 판을 만들지 않게(S1: [열어보기]를 [열기] 하나로 합친 대가).
   */
  const unchanged = useMemo(() => sameRows(start.data, data), [start, data]);

  // 임시 보관은 **제출 전까지만**. 제출 후에도 남아 있으면 다음에 열었을 때
  // 낸 건지 안 낸 건지 헷갈린다 (지연 저장이 뒤늦게 되살리는 것도 막는다)
  useEffect(() => {
    if (done) return;
    // WA-35b·37 — 내용이 시작점으로 돌아왔으면 임시본도 시작점으로: 임시본에서 시작했으면 그 내용, 아니면 없음.
    // 지연 저장이 써 둔 중간 내용(쳤다 지운 것)이 남아 다음에 낸 판을 가리지 않게
    if (unchanged) {
      if (start.from === 'draft') writeDraft(isoKey, data);
      else dropDraft(isoKey);
      return;
    }
    const t = setTimeout(() => writeDraft(isoKey, data), 800);
    return () => clearTimeout(t);
  }, [data, isoKey, done, unchanged, start.from]);

  /**
   * WA-38 — 닫기(×·바탕·Esc). 바뀐 것이 있으면 임시본을 **바로** 쓰고 닫는다 — 800ms 지연 저장을 기다리면
   * 빨리 닫은 사람의 마지막 글자가 사라진다. 다음에 열면 이어 쓰므로 「닫을까요?」를 묻지 않는다.
   */
  const close = useCallback(() => {
    if (!done && !unchanged) writeDraft(isoKey, data);
    onClose();
  }, [done, unchanged, isoKey, data, onClose]);

  // WA-38 — 열면 제목에 초점, Tab은 드로어 안에서 돈다, Esc로 닫는다 (FileDrawer CP-75와 같은 방식)
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], select, input, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  /** WA-35a — 임시본을 버리고 지금 낸 판에서 다시. 적던 것이 사라지므로 묻는다 */
  const restartFromSubmitted = () => {
    if (!initial || !confirm(`작성하던 임시본을 지우고 지금 낸 v${initialVersion}에서 다시 시작할까요?`)) return;
    dropDraft(isoKey); // 지우지 못해도 아래에서 다시 시작한다 — 손대지 않으면 다시 쓰지 않는다
    const next = composerStart(null, initial, blank);
    setStart(next);
    setData(next.data);
  };

  // WA-36a — 일자 예시는 이번 주 날짜에서. 계획 표는 다음 주 일이다
  const hints = useMemo(
    () => ({ achievements: dateHint(weekStartMs), plans: dateHint(weekStartMs, 1), notes: dateHint(weekStartMs) }),
    [weekStartMs],
  );

  const filled = useMemo(
    () =>
      Object.fromEntries(SECTIONS.map((s) => [s.key, data[s.key].filter((r) => r.content.trim()).length])) as Record<
        Bucket,
        number
      >,
    [data],
  );
  const total = filled.achievements + filled.plans + filled.notes;

  const set = useCallback((bucket: Bucket, i: number, field: keyof ComposerRow, v: string) => {
    setData((d) => {
      const rows = [...d[bucket]];
      rows[i] = { ...rows[i], [field]: v };
      if (i === rows.length - 1 && v.trim() && rows.length < 200) rows.push(blank());
      return { ...d, [bucket]: rows };
    });
  }, []);

  /** HM-37 — 「공유」 표시 켜고 끄기 */
  const toggleEmphasis = useCallback((bucket: Bucket, i: number) => {
    setData((d) => {
      const rows = [...d[bucket]];
      rows[i] = { ...rows[i], emphasis: !rows[i].emphasis };
      return { ...d, [bucket]: rows };
    });
  }, []);

  /**
   * WA-11 — 지난번 낸 줄을 이 표에 넣는다. **비어 있는 줄부터 채운다** —
   * 맨 뒤에만 붙이면 위쪽 빈 줄이 그대로 남아 문서에 빈 칸처럼 보인다.
   */
  const appendRows = useCallback((bucket: Bucket, incoming: PrevRow[]) => {
    if (incoming.length === 0) return;
    setData((d) => {
      const kept = d[bucket].filter((r) => r.content.trim()); // 빈 줄은 걷어낸다
      const next = [...kept, ...incoming.map((r) => ({ ...r }))].slice(0, 200);
      next.push(blank()); // 이어서 적을 빈 줄 하나
      return { ...d, [bucket]: next };
    });
  }, []);

  const removeRow = useCallback((bucket: Bucket, i: number) => {
    setData((d) => {
      const rows = d[bucket].filter((_, k) => k !== i);
      return { ...d, [bucket]: rows.length ? rows : [blank()] };
    });
  }, []);

  /** 한글·엑셀 표를 통째로 붙여넣기 — 이 줄부터 아래로 채운다 */
  const onPaste = useCallback((bucket: Bucket, at: number, e: React.ClipboardEvent) => {
    // 한글은 평문에 셀을 줄바꿈으로 넣어 격자가 무너진다 → HTML을 먼저 본다
    const rows = parseClipboardTable(
      e.clipboardData.getData('text/html'),
      e.clipboardData.getData('text/plain'),
    );
    if (!rows) return; // 표가 아니면 평범한 붙여넣기로 둔다
    e.preventDefault();
    setData((d) => {
      const next = [...d[bucket]];
      rows.forEach((r, k) => {
        next[at + k] = { ...r };
      });
      if (next[next.length - 1].content.trim()) next.push(blank());
      return { ...d, [bucket]: next };
    });
    setPasted(`${rows.length}줄을 붙여넣었습니다`);
    setTimeout(() => setPasted(null), 2500);
  }, []);

  const submit = () => {
    setBusy(true);
    setMsg(null);
    fetch('/api/submissions/compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then(async (r) => {
        const body = (await r.json()) as { message?: string; version?: number };
        if (!r.ok) {
          setMsg({ ok: false, text: body.message ?? '제출하지 못했습니다.' });
          return;
        }
        setDone(true); // 지연 저장이 다시 쓰지 못하게 먼저 막는다
        dropDraft(isoKey);
        // WA-35c — 표는 그대로 둔다. 다시 열면 방금 낸 판에서 시작하므로 「빈 화면」이라고 하지 않는다
        setMsg({ ok: true, text: `제출되었습니다 (v${body.version}).` });
        router.refresh();
        setTimeout(onClose, 900);
      })
      .catch(() => setMsg({ ok: false, text: '네트워크 오류로 제출하지 못했습니다.' }))
      .finally(() => setBusy(false));
  };

  /*
   * 입력칸 테두리는 **hairline이 아니라 border-strong**이다 (v1.28.0).
   * hairline(1.67:1)은 카드 바깥선용이고, 「여기에 적는다」를 알려야 하는 경계는
   * 그보다 진해야 한다 — WCAG 1.4.11이 조작 요소 경계에 3:1을 요구하는 이유다.
   * 연한 칸이 스무 개 늘어서 있으면 표가 아니라 회색 얼룩으로 보인다.
   */
  const cell =
    'h-8 w-full rounded-md border border-border-strong bg-canvas px-2 text-[13px] text-ink ' +
    'focus:border-ink focus:ring-1 focus:ring-ink focus:outline-none';

  /*
   * 2026-10-07 — 표 위의 띠를 걷었다. 예전에는 머리 아래에 띠가 셋(붙여넣기 안내 초록 · 작성 안내 회색 ·
   * 지난번에 낸 것)이 쌓여 표가 화면 3분의 2 지점에서야 시작했다. 붙여넣기 안내는 머리 한 줄과
   * 첫 칸의 안내 문구가 이미 말하고, 작성 안내는 접어 둔다(펼치면 그대로 보인다).
   * 「지난번에 낸 것」은 그대로 펼쳐 둔다 — 접어 두었을 때 「있는지도 모르겠다」는 말을 들었다(WA-13).
   */
  return (
    <div className="fixed inset-0 z-40 h-screen">
      <div className="absolute inset-0 bg-ink/40" onClick={close} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="composer-title"
        className="absolute inset-y-0 right-0 flex h-full w-full max-w-5xl flex-col border-l border-hairline bg-canvas shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
      >
        {/* 머리 — 제목은 그 주(WA-38). 붙여넣기는 첫 칸의 placeholder가 말한다 */}
        <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-4 sm:px-7">
          <div className="min-w-0">
            <h2 id="composer-title" ref={titleRef} tabIndex={-1} className="card-title outline-none">
              {title}
            </h2>
            {/* TACP-22 — 담당자가 고친 판이면 누가 언제. 홈의 카드·줄에는 「고침」만 있고 이름은 여기서 본다 */}
            {editedNote && <p className="mt-0.5 text-sm text-warning">{editedNote}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {pasted && <span className="text-sm font-medium text-success">{pasted}</span>}
            <button onClick={close} aria-label="닫기" className="btn-ghost h-9 w-9 px-0 text-xl leading-none text-muted">
              ×
            </button>
          </div>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-7">
          {/*
            WA-35 — 낸 것과 **다른 것**을 보고 있을 때만 한 줄(임시본·못 불러옴). 낸 판에서 시작하면 말하지 않는다 —
            [열기]로 열었으니 당연하다(R15, 2026-10-08)
          */}
          {from === 'draft' && (
            <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-body">
              <span className="font-semibold text-ink">저장하지 않은 임시본에서 이어 씁니다</span>
              {initial && initialVersion !== undefined && (
                <button onClick={restartFromSubmitted} className="text-xs text-muted underline hover:text-ink">
                  지금 낸 v{initialVersion}로 다시 시작
                </button>
              )}
            </p>
          )}
          {from === 'blank' && initialFailed && (
            <p className="mb-4 text-sm text-warning">지금 낸 판을 불러오지 못해 빈 표로 시작합니다.</p>
          )}
          {/*
            WA-13 — 지난번 낸 내용. **본문 맨 위**다.

            처음에는 안내 띠들 사이에 끼워 뒀는데 「이런게 있는지도 잘 모르겠어」였다.
            머리 영역에 두면 그 높이만큼 쓸 칸이 영영 밀리므로, 본문 첫 자리에 둔다 —
            열자마자 제일 먼저 보이고, 쓰기 시작하면 스크롤로 비켜난다.
          */}
          <PreviousWeekPanel
            isoKey={isoKey}
            onCopyRow={(bucket, row) => appendRows(bucket, [row])}
            onCopyPlansToAchievements={(rows) => appendRows('achievements', rows)}
          />
          {SECTIONS.map((s) => (
            // CP-104 — 사용 안내는 첫 표(실적)를 가리킨다
            <section key={s.key} data-guide={s.key === 'achievements' ? 'compose-table' : undefined} className="mb-6">
              <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h3 className="text-[15px] font-semibold text-ink">
                  {s.no}. {s.title}
                </h3>
                <span className="text-xs text-muted">{s.hint}</span>
                <span className="ml-auto text-xs font-medium text-muted tabular-nums">{filled[s.key]}줄</span>
              </div>

              <div className="overflow-hidden rounded-lg border border-hairline">
                {/* 머리글 — 한글 표와 같은 이름·순서. 좁은 화면에서는 칸이 두 줄로 쌓이므로 머리글을 감춘다 */}
                <div className="hidden gap-1.5 border-b border-hairline bg-surface-soft px-2.5 py-1.5 text-xs font-medium text-muted sm:flex">
                  <span className="w-9 shrink-0 text-center">구분</span>
                  <span className="flex-1">업무 내용</span>
                  <span className="w-[74px] shrink-0">일자</span>
                  <span className="w-28 shrink-0">장소</span>
                  <span className="w-28 shrink-0">참석자</span>
                  {/* WA-36 — 이름 없는 칸의 버튼은 뜻을 짐작하게 된다. 파란 점은 문서에 나가는 그 색이다 */}
                  <span className="w-10 shrink-0 text-center whitespace-nowrap">
                    <span aria-hidden className="mr-0.5 inline-block size-1.5 rounded-full bg-emphasis align-middle" />
                    공유
                  </span>
                  <span className="w-6 shrink-0" />
                </div>

                {data[s.key].map((row, i) => {
                  // 비어 있는 구역의 첫 칸이 곧 "여기에 붙여넣으세요"다.
                  // 한 줄이라도 채워지면 안내는 방해가 되므로 사라진다
                  const isPasteTarget = i === 0 && filled[s.key] === 0;
                  /*
                   * HM-33 — 「특이사항 없음」처럼 **비었다는 뜻으로 쓴 글자**를 알아보고 귀띔한다.
                   *
                   * 한 부서원이 실적 칸에 그렇게 적어 냈고 그대로 병합본에 들어갔다.
                   * 그 습관의 절반은 우리가 만든 것이다 — 어제까지 실적을 비우면 제출이 안 됐다.
                   * 그건 고쳤으니 이제 **안 써도 된다는 걸 알려주는 일**이 남았다.
                   *
                   * **막지 않는다.** 정말 그렇게 쓰고 싶으면 쓸 수 있어야 한다 —
                   * 사람이 쓴 글을 화면이 거부하기 시작하면 다음엔 우회로를 찾는다.
                   */
                  const looksEmpty = flagWordOf(row.content, emptyWords) !== null;
                  const no = row.content.trim()
                    ? `${s.no}-${data[s.key].slice(0, i + 1).filter((r) => r.content.trim()).length}`
                    : '';
                  return (
                    /*
                      한 줄 = 내용 + 일자·장소·참석자. 넓은 화면은 한글 표처럼 한 줄로,
                      좁은 화면(400px)은 내용을 한 줄 다 쓰고 나머지 셋을 그 밑에 셋으로 나눈다 —
                      한 줄에 다섯 칸을 우겨넣으면 「업무 내용」 머리글이 한 글자씩 세로로 쪼개졌다.
                    */
                    <div
                      key={i}
                      className={`group grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-1.5 gap-y-1 px-2 py-1.5 sm:flex sm:px-2.5 sm:py-1 ${
                        i > 0 ? 'border-t border-hairline-soft sm:border-t-0' : ''
                      } ${i % 2 ? 'sm:bg-surface-soft/60' : ''}`}
                    >
                      <span className="text-center text-xs text-muted tabular-nums sm:w-9 sm:shrink-0">{no}</span>
                      <input
                        // CP-104 — 사용 안내의 「업무 내용」 단계는 실적 표 첫 칸(붙여넣는 자리)을 가리킨다
                        data-guide={s.key === 'achievements' && i === 0 ? 'compose-first' : undefined}
                        value={row.content}
                        onChange={(e) => set(s.key, i, 'content', e.target.value)}
                        onPaste={(e) => onPaste(s.key, i, e)}
                        placeholder={isPasteTarget ? '한글 표 붙여넣기 (Ctrl+V)' : ''}
                        aria-label={`${s.title} ${i + 1}번째 줄 업무 내용`}
                        aria-describedby={looksEmpty ? `empty-hint-${s.key}-${i}` : undefined}
                        className={`${cell} sm:flex-1 ${
                          isPasteTarget
                            ? 'border-2 border-dashed border-brand bg-brand-soft placeholder:text-body-strong'
                            : looksEmpty
                              ? 'border border-warning/50 bg-warning-soft'
                              : ''
                        }`}
                      />
                      {/* 줄 지우기 — 늘 보이면 스무 줄에 ×가 스무 개다. 그 줄에 손이 갔을 때만 (좁은 화면은 늘) */}
                      <button
                        onClick={() => removeRow(s.key, i)}
                        aria-label={`${i + 1}번째 줄 지우기`}
                        className="h-8 w-6 shrink-0 rounded text-base leading-none text-muted-soft hover:text-error focus:opacity-100 sm:order-last sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
                        title="이 줄 지우기"
                      >
                        ×
                      </button>
                      <div className="col-start-2 col-end-4 grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-1.5 sm:contents">
                        <input
                          value={row.date}
                          onChange={(e) => set(s.key, i, 'date', e.target.value)}
                          placeholder={i === 0 ? hints[s.key] : ''}
                          aria-label={`${s.title} ${i + 1}번째 줄 일자`}
                          className={`${cell} sm:w-[74px] sm:shrink-0`}
                        />
                        <input
                          value={row.place}
                          onChange={(e) => set(s.key, i, 'place', e.target.value)}
                          placeholder={i === 0 ? '중회의실' : ''}
                          aria-label={`${s.title} ${i + 1}번째 줄 장소`}
                          className={`${cell} sm:w-28 sm:shrink-0`}
                        />
                        <input
                          value={row.attendee}
                          onChange={(e) => set(s.key, i, 'attendee', e.target.value)}
                          placeholder={i === 0 ? '원장 외 3명' : ''}
                          aria-label={`${s.title} ${i + 1}번째 줄 참석자`}
                          className={`${cell} sm:w-28 sm:shrink-0`}
                        />
                        {/*
                          HM-37 — 「공유」. 켜면 이 줄이 병합본에 **파란색**으로 나간다.
                          체크박스가 아니라 **누르는 표식**인 것은 의도다 — 체크박스 스무 개가
                          칸 옆에 늘어서면 적는 칸보다 체크박스가 먼저 보인다.
                          켜진 줄만 눈에 띄면 된다.
                        */}
                        <button
                          // CP-104 — 사용 안내의 「공유」 단계는 실적 표 첫 줄의 이 버튼을 가리킨다
                          data-guide={s.key === 'achievements' && i === 0 ? 'compose-share' : undefined}
                          onClick={() => toggleEmphasis(s.key, i)}
                          aria-pressed={row.emphasis === true}
                          aria-label={`${i + 1}번째 줄 공유 표시`}
                          title="파란색으로 나감"
                          className={`h-8 w-10 shrink-0 rounded-md border px-1 text-center text-xs font-semibold whitespace-nowrap transition-colors ${
                            row.emphasis
                              ? 'border-emphasis bg-emphasis text-white'
                              : 'border-hairline bg-canvas text-muted hover:border-ink hover:text-ink'
                          }`}
                        >
                          공유
                        </button>
                      </div>
                    </div>
                  );
                })}
                {/*
                  HM-33 — 표 아래 한 줄로만 귀띔한다. 칸마다 말풍선을 띄우면 잔소리가 되고,
                  잔소리는 다음부터 안 읽힌다. 「비워두셔도 됩니다」가 이 안내의 전부다.
                */}
                {emptyWords.length > 0 && data[s.key].some((r) => flagWordOf(r.content, emptyWords)) && (
                  <p className="border-t border-hairline-soft px-2.5 py-1.5 text-xs leading-5 text-body">
                    「없음」 칸은 비워도 됩니다
                  </p>
                )}
              </div>
            </section>
          ))}
        </div>

        {/* 바닥 — 이 화면의 주 버튼은 [제출] 하나다 */}
        <div data-guide="compose-footer" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-hairline bg-canvas px-4 py-3 sm:px-7">
          <span aria-live="polite" className={`text-sm font-medium ${msg?.ok ? 'text-success' : 'text-error'}`}>
            {msg?.text}
          </span>
          <div className="ml-auto flex items-center gap-3 sm:gap-4">
            {/* WA-37 — 낸 판으로 연 화면은 내용이 바뀌기 전에는 꺼져 있다. 2026-10-08 — [전체 지우기]·합계는 걷었다(R15) */}
            <button
              data-guide="compose-submit"
              onClick={submit}
              disabled={busy || total === 0 || (from === 'submission' && unchanged)}
              className="btn-primary"
            >
              {busy ? '제출 중…' : '제출'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
