/**
 * OPS-50h — 브라우저 e2e 스모크의 **범위**(`--scope`)와 출시 범위의 모양. DB도 서버도 만지지 않는다 — 그래서 시험할 수 있다
 * (`tests/e2e-script.test.ts`). 실행은 `scripts/e2e-seed.ts`(DB에 옮긴다)와 `scripts/e2e-v2.cjs`(화면에서 확인한다)가 한다.
 *
 *   full    리허설 저장소 그대로 — 13개 단위가 모두 켜지고 3단계도 켬. 화면 흐름을 넓게 본다(지금까지의 스모크)
 *   launch  2026-10-13(화) 운영 전환의 범위(LAUNCH-v2 「범위」) — 켜는 부서 둘 · 3단계 끔 · 부서 알림은 그 둘만
 *
 * 왜 따로 있나: `full`은 3단계가 켜진 넓은 길을 보느라, 정작 출시일의 모양(두 부서 · 3단계 끔)에서만 생기는 일 —
 * 「위로」 카드가 없어야 하는 화면, 꺼진 부서 사람에게 쪽지가 새지 않는 것, 「병합 점검」을 누가 받나 — 을 보지 않는다.
 */

export const E2E_SCOPES = ['full', 'launch'] as const;
export type E2eScope = (typeof E2E_SCOPES)[number];

/** `--scope=` 값 읽기 — 없으면 `full`. 모르는 값이면 던진다(호출하는 쪽이 종료 코드 2로 멈춘다) */
export function parseScope(argv: readonly string[]): E2eScope {
  const hit = argv.find((a) => a === '--scope' || a.startsWith('--scope='));
  if (!hit) return 'full';
  const v = hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : '';
  if (!(E2E_SCOPES as readonly string[]).includes(v)) throw new Error(`--scope는 ${E2E_SCOPES.join(' | ')} 중 하나입니다 (받은 값: ${v || '없음'})`);
  return v as E2eScope;
}

/** 출시일에 켜는 부서 — 가짜 조직의 같은 이름 단위(사람은 모두 지어낸 것) */
export const LAUNCH_ACTIVE = ['기획조정실', 'AI홍보전략실'] as const;

/**
 * 범위 밖인데 **알림만 켠 채** 남은 꺼진 부서 하나. LAUNCH-v2 9-5의 2(「두 부서 밖에 『켬』인 줄이 있으면 끈다」)를 운영자 흐름이 화면에서 한다.
 * 끄기 전에 지나가는 「마감 10분 전」 창에서도 이 부서 사람은 받지 않아야 한다 — 부서 알림은 켜짐 **그리고** 스위치다(NT-30)
 */
export const LAUNCH_LEFTOVER = '연구관리실';

/**
 * 사람 칸 — 기획조정실은 **부서장 없이**(담당이 확인한 병합본이 최종 — LAUNCH-v2 9-4의 「아니오」 쪽), 총괄은 **담당이 아니다**.
 * 「병합 점검」은 총괄이 아니라 총괄이 있는 부서의 담당이 받는다(TACP-30) — 가짜 조직은 총괄이 곧 담당이라 둘이 갈리지 않아 가려 볼 수 없었다.
 * AI홍보전략실은 그대로(담당 · 부서장) — 출시일에 두 부서가 하나씩 두 경우를 맡는다.
 * 실장(부서장이던 사람)은 역할만 내리고 집계 제외는 그대로 둔다(LAUNCH-v2 9-4 — 어느 쪽이든 실장은 집계 제외).
 */
export const LAUNCH_ROLES: Readonly<Record<string, 'lead' | 'member'>> = {
  'pc-02': 'lead',
  coord: 'member',
  'pc-head': 'member',
};

/** 수신함 화면·「병합 점검」을 볼 가짜 운영자(리허설 저장소의 `rh-ops`) — 출시 범위에서는 알림을 켠다(운영자도 「병합 점검」을 받는다) */
export const LAUNCH_OPERATOR = 'rh-ops';

/** 부서 하나의 켜짐·알림 — 출시 범위 */
export function launchDivisionState(nameKo: string): { isActive: boolean; notifyEnabled: boolean } {
  const on = (LAUNCH_ACTIVE as readonly string[]).includes(nameKo);
  return { isActive: on, notifyEnabled: on || nameKo === LAUNCH_LEFTOVER };
}
