// OPS-41 — 양식이 **정말로 있는가.**
//
// 화면은 `Template` 행이 있으면 「✓」를 찍고 있었다. 그런데 행과 파일은 다른 것이다 —
// 2026-09-10에 30개 부서 전부 행은 있는데 **파일은 우리 부서 것만 있었다**
// (초기 시드가 한 파일을 30개 부서에 등록해 놓고 파일은 하나만 저장했다).
//
// 그 상태로 부서를 켜면 아무도 미리 모른다. 부서원이 [양식 다운로드]를 눌러 500을 보고,
// 웹 작성이 「등록된 부서 양식이 없습니다」로 막히고, 14:01 자동 병합이 실패한다.
// **켜기 전에 보여야 하는 것을 켠 뒤에 알게 되는** 구조였다.
//
// 그래서 판정을 여기 하나로 모으고, 목록과 활성화 차단이 같은 것을 부른다.
import { prisma } from './db';
import { fileExists } from './storage';

/** `none` 행 자체가 없음 · `missing` 행은 있는데 파일이 없음 · `ok` 둘 다 있음 */
export type TemplateState = 'ok' | 'missing' | 'none';

/** 여러 부서를 한 번에 — 목록이 부서 수만큼 질의하지 않게 */
export async function templateStates(divisionIds: readonly string[]): Promise<Map<string, TemplateState>> {
  const out = new Map<string, TemplateState>(divisionIds.map((id) => [id, 'none']));
  if (divisionIds.length === 0) return out;

  const rows = await prisma.template.findMany({
    where: { divisionId: { in: [...divisionIds] }, isActive: true },
    select: { divisionId: true, filePath: true },
  });
  await Promise.all(
    rows.map(async (r) => {
      out.set(r.divisionId, (await fileExists(r.filePath)) ? 'ok' : 'missing');
    }),
  );
  return out;
}

export async function templateState(divisionId: string): Promise<TemplateState> {
  return (await templateStates([divisionId])).get(divisionId) ?? 'none';
}

/** 화면·오류 문구를 한 곳에서 — 두 군데에 적으면 갈라진다 */
export function templateProblem(state: TemplateState, divisionName: string): string | null {
  if (state === 'ok') return null;
  if (state === 'none') return `${divisionName}에 등록된 양식이 없습니다. 양식을 먼저 등록해 주세요.`;
  return (
    `${divisionName}의 양식 파일이 저장소에 없습니다 (등록 기록만 있습니다). ` +
    `부서 설정에서 양식을 다시 올려 주세요.`
  );
}
