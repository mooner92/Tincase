'use client';
// 전사 제출 현황 — 조직도 한 장 (운영자·총괄 전용).
//
// 목요일 14시에 "누가 냈고 어디가 비었나"를 한눈에. 표로 보면 30개 부서 × 337명이라
// 스크롤을 내리며 세야 하지만, 조직도는 **비어 있는 쪽이 눈에 먼저 띈다.**
//
// 제출한 사람 → 부서 담당자 간선을 초록으로 흐르게 하는 이유는 장식이 아니다:
// 문서가 실제로 담당자에게 도착했다는 사실을 그림 하나로 말한다.
import { useMemo, useState } from 'react';
import type { OrgLayout, LaidOutDivision, LaidOutPerson } from '@/lib/orgtree';
import { bundledPath } from '@/lib/orgtree';

const SIZE = 1000; // viewBox — 실제 크기는 CSS가 정한다
const R = { parent: 150, division: 275, person: 420 };

type Focus = { kind: 'division'; d: LaidOutDivision } | { kind: 'person'; p: LaidOutPerson; d: LaidOutDivision } | null;

export function OrgMonitor({ layout, weekLabel, capturedAtKst }: { layout: OrgLayout; weekLabel: string; capturedAtKst: string }) {
  const [focus, setFocus] = useState<Focus>(null);
  const [showMissing, setShowMissing] = useState(false);

  const pct = layout.totals.roster > 0 ? Math.round((layout.totals.submitted / layout.totals.roster) * 100) : 0;

  const missingByDivision = useMemo(
    () =>
      layout.divisions
        .filter((d) => d.isActive && d.roster > d.submitted)
        .map((d) => ({ name: d.name, missing: d.laidOut.filter((p) => p.onRoster && !p.submitted).map((p) => p.name) })),
    [layout.divisions],
  );

  return (
    <div className="space-y-4">
      {/* 요약 */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">전사 제출 현황 · {weekLabel}</p>
          <p className="display mt-1 text-[40px] leading-none">
            {layout.totals.submitted}
            <span className="text-[24px] text-muted"> / {layout.totals.roster}</span>
            <span className="ml-3 text-[20px] text-muted-soft">{pct}%</span>
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="badge-pill bg-surface-card">
            부서 {layout.totals.activeDivisions} / {layout.totals.divisions} 사용 중
          </span>
          <button onClick={() => setShowMissing((v) => !v)} className="tab-pill">
            {showMissing ? '조직도 보기' : `미제출 ${layout.totals.roster - layout.totals.submitted}명 목록`}
          </button>
          <span className="text-muted-soft">{capturedAtKst}</span>
        </div>
      </div>

      {showMissing ? (
        <section className="card px-6 py-5">
          {missingByDivision.length === 0 ? (
            <p className="text-sm text-body">미제출자가 없습니다.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {missingByDivision.map((d) => (
                <li key={d.name} className="flex flex-wrap gap-x-3 gap-y-1">
                  <span className="min-w-40 font-medium text-ink">{d.name}</span>
                  <span className="text-body">{d.missing.join(', ')}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="card overflow-hidden bg-brand-teal">
          <svg
            viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`}
            className="h-auto w-full"
            role="img"
            aria-label={`조직도 제출 현황 — ${layout.totals.submitted}/${layout.totals.roster}명 제출`}
          >
            <defs>
              {/* 제출 간선이 흐르는 그라데이션 — 문서가 담당자에게 도착하는 방향 */}
              <linearGradient id="flow" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#a4d4c5" stopOpacity="0.15" />
                <stop offset="50%" stopColor="#4ade80" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#a4d4c5" stopOpacity="0.15" />
                <animate attributeName="x1" values="-1;1" dur="3s" repeatCount="indefinite" />
                <animate attributeName="x2" values="0;2" dur="3s" repeatCount="indefinite" />
              </linearGradient>
              <radialGradient id="core">
                <stop offset="0%" stopColor="#d08a2c" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#d08a2c" stopOpacity="0.1" />
              </radialGradient>
            </defs>

            {/* 본부 → 실 */}
            {layout.parents.map((p) =>
              p.divisions.map((d) => (
                <path
                  key={`pd-${d.id}`}
                  d={bundledPath(p.angle, R.parent, d.angle, R.division)}
                  fill="none"
                  stroke="#ffffff"
                  strokeOpacity={d.isActive ? 0.28 : 0.1}
                  strokeWidth={1.2}
                />
              )),
            )}

            {/* 실 → 사람. 제출한 사람만 초록으로 흐른다 */}
            {layout.divisions.map((d) =>
              d.laidOut.map((p) => {
                const dim = focus && !isRelated(focus, d, p);
                if (p.submitted) {
                  return (
                    <path
                      key={`dp-${p.id}`}
                      d={bundledPath(d.angle, R.division, p.angle, R.person)}
                      fill="none"
                      stroke="url(#flow)"
                      strokeWidth={dim ? 1 : 2}
                      strokeOpacity={dim ? 0.2 : 1}
                    />
                  );
                }
                return (
                  <path
                    key={`dp-${p.id}`}
                    d={bundledPath(d.angle, R.division, p.angle, R.person)}
                    fill="none"
                    stroke="#ffffff"
                    strokeOpacity={dim ? 0.05 : p.onRoster ? 0.16 : 0.07}
                    strokeWidth={1}
                    strokeDasharray={p.onRoster ? undefined : '2 4'}
                  />
                );
              }),
            )}

            {/* 중심 */}
            <circle r={54} fill="url(#core)" />
            <text textAnchor="middle" dy="-2" className="fill-white text-[15px] font-bold">
              한국환경연구원
            </text>
            <text textAnchor="middle" dy="16" className="fill-white/70 text-[12px]">
              {pct}%
            </text>

            {/* 본부 */}
            {layout.parents.map((p) => (
              <g key={p.name}>
                <circle cx={p.x} cy={p.y} r={5} fill="#ffb084" />
                <text
                  x={p.x}
                  y={p.y}
                  dy={p.y < 0 ? -12 : 18}
                  textAnchor="middle"
                  className="fill-white/85 text-[11px] font-semibold"
                >
                  {p.name === '한국환경연구원' ? '본부 직속' : p.name.replace('연구본부', '')}
                </text>
              </g>
            ))}

            {/* 실 — 완료율만큼 채워진 고리 */}
            {layout.divisions.map((d) => {
              const done = d.roster > 0 && d.submitted === d.roster;
              const dim = focus && focus.kind === 'division' && focus.d.id !== d.id;
              return (
                <g
                  key={d.id}
                  onMouseEnter={() => setFocus({ kind: 'division', d })}
                  onMouseLeave={() => setFocus(null)}
                  className="cursor-pointer"
                >
                  <circle
                    cx={d.x}
                    cy={d.y}
                    r={done ? 7 : 6}
                    fill={done ? '#4ade80' : d.submitted > 0 ? '#e8b94a' : d.isActive ? '#ffffff' : '#ffffff'}
                    fillOpacity={dim ? 0.25 : d.isActive ? 1 : 0.25}
                    stroke={done ? '#4ade80' : 'none'}
                    strokeOpacity={0.35}
                    strokeWidth={5}
                  />
                  {/* 이름은 반지름 방향으로 눕힌다 — 30개를 가로로 쓰면 서로 겹친다.
                      왼쪽 반원은 180도 뒤집어야 글자가 거꾸로 서지 않는다 */}
                  <text
                    transform={`rotate(${labelDeg(d.angle)} ${d.x} ${d.y}) translate(${d.x} ${d.y})`}
                    x={isLeftHalf(d.angle) ? -12 : 12}
                    textAnchor={isLeftHalf(d.angle) ? 'end' : 'start'}
                    dy="3"
                    className="text-[9.5px]"
                    fill="#ffffff"
                    fillOpacity={dim ? 0.25 : d.isActive || d.submitted > 0 ? 0.85 : 0.35}
                  >
                    {d.name}
                  </text>
                </g>
              );
            })}

            {/* 사람 */}
            {layout.people.map((p) => {
              const d = layout.divisions.find((x) => x.laidOut.includes(p))!;
              const dim = focus && !isRelated(focus, d, p);
              return (
                <circle
                  key={p.id}
                  cx={p.x}
                  cy={p.y}
                  r={p.isLead ? 4.5 : 3}
                  fill={p.submitted ? '#4ade80' : p.onRoster ? '#ffffff' : '#ffffff'}
                  fillOpacity={dim ? 0.15 : p.submitted ? 1 : p.onRoster ? 0.45 : 0.15}
                  stroke={p.isLead ? '#ffb084' : 'none'}
                  strokeWidth={1.5}
                  onMouseEnter={() => setFocus({ kind: 'person', p, d })}
                  onMouseLeave={() => setFocus(null)}
                  className="cursor-pointer"
                >
                  <title>
                    {`${d.name} · ${p.name}${p.isLead ? ' (담당자)' : ''}\n${
                      p.submitted ? `제출 ${p.submittedAtKst}` : p.onRoster ? '미제출' : '제출 대상 아님'
                    }`}
                  </title>
                </circle>
              );
            })}
          </svg>

          {/* 범례 + 초점 정보 */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-6 py-3 text-[11px] text-white/70">
            <div className="flex flex-wrap items-center gap-4">
              <Legend color="#4ade80" label="제출" />
              <Legend color="#ffffff" opacity={0.45} label="미제출" />
              <Legend color="#ffffff" opacity={0.15} label="제출 대상 아님" />
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full border-[1.5px] border-[#ffb084]" />
                부서 담당자
              </span>
            </div>
            <span className="font-medium text-white">
              {focus?.kind === 'division'
                ? `${focus.d.name} — ${focus.d.submitted}/${focus.d.roster}`
                : focus?.kind === 'person'
                  ? `${focus.d.name} · ${focus.p.name} — ${focus.p.submitted ? focus.p.submittedAtKst : '미제출'}`
                  : '점 위에 올리면 상세가 보입니다'}
            </span>
          </div>
        </section>
      )}
    </div>
  );
}

/** 반지름 방향으로 눕히기 위한 각도(도). 왼쪽 반원은 뒤집는다 */
function labelDeg(angle: number): number {
  const deg = (angle * 180) / Math.PI - 90;
  return isLeftHalf(angle) ? deg + 180 : deg;
}
function isLeftHalf(angle: number): boolean {
  const a = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return a > Math.PI;
}

function isRelated(focus: NonNullable<Focus>, d: LaidOutDivision, p: LaidOutPerson): boolean {
  return focus.kind === 'division' ? focus.d.id === d.id : focus.d.id === d.id && (focus.p.id === p.id || true);
}

function Legend({ color, label, opacity = 1 }: { color: string; label: string; opacity?: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color, opacity }} />
      {label}
    </span>
  );
}
