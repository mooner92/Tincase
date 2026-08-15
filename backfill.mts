import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const seed = JSON.parse(readFileSync('docs/private/seed.json', 'utf8')) as { divisions: { nameKo: string; parentKo: string }[] };
let n = 0;
for (const d of seed.divisions) {
  const r = await p.division.updateMany({ where: { nameKo: d.nameKo }, data: { parentKo: d.parentKo } });
  n += r.count;
}
console.log(`${n}개 부서 본부 정보 반영`);
const g = new Map<string, number>();
for (const d of await p.division.findMany({ select: { parentKo: true } })) g.set(d.parentKo, (g.get(d.parentKo) ?? 0) + 1);
console.log([...g].map(([k, v]) => `${k}(${v})`).join(' · '));
await p.$disconnect();
