// RH-120~125 — 본부 다듬기 화면의 서버 쪽: 올라온 산하 사본을 읽어 후보·자문회의·분량을 만들고, 저장한다.
// 본부본 만들기(run.ts `composeHq`)와 같은 입력·같은 함수(`curateHq`)를 쓴다 — 화면이 본 것과 본부본이 어긋나지 않게.
import type { WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { audit } from '../audit';
import { HttpError } from '../authz';
import { readStoredFile } from '../storage';
import { consultLabels, isProjectForm, parseHqForm } from '@/lib/hwp/hq-form';
import type { UnitDoc } from '@/lib/hwp/hq-merge';
import { curateHq, curateView, type CurateConsult, type CurateItem, type SavedCuration } from '@/lib/hq-curate';
import { estimatePages, pageLimit } from '@/lib/hq-pages';
import { isMonthlyWeek } from '@/lib/week';
import { hqInputs, templateFor } from './run';
import type { RollupNode } from './tree';
import { curateContext, loadCuration } from './curation-store';

export interface CurateBoard {
  slot: { isoKey: string; label: string };
  /** 본부 이름 — 자문회의 표의 본부 줄 */
  hq: string;
  rules: { source: string; summary: readonly string[] } | null;
  items: CurateItem[];
  consult: CurateConsult[];
  /** 본부본 어림 쪽 수(소수 한 자리) · 이 주의 기준(주간 1 · 월간 2) */
  pages: number;
  limit: number;
  monthly: boolean;
  saved: { by: string; at: string } | null;
  /** 읽지 못한 사본(실 이름) — 그 실 항목은 목록에 없다 */
  unreadable: string[];
}

async function unitDocs(node: RollupNode, slot: WeekSlot): Promise<{ units: UnitDoc[]; unreadable: string[] }> {
  const units: UnitDoc[] = [];
  const unreadable: string[] = [];
  for (const i of await hqInputs(node, slot)) {
    if (!i.report) continue;
    try {
      units.push({ nameKo: i.division.nameKo, data: parseHqForm(await readStoredFile(i.report.filePath)) });
    } catch {
      unreadable.push(i.division.nameKo);
    }
  }
  return { units, unreadable };
}

async function projectTemplate(node: RollupNode): Promise<Buffer> {
  const template = await templateFor(node);
  if (!isProjectForm(template)) throw new HttpError(404, 'not_project_form', '다듬기는 연구 본부 양식(과제 표)에서만 씁니다.');
  return template;
}

export async function curateBoard(node: RollupNode, slot: WeekSlot): Promise<CurateBoard> {
  const template = await projectTemplate(node);
  const { units, unreadable } = await unitDocs(node, slot);
  const ctx = curateContext(node.node.nameKo, slot);
  const saved = await loadCuration(node.node.id, slot.id);
  const view = curateView(units, ctx, saved);
  const monthly = isMonthlyWeek(slot.opensAt);
  const pages = estimatePages(curateHq(units, ctx, saved), { consultRows: consultLabels(template).length || 4 });
  return {
    slot: { isoKey: slot.isoKey, label: slot.label },
    hq: node.node.nameKo,
    rules: ctx.rules ? { source: ctx.rules.source, summary: ctx.rules.summary } : null,
    items: view.items,
    consult: view.consult,
    pages: Math.round(pages * 10) / 10,
    limit: pageLimit(monthly),
    monthly,
    saved: saved ? { by: saved.updatedBy, at: saved.updatedAt.toISOString() } : null,
    unreadable,
  };
}

const cell = (v: string) => {
  const t = v.trim();
  return t === '' ? '-' : t;
};

/**
 * RH-120 — 저장. 사람이 **규칙 답과 다르게** 정한 것만 남긴다(같으면 버린다 — 규칙이 바뀌면 그 답을 따라가게).
 * 지금 목록에 없는 열쇠·줄 이름은 버린다. 남는 것이 없으면 행을 지운다(규칙대로로 돌아감). 본부본은 부르는 쪽이 다시 맞춘다
 */
export async function saveCuration(
  actor: string,
  node: RollupNode,
  slot: WeekSlot,
  input: { decisions: Record<string, boolean>; consult: Record<string, string[]> },
): Promise<{ changed: number; consult: number }> {
  await projectTemplate(node);
  const { units } = await unitDocs(node, slot);
  const ctx = curateContext(node.node.nameKo, slot);
  const base = curateView(units, ctx, null);
  const decisions: Record<string, boolean> = {};
  for (const it of base.items) {
    const v = input.decisions[it.key];
    if (typeof v === 'boolean' && v !== it.suggested) decisions[it.key] = v;
  }
  const consult: Record<string, string[]> = {};
  for (const c of base.consult) {
    const v = input.consult[c.label];
    if (!v) continue;
    const vals = v.slice(0, 4).map(cell);
    if (vals.join('|') !== c.values.map(cell).join('|')) consult[c.label] = vals;
  }
  const saved: SavedCuration = { decisions, consult };
  const where = { divisionId_weekSlotId: { divisionId: node.node.id, weekSlotId: slot.id } };
  if (Object.keys(decisions).length === 0 && Object.keys(consult).length === 0) {
    await prisma.hqCuration.deleteMany({ where: { divisionId: node.node.id, weekSlotId: slot.id } });
  } else {
    const data = { decisions: JSON.stringify(saved.decisions), consult: JSON.stringify(saved.consult), updatedBy: actor };
    await prisma.hqCuration.upsert({ where, create: { divisionId: node.node.id, weekSlotId: slot.id, ...data }, update: data });
  }
  const view = curateView(units, ctx, saved);
  await audit(actor, 'hq_curate', node.node.id, `hq:${node.node.slug}:${slot.isoKey}`, {
    out: view.items.filter((i) => !i.included).length,
    total: view.items.length,
    changed: Object.keys(decisions).length,
    consult: Object.keys(consult).length,
  });
  return { changed: Object.keys(decisions).length, consult: Object.keys(consult).length };
}
