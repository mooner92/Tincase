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
