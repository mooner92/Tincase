// OPS-30 — 주차 감사 문서. 마감 시점의 제출 사실을 **한 파일로 고정**한다.
//
// 왜 별도 문서인가: 화면은 계속 변한다(다음 주차가 열리고, 명단이 바뀌고, 재제출이 쌓인다).
// "그때 누가 냈는가"를 나중에 증명하려면 그 시점의 사실이 파일로 남아야 한다.
//
// 형식을 둘로 나눈 이유:
//   HTML  사람이 읽고 그대로 인쇄(→PDF)해서 보관하는 것. 그림이 들어가야 한다
//   CSV   엑셀에서 걸러 보고 세는 것. 그림은 필요 없고 행이 필요하다
// 하나로 합치면 둘 다 어정쩡해진다.

import type { OrgLayout } from '@/lib/orgtree';
import { bundledPath, RADII } from '@/lib/orgtree';

export interface ReportMeta {
  weekLabel: string;
  isoKey: string;
  deadlineKst: string;
  capturedAtKst: string;
  capturedBy: string;
}

/** 엑셀이 UTF-8로 알아보게 BOM을 붙인다 (실제로 겪은 문제 — 없으면 한글이 깨진다) */
export function reportCsv(layout: OrgLayout, meta: ReportMeta): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows: string[] = [
    ['본부', '부서', '이름', '역할', '제출대상', '제출여부', '제출시각'].map(esc).join(','),
  ];
  for (const d of layout.divisions) {
    for (const p of d.laidOut) {
      rows.push(
        [
          d.parent,
          d.name,
          p.name,
          p.isLead ? '부서담당자' : '제출자',
          p.onRoster ? 'Y' : 'N',
          p.submitted ? 'Y' : 'N',
          p.submittedAtKst ?? '',
        ]
          .map(esc)
          .join(','),
      );
    }
  }
  const header = [
    `# 한국환경연구원 주간 업무일지 제출 현황`,
    `# ${meta.weekLabel} (${meta.isoKey}) · 마감 ${meta.deadlineKst}`,
    `# 기준 ${meta.capturedAtKst} · 출력 ${meta.capturedBy}`,
    `# 제출 ${layout.totals.submitted} / 대상 ${layout.totals.roster}`,
    '',
  ].join('\n');
  return '﻿' + header + rows.join('\n') + '\n';
}

/** 조직도를 정적 SVG로. 화면 컴포넌트와 달리 애니메이션·상호작용이 없다 (인쇄물이므로) */
function orgSvg(layout: OrgLayout): string {
  const S = 1000;
  const parts: string[] = [];

  for (const parent of layout.parents) {
    for (const d of parent.divisions) {
      parts.push(
        `<path d="${bundledPath(parent.angle, RADII.parent, d.angle, RADII.division)}" fill="none" stroke="#1a3a3a" stroke-opacity="${d.isActive ? 0.45 : 0.15}" stroke-width="1.2"/>`,
      );
    }
  }
  for (const d of layout.divisions) {
    for (const p of d.laidOut) {
      const path = bundledPath(d.angle, RADII.division, p.angle, RADII.person);
      parts.push(
        p.submitted
          ? `<path d="${path}" fill="none" stroke="#16a34a" stroke-opacity="0.85" stroke-width="1.6"/>`
          : `<path d="${path}" fill="none" stroke="#1a3a3a" stroke-opacity="${p.onRoster ? 0.22 : 0.08}" stroke-width="1"${p.onRoster ? '' : ' stroke-dasharray="2 4"'}/>`,
      );
    }
  }
  parts.push(`<circle r="52" fill="#f5f0e0" stroke="#d08a2c" stroke-width="2"/>`);
  parts.push(
    `<text text-anchor="middle" dy="-2" font-size="14" font-weight="700" fill="#0a0a0a">한국환경연구원</text>`,
    `<text text-anchor="middle" dy="16" font-size="12" fill="#6a6a6a">${layout.totals.submitted}/${layout.totals.roster}</text>`,
  );
  for (const p of layout.parents) {
    parts.push(
      `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="#d08a2c"/>`,
      `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" dy="${p.y < 0 ? -12 : 18}" text-anchor="middle" font-size="11" font-weight="600" fill="#1a1a1a">${esc(p.name === '한국환경연구원' ? '본부 직속' : p.name)}</text>`,
    );
  }
  for (const d of layout.divisions) {
    const done = d.roster > 0 && d.submitted === d.roster;
    const deg = (d.angle * 180) / Math.PI - 90;
    const left = ((d.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) > Math.PI;
    parts.push(
      `<circle cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="6" fill="${done ? '#16a34a' : d.submitted > 0 ? '#e8b94a' : '#ffffff'}" stroke="#1a3a3a" stroke-width="1"/>`,
      `<text transform="rotate(${(left ? deg + 180 : deg).toFixed(1)} ${d.x.toFixed(1)} ${d.y.toFixed(1)}) translate(${d.x.toFixed(1)} ${d.y.toFixed(1)})" x="${left ? -12 : 12}" text-anchor="${left ? 'end' : 'start'}" dy="3" font-size="9.5" fill="#3a3a3a">${esc(d.name)}</text>`,
    );
  }
  for (const d of layout.divisions) {
    for (const p of d.laidOut) {
      parts.push(
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.isLead ? 4 : 2.8}" fill="${p.submitted ? '#16a34a' : '#ffffff'}" stroke="${p.isLead ? '#d08a2c' : '#1a3a3a'}" stroke-width="${p.isLead ? 1.5 : 0.6}" stroke-opacity="${p.onRoster ? 1 : 0.3}"/>`,
      );
    }
  }
  return `<svg viewBox="${-S / 2} ${-S / 2} ${S} ${S}" xmlns="http://www.w3.org/2000/svg" width="900" height="900">${parts.join('')}</svg>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function reportHtml(layout: OrgLayout, meta: ReportMeta): string {
  const byParent = new Map<string, typeof layout.divisions>();
  for (const d of layout.divisions) {
    const list = byParent.get(d.parent);
    if (list) list.push(d);
    else byParent.set(d.parent, [d]);
  }

  const divRows = layout.divisions
    .map((d) => {
      const done = d.roster > 0 && d.submitted === d.roster;
      const missing = d.laidOut.filter((p) => p.onRoster && !p.submitted).map((p) => p.name);
      return `<tr class="${d.isActive ? '' : 'off'}">
        <td>${esc(d.parent === '한국환경연구원' ? '본부 직속' : d.parent)}</td>
        <td><b>${esc(d.name)}</b></td>
        <td class="num ${done ? 'ok' : d.submitted > 0 ? 'part' : ''}">${d.submitted} / ${d.roster}</td>
        <td>${d.isActive ? (done ? '완료' : '진행') : '미사용'}</td>
        <td class="miss">${esc(missing.join(', '))}</td>
      </tr>`;
    })
    .join('');

  const personRows = layout.divisions
    .flatMap((d) =>
      d.laidOut.map(
        (p) => `<tr class="${p.submitted ? 'y' : p.onRoster ? 'n' : 'off'}">
          <td>${esc(d.name)}</td>
          <td>${esc(p.name)}${p.isLead ? ' <span class="tag">담당</span>' : ''}</td>
          <td>${p.onRoster ? 'Y' : '—'}</td>
          <td>${p.submitted ? 'Y' : p.onRoster ? 'N' : '—'}</td>
          <td>${esc(p.submittedAtKst ?? '')}</td>
        </tr>`,
      ),
    )
    .join('');

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>주간 업무일지 제출 현황 — ${esc(meta.weekLabel)}</title>
<style>
  :root { --ink:#0a0a0a; --body:#3a3a3a; --muted:#6a6a6a; --line:#e5e5e5; }
  * { box-sizing: border-box; }
  body { margin:0; padding:32px; background:#fffaf0; color:var(--ink);
         font-family:"Pretendard","Malgun Gothic","Apple SD Gothic Neo",sans-serif; font-size:13px; line-height:1.6; }
  .wrap { max-width:1000px; margin:0 auto; }
  h1 { font-size:22px; margin:0 0 4px; }
  h2 { font-size:15px; margin:32px 0 10px; padding-bottom:6px; border-bottom:1px solid var(--line); }
  .meta { color:var(--muted); font-size:12px; }
  .big { font-size:38px; font-weight:700; margin:14px 0 0; }
  .big span { font-size:20px; color:var(--muted); font-weight:400; }
  figure { margin:20px 0; text-align:center; }
  svg { max-width:100%; height:auto; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th { text-align:left; font-weight:600; color:var(--muted); border-bottom:1px solid var(--line); padding:6px 8px; }
  td { padding:5px 8px; border-bottom:1px solid #f0f0f0; vertical-align:top; }
  .num { font-variant-numeric:tabular-nums; white-space:nowrap; }
  .ok { color:#15803d; font-weight:600; }
  .part { color:#a16207; font-weight:600; }
  .off td { color:#9a9a9a; }
  .miss { color:#b91c1c; }
  .tag { font-size:10px; background:#f5f0e0; border-radius:3px; padding:0 4px; color:var(--body); }
  tr.n td:nth-child(4) { color:#b91c1c; font-weight:600; }
  tr.y td:nth-child(4) { color:#15803d; font-weight:600; }
  .legend { color:var(--muted); font-size:11px; margin-top:6px; }
  footer { margin-top:36px; padding-top:12px; border-top:1px solid var(--line); color:var(--muted); font-size:11px; }
  @media print {
    body { background:#fff; padding:0; }
    h2 { page-break-after:avoid; }
    tr { page-break-inside:avoid; }
  }
</style></head>
<body><div class="wrap">
  <h1>주간 업무일지 제출 현황</h1>
  <p class="meta">${esc(meta.weekLabel)} (${esc(meta.isoKey)}) · 마감 ${esc(meta.deadlineKst)}</p>
  <p class="big">${layout.totals.submitted}<span> / ${layout.totals.roster}명</span></p>

  <figure>${orgSvg(layout)}
    <figcaption class="legend">
      초록 = 제출 · 회색 = 미제출 · 점선 = 제출 대상 아님 · 주황 테두리 = 부서담당자
    </figcaption>
  </figure>

  <h2>부서별</h2>
  <table><thead><tr><th>본부</th><th>부서</th><th>제출</th><th>상태</th><th>미제출자</th></tr></thead>
  <tbody>${divRows}</tbody></table>

  <h2>개인별</h2>
  <table><thead><tr><th>부서</th><th>이름</th><th>제출대상</th><th>제출</th><th>제출시각</th></tr></thead>
  <tbody>${personRows}</tbody></table>

  <footer>
    ${esc(meta.capturedAtKst)} 기준 · 출력 ${esc(meta.capturedBy)} · Tincase<br>
    이 문서는 출력 시점의 제출 사실을 고정한 기록입니다. 이후 재제출·명단 변경은 반영되지 않습니다.
  </footer>
</div></body></html>`;
}
