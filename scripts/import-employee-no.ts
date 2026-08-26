/**
 * 사번 일괄 등록 — 인사 명단 엑셀 → `User.employeeNo`.
 *
 *   npx tsx scripts/import-employee-no.ts <명단.xlsx> [--yes]
 *
 * 기본은 미리보기다. `--yes` 없이는 무엇이 바뀔지 보여주기만 한다.
 *
 * **이름만으로 잇지 않는다.** 동명이인이 있으면 엉뚱한 사람에게 알림이 간다 —
 * 알림은 잘못 가면 되돌릴 수 없다. 그래서 «부서 + 이름»이 모두 맞을 때만 잇고,
 * 한 부서에 같은 이름이 둘 이상이면 그 사람은 **건너뛰고 목록에 남긴다**.
 *
 * 엑셀 열 이름은 인사 명단 원본을 그대로 따른다: 부서 · 사번 · 성명.
 */
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';

const prisma = new PrismaClient();

interface Row {
  empNo: string;
  div: string;
  name: string;
}

/** xlsx 파싱은 파이썬(openpyxl)에 맡긴다 — 노드에 의존성을 하나 더 들이지 않는다 */
function readSheet(path: string): Row[] {
  const py = `
import openpyxl, json, sys
wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
ws = wb[wb.sheetnames[0]]
head, out = None, []
for r in ws.iter_rows(values_only=True):
    if head is None:
        head = [str(c).strip() if c else '' for c in r]
        idx = {k: head.index(k) for k in ('부서', '사번', '성명') if k in head}
        if len(idx) < 3:
            print(json.dumps({'error': f'열을 찾지 못했습니다: {head[:8]}'}), flush=True); sys.exit(0)
        continue
    if not r[idx['사번']] or not r[idx['성명']]: continue
    out.append({'empNo': str(r[idx['사번']]).strip(),
                'div': str(r[idx['부서']]).strip(),
                'name': str(r[idx['성명']]).strip()})
print(json.dumps(out, ensure_ascii=False))
`;
  const raw = execFileSync('python3', ['-c', py, path], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const parsed = JSON.parse(raw.trim().split('\n').pop()!);
  if (parsed.error) throw new Error(parsed.error);
  return parsed as Row[];
}

async function main() {
  const [path] = process.argv.slice(2);
  const apply = process.argv.includes('--yes');
  if (!path) {
    console.error('사용법: npx tsx scripts/import-employee-no.ts <명단.xlsx> [--yes]');
    process.exit(1);
  }

  const rows = readSheet(path);
  const key = (d: string, n: string) => `${d}/${n}`;

  // 한 부서에 같은 이름이 둘 이상이면 사번을 확신할 수 없다
  const count = new Map<string, number>();
  rows.forEach((r) => count.set(key(r.div, r.name), (count.get(key(r.div, r.name)) ?? 0) + 1));
  const sheet = new Map(rows.filter((r) => count.get(key(r.div, r.name)) === 1).map((r) => [key(r.div, r.name), r.empNo]));
  const ambiguous = [...count].filter(([, n]) => n > 1).map(([k]) => k);

  const users = await prisma.user.findMany({ include: { division: true } });
  const plan: { id: string; who: string; from: string | null; to: string }[] = [];
  const unmatched: string[] = [];

  for (const u of users) {
    const empNo = sheet.get(key(u.division.nameKo, u.name));
    if (!empNo) {
      unmatched.push(`${u.division.nameKo}/${u.name}`);
      continue;
    }
    if (u.employeeNo === empNo) continue; // 이미 같다
    plan.push({ id: u.id, who: `${u.division.nameKo}/${u.name}`, from: u.employeeNo, to: empNo });
  }

  console.log(`명단 ${rows.length}행 · 계정 ${users.length}명`);
  console.log(`  등록/변경 대상 ${plan.length}명 · 이미 일치 ${users.length - plan.length - unmatched.length}명 · 못 찾음 ${unmatched.length}명`);
  if (ambiguous.length) console.log(`  ⚠ 부서 내 동명이인이라 건너뜀: ${ambiguous.join(', ')}`);
  if (unmatched.length) console.log(`  ⚠ 명단에 없는 계정: ${unmatched.slice(0, 10).join(', ')}${unmatched.length > 10 ? ` 외 ${unmatched.length - 10}명` : ''}`);
  plan.slice(0, 5).forEach((c) => console.log(`     ${c.who}: ${c.from ?? '(없음)'} → ${c.to}`));
  if (plan.length > 5) console.log(`     … 외 ${plan.length - 5}명`);

  if (!apply) {
    console.log('\n미리보기입니다. 실제로 등록하려면 끝에 --yes 를 붙이세요.');
    await prisma.$disconnect();
    return;
  }

  for (const c of plan) {
    await prisma.user.update({ where: { id: c.id }, data: { employeeNo: c.to } });
  }
  console.log(`\n${plan.length}명 등록했습니다.`);
  console.log('사번이 있어도 부서 알림 플래그(NT-30)와 개인 설정(NT-20)이 켜져 있어야 실제로 나갑니다.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
