// HM-44 — 자동 병합 **기한부 일시정지**.
//
// 이 파일이 지키는 것은 두 가지다.
//   1. 멈춤은 **저절로 풀린다** — 켜는 일이 사람 기억에 남지 않는다.
//   2. 값을 못 읽으면 **멈춘 채로 있는다** — 「멈춘 줄 알았는데 안 멈췄다」가 남의 문서를 덮는다.
//
// 그리고 이 기능의 고유한 위험은 오타다. 오타가 fail-closed와 만나면 **영구 정지**가 되고,
// 그건 목요일 오후에 아무 일도 안 일어나는 형태로만 드러난다. 그래서 실제 배포 파일의
// 값이 시각으로 읽히는지도 여기서 본다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mergePauseState, mergePaused } from '@/server/merge/pause';

const 지금 = new Date('2026-09-17T14:30:00+09:00');

describe('HM-44 병합 일시정지', () => {
  it('[HM-T50] 값이 없으면 안 멈춘다 — 기본은 늘 도는 것이다', () => {
    expect(mergePaused(지금, undefined)).toBe(false);
    expect(mergePaused(지금, '')).toBe(false);
    expect(mergePaused(지금, '   ')).toBe(false);
  });

  it('[HM-T51] 그 시각까지만 멈춘다', () => {
    expect(mergePaused(지금, '2026-09-21T09:00:00+09:00')).toBe(true);
  });

  it('[HM-T52] **저절로 풀린다** — 지난 값은 아무것도 멈추지 않는다', () => {
    // 이 한 줄이 이 기능의 존재 이유다. 지난 주에 적어 둔 값이 이번 주를 막으면 안 된다
    expect(mergePaused(지금, '2026-09-14T09:00:00+09:00')).toBe(false);
    // 1밀리초만 지나도 풀린다 — 경계에서 눌러앉지 않는다
    expect(mergePaused(new Date('2026-09-21T09:00:00.001+09:00'), '2026-09-21T09:00:00+09:00')).toBe(false);
  });

  it('[HM-T53] 못 읽으면 **멈춘 채로 있는다** — 덮어쓰는 쪽이 더 나쁘다', () => {
    for (const bad of ['월요일', 'off', '다음주 월요일 아침', '2026-13-01T09:00:00+09:00']) {
      const st = mergePauseState(지금, bad);
      expect(st.paused, bad).toBe(true);
      expect(st.paused && st.until, bad).toBe(null); // 「언제까지」를 모른다는 뜻
    }
  });

  it('[HM-T54a] 없는 날짜는 **다음 달로 굴러간다** — 안전한 쪽이지만 조용하다', () => {
    // 9/31은 오타인데 JS는 10/1로 읽는다. 「못 읽음」이 아니라 **열흘 더 멈춤**이 된다.
    // 방향은 안전하지만(덮지 않는다) 목요일마다 아무 일도 안 일어난다. 그래서 배포 파일
    // 검사(HM-T56)가 「적은 날짜와 읽힌 날짜가 같은가」를 따로 본다.
    const st = mergePauseState(지금, '2026-09-31T09:00:00+09:00');
    expect(st.paused && st.until?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('[HM-T54] 멈춘 이유를 말한다 — 조용히 멈추면 목요일에야 안다', () => {
    const st = mergePauseState(지금, '월요일');
    expect(st.paused && st.until === null && st.reason).toContain('월요일');
  });

  it('[HM-T55] 시간대를 안 적으면 안 된다 — 서버 TZ에 따라 아홉 시간 어긋난다', () => {
    // KST 09:00으로 적었는데 UTC로 읽히면 18:00이다. 목요일 오후를 통째로 삼킨다.
    const 붙임 = mergePauseState(지금, '2026-09-21T09:00:00+09:00');
    expect(붙임.paused && 붙임.until?.toISOString()).toBe('2026-09-21T00:00:00.000Z');
  });
});

describe('HM-44 배포 파일의 값', () => {
  const compose = readFileSync('docker-compose.yml', 'utf-8');

  it('[HM-T56] docker-compose에 적힌 값은 시각으로 읽힌다 — 오타는 영구 정지가 된다', () => {
    const m = compose.match(/^\s*MERGE_PAUSE_UNTIL:\s*"?([^"\n#]+)"?/m);
    if (!m) return; // 평소에는 없는 것이 정상이다
    const raw = m[1].trim();
    expect(Number.isNaN(new Date(raw).getTime()), `읽을 수 없는 값: ${raw}`).toBe(false);
    expect(raw, '시간대를 붙여야 한다').toMatch(/(Z|[+-]\d{2}:\d{2})$/);

    // 9/31 같은 오타는 파싱에 «성공»해 10/1이 된다 — 조용히 열흘을 더 멈춘다.
    // 적은 날짜와 읽힌 날짜가 같은지 본다 (HM-T54a)
    const [, y, mo, d] = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)!;
    const parsed = new Date(raw);
    const off = raw.match(/([+-]\d{2}):(\d{2})$/);
    const local = off
      ? new Date(parsed.getTime() + (Number(off[1]) * 60 + Math.sign(Number(off[1])) * Number(off[2])) * 60_000)
      : parsed;
    expect(
      [local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate()].join('-'),
      `없는 날짜다: ${raw}`,
    ).toBe([Number(y), Number(mo), Number(d)].join('-'));
  });

  it('[HM-T57] 영구 정지 스위치는 배포 파일에 남아 있지 않는다', () => {
    // MERGE_SCHEDULER=off는 되살리는 일이 사람 기억에 남는다 — 운영에서는 기한부만 쓴다
    expect(compose).not.toMatch(/^\s*MERGE_SCHEDULER:\s*"?off/m);
  });
});
