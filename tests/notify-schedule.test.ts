// NT-41 · HM-35 — 알림·병합이 **몇 시에** 일어나는가.
//
// 이 파일이 지키는 것은 문구가 아니라 **시각**이다. 시각은 눈으로 읽어서 맞는지 알 수 없고,
// 틀려도 조용하다 — 알림이 안 오거나, 엉뚱한 때 와서 방해가 된다. 둘 다 아무도 신고하지 않는다.
//
// 전부 순수 계산이라 DB를 타지 않는다. `npm run test:tz`가 서버 TZ를 바꿔 다시 돌린다 (WS-07).
import { describe, expect, it } from 'vitest';
import { TZDate } from '@date-fns/tz';
import { dayBeforeAt, deadlineFor, KST } from '@/lib/week';
import { MERGE_DELAY_MINUTES } from '@/server/merge/run';
import { REVIEW_MINUTES, SUBMIT_MINUTES } from '@/server/notify/merge-notices';
import { LAST_CALL_MINUTES, LAST_CALL_WINDOW, dueStages } from '@/server/notify/deadline-reminder';

/** KST 벽시계로 읽어 "8/26(수) 11:45" 꼴로 — 실패 메시지가 UTC면 사람이 못 읽는다 */
function kst(d: Date): string {
  const k = new TZDate(d.getTime(), KST);
  const dow = ['일', '월', '화', '수', '목', '금', '토'][k.getDay()];
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getMonth() + 1}/${k.getDate()}(${dow}) ${p(k.getHours())}:${p(k.getMinutes())}`;
}

describe('NT-41 마감 하루 전 알림 시각', () => {
  it('[WS-T40] 목 14:00 마감 → 수 11:45 (AI홍보전략실의 실제 정책)', () => {
    // 2026-08-24(월) 개시 주차, 마감 dow=4(목) 14:00
    const 마감 = deadlineFor(
      { opensAt: new TZDate(2026, 7, 24, 0, 0, 0, 0, KST) },
      { deadlineDow: 4, deadlineTime: '14:00' },
    );
    expect(kst(마감)).toBe('8/27(목) 14:00');
    expect(kst(dayBeforeAt(마감, '11:45'))).toBe('8/26(수) 11:45');
  });

  it('[WS-T41] 24시간을 빼는 것이 아니다 — 간격은 26시간 15분', () => {
    const 마감 = deadlineFor(
      { opensAt: new TZDate(2026, 7, 24, 0, 0, 0, 0, KST) },
      { deadlineDow: 4, deadlineTime: '14:00' },
    );
    const 알림 = dayBeforeAt(마감, '11:45');
    expect((마감.getTime() - 알림.getTime()) / 60_000).toBe(26 * 60 + 15);
  });

  it('[WS-T42] 마감 시각이 11:45보다 이르면 간격이 24시간보다 짧다', () => {
    // 마감이 목 09:00이면 전날 11:45는 21시간 15분 전이다. 뺄셈 상수로는 못 맞춘다
    const 마감 = deadlineFor(
      { opensAt: new TZDate(2026, 7, 24, 0, 0, 0, 0, KST) },
      { deadlineDow: 4, deadlineTime: '09:00' },
    );
    expect(kst(dayBeforeAt(마감, '11:45'))).toBe('8/26(수) 11:45');
    expect((마감.getTime() - dayBeforeAt(마감, '11:45').getTime()) / 60_000).toBe(21 * 60 + 15);
  });

  it('[WS-T43] 월 경계를 넘는다 — 3/1 마감의 전날은 2월 마지막 날', () => {
    const 삼월일일 = new Date(new TZDate(2027, 2, 1, 14, 0, 0, 0, KST).getTime());
    expect(kst(dayBeforeAt(삼월일일, '11:45'))).toBe('2/28(일) 11:45');

    const 윤년 = new Date(new TZDate(2028, 2, 1, 14, 0, 0, 0, KST).getTime());
    expect(kst(dayBeforeAt(윤년, '11:45'))).toBe('2/29(화) 11:45');
  });

  it('[WS-T44] 연 경계를 넘는다 — 1/1 마감의 전날은 작년 12/31', () => {
    const 새해 = new Date(new TZDate(2027, 0, 1, 14, 0, 0, 0, KST).getTime());
    const 전날 = dayBeforeAt(새해, '11:45');
    expect(kst(전날)).toBe('12/31(목) 11:45');
    expect(new TZDate(전날.getTime(), KST).getFullYear()).toBe(2026);
  });

  it('[WS-T45] 시각 형식이 틀리면 조용히 넘어가지 않고 던진다', () => {
    const 마감 = new Date('2026-08-27T05:00:00.000Z');
    for (const bad of ['11:60', '24:00', '1145', '', '11:5']) {
      expect(() => dayBeforeAt(마감, bad), bad).toThrow();
    }
  });
});

/**
 * HM-35 — 목요일 오후의 순서. **이 순서가 깨지면 제품이 깨진다.**
 *
 *   14:00 마감 → 14:01 병합 시작 → 14:10 실/팀장 검토 → 14:30 담당자 제출 → 15:00 대외 마감
 *
 * 상수 하나를 무심코 고치면 «병합이 끝나기 전에 검토 요청이 나가는» 상태가 되는데,
 * 그건 알림이 낡은 문서를 가리키는 형태로만 드러난다 (2026-08-27에 실제로 그랬다).
 */
describe('HM-35 마감 후 타임라인', () => {
  it('[HM-T45] 병합은 마감 정각이 아니라 +1분에 시작한다', () => {
    // 14:00:00.000 업로드는 유효하다(WS-06 «정각까지 허용»). 그 요청이 커밋될 틈을 준다
    expect(MERGE_DELAY_MINUTES).toBeGreaterThan(0);
  });

  it('[HM-T46] 순서가 지켜진다 — 병합 시작 < 실/팀장 < 담당자', () => {
    expect(MERGE_DELAY_MINUTES).toBeLessThan(REVIEW_MINUTES);
    expect(REVIEW_MINUTES).toBeLessThan(SUBMIT_MINUTES);
  });

  it('[HM-T47] 병합에 최소 5분이 남는다 — 모델 호출이 수 분 걸린다', () => {
    expect(REVIEW_MINUTES - MERGE_DELAY_MINUTES).toBeGreaterThanOrEqual(5);
  });

  it('[HM-T48] 담당자 알림 뒤에도 대외 마감(15:00)까지 여유가 있다', () => {
    // 부서 마감 14:00 → 대외 마감 15:00. 담당자가 받고 나서 쓸 수 있는 시간
    expect(60 - SUBMIT_MINUTES).toBeGreaterThanOrEqual(20);
  });
});

/**
 * NT-42 — **최후 알림** (마감 10분 전).
 *
 * 같은 사람에게 가는 세 번째 알림이다. 여기서 지킬 것은 문구가 아니라 **창**이다:
 * 창이 마감을 넘으면 「10분 남았습니다」가 마감 뒤에 나간다 — 거짓말이고,
 * 이미 못 내게 된 사람을 재촉하는 꼴이다. 그 어긋남은 그 주에 늦게 낸 사람이 있어야만
 * 드러나서 몇 주 동안 아무도 모를 수 있다.
 */
describe('NT-42 최후 알림 창', () => {
  it('[NT-T42] **창이 마감을 넘지 않는다** — 넘으면 마감 뒤에 「10분 남았습니다」가 간다', () => {
    // 창 = [마감-10분, 마감-10분+폭]. 끝이 마감보다 앞이려면 폭 < 10이어야 한다
    expect(LAST_CALL_WINDOW).toBeLessThan(LAST_CALL_MINUTES);
  });

  it('[NT-T43] 1분 주기 스케줄러가 반드시 한 번은 창을 지난다', () => {
    expect(LAST_CALL_WINDOW).toBeGreaterThanOrEqual(2);
  });

  it('[NT-T44] 세 단계가 시간 순서대로다 — 전날 → 1시간 전 → 10분 전', () => {
    const slot = { opensAt: new Date(new TZDate(2026, 7, 31, 0, 0, 0, 0, KST).getTime()) };
    const 마감 = deadlineFor(slot, { deadlineDow: 4, deadlineTime: '14:00' });
    const 전날 = dayBeforeAt(마감, '11:45').getTime();
    const 한시간 = 마감.getTime() - 60 * 60_000;
    const 십분 = 마감.getTime() - LAST_CALL_MINUTES * 60_000;
    expect(전날).toBeLessThan(한시간);
    expect(한시간).toBeLessThan(십분);
    expect(십분).toBeLessThan(마감.getTime());
  });

  it('[NT-T45] 최후 알림은 마감 10분 전이다 — 더 당기면 「최후」가 아니다', () => {
    expect(LAST_CALL_MINUTES).toBeGreaterThanOrEqual(5);
    expect(LAST_CALL_MINUTES).toBeLessThanOrEqual(15);
  });
});


/**
 * NT-43 — **분 단위로 훑는다.** 상수가 맞는 것과 알림이 나가는 것은 다른 얘기다.
 *
 * 최후 알림은 2026-09-10 21:08에 배포됐는데 **아직 한 번도 안 나갔다**:
 * 9/10은 배포가 마감(14:00) 뒤였고, 9/17은 마감 6분 전(13:44)에 스케줄러를 껐다.
 * 그래서 2026-09-24가 첫 실전이다. 처음 도는 코드를 목요일 오후에 처음 보지 않으려고
 * 수요일 00:00부터 목요일 15:00까지 1분씩 밀어 보며 **실제로 몇 시 몇 분에 나가는지** 센다.
 */
describe('NT-43 실제 발송 분 — 목 14:00 마감 주간', () => {
  // 2026-09-21(월) 개시 → 마감 2026-09-24(목) 14:00
  const 마감 = deadlineFor(
    { opensAt: new TZDate(2026, 8, 21, 0, 0, 0, 0, KST) },
    { deadlineDow: 4, deadlineTime: '14:00' },
  );

  /** 수 00:00 ~ 목 15:00을 1분씩 — 각 종류가 켜지는 분을 모은다 */
  const 발동: Record<string, string[]> = { deadline_1d: [], deadline_1h: [], deadline_10m: [] };
  const 시작 = new TZDate(2026, 8, 23, 0, 0, 0, 0, KST).getTime();
  for (let m = 0; m <= 39 * 60; m++) {
    const now = new Date(시작 + m * 60_000);
    for (const k of dueStages(now, 마감)) 발동[k].push(kst(now));
  }

  it('[NT-T50] 마감이 목 14:00로 잡힌다 — 이 주차 계산이 틀리면 나머지가 다 틀린다', () => {
    expect(kst(마감)).toBe('9/24(목) 14:00');
  });

  it('[NT-T51] **최후 알림은 13:50~13:53에만 켜진다** — 마감을 넘지 않는다', () => {
    expect(발동.deadline_10m).toEqual([
      '9/24(목) 13:50',
      '9/24(목) 13:51',
      '9/24(목) 13:52',
      '9/24(목) 13:53',
    ]);
    // 마지막 발동이 마감보다 앞이다 — 「10분 남았습니다」가 마감 뒤에 가면 거짓말이다
    expect(발동.deadline_10m.at(-1)! < '9/24(목) 14:00').toBe(true);
  });

  it('[NT-T52] 1시간 전 알림은 13:00에 켜진다', () => {
    expect(발동.deadline_1h[0]).toBe('9/24(목) 13:00');
    expect(발동.deadline_1h.at(-1)).toBe('9/24(목) 13:12');
  });

  it('[NT-T53] 하루 전 알림은 수 11:45에 켜진다 — 점심시간 직전', () => {
    expect(발동.deadline_1d[0]).toBe('9/23(수) 11:45');
    expect(발동.deadline_1d.at(-1)).toBe('9/23(수) 11:57');
  });

  it('[NT-T54] 세 창이 겹치지 않는다 — 같은 분에 두 통이 가지 않는다', () => {
    const 전부 = [...발동.deadline_1d, ...발동.deadline_1h, ...발동.deadline_10m];
    expect(new Set(전부).size).toBe(전부.length);
  });

  it('[NT-T55] 창 **밖에서는 아무것도 안 켜진다** — 39시간 중 29분만 켜져 있다', () => {
    const 켜진분 = 발동.deadline_1d.length + 발동.deadline_1h.length + 발동.deadline_10m.length;
    expect(켜진분).toBe(13 + 13 + 4);
    // 마감 뒤에는 어떤 단계도 켜지지 않는다
    for (let m = 0; m <= 60; m++) {
      const 마감후 = new Date(마감.getTime() + m * 60_000 + 1);
      expect(dueStages(마감후, 마감), kst(마감후)).toEqual([]);
    }
  });

  it('[NT-T56] 1분 주기가 창을 건너뛰지 않는다 — 가장 좁은 창도 2분 이상이다', () => {
    // 스케줄러가 한 주기를 늦게 돌아도(실행이 1분을 넘으면 생긴다) 여전히 창에 든다
    expect(발동.deadline_10m.length).toBeGreaterThanOrEqual(2);
  });
});
