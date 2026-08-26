'use client';
// RS-15 — 인원 최신화 화면. ERP 엑셀을 올리면 **무엇이 바뀌는지 먼저 보여준다.**
//
// 매주 하는 일이라 몇 년 간다. 그래서 화면에 둔다 — 스크립트로 두면 그걸 돌릴 수 있는
// 사람이 있을 때만 굴러간다.
//
// 화면의 규칙 하나: **[반영]은 미리보기를 본 뒤에만 눌린다.** 파일을 고르자마자 반영되는
// 버튼은 없다. 잘못 뽑은 엑셀은 겉보기에 멀쩡하므로, 사람이 «31건 바뀝니다»를 읽는
// 순간이 유일한 안전장치다.
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Change {
  kind: string;
  name: string;
  detail: string;
}
interface Plan {
  totalRows: number;
  changes: Change[];
  /** 기록용 채움 — 개수만 보여준다 (RS-16) */
  backfills: Change[];
  newDivisions: { nameKo: string; parentKo: string }[];
  leadWarnings: string[];
  conflicts: string[];
  blockers: string[];
  unchanged: number;
  applied: { created: number; updated: number; deactivated: number; divisionsCreated: number } | null;
  needPassword?: { name: string; email: string; division: string }[];
}

const KIND_LABEL: Record<string, string> = {
  create: '신규',
  move: '부서이동',
  title: '직책',
  rename: '이름',
  employeeNo: '사번',
  deactivate: '퇴사',
  reactivate: '복귀',
};

/** 퇴사는 되돌리기 번거로우므로 눈에 띄어야 한다 */
const KIND_STYLE: Record<string, string> = {
  create: 'bg-brand-soft text-ink',
  deactivate: 'bg-error-soft text-error',
};

export function RosterSync() {
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const send = async (mode: 'preview' | 'apply') => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    const body = new FormData();
    body.append('file', file);
    body.append('mode', mode);
    try {
      const res = await fetch('/api/ops/roster/sync', { method: 'POST', body });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.message ?? '처리하지 못했습니다.');
      setPlan(j as Plan);
      if (mode === 'apply') router.refresh();
    } catch (e) {
      setErr((e as Error).message);
      if (mode === 'apply') setPlan(null); // 실패한 계획을 그대로 두면 또 누르게 된다
    } finally {
      setBusy(false);
    }
  };

  const deactivations = plan?.changes.filter((c) => c.kind === 'deactivate').length ?? 0;
  const canApply =
    plan && !plan.applied && plan.blockers.length === 0 && plan.changes.length + plan.backfills.length > 0;

  return (
    <section className="card px-6 py-5">
      <h2 className="display text-lg">인원 최신화</h2>
      <p className="mt-1 max-w-[70ch] text-sm text-body">
        ERP에서 <strong className="font-medium text-ink">부서별 인원 현황</strong>을 엑셀로 내려받아 올리면
        실별 인원을 맞춥니다. <strong className="font-medium text-ink">담당자·집계 여부·알림 설정·비밀번호는
        그대로 둡니다</strong> — 사람이 정한 값은 엑셀이 덮지 않습니다.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setPlan(null); // 파일이 바뀌면 앞의 계획은 더 이상 그 파일의 것이 아니다
            setErr(null);
          }}
          className="text-sm text-body file:mr-3 file:rounded-lg file:border file:border-hairline file:bg-canvas file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:border-ink"
        />
        <button onClick={() => send('preview')} disabled={!file || busy} className="btn-secondary btn-sm">
          {busy ? '읽는 중…' : '무엇이 바뀌는지 보기'}
        </button>
        {canApply && (
          <button
            onClick={() => {
              const msg =
                deactivations > 0
                  ? `${plan!.changes.length}건을 반영합니다.\n\n비활성 처리 ${deactivations}명이 포함되어 있습니다. 계속할까요?`
                  : `${plan!.changes.length}건을 반영합니다. 계속할까요?`;
              if (confirm(msg)) send('apply');
            }}
            disabled={busy}
            className="btn-primary btn-sm"
          >
            반영하기
          </button>
        )}
      </div>

      {err && <p className="mt-3 rounded-lg bg-error-soft px-3 py-2 text-sm text-error">{err}</p>}

      {plan && (
        <div className="mt-5 space-y-3">
          {plan.applied ? (
            <p className="rounded-lg bg-brand-soft px-4 py-3 text-sm text-ink">
              <strong className="font-semibold">반영 완료</strong> — 신규 {plan.applied.created} · 수정{' '}
              {plan.applied.updated} · 비활성 {plan.applied.deactivated}
              {plan.applied.divisionsCreated > 0 && ` · 새 부서 ${plan.applied.divisionsCreated}`}
            </p>
          ) : (
            <p className="text-sm text-body">
              엑셀 {plan.totalRows}명 · <strong className="font-semibold text-ink">변경 {plan.changes.length}건</strong> ·
              그대로 {plan.unchanged}명
              {plan.backfills.length > 0 && (
                <span className="text-muted"> · 직책 기록 {plan.backfills.length}건</span>
              )}
              {plan.changes.length === 0 && plan.backfills.length === 0 && ' — 바꿀 것이 없습니다.'}
            </p>
          )}

          {/* 막힌 이유는 가장 먼저 보여야 한다 */}
          {plan.blockers.map((b, i) => (
            <p key={i} className="rounded-lg border border-error/40 bg-error-soft px-4 py-3 text-sm text-error">
              ✋ {b}
            </p>
          ))}

          {/* 담당자 소실 — 조용히 넘어가면 그 부서가 무주공산이 된다 (RS-10) */}
          {plan.leadWarnings.map((w, i) => (
            <p key={i} className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-body">
              ⚠ {w}
            </p>
          ))}

          {plan.conflicts.map((c, i) => (
            <p key={i} className="rounded-lg bg-surface-soft px-4 py-2 text-sm text-body">
              {c}
            </p>
          ))}

          {plan.newDivisions.length > 0 && (
            <p className="text-sm text-body">
              새 부서 {plan.newDivisions.length}개 — {plan.newDivisions.map((d) => d.nameKo).join(', ')}
              <span className="ml-1 text-muted-soft">(비활성 상태로 만들어집니다)</span>
            </p>
          )}

          {plan.changes.length > 0 && (
            <div className="max-h-80 overflow-y-auto rounded-xl border border-hairline">
              <table className="w-full text-sm">
                <tbody>
                  {plan.changes.map((c, i) => (
                    <tr key={i} className="border-b border-hairline-soft last:border-0">
                      <td className="w-20 px-3 py-1.5 align-top">
                        <span className={`badge-pill py-0 text-[11px] ${KIND_STYLE[c.kind] ?? 'bg-surface-card text-body'}`}>
                          {KIND_LABEL[c.kind] ?? c.kind}
                        </span>
                      </td>
                      <td className="w-24 px-3 py-1.5 align-top font-medium text-ink">{c.name}</td>
                      <td className="px-3 py-1.5 align-top text-body">{c.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {plan.needPassword && plan.needPassword.length > 0 && (
            <div className="rounded-xl border border-hairline bg-surface-soft px-4 py-3 text-sm">
              <p className="font-medium text-ink">비밀번호 발급이 필요한 사람 {plan.needPassword.length}명</p>
              <p className="mt-0.5 text-muted">
                {plan.needPassword.map((u) => `${u.division} ${u.name}`).join(', ')}
              </p>
              <p className="mt-1 text-[11px] text-muted-soft">
                비밀번호는 개인별로 전달해야 하므로 여기서 만들지 않습니다 — 위 [비밀번호 발급]에서 진행하세요.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
