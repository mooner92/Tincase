'use client';
// WS-19 · TACP-20 — 주차 마감 예외를 **총괄이** 정한다 (전사 현황 위쪽).
//
// 기획조정실 공지 본문을 그대로 붙여넣으면 날짜·시각·이유를 읽는다. 바로 바꾸지 않고
// **먼저 보여 준다** — 어느 주차가 언제로 바뀌는지, 알림·병합이 언제 나가는지, 이미 지나서
// 안 나가는 알림이 무엇인지. 전 부서의 마감이 한꺼번에 움직이는 일이라 한 번 더 보는 값이 크다.
//
// 확인 창(confirm)은 쓰지 않는다 — 미리보기 화면 자체가 확인 단계다.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface WeekRow {
  isoKey: string;
  label: string;
  deadlineKo: string;
  overridden: boolean;
  note: string | null;
  passed: boolean;
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

export function DeadlineScheduler() {
  const router = useRouter();
  const [weeks, setWeeks] = useState<WeekRow[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [how, setHow] = useState<'paste' | 'manual'>('paste');
  const [notice, setNotice] = useState('');
  const [external, setExternal] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [clearing, setClearing] = useState<string | null>(null);

  const load = () =>
    fetch('/api/schedule/deadline')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((b: { weeks: WeekRow[] }) => setWeeks(b.weeks))
      .catch(() => setErr('마감 상태를 불러오지 못했습니다.'));
  useEffect(() => {
    load();
  }, []);

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
        await load();
        router.refresh();
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
        await load();
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
    <section className="card mb-6 px-6 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">
          주차 마감
          <span className="ml-2 text-xs font-normal text-muted">
            연휴로 대외 마감이 바뀌면 여기서 바꿉니다 — 전 부서에 한꺼번에 적용됩니다
          </span>
        </h2>
        {!editing && (
          <button onClick={() => setEditing(true)} className="btn-secondary btn-sm">
            마감 바꾸기
          </button>
        )}
      </div>

      {/* 이번 주 · 다음 주 */}
      <ul className="mt-3 space-y-1.5 text-sm">
        {(weeks ?? []).map((w) => (
          <li key={w.isoKey} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="w-24 text-muted">{w.label}</span>
            <span className={w.overridden ? 'font-semibold text-error' : 'text-ink'}>부서 마감 {w.deadlineKo}</span>
            {w.overridden && <span className="text-xs text-muted">· {w.note}</span>}
            {w.overridden && !w.passed && clearing !== w.isoKey && (
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

      {done && <p className="mt-3 rounded-lg bg-brand-soft px-3 py-2 text-sm text-ink">{done}</p>}
      {err && <p className="mt-3 rounded-lg bg-error-soft px-3 py-2 text-sm text-error">{err}</p>}

      {editing && (
        <div className="mt-4 border-t border-hairline-soft pt-4">
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
            <div className="mt-4 rounded-xl border border-hairline px-4 py-3 text-sm">
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

              {plan.warnings.map((w) => (
                <p key={w} className="mt-2 rounded-lg bg-warning-soft px-3 py-1.5 text-xs text-ink">
                  {w}
                </p>
              ))}
              {plan.blocked ? (
                <p className="mt-2 rounded-lg bg-error-soft px-3 py-1.5 text-xs text-error">{plan.blocked}</p>
              ) : (
                <button onClick={() => post('apply')} disabled={busy} className="btn-primary btn-sm mt-3">
                  {busy ? '적용 중…' : '이대로 적용'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
