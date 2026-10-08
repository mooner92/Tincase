// RU-45~47 — 운영회의 시연(테스트 서버 11112의 시연 모드). 시드의 **계획**(어느 주를 어디까지, 몇 시에)과 경로 경계,
// 화면 맨 위의 띠, 그리고 11112 하나로 평소·시연을 오가는 compose 스위치.
//
// 시드 자체는 DB·양식 hwp가 있어야 돌아서 여기서 돌리지 않는다(docs/DEMO.md의 절차로 확인). 대신 시드가 무엇을 할지
// 정하는 순수 함수를 고정한다 — 강당에서 틀어지는 것은 대개 「새벽 3시 제출」·「병합이 제출보다 먼저」·「실명 DB에 시드」다.
import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DEMO_ROOT,
  HISTORY_UPLOADS,
  LIVE_UPLOADS,
  contentNo,
  mondayOfIsoKey,
  parseArgs,
  parseUntil,
  pathRefusal,
  planWeek,
  squeeze,
  type Cast,
  type Planned,
  type Stage,
} from '../scripts/demo-plan';
import { describeWeek } from '@/lib/week';

vi.mock('next/server', () => ({ connection: async () => {} }));

const MIN = 60_000;
const at = (iso: string) => new Date(iso);

// fake-org PEOPLE과 같은 모양(이메일 앞부분) — 이 시험은 DB를 열지 않으므로 그대로 적는다
const CAST: Cast = {
  ai: ['lead', 'member', 'member2', 'ai-04', 'ai-05', 'ai-06', 'ai-07', 'ai-08', 'ai-09', 'ai-10'],
  pco: ['coord', 'pc-02', 'pc-03', 'pc-04', 'pc-05'],
  rmo: ['rm-lead', 'rm-02', 'rm-03', 'rm-04'],
  ca: ['ca-lead', 'ca-02', 'ca-03', 'ca-04', 'ca-05', 'ca-06'],
  member: 'member',
  memberPending: 'member2',
  lead: 'lead',
  head: 'head',
  hqLead: 'hq-lead',
  hqHead: 'hq-head',
  coordinator: 'coord',
  rmLead: 'rm-lead',
  caLead: 'ca-lead',
  pcHead: 'pc-head',
  rmHead: 'rm-head',
  caHead: 'ca-head',
};

// 11/2(월) 운영회의 — W45. 마감 11/5(목) 14:00. 아침 07:00에 시드하고 이야기 시각은 09:40
const W45 = mondayOfIsoKey('2026-W45');
const W45_DEADLINE = at('2026-11-05T14:00:00+09:00');
const W44 = mondayOfIsoKey('2026-W44');
const W44_DEADLINE = at('2026-10-29T14:00:00+09:00');
const MORNING = at('2026-11-02T09:40:00+09:00');

const plan = (stage: Stage, end = MORNING) => planWeek({ cast: CAST, stage, monday: W45, deadline: W45_DEADLINE, end });
const kinds = (p: Planned[]) => p.map((x) => x.action.kind);
const submitted = (p: Planned[]) => new Set(p.flatMap((x) => (x.action.kind === 'submit' ? [x.action.who] : [])));
const has = (p: Planned[], pred: (a: Planned['action']) => boolean) => p.some((x) => pred(x.action));

describe('[RU-T80] 주차·시각 읽기', () => {
  it('ISO 키 → 그 주 월요일 00:00 KST. 없는 주차는 거절', () => {
    expect(W45.toISOString()).toBe('2026-11-01T15:00:00.000Z'); // 11/2 00:00 KST
    expect(describeWeek(W45).label).toBe('11월 1주차');
    expect(describeWeek(W44).kind).toBe('monthly'); // 10월 마지막 주 — 회의 전 주는 월간이다
    expect(mondayOfIsoKey('2026-W01').toISOString()).toBe('2025-12-28T15:00:00.000Z');
    expect(() => mondayOfIsoKey('2026-W54')).toThrow('없는 주차');
    expect(() => mondayOfIsoKey('2026-45')).toThrow('2026-W45');
  });

  it('--until 「09:40」은 오늘(KST) — 서버 시계의 시간대와 무관', () => {
    const now = at('2026-11-01T22:30:00Z'); // KST로는 11/2 07:30
    expect(parseUntil('09:40', now).toISOString()).toBe('2026-11-02T00:40:00.000Z');
    expect(parseUntil('2026-11-02T09:40+09:00', now).toISOString()).toBe('2026-11-02T00:40:00.000Z');
    expect(() => parseUntil('9시', now)).toThrow('--until');
  });

  it('명령줄 — 기본은 ready, 모르는 단계·인자는 거절', () => {
    const now = at('2026-11-01T22:00:00Z');
    expect(parseArgs([], now)).toEqual({ stage: 'ready', isoKey: null, until: null, keepOpen: false });
    expect(parseArgs(['--stage=hq', '--week=2026-W45', '--until=09:40', '--keep-open'], now)).toEqual({
      stage: 'hq',
      isoKey: '2026-W45',
      until: at('2026-11-02T09:40:00+09:00'),
      keepOpen: true,
    });
    expect(() => parseArgs(['--stage=final'], now)).toThrow('open | ready | hq | done');
    expect(() => parseArgs(['--force'], now)).toThrow('모르는 인자');
  });
});

describe('[RU-T81] ★ 경로 — 시연 디렉터리나 임시 디렉터리 밖에는 시드하지 않는다', () => {
  const tmp = '/tmp';
  it('시연 데이터 볼륨 · 임시 디렉터리는 받는다', () => {
    expect(pathRefusal(`${DEMO_ROOT}/db/worklog.db`, DEMO_ROOT, tmp)).toBeNull();
    expect(pathRefusal('/tmp/demo-test/db/worklog.db', '/tmp/demo-test', tmp)).toBeNull();
  });
  it('운영·테스트 DB는 이름이 비슷해도 거절한다 — 경계(/)까지 본다', () => {
    expect(pathRefusal('/data/worklog/db/worklog.db', '/data/worklog', tmp)).toMatch(/worklog-demo/);
    expect(pathRefusal('/data/worklog-test/db/worklog.db', '/data/worklog-test', tmp)).not.toBeNull();
    expect(pathRefusal('/data/worklog-demo2/db/worklog.db', '/data/worklog-demo2', tmp)).not.toBeNull();
  });
  it('DB와 저장소는 같은 곳에 — 한쪽만 시연이면 거절', () => {
    expect(pathRefusal(`${DEMO_ROOT}/db/worklog.db`, '/data/worklog', tmp)).not.toBeNull();
    expect(pathRefusal('/tmp/x/db/worklog.db', '/data/worklog-test', tmp)).not.toBeNull();
    expect(pathRefusal('/tmp/x/worklog.db', '/tmp', tmp)).not.toBeNull(); // 임시 디렉터리 자체를 저장소로 쓰지 않는다
  });
  it('상대 경로는 거절', () => {
    expect(pathRefusal('./dev.db', DEMO_ROOT, tmp)).toMatch(/절대 경로/);
  });
});

// 2026-10-08(ADR-0015 · RU-84) — 승인이 곧 위로 가는 제출이다. 계획에는 사람이 하는 일만 있다: 제출·병합·실장 승인·섹션 올리기·
// 본부장 승인. [제출]·[이어 붙이기]·[총괄에 제출]·[전사 취합본 만들기]는 없고, 본부본·전사본은 시드가 승인 뒤에 맞춘다
describe('[RU-T82] ★ 단계 — 시연자가 화면에서 누를 것이 남아 있다', () => {
  it('없어진 버튼의 일은 계획에 없다 — 사람이 하는 일만', () => {
    for (const stage of ['ready', 'hq', 'done'] as const) {
      expect([...new Set(kinds(plan(stage)))].sort(), stage).toEqual(
        stage === 'done' ? ['approve', 'hqApprove', 'merge', 'submit', 'upload'] : ['approve', 'merge', 'submit', 'upload'],
      );
    }
  });

  it('open — 이번 주는 비어 있다', () => {
    expect(plan('open')).toEqual([]);
  });

  it('ready — 실·팀마다 한두 명 남음 · 주인공(남시우)은 안 냈다 · 실·팀 셋은 실장 승인(= 올라감) · AI홍보전략실은 병합 전 · 본부장 승인 전', () => {
    const p = plan('ready');
    const subs = submitted(p);
    expect(subs.has('member2')).toBe(false);
    expect(subs.has('ai-10')).toBe(false);
    expect(subs.has('pc-05')).toBe(false);
    expect(subs.has('ca-06')).toBe(false);
    expect(subs.size).toBe(21); // 25명 중
    expect(has(p, (a) => a.kind === 'merge' && a.div === 'AI홍보전략실')).toBe(false);
    expect(has(p, (a) => a.kind === 'merge' && a.div === '기획조정실' && a.trigger === 'manual')).toBe(true);
    expect(has(p, (a) => a.kind === 'approve' && a.div === 'AI홍보전략실')).toBe(false); // 실장 [승인]은 시연자가 누른다
    // 실·팀 셋은 그 부서장이 승인했다 — 승인이 곧 위로 가는 제출이다(부서장 없는 단위는 마감 전 아침에 아무것도 올라가지 않는다, RU-71)
    expect(p.filter((x) => x.action.kind === 'approve').map((x) => x.action)).toEqual([
      { kind: 'approve', div: '기획조정실', who: 'pc-head' },
      { kind: 'approve', div: '연구관리실', who: 'rm-head' },
      { kind: 'approve', div: '기후대기전략연구본부', who: 'ca-head' }, // 본부 단계 없는 본부 — 바로 총괄로(RU-07)
    ]);
    expect(kinds(p)).not.toContain('hqApprove');
  });

  it('hq — AI홍보전략실 실장 승인까지 · 남은 것은 본부장 [검토 완료 · 승인]. 주인공은 여전히 화면에서 낸다', () => {
    const p = plan('hq');
    expect(submitted(p).has('member2')).toBe(false);
    const order = kinds(p).filter((k) => k !== 'submit' && k !== 'upload');
    expect(order).toEqual(['merge', 'merge', 'merge', 'merge', 'approve', 'approve', 'approve', 'approve']);
    expect(p[p.length - 1].action).toEqual({ kind: 'approve', div: 'AI홍보전략실', who: 'head' });
  });

  it('[RU-T150] hwp 스위치가 꺼졌으면(uploads=false) 총괄이 올린 섹션이 계획에 없다 — 나머지 일은 그대로 (RU-60a)', () => {
    for (const stage of ['ready', 'hq', 'done'] as const) {
      const off = planWeek({ cast: CAST, stage, monday: W45, deadline: W45_DEADLINE, end: MORNING, uploads: false });
      expect(kinds(off), stage).not.toContain('upload');
      expect(off.filter((x) => x.action.kind !== 'upload').map((x) => x.action), stage).toEqual(
        plan(stage).filter((x) => x.action.kind !== 'upload').map((x) => x.action),
      );
    }
    const past = planWeek({ cast: CAST, stage: 'done', monday: W44, deadline: W44_DEADLINE, end: at('2026-11-02T09:40:00+09:00'), uploads: false });
    expect(kinds(past)).not.toContain('upload');
  });

  it('done — 본부장 승인이 마지막(전사본은 그 뒤 저절로)', () => {
    expect(plan('done').at(-1)?.action).toEqual({ kind: 'hqApprove', div: '기획경영본부', who: 'hq-head' });
  });

  it('올리는 섹션 제목은 전사 기본 섹션에 있다 — 없는 제목이면 시드가 멈춘다', async () => {
    // sections.ts는 DB 모듈을 불러 env 검사를 거친다 — 이 시험만 돌려도 서도록 형식상 값을 채운다(DB는 열지 않는다)
    process.env.DATABASE_URL ??= 'file:./test-demo.db';
    process.env.STORAGE_ROOT ??= '/tmp/tincase-test-demo';
    process.env.CF_ACCESS_TEAM ??= 'test-team';
    const { DEFAULT_SECTIONS } = await import('@/server/rollup/sections');
    const titles = new Set(DEFAULT_SECTIONS.map((s) => s.title));
    for (const t of [...HISTORY_UPLOADS, ...LIVE_UPLOADS]) expect(titles.has(t), t).toBe(true);
  });
});

describe('[RU-T83] ★ 시각 — 강당 화면에 새벽·뒤집힌 순서가 뜨지 않는다', () => {
  const kstHour = (d: Date) => new Date(d.getTime() + 9 * 3600_000).getUTCHours();

  it('아침 시드: 모두 이야기 시각 전, 같은 날 아침 — 제출 → 병합 → 승인(= 위로 제출) 순서', () => {
    const p = plan('hq');
    for (const x of p) {
      expect(x.at.getTime()).toBeLessThan(MORNING.getTime());
      expect(x.at.getTime()).toBeGreaterThan(W45.getTime());
      expect(kstHour(x.at)).toBeGreaterThanOrEqual(7);
    }
    const lastSubmit = Math.max(...p.filter((x) => x.action.kind === 'submit').map((x) => x.at.getTime()));
    const firstMerge = Math.min(...p.filter((x) => x.action.kind === 'merge').map((x) => x.at.getTime()));
    expect(lastSubmit).toBeLessThan(firstMerge);
    const lastMerge = Math.max(...p.filter((x) => x.action.kind === 'merge').map((x) => x.at.getTime()));
    const firstApprove = Math.min(...p.filter((x) => x.action.kind === 'approve').map((x) => x.at.getTime()));
    expect(lastMerge).toBeLessThan(firstApprove); // 승인할 병합본이 먼저 있다
    // 시각은 정렬돼 있다 — 시드가 이 순서대로 실행한다
    expect(p.map((x) => x.at.getTime())).toEqual([...p.map((x) => x.at.getTime())].sort((a, b) => a - b));
  });

  it('월요일 새벽(00:30)이 이야기 시각이어도 그 주 안 — 지난주로 새지 않는다', () => {
    const end = at('2026-11-02T00:30:00+09:00');
    const p = plan('ready', end);
    expect(p.length).toBeGreaterThan(0);
    for (const x of p) {
      expect(x.at.getTime()).toBeGreaterThanOrEqual(W45.getTime() + MIN);
      expect(x.at.getTime()).toBeLessThan(end.getTime());
    }
  });

  it('지난주(마감이 지난 주): 제출은 마감 전, 자동 병합은 14:01, 승인(= 위로 제출)은 3단계 기한 안', () => {
    const p = planWeek({ cast: CAST, stage: 'done', monday: W44, deadline: W44_DEADLINE, end: new Date(W45.getTime() - MIN) });
    const D = W44_DEADLINE.getTime();
    for (const x of p.filter((y) => y.action.kind === 'submit')) expect(x.at.getTime()).toBeLessThan(D);
    expect(submitted(p).has('member2')).toBe(true); // 「지난번에 낸 것」
    expect(submitted(p).size).toBe(24);
    for (const x of p.filter((y) => y.action.kind === 'merge')) {
      expect(x.at.getTime() - D).toBeGreaterThanOrEqual(MIN);
      expect(x.at.getTime() - D).toBeLessThan(3 * MIN);
      expect(x.action).toMatchObject({ trigger: 'auto' });
    }
    // 실장 승인은 「실·팀 → 본부」(D+60분) 안, 본부장 승인은 「본부 → 총괄」(D+120분) 안 — 승인이 곧 위로 가는 제출이다
    for (const x of p) {
      if (x.action.kind === 'approve') expect(x.at.getTime() - D).toBeLessThanOrEqual(60 * MIN);
      if (x.action.kind === 'hqApprove') expect(x.at.getTime() - D).toBeLessThanOrEqual(120 * MIN);
      // 승인은 병합 뒤 — 승인할 병합본이 있다
      if (x.action.kind === 'approve') expect(x.at.getTime() - D).toBeGreaterThan(3 * MIN);
    }
    expect(p.filter((x) => x.action.kind === 'approve')).toHaveLength(4);
    expect(p.at(-1)?.action.kind).toBe('hqApprove');
  });

  it('squeeze — 넘치는 쪽만 줄이고 순서를 지킨다', () => {
    expect(squeeze([10, 20, 30], 0, 100)).toEqual([10, 20, 30]);
    expect(squeeze([10, 20, 30], 0, 20)).toEqual([10, 15, 20]);
    expect(squeeze([10, 20, 30], 20, 100)).toEqual([20, 25, 30]);
  });

  it('같은 사람·주·판이면 같은 내용 — 다시 시드해도 화면이 같다', () => {
    expect(contentNo('member', '2026-W45', 1)).toBe(contentNo('member', '2026-W45', 1));
    expect(contentNo('member', '2026-W45', 2)).not.toBe(contentNo('member', '2026-W45', 1));
  });
});

describe('[RU-T84] 화면 맨 위의 띠 (RU-43 · RU-47)', () => {
  async function banner(kind: string | undefined) {
    const prev = process.env.TINCASE_ENV;
    if (kind === undefined) delete process.env.TINCASE_ENV;
    else process.env.TINCASE_ENV = kind;
    try {
      const { EnvBanner } = await import('@/components/EnvBanner');
      const el = await EnvBanner();
      return el ? renderToStaticMarkup(el) : '';
    } finally {
      if (prev === undefined) delete process.env.TINCASE_ENV;
      else process.env.TINCASE_ENV = prev;
    }
  }
  it('운영은 아무것도 없다', async () => {
    expect(await banner(undefined)).toBe('');
    expect(await banner('')).toBe('');
  });
  it('시연 — 「지어낸 것」을 알린다. 경고색이 아니고 「테스트」라고 하지 않는다', async () => {
    const html = await banner('demo');
    expect(html).toContain('시연 —');
    expect(html).not.toContain('시연 서버'); // 따로 된 시연 서버는 없다 — 11112의 시연 모드다(2026-10-08)
    expect(html).toContain('지어낸 것');
    expect(html).not.toContain('테스트');
    expect(html).not.toContain('bg-warning');
  });
  it('테스트 서버는 그대로', async () => {
    expect(await banner('test')).toContain('테스트 서버입니다');
  });
});

describe('[RU-T85] ★ 11112 하나 — 스위치 하나가 저장소·띠·쿠키를 함께 바꾼다 (2026-10-08 「11113은 쓰지마」)', () => {
  const ROOT = path.resolve(__dirname, '..');
  // 주석은 뺀다 — 설명에 옛 포트·명령이 나와도 설정은 아니다
  const COMPOSE = readFileSync(path.join(ROOT, 'docker-compose.test.yml'), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

  /** docker compose의 `${VAR:-기본}` 치환만 흉내 낸다 — 이 파일은 그것만 쓴다(아래 첫 시험이 지킨다). 다른 변수는 기본값 */
  function render(mode: string | undefined) {
    const text = COMPOSE.replace(/\$\{(\w+):-([^}]*)\}/g, (_m, name: string, dflt: string) =>
      name === 'TINCASE_TEST_MODE' && mode ? mode : dflt,
    );
    const one = (re: RegExp) => {
      const m = [...text.matchAll(re)];
      expect(m, String(re)).toHaveLength(1);
      return m[0][1];
    };
    return {
      volume: one(/^\s+- (\S+):\/data\s*(?:#.*)?$/gm),
      env: one(/^\s+TINCASE_ENV: (\S+)/gm),
      cookie: one(/^\s+SESSION_COOKIE_NAME: (\S+)/gm),
      ports: [...text.matchAll(/^\s+- "([\d.]+:\d+:\d+)"/gm)].map((m) => m[1]),
    };
  }

  it('변수는 TINCASE_TEST_MODE 하나뿐 — 저장소와 띠를 따로 고를 길이 없다(실명 DB 위에 「지어낸 것」 띠)', () => {
    const vars = new Set([...COMPOSE.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]));
    expect([...vars]).toEqual(['TINCASE_TEST_MODE:-test']);
  });

  it('평소(변수 없음·빈 값) — 테스트 데이터 · 테스트 띠 · 테스트 쿠키', () => {
    for (const mode of [undefined, '']) {
      expect(render(mode)).toEqual({
        volume: '/data/worklog-test',
        env: 'test',
        cookie: 'repman_test_session',
        ports: ['0.0.0.0:11112:3000'],
      });
    }
  });

  it('시연 모드 — 같은 포트, 시드가 만드는 저장소(DEMO_ROOT), 시연 띠, 쿠키는 따로', () => {
    expect(render('demo')).toEqual({
      volume: DEMO_ROOT,
      env: 'demo',
      cookie: 'repman_demo_session',
      ports: ['0.0.0.0:11112:3000'],
    });
    // 평소 저장소(운영 사본)는 시드가 받지 않는 곳이다 — 둘이 겹치면 시드 거절이 무의미해진다
    expect(pathRefusal(`${render(undefined).volume}/db/worklog.db`, render(undefined).volume, '/tmp')).not.toBeNull();
  });

  it('시연용 compose·포트가 따로 없다', () => {
    expect(existsSync(path.join(ROOT, 'docker-compose.demo.yml'))).toBe(false);
    expect(COMPOSE).not.toMatch(/11113/);
  });
});
