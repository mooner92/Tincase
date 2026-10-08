// OPS-43 — 빌드 찌꺼기 청소와 배포 입구(scripts/deploy.sh).
//
// 2026-10-08, 이틀 사이 빌드 찌꺼기 약 45개(약 35G)로 루트 디스크가 100%가 됐다. 청소를 스크립트로 만들었는데,
// 이 스크립트의 위험은 **너무 많이 지우는 것**이다 — 서버를 여러 사람이 함께 쓰고, 필터 하나가 빠지면 남의 이미지가
// 지워진다. 그 실수는 소리 없이 일어나고 되돌릴 수 없다. 그래서 여기서 지키는 것은 셋이다.
//   1. 표식 — Dockerfile의 **모든** 스테이지가 표식을 단다. 빠진 스테이지의 찌꺼기는 청소가 영영 못 잡는다
//   2. 범위 — 스크립트는 표식 필터 없는 prune, `-a`, system/builder prune, `rmi -f`를 쓰지 않는다.
//      글자로 읽어서 보고(구조), `dk`(docker 호출 한 곳)를 가짜로 바꿔 끼워 실제로 나가는 명령을 본다(행동)
//   3. 판정 — 디스크 5 GiB 기준과 배포 금지 시간대 계산. 금지 시간대는 bash로 다시 셌으므로
//      src/lib/week.ts의 deadlineFor·dayBeforeAt과 **같은 답**인지 맞대 본다 — 둘이 갈라지면 화면과 배포가 다른 마감을 본다
//
// docker는 부르지 않는다. bash로 스크립트를 `source`하면 함수만 정의되고(main은 돌지 않는다) 그 함수를 직접 부른다.
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TZDate } from '@date-fns/tz';
import { currentWeek, dayBeforeAt, KST, mondayOf, type DeadlinePolicy } from '@/lib/week';
import { earliestDeadline } from '@/server/slot-deadline';

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/deploy.sh');
const scriptText = readFileSync(SCRIPT, 'utf-8');

/** 스크립트를 source한 bash에서 `body`를 돌린다. set -e가 켜진 채라 실패할 함수는 `|| rc=$?`로 부른다 */
function sh(body: string, env: Record<string, string> = {}) {
  const r = spawnSync('bash', ['-c', `source "${SCRIPT}"\n${body}`], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** 주석 줄을 뺀 코드 줄 — 「쓰지 않는다」고 적어 둔 설명이 검사에 걸리지 않게 */
const codeLines = scriptText
  .split('\n')
  .map((line, i) => ({ line, no: i + 1 }))
  .filter(({ line }) => !/^\s*#/.test(line));

/** KST 벽시계 → epoch 초 */
const at = (y: number, mo: number, d: number, h: number, mi: number) =>
  Math.floor(new TZDate(y, mo - 1, d, h, mi, 0, 0, KST).getTime() / 1000);

// ── 가짜 docker ──────────────────────────────────────────────────────────────────────────────────────────────
// 상태는 파일에 둔다 — 스크립트가 `$(dk …)`로 부르면 서브셸이라 셸 변수는 돌아오지 않는다.
let state = '';
afterEach(() => {
  if (state) rmSync(state, { recursive: true, force: true });
  state = '';
});
function fakeDocker(opts: { deletingRounds?: number; dangling?: Record<string, string> } = {}) {
  state = mkdtempSync(path.join(os.tmpdir(), 'deploy-test-'));
  const sigs = Object.entries(opts.dangling ?? {})
    .map(([id, sig]) => `printf '%s' '${sig}' > "$STATE/sig-${id}"`)
    .join('\n');
  return {
    env: { STATE: state, DELETING_ROUNDS: String(opts.deletingRounds ?? 0) },
    prelude: `
${sigs}
dk() {
  printf '%s\\n' "$*" >> "$STATE/calls"
  case $1 in
    image)
      case $2 in
        prune)
          local n; n=$(cat "$STATE/rounds" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$STATE/rounds"
          if [ "$DELETING_ROUNDS" = always ] || [ "$n" -le "$DELETING_ROUNDS" ]; then
            printf 'Deleted Images:\\ndeleted: sha256:aaa%s\\ndeleted: sha256:bbb%s\\n\\nTotal reclaimed space: 1.2GB\\n' "$n" "$n"
          else
            printf 'Total reclaimed space: 0B\\n'
          fi ;;
        inspect) cat "$STATE/sig-\${!#}" 2>/dev/null || return 1 ;;
      esac ;;
    images) for f in "$STATE"/sig-*; do [ -e "$f" ] && printf '%s\\n' "\${f##*/sig-}"; done ;;
    rmi) echo "$2" >> "$STATE/removed" ;;
  esac
}
`,
    calls: () => {
      try {
        return readFileSync(path.join(state, 'calls'), 'utf-8').trim().split('\n').filter(Boolean);
      } catch {
        return [];
      }
    },
    removed: () => {
      try {
        return readFileSync(path.join(state, 'removed'), 'utf-8').trim().split('\n').filter(Boolean);
      } catch {
        return [];
      }
    },
  };
}

const APP_LABEL = /^APP_LABEL='([^']+)'$/m.exec(scriptText)?.[1];

describe('OPS-43a 표식 — Dockerfile의 모든 스테이지', () => {
  it('[OPS-T10] FROM 바로 다음 줄이 LABEL org.tincase.app="repman"이고, 스크립트의 필터와 같은 값이다', () => {
    const lines = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf-8').split('\n');
    const froms = lines.map((l, i) => ({ l, i })).filter(({ l }) => /^FROM\s/i.test(l));
    // deps · build · run — 스테이지가 늘어도 이 검사는 그대로 맞다. 줄어 0이 되는 사고만 막는다
    expect(froms.length).toBeGreaterThanOrEqual(3);
    for (const { l, i } of froms) {
      expect(lines[i + 1], `${l} 다음 줄`).toBe('LABEL org.tincase.app="repman"');
    }
    expect(APP_LABEL).toBe('org.tincase.app=repman');
  });
});

describe('OPS-43e 범위 — 남의 것·태그 붙은 것을 지우는 명령이 없다 (스크립트를 글자로 읽는다)', () => {
  it('[OPS-T11] system·builder·container·volume·network prune을 쓰지 않는다', () => {
    const bad = codeLines.filter(({ line }) => /\b(system|builder|container|volume|network)\s+prune\b/.test(line));
    expect(bad.map((b) => `${b.no}: ${b.line}`)).toEqual([]);
  });

  it('[OPS-T11a] image prune은 전부 표식 필터를 달고, -a/--all이 없다', () => {
    // 실제로 부르는 줄만 — 「image prune 실패」 같은 안내 문구는 명령이 아니다
    const prunes = codeLines.filter(({ line }) => /\b(dk|docker)\s+image\s+prune\b/.test(line));
    expect(prunes.length).toBeGreaterThan(0);
    for (const { line, no } of prunes) {
      expect(line, `${no}행`).toContain('--filter "label=$APP_LABEL"');
      // `-af`처럼 묶어 쓴 것도 — -a가 붙으면 쓰지 않는 **태그 붙은** 이미지(repman:rollback)까지 지운다
      expect(line, `${no}행`).not.toMatch(/\s(-[A-Za-z]*a[A-Za-z]*|--all)(\s|$)/);
    }
  });

  it('[OPS-T11b] rmi는 레거시 청소 한 곳뿐 — -f 없이, 지문을 확인한 다음 줄에서만', () => {
    const rmis = codeLines.filter(({ line }) => /\b(rmi|image\s+rm)\b/.test(line));
    expect(rmis.map((r) => r.line.trim())).toEqual(['if dk rmi "$id" >/dev/null 2>&1; then']);
    const fn = /prune_legacy_leftovers\(\) \{([\s\S]*?)\n\}/.exec(scriptText)?.[1] ?? '';
    const guard = fn.indexOf('is_legacy_repman_leftover "$sig" || continue');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(fn.indexOf('dk rmi'));
    expect(codeLines.some(({ line }) => /rmi\s+(-f|--force)\b/.test(line))).toBe(false);
  });

  it('[OPS-T11c] 운영 문서도 필터 없는 prune을 명령으로 시키지 않는다', () => {
    // 스크립트만 고치고 DEPLOY.md에 `sudo docker image prune -f`가 남으면 사람이 그걸 친다
    for (const doc of ['docs/DEPLOY.md', 'docs/spec/09-deployment-ops.md']) {
      const cmds = readFileSync(path.join(ROOT, doc), 'utf-8')
        .split('\n')
        .filter((l) => /^\s*(sudo\s+)?docker\s/.test(l) && /\bprune\b/.test(l) && !l.includes('--filter label=org.tincase.app=repman'));
      expect(cmds, doc).toEqual([]);
    }
  });
});

describe('OPS-43c·d 청소 — 실제로 나가는 docker 명령 (가짜 dk)', () => {
  it('[OPS-T12] 지운 것이 없을 때까지 되풀이한다 — 사슬은 한 번에 끝 하나씩 떨어진다', () => {
    const f = fakeDocker({ deletingRounds: 3 });
    const r = sh(`${f.prelude}\nprune_labeled_leftovers`, f.env);
    expect(r.code).toBe(0);
    const prunes = f.calls().filter((c) => c.startsWith('image prune'));
    expect(prunes).toEqual(Array(4).fill('image prune -f --filter label=org.tincase.app=repman'));
    expect(r.out).toContain('표식 있는 찌꺼기 6개 지움');
  });

  it('[OPS-T13] 끝없이 지워져도 상한(30회)에서 멈추고 알린다', () => {
    const f = fakeDocker();
    const r = sh(`${f.prelude}\nprune_labeled_leftovers`, { ...f.env, DELETING_ROUNDS: 'always' });
    expect(r.code).toBe(0);
    expect(f.calls().filter((c) => c.startsWith('image prune'))).toHaveLength(30);
    expect(r.err).toContain('30회를 돌고도 남았다');
  });

  const REPMAN = '0|/app|app|["/usr/bin/tini","--"]|["./scripts/entrypoint.sh"]';
  it('[OPS-T14] 표식 없는 옛 이미지는 repman 최종 이미지 지문일 때만 지운다 — 남의 /app 이미지는 그대로', () => {
    const f = fakeDocker({
      dangling: {
        'sha256:repman-old': REPMAN,
        // 남의 Node 프로젝트 — WorkingDir가 같아도 지우면 안 된다 (deps·build 스테이지 찌꺼기와도 같은 모양이다)
        'sha256:other-node': '0|/app||["docker-entrypoint.sh"]|["node"]',
        // 목록과 지우기 사이에 누가 태그를 붙였다 — 태그 수가 0이 아니면 손대지 않는다
        'sha256:tagged-now': REPMAN.replace(/^0/, '1'),
        // 비슷하지만 사용자가 다르다 — 「비슷하면 지운다」가 아니다
        'sha256:root-user': REPMAN.replace('|app|', '|root|'),
      },
    });
    const r = sh(`${f.prelude}\nprune_legacy_leftovers`, f.env);
    expect(r.code).toBe(0);
    expect(f.removed()).toEqual(['sha256:repman-old']);
    expect(f.calls().filter((c) => c.startsWith('rmi'))).toEqual(['rmi sha256:repman-old']);
  });

  it('[OPS-T15] 지문은 정확히 같아야 한다', () => {
    const cases: [string, boolean][] = [
      [REPMAN, true],
      [`${REPMAN} `, false],
      [REPMAN.replace('./scripts/entrypoint.sh', 'node server.js'), false],
      [REPMAN.replace('/app', '/srv'), false],
      ['', false],
    ];
    for (const [sig, want] of cases) {
      const r = sh(`is_legacy_repman_leftover '${sig}' && echo yes || echo no`);
      expect(r.out.trim(), sig).toBe(want ? 'yes' : 'no');
    }
  });

  it('[OPS-T22] 테스트 모드 변수는 sudo **뒤에** 붙는다 — 앞에 두면 sudo가 지운다 (RU-45)', () => {
    state = mkdtempSync(path.join(os.tmpdir(), 'deploy-test-'));
    const r = sh(
      `id() { echo 1000; }
       sudo() { printf '%s\\n' "$*" >> "$STATE/sudo"; }
       dk TINCASE_TEST_MODE=demo compose -f docker-compose.test.yml -p repman-test up -d
       dk image prune -f --filter "label=$APP_LABEL"
       cat "$STATE/sudo"`,
      { STATE: state },
    );
    expect(r.out.trim().split('\n')).toEqual([
      'TINCASE_TEST_MODE=demo docker compose -f docker-compose.test.yml -p repman-test up -d',
      'docker image prune -f --filter label=org.tincase.app=repman',
    ]);
  });
});

describe('OPS-43f 디스크 — 5 GiB 미만이면 빌드하지 않는다', () => {
  it('[OPS-T16] 경계: 5 GiB는 되고 1 KiB 모자라면 안 된다. 숫자가 아니면(df를 못 읽음) 안 된다', () => {
    const GiB = 1024 * 1024; // KiB 단위
    const verdict = (kib: string, min = '') => sh(`enough_disk_to_build '${kib}' ${min} && echo 0 || echo $?`).out.trim();
    expect(verdict(String(5 * GiB))).toBe('0');
    expect(verdict(String(5 * GiB - 1))).toBe('1');
    expect(verdict(String(50 * GiB))).toBe('0');
    expect(verdict('')).toBe('2');
    expect(verdict('4.9G')).toBe('2');
    expect(verdict(String(2 * GiB), '2')).toBe('0');
  });

  it('[OPS-T17] 모자라면 우리 찌꺼기를 먼저 치우고, 그래도 모자라면 할 일을 말하고 빌드 없이 끝난다', () => {
    const f = fakeDocker({ deletingRounds: 1 });
    const r = sh(`${f.prelude}\nroot_avail_kib() { echo 1048576; }\nensure_disk_for_build prod\necho 빌드로-넘어감`, f.env);
    expect(r.code).toBe(1);
    expect(r.out).not.toContain('빌드로-넘어감');
    expect(r.err).toContain('빌드하지 않는다');
    expect(r.err).toContain('npm cache clean');
    expect(r.err).toContain('bash scripts/deploy.sh prod --no-build');
    // 나간 docker 명령은 표식 청소와 목록 읽기뿐 — 빌드도, 필터 없는 prune도 없다
    for (const c of f.calls()) expect(c).toMatch(/^(image prune -f --filter label=org\.tincase\.app=repman|images --filter dangling=true)/);
    expect(f.calls().some((c) => c.startsWith('image prune'))).toBe(true);
  });

  it('[OPS-T17a] 치워서 5 GiB를 넘기면 그대로 빌드로 간다', () => {
    const f = fakeDocker({ deletingRounds: 1 });
    // 첫 번째 df는 2 GiB, 청소 뒤는 8 GiB
    const r = sh(
      `${f.prelude}
       root_avail_kib() { if [ -e "$STATE/cleaned" ]; then echo 8388608; else touch "$STATE/cleaned"; echo 2097152; fi; }
       ensure_disk_for_build test
       echo 빌드로-넘어감`,
      f.env,
    );
    expect(r.code).toBe(0);
    expect(r.out).toContain('빌드로-넘어감');
  });
});

describe('OPS-16 · OPS-43g 배포 금지 시간대 — bash 계산이 src/lib/week.ts와 같은 답인가', () => {
  /** bash week_window → { start, end, deadline } (epoch 초) */
  function bashWindow(monday: string, odow: number | null, otime: string | null, ps: DeadlinePolicy[]) {
    const pol = ps.map((p) => `'${p.deadlineDow}|${p.deadlineTime}'`).join(' ');
    const r = sh(`week_window ${monday} '${odow ?? ''}' '${otime ?? ''}' ${pol}`);
    expect(r.code, r.err).toBe(0);
    const [start, end, deadline] = r.out.trim().split(' ').map(Number);
    return { start, end, deadline };
  }

  const 목14: DeadlinePolicy = { deadlineDow: 4, deadlineTime: '14:00' };
  const cases: { name: string; monday: [number, number, number]; odow: number | null; otime: string | null; ps: DeadlinePolicy[] }[] = [
    { name: '평소 목 14:00', monday: [2026, 10, 5], odow: null, otime: null, ps: [목14] },
    { name: '연휴 — 수 14:00으로 당김 (WS-18)', monday: [2026, 9, 21], odow: 3, otime: '14:00', ps: [목14] },
    { name: '시각만 예외', monday: [2026, 10, 5], odow: null, otime: '12:00', ps: [목14] },
    { name: '부서마다 다르면 가장 이른 것', monday: [2026, 10, 5], odow: null, otime: null, ps: [목14, { deadlineDow: 3, deadlineTime: '17:30' }, { deadlineDow: 5, deadlineTime: '9:00' }] },
    { name: '월요일 마감 — 전날은 지난 주 일요일', monday: [2026, 10, 12], odow: 1, otime: '10:00', ps: [목14] },
    { name: '일요일 마감', monday: [2026, 10, 5], odow: 7, otime: '23:59', ps: [목14] },
    { name: '연말 W53 → 해 넘김', monday: [2026, 12, 28], odow: null, otime: null, ps: [{ deadlineDow: 5, deadlineTime: '14:00' }] },
    { name: '월말 넘김 (3월 1일 전날 = 2월 28일)', monday: [2027, 3, 1], odow: 1, otime: '09:00', ps: [목14] },
  ];

  for (const c of cases) {
    it(`[OPS-T18] ${c.name}`, () => {
      const opensAt = new Date(new TZDate(c.monday[0], c.monday[1] - 1, c.monday[2], 0, 0, 0, 0, KST).getTime());
      const deadline = earliestDeadline({ opensAt, deadlineDowOverride: c.odow, deadlineTimeOverride: c.otime }, c.ps);
      const monday = `${c.monday[0]}-${String(c.monday[1]).padStart(2, '0')}-${String(c.monday[2]).padStart(2, '0')}`;
      const w = bashWindow(monday, c.odow, c.otime, c.ps);
      expect(w.deadline * 1000).toBe(deadline.getTime());
      expect(w.start * 1000).toBe(dayBeforeAt(deadline, '11:30').getTime());
      expect(w.end * 1000).toBe(deadline.getTime() + 150 * 60_000);
    });
  }

  it('[OPS-T18a] 켜진 부서가 없으면 평소 마감(목 14:00) — slot-deadline.ts FALLBACK과 같다', () => {
    const opensAt = new Date(new TZDate(2026, 9, 5, 0, 0, 0, 0, KST).getTime());
    const w = bashWindow('2026-10-05', null, null, []);
    expect(w.deadline * 1000).toBe(earliestDeadline({ opensAt, deadlineDowOverride: null, deadlineTimeOverride: null }, []).getTime());
  });

  it('[OPS-T18b] 주차 키·월요일이 currentWeek와 같다 — 일요일 밤·월요일 0시·UTC 날짜가 다른 시각', () => {
    for (const iso of [
      '2026-10-04T23:59:00+09:00',
      '2026-10-05T00:00:00+09:00',
      '2026-10-04T15:30:00Z', // KST 월 00:30, UTC로는 일요일
      '2026-12-31T12:00:00+09:00',
      '2027-01-03T23:00:00+09:00',
    ]) {
      const now = new Date(iso);
      const r = sh(`window_keys ${Math.floor(now.getTime() / 1000)}`);
      const [m1, k1, , k2] = r.out.trim().split(' ');
      const w = currentWeek(now);
      const ko = new TZDate(mondayOf(now).getTime(), KST);
      expect(m1, iso).toBe(`${ko.getFullYear()}-${String(ko.getMonth() + 1).padStart(2, '0')}-${String(ko.getDate()).padStart(2, '0')}`);
      expect(k1, iso).toBe(w.isoKey);
      expect(k2, iso).toBe(currentWeek(new Date(now.getTime() + 7 * 86400_000)).isoKey);
    }
  });

  /** window_verdict → 0 가도 됨 · 1 금지 · 2 판정 못 함 */
  const verdict = (now: number, rows: string) =>
    Number(sh(`window_verdict ${now} $'${rows.replace(/\n/g, '\\n')}' >/dev/null && echo 0 || echo $?`).out.trim());

  it('[OPS-T19] 경계 — 수 11:30부터 목 16:30 전까지 막는다 (목 14:00 마감)', () => {
    const rows = 'div|4|14:00|';
    expect(verdict(at(2026, 10, 7, 11, 29), rows)).toBe(0);
    expect(verdict(at(2026, 10, 7, 11, 30), rows)).toBe(1);
    expect(verdict(at(2026, 10, 8, 14, 0), rows)).toBe(1);
    expect(verdict(at(2026, 10, 8, 16, 29), rows)).toBe(1);
    expect(verdict(at(2026, 10, 8, 16, 30), rows)).toBe(0);
    expect(verdict(at(2026, 10, 12, 10, 0), rows)).toBe(0); // 다음 주 월요일
  });

  it('[OPS-T19a] 이 주차만 수요일로 당기면 금지 시간대도 하루 당겨진다', () => {
    const rows = 'slot|2026-W41|3|14:00\ndiv|4|14:00|'; // sqlite3 -separator '|' 출력 그대로
    expect(verdict(at(2026, 10, 6, 11, 30), rows)).toBe(1); // 화 11:30
    expect(verdict(at(2026, 10, 8, 15, 0), rows)).toBe(0); // 목 15:00 — 평소라면 막혔을 시각
  });

  it('[OPS-T19b] 다음 주 마감이 월요일로 당겨지면 이번 주 일요일부터 막는다', () => {
    const rows = 'slot|2026-W42|1|10:00\ndiv|4|14:00|';
    expect(verdict(at(2026, 10, 11, 12, 0), rows)).toBe(1); // 일 12:00 — 이번 주(W41)의 마감은 이미 지났다
    expect(verdict(at(2026, 10, 11, 11, 0), rows)).toBe(0);
  });

  it('[OPS-T19c] 값이 이상하면 판정하지 못한다 — 막는 쪽(2)이다', () => {
    expect(verdict(at(2026, 10, 9, 10, 0), 'div|9|14:00|')).toBe(2);
    expect(verdict(at(2026, 10, 9, 10, 0), 'div|4|25:00|')).toBe(2);
    expect(verdict(at(2026, 10, 9, 10, 0), 'Error: no such table: WeekSlot')).toBe(2);
    expect(verdict(at(2026, 10, 9, 10, 0), '')).toBe(0); // 켜진 부서 없음 → 평소 마감, 금요일은 열려 있다
  });
});

describe('OPS-43h 테스트 서버 모드', () => {
  it('[OPS-T20] 시연(demo)으로 떠 있는데 변수 없이 올리려 하면 멈춘다. 명시하면 간다', () => {
    const v = (current: string, requested: string) =>
      sh(`test_mode_verdict '${current}' '${requested}' && echo 0 || echo $?`).out.trim();
    expect(v('demo', '')).toBe('1');
    expect(v('demo', 'demo')).toBe('0');
    expect(v('demo', 'test')).toBe('0'); // 되돌리려는 뜻을 적었다
    expect(v('test', '')).toBe('0');
    expect(v('', '')).toBe('0'); // 아직 떠 있지 않다
  });
});

describe('OPS-47 리허설 — 스케줄러는 시연 모드에서만, 덧붙이는 compose로', () => {
  it('[OPS-T34] 판정 — 시연 모드에서만 켠다. 평소 모드(실명 사본)·모드 없음은 멈춘다 · 값이 이상하면 멈춘다', () => {
    const v = (mode: string, on: string) => sh(`rehearsal_verdict '${mode}' '${on}' && echo 0 || echo $?`).out.trim();
    expect(v('demo', 'on')).toBe('0');
    expect(v('test', 'on')).toBe('1');
    expect(v('', 'on')).toBe('1');
    expect(v('demo', '')).toBe('0');
    expect(v('test', 'off')).toBe('0');
    expect(v('demo', 'yes')).toBe('2');
  });

  it('[OPS-T34b] 덧붙이는 파일은 스케줄러 한 줄만 바꾼다 — 저장소·띠·쿠키·메신저는 docker-compose.test.yml 그대로', () => {
    const extra = readFileSync(path.join(path.dirname(SCRIPT), '..', 'docker-compose.rehearsal.yml'), 'utf-8');
    const body = extra.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
    expect(body.map((l) => l.trim())).toEqual(['services:', 'app-test:', 'environment:', 'MERGE_SCHEDULER: "on"']);
  });
});

describe('OPS-43b·g·h 입구에서 끝까지 — main을 가짜 dk로 돌린다', () => {
  // 판정 함수가 옳아도 main이 그것을 부르지 않으면 소용없다 — 롤백 태그를 빼먹거나 순서가 바뀌는 사고는 여기서만 보인다.
  // docker·sudo·curl·df는 셸 함수로 바꿔 끼운다. 저장소는 임시 git(브랜치를 고를 수 있게)으로 REPO_ROOT를 바꾼다
  function runMain(args: string, opts: { branch?: string | null; env?: Record<string, string>; curl?: string } = {}) {
    state = mkdtempSync(path.join(os.tmpdir(), 'deploy-test-'));
    const repo = path.join(state, 'repo');
    const branch = opts.branch === undefined ? 'main' : opts.branch;
    const git =
      branch === null
        ? `mkdir -p "${repo}"` // git 저장소가 아니다 = 브랜치를 읽지 못한다 (root로 돈 경우와 같은 결과)
        : `git init -q -b ${branch} "${repo}" && git -C "${repo}" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init`;
    const r = sh(
      `${git}
       REPO_ROOT="${repo}"; LOCK_FILE="$STATE/lock"; HEALTH_TIMEOUT_SEC=1
       sudo() { :; }
       curl() { ${opts.curl ?? `printf '{"ok":true}\\n200'`}; }
       root_avail_kib() { echo 52428800; }
       dk() {
         printf '%s\\n' "$*" >> "$STATE/calls"
         case "$1 $2" in
           "inspect --format") [ "$3" = '{{.State.Running}}' ] && echo false || true ;;
           "image inspect") echo sha256:0123456789abcdef0123 ;;
           "image prune") echo 'Total reclaimed space: 0B' ;;
         esac
         return 0
       }
       main ${args}`,
      { ...opts.env, STATE: state },
    );
    let calls: string[] = [];
    try {
      calls = readFileSync(path.join(state, 'calls'), 'utf-8').trim().split('\n').filter(Boolean);
    } catch {
      /* docker를 한 번도 부르지 않았다 */
    }
    return { ...r, calls };
  }
  const idx = (calls: string[], re: RegExp) => calls.findIndex((c) => re.test(c));

  it('[OPS-T23] prod — 롤백 태그 → 빌드 → 기동 → 표식 청소 순서. 지우는 명령은 표식 prune뿐이다', () => {
    const r = runMain('prod');
    expect(r.code, r.err).toBe(0);
    const tag = idx(r.calls, /^tag repman:latest repman:rollback$/);
    const build = idx(r.calls, /^compose -f docker-compose\.yml -p repman build$/);
    const up = idx(r.calls, /^compose -f docker-compose\.yml -p repman up -d$/);
    const prune = idx(r.calls, /^image prune -f --filter label=org\.tincase\.app=repman$/);
    expect([tag, build, up, prune].every((i) => i >= 0), r.calls.join('\n')).toBe(true);
    expect(tag).toBeLessThan(build);
    expect(build).toBeLessThan(up);
    expect(up).toBeLessThan(prune);
    for (const c of r.calls.filter((c) => /\b(prune|rmi)\b/.test(c))) {
      expect(c).toBe('image prune -f --filter label=org.tincase.app=repman');
    }
  });

  it('[OPS-T23a] prod --no-build — 롤백 태그를 옮기지 않고 빌드 없이 다시 만든다', () => {
    const r = runMain('prod --no-build');
    expect(r.code, r.err).toBe(0);
    expect(r.calls.some((c) => c.startsWith('tag '))).toBe(false);
    expect(r.calls.some((c) => / build$/.test(c))).toBe(false);
    expect(r.calls).toContain('compose -f docker-compose.yml -p repman up -d --no-build --force-recreate');
  });

  it('[OPS-T23b] main이 아니거나 브랜치를 못 읽으면 운영은 docker를 부르기 전에 멈춘다 — --no-build도', () => {
    for (const [branch, args] of [
      ['feat/x', 'prod'],
      ['feat/x', 'prod --no-build --ignore-window'],
      [null, 'prod'],
    ] as const) {
      const r = runMain(args, { branch });
      expect(r.code, `${branch} ${args}`).toBe(1);
      expect(r.err).toMatch(/main에서만|브랜치를 읽지 못했다/);
      expect(r.calls, `${branch} ${args}`).toEqual([]);
    }
  });

  it('[OPS-T35b] health에 닿지 못하면(앱이 기동하다 멈춤 — 스키마 OPS-48 등) 로그의 FATAL 줄을 보라고 말한다 · 본문이 있으면 말하지 않는다', () => {
    // 컨테이너가 기동하다 끝나면 curl은 연결 실패와 000을 낸다
    const down = runMain('prod --no-build', { curl: `printf 'curl: (7) Failed to connect\\n000'` });
    expect(down.code).toBe(1);
    expect(down.err).toContain('health에 닿지 못했다');
    expect(down.err).toContain('sudo docker compose -f docker-compose.yml -p repman logs --tail 60 | grep -A8 FATAL');
    // 앱은 떴는데 판정이 실패한 것(양식 파일 없음 등)은 본문의 checks를 읽는다 — FATAL 안내는 없다
    const up = runMain('prod --no-build', { curl: `printf '{"ok":false,"checks":{"template":"fail"}}\\n503'` });
    expect(up.code).toBe(1);
    expect(up.err).toContain('ok:true가 아니다');
    expect(up.err).not.toContain('health에 닿지 못했다');
  }, 30_000); // health 대기(1초) 뒤 3초 쉼이 두 번

  it('[OPS-T34c] test + TINCASE_REHEARSAL=on — 시연 모드면 덧붙이는 compose로 다시 만든다 · 평소 모드면 docker를 부르기 전에 멈춘다', () => {
    const r = runMain('test --no-build', { branch: 'feat/x', env: { TINCASE_TEST_MODE: 'demo', TINCASE_REHEARSAL: 'on' } });
    expect(r.code, r.err).toBe(0);
    expect(r.calls).toContain(
      'TINCASE_TEST_MODE=demo compose -f docker-compose.test.yml -f docker-compose.rehearsal.yml -p repman-test up -d --no-build --force-recreate',
    );
    const plain = runMain('test --no-build', { branch: 'feat/x', env: { TINCASE_TEST_MODE: 'demo' } });
    expect(plain.calls.some((c) => c.includes('rehearsal'))).toBe(false); // 변수 없이 다시 올리면 꺼진다
    const bad = runMain('test --no-build', { branch: 'feat/x', env: { TINCASE_TEST_MODE: 'test', TINCASE_REHEARSAL: 'on' } });
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('OPS-47');
    expect(bad.calls.some((c) => c.startsWith('compose') || c.includes('up -d'))).toBe(false);
  });

  it('[OPS-T23c] test — TINCASE_TEST_MODE를 빌드·기동 모두에 sudo 뒤 환경으로 넘긴다. 운영 compose는 건드리지 않는다', () => {
    const r = runMain('test', { branch: 'feat/x', env: { TINCASE_TEST_MODE: 'demo' } });
    expect(r.code, r.err).toBe(0);
    expect(r.calls).toContain('TINCASE_TEST_MODE=demo compose -f docker-compose.test.yml -p repman-test build');
    expect(r.calls).toContain('TINCASE_TEST_MODE=demo compose -f docker-compose.test.yml -p repman-test up -d');
    expect(r.calls.some((c) => c.includes('docker-compose.yml') || c.startsWith('tag '))).toBe(false);
  });
});

describe('OPS-43b 입구', () => {
  it('[OPS-T21] 대상이 없거나 모르는 인자면 docker를 부르기 전에 끝난다', () => {
    const run = (...args: string[]) => spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8' });
    const none = run();
    expect(none.status).toBe(1);
    expect(none.stderr).toContain('사용법');
    expect(run('staging').status).toBe(1);
    expect(run('prune', '--no-build').status).toBe(1);
    const help = run('--help');
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('bash scripts/deploy.sh prune');
  });

  it('[OPS-T21a] bash 문법 검사를 통과한다', () => {
    expect(spawnSync('bash', ['-n', SCRIPT]).status).toBe(0);
  });
});
