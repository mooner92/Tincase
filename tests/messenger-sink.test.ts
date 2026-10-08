// NT-56 · OPS-46 · TACP-26 — 가짜 알림 수신함(더미 메신저).
//
// 지키는 것 셋:
//   ① 문 — 시험·시연 서버 + MESSENGER_SINK=on일 때만 열린다. 운영에서는 경로·화면·비우기가 누구에게나 404다
//   ② 기동 — 운영이 수신함으로, 시험 서버가 실제 메신저로 보내는 설정이면 서버가 뜨지 않는다
//   ③ 왕복 — 메신저 클라이언트(sendAlert)가 **진짜 메신저에 보내는 것과 똑같이** 보낸 것을 수신함이 받아 적는다.
//      종류 머리(x-tincase-kind)는 수신함으로 갈 때만 붙는다 — 진짜 메신저가 받는 요청은 그대로다
//
// DB: prisma/test-sink.db — 이 파일 전용.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isSinkUrl, sinkBootProblem, sinkOpen, SINK_PATH } from '@/lib/messenger-sink';

const root = path.resolve(__dirname, '..');
const STORAGE = mkdtempSync(path.join(tmpdir(), 'tincase-sink-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-sink.db';
process.env.STORAGE_ROOT = STORAGE;
process.env.CF_ACCESS_TEAM = 'test-team';
delete process.env.DEV_IDENTITY;

const pageAs = vi.hoisted(() => ({ who: '' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers(pageAs.who ? { 'x-test-identity': pageAs.who } : {}) }));

const OP = 'sink-op@example.invalid';
const MEMBER = 'sink-member@example.invalid';
const HEAD = 'sink-head@example.invalid';

/** env는 모듈을 읽을 때 굳는다 — 서버 모양을 바꿔 시험하려면 모듈을 새로 읽는다 */
async function asServer(env: Record<string, string>) {
  for (const k of ['TINCASE_ENV', 'MESSENGER_SINK', 'MESSENGER_URL', 'MESSENGER_ALLOWLIST']) delete process.env[k];
  Object.assign(process.env, env);
  vi.resetModules();
  return {
    sinkRoute: await import('@/app/api/dev/messenger-sink/route'),
    clearRoute: await import('@/app/api/ops/notify-sink/route'),
    page: (await import('@/app/ops/notify-sink/page')).default,
    messenger: await import('@/server/messenger'),
    store: await import('@/server/messenger-sink'),
  };
}

const nx = (url: string, init: RequestInit & { who?: string } = {}) => {
  const { who, ...rest } = init;
  const r = new Request(`http://test.local${url}`, { ...rest, headers: { ...(rest.headers ?? {}), ...(who ? { 'x-test-identity': who } : {}) } });
  (r as unknown as { nextUrl: URL }).nextUrl = new URL(`http://test.local${url}`);
  return r as never;
};

/** 페이지가 던진 Next 신호(notFound·redirect)의 digest — 그렸으면 null */
async function visit(page: (p: { searchParams: Promise<Record<string, string>> }) => Promise<unknown>, who: string) {
  pageAs.who = who;
  try {
    await page({ searchParams: Promise.resolve({}) });
    return null;
  } catch (e) {
    return String((e as { digest?: string }).digest);
  } finally {
    pageAs.who = '';
  }
}
const NF = 'NEXT_HTTP_ERROR_FALLBACK;404';

beforeAll(async () => {
  rmSync(path.join(root, 'prisma/test-sink.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  const { prisma } = await import('@/server/db');
  const d = await prisma.division.create({ data: { slug: 'Sink_Div', shortSlug: 'sk', nameKo: '수신부서', nameEn: 'Sink Div', isActive: true } });
  await prisma.user.create({ data: { email: OP, name: '운영', divisionId: d.id, isOperator: true, mustChangePassword: false } });
  await prisma.user.create({ data: { email: MEMBER, name: '부원', divisionId: d.id, mustChangePassword: false } });
  await prisma.user.create({ data: { email: HEAD, name: '수신부서장', divisionId: d.id, divisionRole: 'head', employeeNo: 'T001', mustChangePassword: false } });
}, 60_000);

afterAll(async () => {
  const { prisma } = await import('@/server/db');
  await prisma.$disconnect();
  rmSync(path.join(root, 'prisma/test-sink.db'), { force: true });
  rmSync(STORAGE, { recursive: true, force: true });
});

describe('[NT-T75] 문 — 시험·시연 서버 그리고 MESSENGER_SINK=on', () => {
  it('판정 표', () => {
    const cases: [string | undefined, string | undefined, boolean][] = [
      ['test', 'on', true],
      ['demo', 'on', true],
      ['test', 'off', false],
      ['demo', undefined, false],
      ['', 'on', false], // 운영 — 스위치를 켜도 닫혀 있다
      [undefined, 'on', false],
      ['production', 'on', false],
      ['rehearsal', 'on', false],
    ];
    for (const [TINCASE_ENV, MESSENGER_SINK, open] of cases) expect(sinkOpen({ TINCASE_ENV, MESSENGER_SINK }), `${TINCASE_ENV}/${MESSENGER_SINK}`).toBe(open);
  });
  it('수신함 주소는 경로로 알아본다 — 호스트·포트·끝 빗금과 상관없이', () => {
    expect(isSinkUrl(`http://127.0.0.1:3000${SINK_PATH}`)).toBe(true);
    expect(isSinkUrl(`http://app:3000${SINK_PATH}/`)).toBe(true);
    expect(isSinkUrl('http://messenger.example.com:12555/')).toBe(false);
    expect(isSinkUrl(`http://x${SINK_PATH}x`)).toBe(false);
    expect(isSinkUrl('')).toBe(false);
    expect(isSinkUrl('not a url')).toBe(false);
  });
});

describe('[NT-T76] ★ 기동 거부 (OPS-46) — 알림이 엉뚱한 곳으로 가는 설정이면 뜨지 않는다', () => {
  const SINK = `http://127.0.0.1:3000${SINK_PATH}`;
  const REAL = 'http://messenger.example.com:12555/';
  it('판정 표', () => {
    const ok = (e: Parameters<typeof sinkBootProblem>[0]) => sinkBootProblem(e) === null;
    // 괜찮은 것
    expect(ok({ TINCASE_ENV: '', MESSENGER_URL: REAL })).toBe(true); // 운영
    expect(ok({ TINCASE_ENV: '', MESSENGER_URL: '' })).toBe(true); // 알림 끔
    expect(ok({ TINCASE_ENV: 'test', MESSENGER_URL: SINK, MESSENGER_SINK: 'on' })).toBe(true);
    expect(ok({ TINCASE_ENV: 'demo', MESSENGER_URL: SINK, MESSENGER_SINK: 'on' })).toBe(true);
    expect(ok({ TINCASE_ENV: 'test', MESSENGER_URL: '' })).toBe(true); // 예전 테스트 서버(알림 끔)
    // 거부
    expect(sinkBootProblem({ TINCASE_ENV: '', MESSENGER_URL: SINK, MESSENGER_SINK: 'on' })).toMatch(/운영 알림이 아무에게도/);
    expect(sinkBootProblem({ TINCASE_ENV: 'test', MESSENGER_URL: REAL })).toMatch(/실제 사람에게 알림이 갑니다/);
    expect(sinkBootProblem({ TINCASE_ENV: 'demo', MESSENGER_URL: REAL, MESSENGER_SINK: 'on' })).toMatch(/실제 사람에게/);
    expect(sinkBootProblem({ TINCASE_ENV: 'test', MESSENGER_URL: SINK, MESSENGER_SINK: 'off' })).toMatch(/404로 실패/);
  });

  it('env.ts가 읽히는 순간 멈춘다 — 시험 서버가 실제 메신저 주소를 받으면 process.exit(1)', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(asServer({ TINCASE_ENV: 'test', MESSENGER_URL: REAL })).rejects.toThrow('exit 1');
      expect(err.mock.calls.flat().join(' ')).toContain('OPS-46');
    } finally {
      exit.mockRestore();
      err.mockRestore();
    }
  });

  it('기동할 때 검사한다 — instrumentation이 env를 먼저 읽고 · 컨테이너 입구(entrypoint.sh)도 같은 판정', () => {
    const inst = readFileSync(path.join(root, 'src/instrumentation.ts'), 'utf8');
    const reg = inst.slice(inst.indexOf('export async function register'));
    expect(reg.indexOf("await import('./server/env')")).toBeGreaterThan(-1);
    expect(reg.indexOf("await import('./server/env')")).toBeLessThan(reg.indexOf("MERGE_SCHEDULER === 'off'")); // 스케줄러가 꺼진 서버에서도
    const sh = readFileSync(path.join(root, 'scripts/entrypoint.sh'), 'utf8');
    expect(sh).toContain('*/api/dev/messenger-sink');
    expect(sh).toMatch(/test \| demo\) TRIAL=1/);
    expect(sh).toContain('[ "${MESSENGER_SINK:-}" != "on" ]'); // 셋째 경우(수신함 주소인데 스위치 꺼짐)도 같은 판정
  });
});

describe('[NT-T77] ★ 운영에서는 404 — 경로·화면·비우기 모두, 운영자에게도 (TACP-5 · TACP-26)', () => {
  it('운영(TINCASE_ENV 없음) — MESSENGER_SINK=on이어도', async () => {
    const s = await asServer({ MESSENGER_SINK: 'on' });
    const form = 'CMD=ALERT&Action=ALERT&RecvId=T001&Subject=x&Contents=y';
    expect((await s.sinkRoute.POST(nx(SINK_PATH, { method: 'POST', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } }))).status).toBe(404);
    expect((await s.sinkRoute.GET(nx(SINK_PATH))).status).toBe(404);
    expect((await s.clearRoute.DELETE(nx('/api/ops/notify-sink', { method: 'DELETE', who: OP }))).status).toBe(404);
    expect(await visit(s.page as never, OP)).toBe(NF);
    expect(await s.store.readSinkEntries()).toEqual([]); // 아무것도 적지 않았다
  });
  it('시험 서버라도 스위치가 없으면 닫혀 있다', async () => {
    const s = await asServer({ TINCASE_ENV: 'test' });
    expect((await s.sinkRoute.GET(nx(SINK_PATH))).status).toBe(404);
    expect(await visit(s.page as never, OP)).toBe(NF);
  });
});

describe('[NT-T78] ★ 왕복 — 클라이언트가 진짜 메신저에 보내는 것 그대로 받아 적는다', () => {
  let server: Server;
  let port = 0;
  let route: Awaited<ReturnType<typeof asServer>>['sinkRoute'] | null = null;
  const seenHeaders: IncomingHttpHeaders[] = [];

  beforeAll(async () => {
    // 같은 앱의 경로 처리기를 HTTP 뒤에 둔다 — 클라이언트는 진짜 HTTP로 보낸다
    server = createServer(async (req, res) => {
      seenHeaders.push(req.headers);
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = Buffer.concat(chunks);
      if (!route || !req.url?.startsWith(SINK_PATH)) {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('send ok\n'); // 「진짜 메신저」 흉내 — 머리만 본다
        return;
      }
      const headers: Record<string, string> = {};
      for (const k of ['content-type', 'x-tincase-kind', 'content-length']) if (req.headers[k]) headers[k] = String(req.headers[k]);
      const out = await route.POST(nx(req.url, { method: req.method, headers, body: body.length ? body : undefined }));
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(Buffer.from(await out.arrayBuffer()));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('sendAlert → 수신함: 종류 · 받는 사람(사번 → 가짜 사람) · 제목 · 본문 · 주소 · 폼 16개 필드 · 응답은 「send ok」', async () => {
    const s = await asServer({ TINCASE_ENV: 'test', MESSENGER_SINK: 'on', MESSENGER_URL: `http://127.0.0.1:${port}${SINK_PATH}`, MESSENGER_ALLOWLIST: '*' });
    route = s.sinkRoute;
    const { logger } = await import('@/server/logger');
    const warn = vi.spyOn(logger, 'warn');
    const r = await s.messenger.sendAlert({ recvIds: ['T001'], subject: '[Tincase] 검토 부탁드려요', contents: '첫 줄\n둘째 줄', url: 'http://example.invalid/x/manage', kind: 'merge_review' });
    expect(r).toMatchObject({ sent: ['T001'], errors: [], disabled: false });
    // 응답이 진짜 메신저와 같은 「send ok」라 클라이언트가 「처음 보는 응답」 경고를 내지 않는다
    expect(warn.mock.calls.flat().join(' ')).not.toContain('처음 보는 응답');
    warn.mockRestore();

    const [e] = await s.store.readSinkEntries();
    expect(e).toMatchObject({
      kind: 'merge_review',
      base: 'merge_review',
      recipients: [{ employeeNo: 'T001', email: HEAD, name: '수신부서장' }],
      subject: '[Tincase] 검토 부탁드려요',
      contents: '첫 줄\n둘째 줄',
      url: 'http://example.invalid/x/manage',
    });
    expect(Date.parse(e.at)).toBeGreaterThan(Date.now() - 60_000);
    // messenger.md §6 — 사내 샘플 폼과 같은 16개 필드
    expect(Object.keys(e.form).sort()).toEqual(
      ['Action', 'CMD', 'Contents', 'Contents_Encode', 'Option', 'RecvId', 'SendID', 'SendName', 'SendName_Encode', 'Subject', 'Subject_Encode', 'SystemName', 'SystemName_Encode', 'URL', 'URL_Encode', 'key'].sort(),
    );
    expect(seenHeaders.at(-1)?.['x-tincase-kind']).toBe('merge_review');
  });

  it('모르는 사번도 적는다(누구에게 갔어야 했나) · 규격을 어긴 요청은 422로 돌려보낸다 · 운영자 화면에 보이고 [비우기]로 지운다', async () => {
    const s = await asServer({ TINCASE_ENV: 'demo', MESSENGER_SINK: 'on', MESSENGER_URL: `http://127.0.0.1:${port}${SINK_PATH}`, MESSENGER_ALLOWLIST: '*' });
    route = s.sinkRoute;
    await s.messenger.sendAlert({ recvIds: ['NOPE9'], subject: 's', contents: 'c', kind: 'ru_org_ready:u1' });
    const last = (await s.store.readSinkEntries()).at(-1)!;
    expect(last.recipients).toEqual([{ employeeNo: 'NOPE9', email: '', name: '' }]);
    expect(last.base).toBe('ru_org_ready');
    const bad = await s.sinkRoute.POST(nx(SINK_PATH, { method: 'POST', body: 'CMD=MSG&RecvId=', headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
    expect(bad.status).toBe(422);
    // 신원 없이 열린 경로 — 길이 머리가 없어도 64KB를 넘으면 끝까지 읽지 않고 413, 아무것도 적지 않는다
    const before = (await s.store.readSinkEntries()).length;
    const big = await s.sinkRoute.POST(nx(SINK_PATH, { method: 'POST', body: `CMD=ALERT&RecvId=T001&Contents=${'a'.repeat(70_000)}` }));
    expect(big.status).toBe(413);
    expect(await s.store.readSinkEntries()).toHaveLength(before);
    expect((await s.sinkRoute.GET(nx(SINK_PATH))).status).toBe(200);

    // TACP-26 — 화면·비우기는 운영자만
    expect(await visit(s.page as never, MEMBER)).toBe(NF);
    expect(await visit(s.page as never, OP)).toBeNull();
    expect((await s.clearRoute.DELETE(nx('/api/ops/notify-sink', { method: 'DELETE', who: MEMBER }))).status).toBe(404);
    expect((await s.clearRoute.DELETE(nx('/api/ops/notify-sink', { method: 'DELETE', who: HEAD }))).status).toBe(404);
    const n = (await s.store.readSinkEntries()).length;
    const cleared = await s.clearRoute.DELETE(nx('/api/ops/notify-sink', { method: 'DELETE', who: OP }));
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ ok: true, removed: n });
    expect(await s.store.readSinkEntries()).toEqual([]);
  });

  it('진짜 메신저 주소로 보낼 때는 종류 머리가 붙지 않는다 — 운영 메신저가 받는 요청은 그대로다', async () => {
    const s = await asServer({ MESSENGER_URL: `http://127.0.0.1:${port}/`, MESSENGER_ALLOWLIST: 'T001' });
    route = null;
    await s.messenger.sendAlert({ recvIds: ['T001'], subject: 's', contents: 'c', kind: 'merge_review' });
    expect(seenHeaders.at(-1)?.['x-tincase-kind']).toBeUndefined();
  });
});

describe('[NT-T79] 시험 서버 compose — 알림은 같은 컨테이너의 수신함으로, 허용 목록은 「*」', () => {
  it('docker-compose.test.yml', () => {
    const c = readFileSync(path.join(root, 'docker-compose.test.yml'), 'utf8');
    expect(c).toMatch(new RegExp(`MESSENGER_URL: http://127\\.0\\.0\\.1:3000${SINK_PATH}\\n`));
    expect(c).toMatch(/MESSENGER_SINK: "on"/);
    expect(c).toMatch(/MESSENGER_ALLOWLIST: "\*"/);
    // 스케줄러는 그대로 꺼져 있다 — 리허설만 덧붙이는 compose로 켠다(OPS-47)
    expect(c).toMatch(/MERGE_SCHEDULER: "off"/);
    // 운영 compose에는 수신함이 없다
    const prod = readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
    expect(prod).not.toContain('messenger-sink');
    expect(prod).not.toContain('MESSENGER_SINK');
  });
});

describe('[NT-T80] 보내는 곳은 모두 종류를 싣는다 (NT-56c) — 빠지면 수신함에 「종류 없음」, 리허설은 뜻밖의 알림으로 잡는다', () => {
  it('src의 sendAlert 호출마다 `kind` — 갈래를 합칠 때 새 알림(「병합 점검」)이 빠졌던 자리', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = path.join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
      });
    const calls: { at: string; args: string }[] = [];
    for (const file of walk(path.join(root, 'src'))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bsendAlert\(/g)) {
        if (/function\s+sendAlert\($/.test(src.slice(Math.max(0, m.index - 30), m.index + 10))) continue; // 정의
        // 괄호를 맞춰 인자 전체를 잘라 낸다
        let depth = 0;
        let end = m.index + m[0].length - 1;
        for (; end < src.length; end++) {
          if (src[end] === '(') depth++;
          else if (src[end] === ')' && --depth === 0) break;
        }
        calls.push({ at: `${path.relative(root, file)}:${src.slice(0, m.index).split('\n').length}`, args: src.slice(m.index, end + 1) });
      }
    }
    // 객체의 맨 위 칸만 본다 — `...batchMessage(p, slot, report, kind, now)`처럼 다른 함수에 넘기는 `kind`는 싣는 것이 아니다
    const topLevel = (args: string) => {
      let depth = 0;
      let out = '';
      for (const ch of args) {
        if ('([{'.includes(ch)) depth++;
        if (depth === 2) out += ch;
        if (')]}'.includes(ch)) depth--;
      }
      return out;
    };
    expect(calls.length).toBeGreaterThanOrEqual(9);
    expect(calls.filter((c) => !/\bkind\b/.test(topLevel(c.args))).map((c) => c.at)).toEqual([]);
  });

  it('수신함 화면은 「병합 점검」을 이름으로 보인다', async () => {
    const { SINK_KIND_LABEL, kindBase } = await import('@/lib/messenger-sink');
    expect(SINK_KIND_LABEL[kindBase('merge_batch:1760504400000:u1')]).toBe('병합 점검');
    expect(SINK_KIND_LABEL[kindBase('merge_batch_done:1760504400000:u1')]).toBe('병합 점검 완료');
  });
});
