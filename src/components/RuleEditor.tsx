'use client';
// CP-78~82 — 부서 병합 설정. 문법 없음 (HM-18 v3).
// 부서마다 업무가 천차만별이라 분류는 각 부서가 자기 말로 적는다. 안 적으면 제출자 순서.
//
// **화면 원칙 (v1.24.0 개편).** 「여기가 뭐 하는 곳인지 모르겠다」는 실제 피드백에서 고쳤다.
//
//   1. 설명을 **입력칸 아래가 아니라 제목 옆**에 한 줄로 둔다. 칸마다 두세 줄씩 붙어 있으면
//      읽을 것이 설정보다 많아지고, 그러면 아무것도 안 읽는다
//   2. 입력칸은 **눌러 들어간 것처럼** 그린다 (안쪽 그림자 + 흰 바탕). 평평하면 어디가
//      쓰는 곳인지 훑어서 알 수 없다
//   3. 각 설정은 **자기 카드**를 갖는다. 한 카드에 다 넣으면 어디까지가 한 설정인지 모른다
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseFlagWords } from '@/lib/empty-content';
import { parseEmphasisWords } from '@/lib/emphasis-marker';

/** 서버의 parseCategories와 같은 규칙 — 입력하는 즉시 해석 결과를 보여주기 위해 */
function preview(raw: string): string[] {
  return raw
    .split(/[,·\-–—/|]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.slice(0, 20))
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .slice(0, 12);
}

/** 눌러 들어간 입력칸 — 어디에 쓰는지 훑어서 보이게 (화면 원칙 2) */
const FIELD =
  'w-full rounded-xl border border-hairline bg-canvas px-3.5 py-2.5 text-sm leading-6 text-ink ' +
  'shadow-[inset_0_1px_2px_rgba(10,10,10,0.06)] transition-colors ' +
  'placeholder:text-muted-soft focus:border-ink focus:outline-none';

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-hairline bg-surface-soft/50 px-5 py-4">
      <h3 className="text-sm font-semibold text-ink">
        {title}
        <span className="ml-2 text-xs font-normal text-muted">{hint}</span>
      </h3>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

/** HM-48 — 서버 `MERGE_SORTS`·`MERGE_UNDATED`와 같은 값. 화면은 서버 모듈을 들이지 않는다 (preview와 같은 이유) */
type SortChoice = 'input' | 'date';
type UndatedChoice = 'last' | 'first';

const SORT_OPTIONS: { value: SortChoice; label: string; hint: string }[] = [
  { value: 'input', label: '제출자 순', hint: '명단 순서대로, 각자 적은 순서 그대로' },
  { value: 'date', label: '일자 순', hint: '일자 칸의 첫 날짜가 빠른 줄부터 · 기간은 시작일' },
];
const UNDATED_OPTIONS: { value: UndatedChoice; label: string }[] = [
  { value: 'last', label: '뒤' },
  { value: 'first', label: '앞' },
];

export interface RuleEditorProps {
  initialCategories: string;
  initialDedupe: boolean;
  initialDropNotes: boolean;
  /** HM-48 — 줄 순서 */
  initialSort: SortChoice;
  initialUndated: UndatedChoice;
  initialRule: string;
  initialGuide: string;
  initialEmptyWords: string;
  initialEmphasisWords: string;
  /**
   * CP-108 — 이번 주 병합본이 이미 있나(그리고 사람이 고쳤나). 없으면 null.
   * 규칙 저장은 병합을 다시 돌리지 않으므로, 이미 있는 병합본에는 [다시 병합]해야 들어간다
   */
  thisWeekMerged?: { edited: boolean } | null;
}

/**
 * CP-108 — 저장 뒤 한 줄. 「저장되었습니다」만 말하면 이번 주 병합본이 그대로인 것을 「설정이 안 먹는다」로 읽는다.
 * [다시 병합]을 권할 때는 그게 병합본을 고친 것을 지운다는 것도 같이 말한다 (HM-49)
 */
export function savedNote(docChanged: boolean, merged: { edited: boolean } | null | undefined): string {
  if (!docChanged || !merged) return '저장되었습니다.';
  return `저장되었습니다. 이번 주 병합본에는 [다시 병합]해야 적용됩니다${merged.edited ? ' — 병합본을 고친 내용은 사라집니다.' : '.'}`;
}

export function RuleEditor(props: RuleEditorProps) {
  const [categories, setCategories] = useState(props.initialCategories);
  const [dedupe, setDedupe] = useState(props.initialDedupe);
  const [dropNotes, setDropNotes] = useState(props.initialDropNotes);
  const [sort, setSort] = useState(props.initialSort);
  const [undated, setUndated] = useState(props.initialUndated);
  const [rule, setRule] = useState(props.initialRule);
  const [guide, setGuide] = useState(props.initialGuide);
  const [emptyWords, setEmptyWords] = useState(props.initialEmptyWords);
  const [emphasisWords, setEmphasisWords] = useState(props.initialEmphasisWords);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  const dirty =
    categories !== props.initialCategories ||
    dedupe !== props.initialDedupe ||
    dropNotes !== props.initialDropNotes ||
    sort !== props.initialSort ||
    undated !== props.initialUndated ||
    rule !== props.initialRule ||
    guide !== props.initialGuide ||
    emptyWords !== props.initialEmptyWords ||
    emphasisWords !== props.initialEmphasisWords;

  const parsed = useMemo(() => preview(categories), [categories]);
  const words = useMemo(() => parseFlagWords(emptyWords), [emptyWords]);
  const marks = useMemo(() => parseEmphasisWords(emphasisWords), [emphasisWords]);

  // CP-81 — 저장 전 이탈 방지
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  /*
   * CP-108 — 문서를 바꾸는 설정을 바꿨나. 작성 안내·확인할 낱말은 병합본 글자를 바꾸지 않는다.
   * 「날짜 없는 줄」은 일자 순일 때만 문서에 닿는다 (수합 관리의 「규칙 바뀜」과 같은 판단, CP-107)
   */
  const docChanged =
    categories !== props.initialCategories ||
    dedupe !== props.initialDedupe ||
    dropNotes !== props.initialDropNotes ||
    sort !== props.initialSort ||
    (sort === 'date' && undated !== props.initialUndated) ||
    rule !== props.initialRule ||
    emphasisWords !== props.initialEmphasisWords;

  const save = () => {
    const note = savedNote(docChanged, props.thisWeekMerged);
    setSaving(true);
    setMsg(null);
    fetch('/api/division/rule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categories,
        dedupe,
        dropNotes,
        sort,
        undated,
        ruleText: rule,
        guideText: guide,
        emptyWords,
        emphasisWords,
      }),
    })
      .then(async (r) => {
        const body = await r.json();
        setMsg(r.ok ? { ok: true, text: note } : { ok: false, text: body.message ?? '저장 실패' });
        if (r.ok) router.refresh();
      })
      .catch(() => setMsg({ ok: false, text: '네트워크 오류로 저장하지 못했습니다.' }))
      .finally(() => setSaving(false));
  };

  return (
    <div className="space-y-3">
      <Card title="분류 순서" hint="병합본을 이 순서로 묶습니다">
        <input
          value={categories}
          onChange={(e) => setCategories(e.target.value)}
          className={FIELD}
          placeholder="AI-홍보-시스템-도서관   (쉼표·가운뎃점·하이픈 아무거나)"
        />
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {parsed.length === 0 ? (
            <span>{sort === 'date' ? '비우면 표 전체를 일자 순으로 놓습니다.' : '비우면 제출자 순서로 넣습니다.'}</span>
          ) : (
            <>
              {parsed.map((c) => (
                <span key={c} className="badge-pill bg-canvas px-2 py-0.5 text-[11px]">
                  {c}
                </span>
              ))}
              <span className="badge-pill bg-surface-card px-2 py-0.5 text-[11px] text-muted-soft">기타</span>
            </>
          )}
        </div>
      </Card>

      {/*
        HM-48 — 줄 순서. 실제 최종 취합본은 대부분 일자 오름차순이고 날짜 없는 줄을 뒤에 둔다.
        담당자가 매주 손으로 다시 놓던 것을 병합이 한다. 기본은 제출자 순 — 지금까지와 같다.
        「날짜 없는 줄」은 일자 순일 때만 뜻이 있어서 그때만 보인다 — 안 쓰이는 설정을 늘어놓지 않는다.
      */}
      <Card title="정렬" hint="표 안에서 줄을 놓는 순서 · 분류를 정했으면 분류 안에서">
        <div className="space-y-2">
          {SORT_OPTIONS.map((o) => (
            <label key={o.value} className="flex items-start gap-2.5 text-sm text-body">
              <input
                type="radio"
                name="merge-sort"
                checked={sort === o.value}
                onChange={() => setSort(o.value)}
                className="mt-1"
              />
              <span>
                <span className="font-medium text-ink">{o.label}</span>
                <span className="ml-1.5 text-xs text-muted">{o.hint}</span>
              </span>
            </label>
          ))}
          {sort === 'date' && (
            <div className="ml-6 flex flex-wrap items-center gap-x-4 gap-y-1 border-l border-hairline pl-3 text-sm text-body">
              <span className="font-medium text-ink">날짜 없는 줄</span>
              {UNDATED_OPTIONS.map((o) => (
                <label key={o.value} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="merge-undated"
                    checked={undated === o.value}
                    onChange={() => setUndated(o.value)}
                  />
                  {o.label}
                </label>
              ))}
              <span className="text-xs text-muted">상시·계속처럼 일자를 못 읽은 줄을 둘 곳</span>
            </div>
          )}
        </div>
      </Card>

      <Card title="병합 동작" hint="자동으로 할 일">
        <div className="space-y-2">
          <label className="flex items-start gap-2.5 text-sm text-body">
            <input type="checkbox" checked={dedupe} onChange={(e) => setDedupe(e.target.checked)} className="mt-1" />
            <span>
              <span className="font-medium text-ink">중복 묶기</span>
              <span className="ml-1.5 text-xs text-muted">여러 사람이 같은 업무를 적었으면 한 줄로</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-sm text-body">
            <input
              type="checkbox"
              checked={dropNotes}
              onChange={(e) => setDropNotes(e.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="font-medium text-ink">특이사항 없으면 3번 표 비우기</span>
            </span>
          </label>
        </div>
      </Card>

      {/*
        HM-33 — 「내용 없음」 낱말. **부서마다 다르다.**
        한 부서원이 실적 칸에 「특이사항 없음」을 적어 낸 일에서 나왔는데, 그건 그 부서 사정이지
        전사 규칙이 아니다. 비워두면 이 기능은 아예 없는 것과 같다.
      */}
      <Card title="확인할 낱말" hint="이 낱말이 든 줄을 병합 후 알려줍니다 (지우지는 않습니다)">
        <input
          value={emptyWords}
          onChange={(e) => setEmptyWords(e.target.value)}
          className={FIELD}
          placeholder="없음   (비우면 검사하지 않습니다)"
        />
        <p className="mt-2 text-xs text-muted">
          {words.length === 0 ? (
            '검사하지 않습니다.'
          ) : (
            <>
              <span className="text-ink">{words.map((w) => `「${w}」`).join(' ')}</span>이 들어간 줄을 찾아 담당자
              알림과 수합 관리 화면에 띄웁니다. <strong className="font-medium">문서는 그대로 둡니다</strong> —
              뺄지는 사람이 정합니다.
            </>
          )}
        </p>
      </Card>

      {/*
        HM-38 — 글로 적은 강조 표시. 한글로 작성해 올리는 사람에게는 「공유」 버튼이 없어서
        괄호로 적어 온다 (「…개최 (하이라이트)」). 병합이 그걸 떼고 파란색으로 바꾼다.
      */}
      <Card title="공유 표시 낱말" hint="괄호로 적은 이 낱말을 「공유」로 바꿉니다">
        <input
          value={emphasisWords}
          onChange={(e) => setEmphasisWords(e.target.value)}
          className={FIELD}
          placeholder="하이라이트   (비우면 바꾸지 않습니다)"
        />
        <p className="mt-2 text-xs text-muted">
          {marks.length === 0 ? (
            '바꾸지 않습니다.'
          ) : (
            <>
              <span className="text-ink">{marks.map((w) => `「(${w})」`).join(' ')}</span>처럼{' '}
              <strong className="font-medium">괄호로 감싼</strong> 것만 찾아 지우고 그 줄을 파란색으로
              냅니다. 괄호 없는 낱말은 업무 이름일 수 있어 건드리지 않습니다.
            </>
          )}
        </p>
      </Card>

      <Card title="병합 지침" hint="선택 · 평소 말하듯 적으면 됩니다">
        <textarea
          value={rule}
          onChange={(e) => setRule(e.target.value)}
          rows={2}
          className={FIELD}
          placeholder="도서관 업무는 맨 뒤로 / 같은 회의 참석은 묶어주세요"
        />
      </Card>

      <Card title="작성 안내" hint="부서원 제출 화면에 그대로 보입니다">
        <textarea
          value={guide}
          onChange={(e) => setGuide(e.target.value)}
          rows={3}
          className={FIELD}
          placeholder="한 줄에 하나씩&#10;상시 반복 업무는 일자를 공란으로 둡니다"
        />
      </Card>

      <div className="flex items-center gap-3 pt-1">
        <button onClick={save} disabled={saving || !dirty} className="btn-primary">
          {saving ? '저장 중…' : '저장'}
        </button>
        <span aria-live="polite" className={`text-sm ${msg?.ok ? 'text-success' : 'text-error'}`}>
          {msg?.text}
        </span>
        {dirty && !msg && <span className="text-xs text-warning">저장하지 않은 변경</span>}
      </div>

      {/* PG-26 — 절대 규칙은 상시 노출하되, 설정이 아니므로 맨 아래 작게 */}
      <p className="pt-1 text-[11px] leading-5 text-muted-soft">
        표 규격·내용·원본은 어떤 설정으로도 바꿀 수 없습니다. 병합은 제출된 글자를 그대로 옮깁니다.
      </p>
    </div>
  );
}
