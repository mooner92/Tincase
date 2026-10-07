'use client';
// RU-51·52 — 3단계 사용 스위치와 단계 시각. 시각은 「그 주 부서 마감 + 몇 분」으로 정한다 —
// 연휴로 부서 마감이 옮겨지면(WS-19) 여기 기한도 같은 간격으로 따라간다. 날짜를 직접 적지 않는 이유다.
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const OPTIONS = [30, 60, 90, 120, 180, 240, 1440];
const label = (m: number) => (m === 1440 ? '다음 날 같은 시각' : m % 60 === 0 ? `${m / 60}시간 뒤` : `${Math.floor(m / 60) ? `${Math.floor(m / 60)}시간 ` : ''}${m % 60}분 뒤`);

export function OrgSchedulePanel({
  enabled,
  unitDueMinutes,
  hqDueMinutes,
  anchorKo,
  unitDueKo,
  hqDueKo,
  weekLabel,
}: {
  enabled: boolean;
  unitDueMinutes: number;
  hqDueMinutes: number;
  anchorKo: string;
  unitDueKo: string;
  hqDueKo: string;
  weekLabel: string;
}) {
  const router = useRouter();
  const [unit, setUnit] = useState(unitDueMinutes);
  const [hq, setHq] = useState(hqDueMinutes);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = unit !== unitDueMinutes || hq !== hqDueMinutes;

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/rollup/org/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) setErr(b.message ?? '저장하지 못했습니다.');
      else router.refresh();
    } catch {
      setErr('네트워크 오류로 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };
  const opts = (cur: number) => [...new Set([...OPTIONS, cur])].sort((a, b) => a - b);

  return (
    <section className={`card px-6 py-5 ${enabled ? '' : 'border-warning/50'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">
          단계 일정
          <span className="ml-2 text-xs font-normal text-muted">그 주 부서 마감에서 계산합니다 — 연휴로 마감을 옮기면 같이 움직입니다</span>
        </h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} disabled={busy} onChange={(e) => save({ enabled: e.target.checked })} />
          <span className={enabled ? 'font-semibold text-success' : 'font-semibold text-warning'}>{enabled ? '3단계 취합 사용 중' : '3단계 취합 꺼짐'}</span>
        </label>
      </div>
      {!enabled && (
        <p className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-ink">
          꺼져 있습니다 — 실·팀의 [제출] 카드, 본부·전사 취합 메뉴, 단계 알림이 아무에게도 보이지 않습니다. 켜는 순간 나타납니다.
        </p>
      )}
      <table className="mt-3 w-full text-sm">
        <tbody>
          <tr className="border-b border-hairline-soft">
            <td className="w-44 py-2 text-muted">부서 마감 (기준)</td>
            <td className="py-2 text-ink">{anchorKo}</td>
            <td className="py-2 text-xs text-muted">{weekLabel} · 바꾸려면 전사 현황의 「주차 마감」</td>
          </tr>
          <tr className="border-b border-hairline-soft">
            <td className="py-2 text-muted">실·팀 → 위로 제출 기한</td>
            <td className="py-2 text-ink">{unitDueKo}</td>
            <td className="py-2">
              <select value={unit} onChange={(e) => setUnit(Number(e.target.value))} className="rounded-lg border border-border-strong px-2 py-1 text-sm">
                {opts(unit).map((m) => (
                  <option key={m} value={m}>
                    부서 마감 {label(m)}
                  </option>
                ))}
              </select>
              <span className="ml-2 text-xs text-muted">본부 담당자에게 산하 제출 현황 알림</span>
            </td>
          </tr>
          <tr>
            <td className="py-2 text-muted">본부 → 총괄 제출 기한</td>
            <td className="py-2 text-ink">{hqDueKo}</td>
            <td className="py-2">
              <select value={hq} onChange={(e) => setHq(Number(e.target.value))} className="rounded-lg border border-border-strong px-2 py-1 text-sm">
                {opts(hq).map((m) => (
                  <option key={m} value={m}>
                    부서 마감 {label(m)}
                  </option>
                ))}
              </select>
              <span className="ml-2 text-xs text-muted">15분 전 본부 재촉 · 기한에 총괄 도착 알림</span>
            </td>
          </tr>
        </tbody>
      </table>
      {dirty && (
        <button onClick={() => save({ unitDueMinutes: unit, hqDueMinutes: hq })} disabled={busy} className="btn-secondary btn-sm mt-3">
          {busy ? '저장 중…' : '단계 시각 저장'}
        </button>
      )}
      {err && <p className="mt-3 rounded-lg bg-error-soft px-3 py-2 text-sm text-error">{err}</p>}
    </section>
  );
}
