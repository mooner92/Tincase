/**
 * OPS-47 — 가짜 병합 모델. ollama `/api/generate`를 흉내 낸다: 묶을 것은 없다고(`duplicates: []`), 분류는 첫 이름으로 답한다 —
 * 병합은 결정론 결과 그대로 완결된다. 진짜 모델 없이도 「모델 호출 → 검증 → 조립」 길과 상주(keep_alive)·데우기 호출을 끝까지 탄다.
 * 리허설(`scripts/rehearsal.ts local` · `fake-model`)이 쓴다. 이 서버가 받은 요청 수를 센다 — 정말 불렸는지 보려고.
 */
import http from 'node:http';

export interface FakeModel {
  server: http.Server;
  /** `/api/generate`를 받은 횟수 */
  calls: () => number;
}

type Body = { model?: string; format?: { properties?: Record<string, { properties?: Record<string, { enum?: string[] }> }> } };

/** 응답 본문(response 글자) — 순수. 요청의 `format`(JSON 스키마)을 보고 고른다 */
export function fakeModelReply(body: Body): string {
  const props = body.format?.properties ?? {};
  if (props.duplicates) return JSON.stringify({ duplicates: [] });
  if (props.assign) {
    const ids = Object.entries(props.assign.properties ?? {});
    return JSON.stringify({ assign: Object.fromEntries(ids.map(([id, p]) => [id, p.enum?.[0] ?? '기타'])) });
  }
  return ''; // 데우기(빈 프롬프트)
}

export function fakeModelServer(delayMs: number): FakeModel {
  let n = 0;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body: Body = {};
      try {
        body = JSON.parse(raw || '{}') as Body;
      } catch {
        /* 빈 본문 */
      }
      const generate = (req.url ?? '').startsWith('/api/generate');
      if (generate) n++;
      setTimeout(
        () => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ model: body.model ?? 'fake', response: generate ? fakeModelReply(body) : '', done: true }));
        },
        generate ? delayMs : 0,
      );
    });
  });
  return { server, calls: () => n };
}
