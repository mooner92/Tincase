'use client';
// WS-19l · PG-51a — 「전사」 머리글의 마감 줄과 [일정 바꾸기]. 누르면 바로 아래에 바꾸는 칸이 열린다.
//
// 2026-10-08 (사용자: 일정 카드 단순화) — 예전에는 [일정 바꾸기]로 「주차 일정」 카드를 펼친 뒤 [마감 바꾸기]를
// 한 번 더 눌러야 입력칸이 나왔고, 카드에는 지난 주차 줄·설명 문장·알림 시각 표가 있었다. 이제는:
//   · 줄은 **다가올 주차만**(페이지가 `upcomingWeeks`로 걸러 넘긴다 — 그 주 마지막 단계 기한까지) — 지난주 몇 시에 닫혔는지는 아무도 보지 않는다
//   · [일정 바꾸기] 한 번에 붙여넣기 칸 — 미리보기는 주차 줄과 같은 꼴 한 줄 + 경고
//   · 3단계 스위치와 간격은 그 아래 한 줄. 간격은 [간격 바꾸기]를 눌렀을 때만 고르는 칸이 나온다
//
// 무엇을 그릴지는 서버가 정해 넘긴다(TACP-9·12):
//   canSchedule  — 마감 바꾸기·되돌리기 (TACP-20 `canScheduleDeadlines`)
//   rollup       — 3단계 스위치·단계 간격 (TACP-21 `canOpenOrgDesk`). null이면 그 부분을 그리지 않는다
// 둘 다 없으면 줄만 그린다.
//
// 마감 바꾸기는 바로 바꾸지 않고 **먼저 보여 준다** — 전 부서의 마감이 한꺼번에 움직이는 일이다.
// 확인 창(confirm)은 쓰지 않는다 — 미리보기 자체가 확인 단계다. 이미 지나 안 나가는 알림은 서버가 경고로 싣는다(WS-19g).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { STAGE_HQ, STAGE_UNIT } from '@/lib/rollup-stages';

export interface WeekScheduleRow {
  isoKey: string;
  label: string;
  deadlineKo: string;
  overridden: boolean;
  note: string | null;
  passed: boolean;
  /** RU-58 — 3단계를 쓸 때만. 부서 마감과 같은 날이면 시각만 */
  stages: { unitDueKo: string; hqDueKo: string } | null;
}

export interface RollupScheduleSetting {
  enabled: boolean;
  unitDueMinutes: number;
  hqDueMinutes: number;
}

interface Plan {
  isoKey: string;
  weekLabel: string;
  externalKo: string;
  departmentKo: string;
  beforeKo: string;
  note: string;
  stages: { unitDueKo: string; hqDueKo: string } | null;
  blocked: string | null;
  warnings: string[];
}

const EXAMPLE = `★ 이번 주 주간업무 제출 기한은 10월 07(수) 오후 3시입니다. ★
(연휴 일정으로 인한 마감 기한이니 양해 부탁드립니다.)`;

/** RU-59 — 「전사」 머리글·/hq·알림과 같은 이름 한 쌍 */
function Stages({ s }: { s: { unitDueKo: string; hqDueKo: string } }) {
  return (
    <>
      <span>
        · {STAGE_UNIT} <span className="text-ink">{s.unitDueKo}</span>
      </span>
      <span>
        · {STAGE_HQ} <strong className="text-ink">{s.hqDueKo}</strong>
      </span>
    </>
  );
}

export function WeekSchedule({
  weeks,
  canSchedule,
  rollup,
}: {
  /** 다가올 주차만 (이번 주가 아직 열려 있으면 이번 주, 그리고 다음 주) */
  weeks: WeekScheduleRow[];
  canSchedule: boolean;
  rollup: RollupScheduleSetting | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [how, setHow] = useState<'paste' | 'manual'>('paste');
  const [notice, setNotice] = useState('');
  const [external, setExternal] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [clearing, setClearing] = useState<string | null>(null);
  const canChange = canSchedule || !!rollup;

  const toggle = () => {
    setOpen((v) => !v);
    setPlan(null);
    setErr(null);
    setDone(null);
  };

  const post = async (mode: 'preview' | 'apply') => {
    setBusy(true);
    setErr(null);
    setDone(null);
    try {
      const r = await fetch('/api/schedule/deadline', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(how === 'paste' ? { mode, noticeText: notice } : { mode, external }),
      });
      const b = await r.json();
      if (!r.ok) {
        setErr(b.message ?? '처리하지 못했습니다.');
        if (mode === 'preview') setPlan(null);
        return;
      }
      setPlan(b.plan);
      if (mode === 'apply') {
        setDone(`${b.plan.weekLabel} 마감 → ${b.plan.departmentKo}`);
        setOpen(false);
        setPlan(null);
        setNotice('');
        setExternal('');
        router.refresh(); // 줄(부서 마감·단계 기한)은 서버가 다시 계산해 내려준다
      }
    } catch {
      setErr('네트워크 오류로 처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const clear = async (isoKey: string) => {
    setBusy(true);
    setErr(null);
    setDone(null);
    try {
      const r = await fetch(`/api/schedule/deadline?isoKey=${isoKey}`, { method: 'DELETE' });
      const b = await r.json();
      if (!r.ok) setErr(b.message ?? '되돌리지 못했습니다.');
      else {
        setDone(`${b.label} 마감 → ${b.normalKo}`);
        router.refresh();
      }
    } catch {
      setErr('네트워크 오류로 처리하지 못했습니다.');
    } finally {
      setBusy(false);
      setClearing(null);
    }
  };

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        {/* 다가올 주차 — 부서 마감 → (3단계) 실·팀 → 본부 → 총괄 */}
        <ul className="min-w-0 space-y-1 text-[15px] text-muted">
          {weeks.map((w, i) => (
            <li key={w.isoKey} className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span>{w.label}</span>
              <span>
                · 마감 <strong className={w.overridden ? 'font-semibold text-error' : 'font-semibold text-ink'}>{w.deadlineKo}</strong>
              </span>
              {w.stages && <Stages s={w.stages} />}
              {w.overridden && w.note && <span className="text-xs">· {w.note}</span>}
              {/* 부서 마감이 지난 주차(그날 단계 기한까지는 줄이 남는다)는 되돌릴 수 없다 — 서버도 409 */}
              {canSchedule && w.overridden && !w.passed && clearing !== w.isoKey && (
                <button onClick={() => setClearing(w.isoKey)} className="text-xs text-muted underline hover:text-ink">
                  평소대로
                </button>
              )}
              {clearing === w.isoKey && (
                <span className="flex items-center gap-2 text-xs">
                  <span className="text-body">평소 마감으로 되돌릴까요?</span>
                  <button onClick={() => clear(w.isoKey)} disabled={busy} className="btn-secondary btn-sm">
                    되돌리기
                  </button>
                  <button onClick={() => setClearing(null)} className="text-muted underline">
                    아니오
                  </button>
                </span>
              )}
              {/* RU-52 — 꺼져 있을 때 최종본 열을 보는 사람은 켜는 사람(운영자)뿐이다. 총괄에게는 아직 안 보인다는 것을 잊지 않게 */}
              {i === 0 && rollup && !rollup.enabled && <span className="ml-1 text-xs font-semibold text-warning">3단계 꺼짐</span>}
            </li>
          ))}
        </ul>
        {canChange && (
          <button
            type="button"
            data-guide="schedule-open"
            onClick={toggle}
            aria-expanded={open}
            aria-controls="schedule"
            className="btn-secondary btn-sm"
          >
            {open ? '일정 접기' : '일정 바꾸기'}
          </button>
        )}
      </div>

      {done && <p className="mt-2 text-sm text-success">{done}</p>}
      {err && <p className="callout callout-error mt-3">{err}</p>}

      {open && (
        <section id="schedule" aria-label="일정 바꾸기" className="card mt-4 scroll-mt-24">
          {canSchedule && (
            <>
              <div className="flex gap-2 text-sm">
                <button onClick={() => setHow('paste')} className={how === 'paste' ? 'tab-pill tab-pill-active' : 'tab-pill'}>
                  공지 붙여넣기
                </button>
                <button onClick={() => setHow('manual')} className={how === 'manual' ? 'tab-pill tab-pill-active' : 'tab-pill'}>
                  직접 입력
                </button>
              </div>

              {/* 사용 안내의 카메라 자리 — 붙여넣을 칸과 [미리보기]까지 (CP-104). 감싸기만 한다 */}
              <div data-guide="deadline-paste-box">
                {how === 'paste' ? (
                  <textarea
                    data-guide="deadline-paste"
                    aria-label="공지 본문"
                    value={notice}
                    onChange={(e) => setNotice(e.target.value)}
                    rows={4}
                    placeholder={EXAMPLE}
                    className="mt-3 w-full rounded-lg border border-border-strong px-3 py-2 text-sm"
                  />
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                    <label className="text-muted" htmlFor="external-at">
                      대외 마감
                    </label>
                    <input
                      id="external-at"
                      type="datetime-local"
                      value={external}
                      onChange={(e) => setExternal(e.target.value)}
                      className="rounded-lg border border-border-strong px-3 py-1.5"
                    />
                    <span className="text-xs text-muted">부서 마감 = 1시간 전</span>
                  </div>
                )}

                <button
                  data-guide="deadline-preview"
                  onClick={() => post('preview')}
                  disabled={busy || (how === 'paste' ? !notice.trim() : !external)}
                  className="btn-primary btn-sm mt-3"
                >
                  {busy ? '확인 중…' : '미리보기'}
                </button>
              </div>

              {plan && (
                <div data-guide="deadline-plan" className="callout callout-muted mt-4">
                  <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted">
                    <span className="font-semibold text-ink">{plan.weekLabel}</span>
                    <span>
                      · 마감{' '}
                      {plan.beforeKo !== plan.departmentKo && (
                        <>
                          <span className="line-through">{plan.beforeKo}</span> →{' '}
                        </>
                      )}
                      <strong className="text-error">{plan.departmentKo}</strong>
                    </span>
                    {plan.stages && <Stages s={plan.stages} />}
                    <span className="text-xs">(대외 마감 {plan.externalKo})</span>
                  </p>
                  <p className="mt-1 text-xs text-muted">표시 문구: {plan.note}</p>

                  {plan.warnings.map((w) => (
                    <p key={w} className="callout callout-warn mt-2 py-2 text-xs">
                      {w}
                    </p>
                  ))}
                  {plan.blocked ? (
                    <p className="callout callout-error mt-2 py-2 text-xs">{plan.blocked}</p>
                  ) : (
                    <button data-guide="deadline-apply" onClick={() => post('apply')} disabled={busy} className="btn-primary btn-sm mt-3">
                      {busy ? '적용 중…' : '이대로 적용'}
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {rollup && <RollupStages {...rollup} divided={canSchedule} />}
        </section>
      )}
    </div>
  );
}

// ── RU-51·52 — 3단계 스위치와 단계 간격 ─────────────────────────────────────
// 시각은 「그 주 부서 마감 + 몇 분」으로 정한다 — 연휴로 부서 마감이 옮겨지면(위의 마감 바꾸기) 단계 기한도
// 같은 간격으로 따라간다. 날짜를 직접 적지 않는 이유다. 계산된 시각은 위 주차 줄에 보인다.

const OPTIONS = [30, 60, 90, 120, 180, 240, 1440];
export const offsetLabel = (m: number) => {
  if (m === 1440) return '다음 날';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `+${[h ? `${h}시간` : '', r ? `${r}분` : ''].filter(Boolean).join(' ')}`;
};

function RollupStages({ enabled, unitDueMinutes, hqDueMinutes, divided }: RollupScheduleSetting & { divided: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [unit, setUnit] = useState(unitDueMinutes);
  const [hq, setHq] = useState(hqDueMinutes);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** 끄기는 한 번 더 묻는다 — 끄면 총괄에게서도 이 부분이 사라지고, 다시 켜는 것은 운영자만 한다 (RU-52) */
  const [turningOff, setTurningOff] = useState(false);

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/rollup/org/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) setErr(b.message ?? '저장하지 못했습니다.');
      else {
        setEditing(false);
        router.refresh(); // 주차 줄의 단계 기한·최종본 열·메뉴가 같이 바뀐다
      }
    } catch {
      setErr('네트워크 오류로 저장하지 못했습니다.');
    } finally {
      setBusy(false);
      setTurningOff(false);
    }
  };
  const opts = (cur: number) => [...new Set([...OPTIONS, cur])].sort((a, b) => a - b);
  const pick = (label: string, value: number, set: (m: number) => void) => (
    <select
      value={value}
      onChange={(e) => set(Number(e.target.value))}
      className="rounded-lg border border-border-strong px-2 py-1 text-sm"
      aria-label={`${label} 기한`}
    >
      {opts(value).map((m) => (
        <option key={m} value={m}>
          {offsetLabel(m)}
        </option>
      ))}
    </select>
  );

  return (
    <div className={divided ? 'card-section' : undefined}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span className="font-semibold text-ink">3단계 취합</span>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy || turningOff}
            onChange={(e) => (e.target.checked ? save({ enabled: true }) : setTurningOff(true))}
          />
          <span className={enabled ? 'font-semibold text-success' : 'font-semibold text-warning'}>{enabled ? '켜짐' : '꺼짐'}</span>
        </label>
        {editing ? (
          <>
            {/* 이름과 고르는 칸은 함께 줄바꿈 — 좁은 화면에서 「+1시간 · 본부 → 총괄」로 짝이 어긋나 읽히지 않게 */}
            <span className="flex items-center gap-1.5">
              <span className="text-muted">· {STAGE_UNIT}</span>
              {pick(STAGE_UNIT, unit, setUnit)}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-muted">· {STAGE_HQ}</span>
              {pick(STAGE_HQ, hq, setHq)}
            </span>
            <button
              onClick={() => save({ unitDueMinutes: unit, hqDueMinutes: hq })}
              disabled={busy || (unit === unitDueMinutes && hq === hqDueMinutes)}
              className="btn-secondary btn-sm"
            >
              {busy ? '저장 중…' : '저장'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-xs text-muted underline"
            >
              취소
            </button>
          </>
        ) : (
          <>
            <span className="text-muted">
              · {STAGE_UNIT} {offsetLabel(unitDueMinutes)} · {STAGE_HQ} {offsetLabel(hqDueMinutes)}
            </span>
            <button
              onClick={() => {
                setUnit(unitDueMinutes);
                setHq(hqDueMinutes);
                setEditing(true);
              }}
              className="text-xs text-muted underline hover:text-ink"
            >
              간격 바꾸기
            </button>
          </>
        )}
      </div>

      {turningOff && (
        <div className="callout callout-warn mt-2 flex flex-wrap items-center gap-2">
          <span>끄면 단계 제출·최종본 열이 사라집니다</span>
          <button onClick={() => save({ enabled: false })} disabled={busy} className="btn-secondary btn-sm">
            끄기
          </button>
          <button onClick={() => setTurningOff(false)} className="text-xs text-muted underline">
            아니오
          </button>
        </div>
      )}
      {err && <p className="callout callout-error mt-3">{err}</p>}
    </div>
  );
}
