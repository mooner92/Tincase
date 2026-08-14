'use client';
// CP-78~81 — 병합 규칙·작성 안내 편집. Phase 1은 저장만 (API-29).
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export function RuleEditor({
  initialRule,
  initialGuide,
}: {
  initialRule: string;
  initialGuide: string;
}) {
  const [rule, setRule] = useState(initialRule);
  const [guide, setGuide] = useState(initialGuide);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  const dirty = rule !== initialRule || guide !== initialGuide;

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
      body: JSON.stringify({ ruleText: rule, guideText: guide }),
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
    <div className="space-y-4">
      <div>
        <label htmlFor="guide" className="mb-1 block text-xs font-medium text-body">
          작성 안내 (부서원 업로드 화면에 표시)
        </label>
        <textarea
          id="guide"
          value={guide}
          onChange={(e) => setGuide(e.target.value)}
          rows={4}
          className="w-full rounded-xl border border-hairline px-3 py-2 font-mono text-xs leading-5"
          placeholder={'한 줄에 하나씩 적습니다.\n예) 상시 반복 업무는 일자를 공란으로 둡니다'}
        />
      </div>
      <div>
        <label htmlFor="rule" className="mb-1 block text-xs font-medium text-body">
          병합 규칙{' '}
          <span className="ml-1 rounded bg-brand-ochre/20 px-1.5 py-0.5 text-[11px] font-normal text-body-strong">
            병합 기능 준비 중 (Phase 2) — 규칙은 미리 저장해둘 수 있습니다 {/* PG-27 */}
          </span>
        </label>
        <textarea
          id="rule"
          value={rule}
          onChange={(e) => setRule(e.target.value)}
          rows={6}
          className="w-full rounded-xl border border-hairline px-3 py-2 font-mono text-xs leading-5"
          placeholder={'# 예시\n순서: 홍길동, 김철수, …\n빈행유지: 실적 8, 계획 8, 특이 4\n특이사항: 비면 표 삭제'}
        />
        {/* PG-26 — 절대 규칙 안내 상시 노출 */}
        <p className="mt-1 text-[11px] leading-4 text-muted-soft">
          표 규격 보존·내용 무손실·원본 불변은 시스템 절대 규칙입니다 — 어떤 병합 규칙으로도 바꿀 수 없습니다.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="btn-primary btn-sm"
        >
          {saving ? '저장 중…' : '저장'}
        </button>
        <span aria-live="polite" className={`text-xs ${msg?.ok ? 'text-success' : 'text-error'}`}>
          {msg?.text}
        </span>
      </div>
    </div>
  );
}
