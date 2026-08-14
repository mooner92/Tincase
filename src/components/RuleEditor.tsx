'use client';
// CP-78~81 — 부서 병합 설정. 문법 없음 (HM-18 v3).
// 부서마다 업무가 천차만별이라 분류는 각 부서가 자기 말로 적는다. 안 적으면 제출자 순서.
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

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

export interface RuleEditorProps {
  initialCategories: string;
  initialDedupe: boolean;
  initialDropNotes: boolean;
  initialRule: string;
  initialGuide: string;
}

export function RuleEditor(props: RuleEditorProps) {
  const [categories, setCategories] = useState(props.initialCategories);
  const [dedupe, setDedupe] = useState(props.initialDedupe);
  const [dropNotes, setDropNotes] = useState(props.initialDropNotes);
  const [rule, setRule] = useState(props.initialRule);
  const [guide, setGuide] = useState(props.initialGuide);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  const dirty =
    categories !== props.initialCategories ||
    dedupe !== props.initialDedupe ||
    dropNotes !== props.initialDropNotes ||
    rule !== props.initialRule ||
    guide !== props.initialGuide;

  const parsed = useMemo(() => preview(categories), [categories]);

  // CP-81 — 저장 전 이탈 방지
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const save = () => {
    setSaving(true);
    setMsg(null);
    fetch('/api/division/rule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories, dedupe, dropNotes, ruleText: rule, guideText: guide }),
    })
      .then(async (r) => {
        const body = await r.json();
        setMsg(r.ok ? { ok: true, text: '저장되었습니다.' } : { ok: false, text: body.message ?? '저장 실패' });
        if (r.ok) router.refresh();
      })
      .catch(() => setMsg({ ok: false, text: '네트워크 오류로 저장하지 못했습니다.' }))
      .finally(() => setSaving(false));
  };

  return (
    <div className="space-y-6">
      {/* ── 분류 순서 ── */}
      <div>
        <label htmlFor="cats" className="mb-1 block text-xs font-medium text-body">
          분류 순서 <span className="font-normal text-muted-soft">— 병합본을 이 순서로 묶습니다</span>
        </label>
        <input
          id="cats"
          value={categories}
          onChange={(e) => setCategories(e.target.value)}
          className="input"
          placeholder="예) AI-홍보(정간물 포함)-시스템-도서관"
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          {parsed.length === 0 ? (
            <span>비워두면 제출자 순서로 넣습니다.</span>
          ) : (
            <>
              <span>이렇게 나뉩니다:</span>
              {parsed.map((c) => (
                <span key={c} className="badge-pill bg-surface-card px-2 py-0.5 text-[11px]">
                  {c}
                </span>
              ))}
              <span className="badge-pill bg-surface-soft px-2 py-0.5 text-[11px] text-muted-soft">기타</span>
            </>
          )}
        </div>
        <p className="mt-1 text-[11px] leading-4 text-muted-soft">
          쉼표·가운뎃점·하이픈 아무거나 써도 됩니다. 분류 이름은 문서에 나타나지 않고 순서에만 쓰입니다.
        </p>
      </div>

      {/* ── 켜고 끄는 것 ── */}
      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs font-medium text-body">병합 동작</legend>
        <label className="flex items-start gap-2 text-sm text-body">
          <input type="checkbox" checked={dedupe} onChange={(e) => setDedupe(e.target.checked)} className="mt-0.5" />
          <span>
            중복 묶기
            <span className="ml-1 text-xs text-muted-soft">
              — 여러 사람이 같은 업무를 적었으면 한 줄로 합칩니다 (원문 중 정보가 가장 많은 것을 남깁니다)
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-body">
          <input
            type="checkbox"
            checked={dropNotes}
            onChange={(e) => setDropNotes(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            특이사항이 비면 3번 표를 비워둠
            <span className="ml-1 text-xs text-muted-soft">— 부서 관례에 맞춥니다</span>
          </span>
        </label>
      </fieldset>

      {/* ── 자연어 지침 ── */}
      <div>
        <label htmlFor="rule" className="mb-1 block text-xs font-medium text-body">
          병합 지침 <span className="font-normal text-muted-soft">(선택)</span>
        </label>
        <textarea
          id="rule"
          value={rule}
          onChange={(e) => setRule(e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-hairline px-3 py-2 text-sm leading-6"
          placeholder={'평소 말하듯 적으면 됩니다.\n예) 도서관 업무는 맨 뒤로 / 같은 회의 참석은 묶어주세요'}
        />
        <p className="mt-1 text-[11px] leading-4 text-muted-soft">
          정해진 문법이 없습니다. 병합할 때 참고용으로 함께 읽힙니다.
        </p>
      </div>

      {/* ── 작성 안내 (부서원에게 보이는 것) ── */}
      <div>
        <label htmlFor="guide" className="mb-1 block text-xs font-medium text-body">
          작성 안내 <span className="font-normal text-muted-soft">— 부서원 제출 화면에 그대로 보입니다</span>
        </label>
        <textarea
          id="guide"
          value={guide}
          onChange={(e) => setGuide(e.target.value)}
          rows={4}
          className="w-full rounded-xl border border-hairline px-3 py-2 text-sm leading-6"
          placeholder={'한 줄에 하나씩.\n예) 상시 반복 업무는 일자를 공란으로 둡니다'}
        />
      </div>

      {/* PG-26 — 절대 규칙 안내 상시 노출 */}
      <p className="rounded-xl bg-surface-soft px-3 py-2 text-[11px] leading-5 text-muted">
        표 규격 보존 · 내용 무손실 · 원본 불변은 시스템 절대 규칙입니다 — 어떤 설정으로도 바꿀 수 없습니다.
        병합은 제출된 원문 글자를 그대로 옮기며, 무엇도 새로 쓰지 않습니다.
      </p>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving || !dirty} className="btn-primary btn-sm">
          {saving ? '저장 중…' : '저장'}
        </button>
        <span aria-live="polite" className={`text-xs ${msg?.ok ? 'text-success' : 'text-error'}`}>
          {msg?.text}
        </span>
      </div>
    </div>
  );
}
