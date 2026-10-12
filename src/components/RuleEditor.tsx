'use client';
// CP-118 — 부서 설정의 「분류 순서」 카드 (PG-74). 문법 없음 (HM-18 v3).
// 부서마다 업무가 천차만별이라 분류는 각 부서가 자기 말로 적는다. 안 적으면 제출자 순서.
//
// 2026-10-08 (R3 · R5 · S7 — ADR-0018) — 카드 둘(작성 안내 · 병합 설정의 분류·정렬·병합 동작·고급 설정)이 칸 하나가 되었다.
// 나머지는 실사용에서 바꾼 부서가 없어 엔진의 고정값이 되었다(HM-51). 칸이 하나라 저장도 칸 옆 [저장] 하나다 —
// 화면 아래에 붙어 따라오던 저장 줄은 여러 카드를 한 번에 저장하던 때의 것이다.
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

/** 서버의 parseCategories와 같은 규칙 — 입력하는 즉시 해석 결과를 보여주기 위해 (화면은 서버 모듈을 들이지 않는다) */
function preview(raw: string): string[] {
  return raw
    .split(/[,·\-–—/|]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.slice(0, 20))
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .slice(0, 12);
}

/** 눌러 들어간 입력칸 — 어디에 쓰는지 훑어서 보이게 */
const FIELD =
  'w-full rounded-lg border border-border-strong bg-canvas px-3.5 py-2.5 text-sm leading-6 text-ink ' +
  'shadow-[inset_0_1px_2px_rgba(10,10,10,0.06)] transition-colors ' +
  'placeholder:text-muted-soft focus:border-ink focus:outline-none';

export interface RuleEditorProps {
  initialCategories: string;
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

export function RuleEditor({ initialCategories, thisWeekMerged }: RuleEditorProps) {
  const [categories, setCategories] = useState(initialCategories);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  // 저장 뒤 router.refresh()가 새 값을 initialCategories로 다시 주므로 비교 기준이 저절로 따라온다
  const dirty = categories !== initialCategories;
  const parsed = useMemo(() => preview(categories), [categories]);
  // CP-108 — 문서가 바뀌는 저장인가. 「AI, 홍보」→「AI-홍보」처럼 적는 꼴만 바꾼 것은 같은 분류다 (엔진과 같은 해석)
  const docChanged = parsed.join('\n') !== preview(initialCategories).join('\n');

  // CP-81 — 저장 전 이탈 방지
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const save = () => {
    const note = savedNote(docChanged, thisWeekMerged);
    setSaving(true);
    setMsg(null);
    fetch('/api/division/rule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories }),
    })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        setMsg(r.ok ? { ok: true, text: note } : { ok: false, text: body.message ?? '저장 실패' });
        if (r.ok) router.refresh();
      })
      .catch(() => setMsg({ ok: false, text: '네트워크 오류로 저장하지 못했습니다.' }))
      .finally(() => setSaving(false));
  };

  return (
    <section data-guide="merge-settings" className="card" aria-labelledby="merge-settings">
      <h2 id="merge-settings" className="card-title">
        분류 순서
      </h2>
      <div className="mt-4 flex items-start gap-2">
        {/* CP-104 — 사용 안내의 「분류 순서」 단계는 적는 칸과 그 밑의 칩만 밝힌다 */}
        <div data-guide="merge-categories" className="min-w-0 flex-1">
          <input
            value={categories}
            onChange={(e) => {
              setCategories(e.target.value);
              setMsg(null);
            }}
            className={FIELD}
            aria-label="분류 순서"
            placeholder="예: AI-홍보-시스템"
          />
          {parsed.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              {parsed.map((c) => (
                <span key={c} className="chip chip-muted text-xs">
                  {c}
                </span>
              ))}
              <span className="chip text-xs text-muted ring-1 ring-hairline ring-inset">기타</span>
            </div>
          )}
        </div>
        <button onClick={save} disabled={saving || !dirty} className="btn-primary h-[46px] shrink-0">
          {saving ? '저장 중…' : '저장'}
        </button>
      </div>
      {/* 알림 자리는 늘 둔다 — 저장한 순간 생겨나는 자리는 화면 읽기 프로그램이 읽지 않는다. 비면 높이가 없다 */}
      <p
        aria-live="polite"
        className={`text-sm ${msg || dirty ? 'mt-3' : ''} ${msg ? (msg.ok ? 'text-success' : 'text-error') : 'text-warning'}`}
      >
        {msg?.text ?? (dirty ? '저장 안 됨' : '')}
      </p>
    </section>
  );
}
