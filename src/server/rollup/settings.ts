// RU-20·21 — 이어 붙이는 **순서**와 메모. 본부는 자기 기여 단위의 순서를, 총괄은 본부들의 순서를 정한다.
//
// 순서는 **목록이 정한다** — 모델에 맡기지 않는다. 같은 입력이면 매주 같은 순서가 나와야
// 본부장·총괄이 「지난주와 같은 자리에 있다」를 믿고 읽는다.
import { z } from 'zod';
import { prisma } from '../db';
import { audit } from '../audit';
import { HttpError, type Scope } from '../authz';
import { loadOrgSetting, loadTree, type RollupNode } from './tree';

export const orderInput = z.object({
  order: z.array(z.string().min(1).max(64)).max(60),
  note: z.string().max(2000).optional(),
  pageBreak: z.boolean().optional(),
  /** 본부 자기 문서를 넣는가 (RU-08) — 본부 단계에서만 */
  self: z.boolean().optional(),
});
export type OrderInput = z.infer<typeof orderInput>;

/** 목록이 고를 수 있는 것만 담았는가 — 모르는 id가 섞이면 받지 않는다 */
function checkSubset(order: string[], allowed: Set<string>) {
  const bad = order.filter((id) => !allowed.has(id));
  if (bad.length || new Set(order).size !== order.length) {
    throw new HttpError(422, 'invalid_order', '순서 목록이 지금 단위 목록과 맞지 않습니다. 새로 고친 뒤 다시 시도하세요.');
  }
}

/**
 * 본부 순서 — **내 본부**만 (TACP-6: 쓰기 대상은 신원의 부서). `self`를 끄면 기여 단위가 바뀌므로
 * 본부 단계가 사라질 수도 있다(기여 단위가 하나 남으면 RU-07) — 화면이 그 결과를 다시 그린다.
 */
export async function setHqOrder(scope: Scope, node: RollupNode, input: OrderInput) {
  // 지금 순서 목록에 없는 본부 자신도 고를 수 있다 — `self`를 다시 켜는 경우
  checkSubset(input.order, new Set([node.node.id, ...node.contributors.map((c) => c.id)]));
  const before = await prisma.division.findUniqueOrThrow({
    where: { id: node.node.id },
    select: { rollupOrder: true, rollupNote: true, rollupPageBreak: true, rollupSelf: true },
  });
  await prisma.division.update({
    where: { id: node.node.id },
    data: {
      rollupOrder: JSON.stringify(input.order),
      ...(input.note !== undefined ? { rollupNote: input.note.trim() } : {}),
      ...(input.pageBreak !== undefined ? { rollupPageBreak: input.pageBreak } : {}),
      ...(input.self !== undefined ? { rollupSelf: input.self } : {}),
    },
  });
  await audit(scope.user.email, 'rollup_order', node.node.id, `hq:${node.node.slug}`, { before, after: input });
}

/** 전사 순서 — 총괄·운영자 */
export async function setOrgOrder(scope: Scope, input: OrderInput) {
  const tree = await loadTree();
  checkSubset(input.order, new Set(tree.nodes.map((n) => n.node.id)));
  const before = await loadOrgSetting();
  await prisma.orgRollupSetting.upsert({
    where: { id: 'org' },
    create: {
      id: 'org',
      order: JSON.stringify(input.order),
      note: input.note?.trim() ?? '',
      pageBreak: input.pageBreak ?? true,
      updatedBy: scope.user.id,
    },
    update: {
      order: JSON.stringify(input.order),
      ...(input.note !== undefined ? { note: input.note.trim() } : {}),
      ...(input.pageBreak !== undefined ? { pageBreak: input.pageBreak } : {}),
      updatedBy: scope.user.id,
    },
  });
  await audit(scope.user.email, 'rollup_order', null, 'org', {
    before: { order: before.order, note: before.note, pageBreak: before.pageBreak },
    after: input,
  });
}
