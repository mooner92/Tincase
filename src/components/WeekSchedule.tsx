'use client';
// WS-19l — 「주차 일정」 카드 하나 (「전사」 화면 머리글의 [일정 바꾸기]를 누르면 펼쳐진다 — PG-51a).
//
// 예전에는 카드가 둘이었다 — 전사 현황의 「주차 마감」(WS-19)과 전사 취합의 「단계 일정」(RU-51·52).
// 둘 다 **그 주 부서 마감 하나**에서 출발하는데 화면이 갈라져 있어서, 총괄이 연휴 공지로 마감을 옮긴 뒤
// 본부 기한이 따라왔는지 보려면 다른 화면에 가야 했고, 단계 일정 카드는 「바꾸려면 전사 현황으로」라는
// 안내를 달고 있었다. 그래서 한 카드에 둔다: 주차마다 부서 마감 → 실·팀 기한 → 본부 기한이 한 줄에.
//
// 무엇을 그릴지는 서버가 정해 넘긴다(TACP-9·12):
//   canSchedule  — 마감 바꾸기·되돌리기 (TACP-20 `canScheduleDeadlines`)
//   rollup       — 3단계 스위치·단계 간격 (TACP-21 `canOpenOrgDesk`). null이면 그 부분을 그리지 않는다
//
// 마감 바꾸기: 기획조정실 공지 본문을 그대로 붙여넣으면 날짜·시각·이유를 읽는다. 바로 바꾸지 않고
// **먼저 보여 준다** — 어느 주차가 언제로 바뀌는지, 알림·병합이 언제 나가는지, 이미 지나서 안 나가는
// 알림이 무엇인지. 전 부서의 마감이 한꺼번에 움직이는 일이라 한 번 더 보는 값이 크다.
// 확인 창(confirm)은 쓰지 않는다 — 미리보기 화면 자체가 확인 단계다.
import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
  matched: string | null;
  note: string;
  schedule: { label: string; atKo: string; passed: boolean }[];
  blocked: string | null;
  warnings: string[];
}

const EXAMPLE = `★ 이번 주 주간업무 제출 기한은 10월 07(수) 오후 3시입니다. ★
(연휴 일정으로 인한 마감 기한이니 양해 부탁드립니다.)`;

export function WeekSchedule({
  weeks,
  canSchedule,
  rollup,
}: {
  weeks: WeekScheduleRow[];
  canSchedule: boolean;
  rollup: RollupScheduleSetting | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [how, setHow] = useState<'paste' | 'manual'>('paste');
  const [notice, setNotice] = useState('');
  const [external, setExternal] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [clearing, setClearing] = useState<string | null>(null);
  const stagesOn = weeks.some((w) => w.stages);

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
        setDone(`${b.plan.weekLabel} 부서 마감을 ${b.plan.departmentKo}로 바꿨습니다. 부서원 화면에 바로 보입니다.`);
        setEditing(false);
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
        setDone(`${b.label} 마감을 평소대로(${b.normalKo}) 되돌렸습니다.`);
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
    <section id="schedule" className="card scroll-mt-24">
      <div className="card-head">
        <div className="min-w-0">
          <h2 className="card-title">
            주차 일정
          </h2>
          <p className="card-desc">
            {canSchedule ? '연휴로 대외 마감이 바뀌면 여기서 바꿉니다 — ' : ''}
            {stagesOn ? '전 부서 마감과 3단계 기한이 한꺼번에 따라갑니다' : '전 부서에 한꺼번에 적용됩니다'}
          </p>
        </div>
        {canSchedule && !editing && (
          <button onClick={() => setEditing(true)} className="btn-secondary btn-sm">
            마감 바꾸기
          </button>
        )}
      </div>

      {/* 이번 주 · 다음 주 — 부서 마감 → (3단계) 실·팀 → 본부 */}
      <ul className="mt-3 space-y-1.5 text-sm">
        {weeks.map((w) => (
          <li key={w.isoKey} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="w-24 text-muted">{w.label}</span>
            <span className={w.overridden ? 'font-semibold text-error' : 'text-ink'}>부서 마감 {w.deadlineKo}</span>
            {w.stages && (
              <span className="text-body">
                <span className="text-muted">· 실·팀 제출</span> {w.stages.unitDueKo}{' '}
                <span className="text-muted">· 본부 제출</span> {w.stages.hqDueKo}
              </span>
            )}
            {w.overridden && <span className="text-xs text-muted">· {w.note}</span>}
            {canSchedule && w.overridden && !w.passed && clearing !== w.isoKey && (
              <button onClick={() => setClearing(w.isoKey)} className="text-xs text-muted underline">
                평소대로 되돌리기
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
          </li>
        ))}
      </ul>

      {done && <p className="callout mt-3 bg-success-soft text-ink">{done}</p>}
      {err && <p className="callout callout-error mt-3">{err}</p>}

      {canSchedule && editing && (
        <div className="card-section">
          <div className="flex gap-2 text-sm">
            <button
              onClick={() => setHow('paste')}
              className={how === 'paste' ? 'tab-pill tab-pill-active' : 'tab-pill'}
            >
              공지 붙여넣기
            </button>
            <button
              onClick={() => setHow('manual')}
              className={how === 'manual' ? 'tab-pill tab-pill-active' : 'tab-pill'}
            >
              직접 입력
            </button>
          </div>

          {how === 'paste' ? (
            <div className="mt-3">
              <p className="mb-1.5 text-xs text-muted">
                취합게시판(NAMS)의 작성 요청 본문을 <strong className="text-ink">그대로</strong> 붙여넣으세요.
                「제출 기한은 …」 문장에서 날짜·시각·이유를 읽습니다.
              </p>
              <textarea
                value={notice}
                onChange={(e) => setNotice(e.target.value)}
                rows={5}
                placeholder={EXAMPLE}
                className="w-full rounded-lg border border-border-strong px-3 py-2 text-sm"
              />
            </div>
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
              <span className="text-xs text-muted">부서 마감은 한 시간 앞으로 잡습니다</span>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <button
              onClick={() => post('preview')}
              disabled={busy || (how === 'paste' ? !notice.trim() : !external)}
              className="btn-primary btn-sm"
            >
              {busy ? '확인 중…' : '미리보기'}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setPlan(null);
                setErr(null);
              }}
              className="btn-secondary btn-sm"
            >
              닫기
            </button>
          </div>

          {plan && (
            <div className="callout callout-muted mt-4">
              <p className="text-ink">
                <span className="font-semibold">{plan.weekLabel}</span> 부서 마감{' '}
                {plan.beforeKo !== plan.departmentKo && (
                  <>
                    <span className="text-muted line-through">{plan.beforeKo}</span> →{' '}
                  </>
                )}
                <strong className="text-error">{plan.departmentKo}</strong>
                <span className="ml-2 text-xs text-muted">대외 마감 {plan.externalKo}</span>
              </p>
              {plan.matched && <p className="mt-1 text-xs text-muted">읽은 부분: 「{plan.matched}」</p>}
              <p className="mt-1 text-xs text-muted">부서원 화면에 보일 문구: {plan.note}</p>

              <table className="mt-3 w-full text-xs">
                <tbody>
                  {plan.schedule.map((r) => (
                    <tr key={r.label + r.atKo} className={r.passed ? 'text-muted-soft' : 'text-body'}>
                      <td className="w-40 py-0.5">{r.label}</td>
                      <td className="py-0.5 tabular-nums">{r.atKo}</td>
                      <td className="py-0.5">{r.passed ? '이미 지남 — 나가지 않음' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="mt-2 text-xs text-muted">
                부서장 승인 알림은 시각이 아니라 <strong className="text-body">승인하는 순간</strong> 담당자에게 갑니다 — 마감을 옮겨도 따로 할 일이 없습니다.
              </p>

              {plan.warnings.map((w) => (
                <p key={w} className="callout callout-warn mt-2 py-2 text-xs">
                  {w}
                </p>
              ))}
              {plan.blocked ? (
                <p className="callout callout-error mt-2 py-2 text-xs">{plan.blocked}</p>
              ) : (
                <button onClick={() => post('apply')} disabled={busy} className="btn-primary btn-sm mt-3">
                  {busy ? '적용 중…' : '이대로 적용'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {rollup && <RollupStages {...rollup} />}
    </section>
  );
}

// ── RU-51·52 — 3단계 스위치와 단계 간격 ─────────────────────────────────────
// 시각은 「그 주 부서 마감 + 몇 분」으로 정한다 — 연휴로 부서 마감이 옮겨지면(위의 마감 바꾸기) 단계 기한도
// 같은 간격으로 따라간다. 날짜를 직접 적지 않는 이유다. 계산된 시각은 위 주차 줄에 보인다.

const OPTIONS = [30, 60, 90, 120, 180, 240, 1440];
const offsetLabel = (m: number) =>
  m === 1440 ? '다음 날 같은 시각' : m % 60 === 0 ? `${m / 60}시간 뒤` : `${Math.floor(m / 60) ? `${Math.floor(m / 60)}시간 ` : ''}${m % 60}분 뒤`;

function RollupStages({ enabled, unitDueMinutes, hqDueMinutes }: RollupScheduleSetting) {
  const router = useRouter();
  const [unit, setUnit] = useState(unitDueMinutes);
  const [hq, setHq] = useState(hqDueMinutes);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** 끄기는 한 번 더 묻는다 — 끄면 총괄에게서도 이 부분이 사라지고, 다시 켜는 것은 운영자만 한다 (RU-52) */
  const [turningOff, setTurningOff] = useState(false);
  const dirty = unit !== unitDueMinutes || hq !== hqDueMinutes;

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
      else router.refresh(); // 주차 줄의 단계 기한·최종본 열·메뉴가 같이 바뀐다
    } catch {
      setErr('네트워크 오류로 저장하지 못했습니다.');
    } finally {
      setBusy(false);
      setTurningOff(false);
    }
  };
  const opts = (cur: number) => [...new Set([...OPTIONS, cur])].sort((a, b) => a - b);

  return (
    <div className="card-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          3단계 취합
          <span className="ml-2 text-xs font-normal text-muted">실·팀 → 본부 → 총괄 제출 기한 · 부서 마감에서 셉니다</span>
        </h3>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy || turningOff}
            onChange={(e) => (e.target.checked ? save({ enabled: true }) : setTurningOff(true))}
          />
          <span className={enabled ? 'font-semibold text-success' : 'font-semibold text-warning'}>
            {enabled ? '사용 중' : '꺼짐'}
          </span>
        </label>
      </div>

      {turningOff && (
        <div className="callout callout-warn mt-2 flex flex-wrap items-center gap-2">
          <span>끄면 실·팀의 [제출] 카드, 본부 취합, 「전사」의 최종본 열, 단계 알림이 모두 사라집니다. 다시 켜는 것은 운영자만 할 수 있습니다.</span>
          <button onClick={() => save({ enabled: false })} disabled={busy} className="btn-secondary btn-sm">
            끄기
          </button>
          <button onClick={() => setTurningOff(false)} className="text-xs text-muted underline">
            아니오
          </button>
        </div>
      )}
      {!enabled && (
        <p className="callout callout-warn mt-2">
          꺼져 있습니다 — 실·팀의 [제출] 카드, 본부 취합, 단계 알림이 나타나지 않고 「전사」의 최종본 열은 운영자에게만 보입니다. 켜는 순간 나타납니다.
        </p>
      )}

      <div className="mt-3 space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="w-36 text-muted">실·팀 → 위로 제출</span>
          <select
            value={unit}
            onChange={(e) => setUnit(Number(e.target.value))}
            className="rounded-lg border border-border-strong px-2 py-1 text-sm"
            aria-label="실·팀 제출 기한"
          >
            {opts(unit).map((m) => (
              <option key={m} value={m}>
                부서 마감 {offsetLabel(m)}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted">본부 담당자에게 산하 제출 현황 알림</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="w-36 text-muted">본부 → 총괄 제출</span>
          <select
            value={hq}
            onChange={(e) => setHq(Number(e.target.value))}
            className="rounded-lg border border-border-strong px-2 py-1 text-sm"
            aria-label="본부 제출 기한"
          >
            {opts(hq).map((m) => (
              <option key={m} value={m}>
                부서 마감 {offsetLabel(m)}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted">15분 전 본부 재촉 · 기한에 총괄 도착 알림</span>
        </div>
      </div>
      {dirty && (
        <button onClick={() => save({ unitDueMinutes: unit, hqDueMinutes: hq })} disabled={busy} className="btn-secondary btn-sm mt-3">
          {busy ? '저장 중…' : '단계 시각 저장'}
        </button>
      )}
      {err && <p className="callout callout-error mt-3">{err}</p>}
    </div>
  );
}
