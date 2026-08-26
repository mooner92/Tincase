// NT-T01~T08 — 메신저 알림.
//
// 실제 메신저 서버는 사내 전용 DNS(`tok.…`)라 이 환경에서 해석되지 않는다.
// 그래서 **모의 서버를 띄워 우리가 보내는 폼을 그대로 받아** 규격과 대조한다.
// 확인하는 것은 "보내졌는가"가 아니라 **"규격대로 만들어졌는가"**다 —
// 그건 여기서 끝까지 검증할 수 있고, 한글 깨짐·수신 실패의 원인은 거의 여기에 있다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';

(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test.db';
process.env.CF_ACCESS_TEAM = 'aidt-kei';
process.env.STORAGE_ROOT = '/tmp/tincase-messenger-test';

let server: Server;
let received: URLSearchParams[] = [];
let status = 200;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push(new URLSearchParams(body));
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body>OK</body></html>'); // 실제 서버도 HTML을 준다
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  process.env.MESSENGER_URL = `http://127.0.0.1:${port}/`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  received = [];
  status = 200;
  process.env.MESSENGER_ALLOWLIST = '21963';
});

/** env는 모듈 로드 시 굳는다 — 허용 목록을 바꿔 시험하려면 모듈을 새로 읽어야 한다 */
async function messenger() {
  vi.resetModules();
  return import('@/server/messenger');
}

describe('메신저 알림 (NT-T01~T08)', () => {
  it('[NT-T01] 문서 규격대로 폼을 만든다 — CMD·수신자·본문', async () => {
    const { sendAlert } = await messenger();
    const res = await sendAlert({
      recvIds: ['21963'],
      subject: '테스트 제목',
      contents: '첫 줄\n둘째 줄',
      url: 'http://example.invalid/x',
    });

    expect(res.sent).toEqual(['21963']);
    expect(received).toHaveLength(1);
    const f = received[0];
    expect(f.get('CMD')).toBe('ALERT');
    expect(f.get('Action')).toBe('ALERT');
    expect(f.get('RecvId')).toBe('21963');
    expect(f.get('Subject')).toBe('테스트 제목');
    expect(f.get('Contents')).toBe('첫 줄\n둘째 줄'); // 줄바꿈 보존
    expect(f.get('URL')).toBe('http://example.invalid/x');
  });

  it('[NT-T02] 텍스트 필드마다 `*_Encode=UTF-8`이 **쌍으로** 간다 (한글 깨짐의 원인)', async () => {
    const { sendAlert } = await messenger();
    await sendAlert({ recvIds: ['21963'], subject: '한글 제목', contents: '한글 본문', url: 'http://a.invalid' });
    const f = received[0];
    for (const k of ['SystemName', 'SendName', 'Subject', 'Contents', 'URL']) {
      expect(f.get(k), `${k} 값`).toBeTruthy();
      expect(f.get(`${k}_Encode`), `${k}_Encode`).toBe('UTF-8');
    }
  });

  it('[NT-T03] 허용 목록 밖은 **보내지 않는다** — 실수로 전원에게 가지 않게', async () => {
    const { sendAlert } = await messenger();
    const res = await sendAlert({ recvIds: ['21963', '10196', '99999'], subject: 's', contents: 'c' });

    expect(res.sent).toEqual(['21963']);
    expect(res.blocked.sort()).toEqual(['10196', '99999']);
    expect(received[0].get('RecvId')).toBe('21963'); // 나머지는 요청에 아예 실리지 않는다
  });

  it('[NT-T04] 허용 목록이 비면 **아무에게도 안 간다** (닫힘이 기본값)', async () => {
    process.env.MESSENGER_ALLOWLIST = '';
    const { sendAlert } = await messenger();
    const res = await sendAlert({ recvIds: ['21963'], subject: 's', contents: 'c' });

    expect(res.sent).toEqual([]);
    expect(res.disabled).toBe(true);
    expect(received).toHaveLength(0); // 요청 자체가 나가지 않는다
  });

  it('[NT-T05] `*`면 전원에게 간다 — 의도적으로 켰을 때만', async () => {
    process.env.MESSENGER_ALLOWLIST = '*';
    const { sendAlert } = await messenger();
    const res = await sendAlert({ recvIds: ['21963', '10196'], subject: 's', contents: 'c' });
    expect(res.sent.sort()).toEqual(['10196', '21963']);
    expect(received[0].get('RecvId')).toBe('21963,10196'); // 공백 없는 콤마
  });

  it('[NT-T06] 50명 단위로 나눠 보낸다 (문서 05 권장)', async () => {
    process.env.MESSENGER_ALLOWLIST = '*';
    const { sendAlert } = await messenger();
    const ids = Array.from({ length: 120 }, (_, i) => String(10000 + i));
    const res = await sendAlert({ recvIds: ids, subject: 's', contents: 'c' });

    expect(res.sent).toHaveLength(120);
    expect(received).toHaveLength(3); // 50 + 50 + 20
    expect(received[0].get('RecvId')!.split(',')).toHaveLength(50);
  });

  it('[NT-T07] 서버가 실패해도 **던지지 않는다** — 알림 때문에 본업이 멈추면 안 된다', async () => {
    status = 500;
    const { sendAlert } = await messenger();
    const res = await sendAlert({ recvIds: ['21963'], subject: 's', contents: 'c' });

    expect(res.sent).toEqual([]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain('500');
  });

  it('[NT-T08] URL이 없으면 URL·Option을 아예 넣지 않는다', async () => {
    const { sendAlert } = await messenger();
    await sendAlert({ recvIds: ['21963'], subject: 's', contents: 'c' });
    expect(received[0].has('URL')).toBe(false);
    expect(received[0].has('Option')).toBe(false);
  });
});
