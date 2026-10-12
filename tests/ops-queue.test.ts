// PG-90 · TACP-30 — `/ops` 「병합 줄」 카드: 이번 주 부서마다 한 줄(가장 최근 작업), 줄 순서로 — 운영자만.
//
// 카드는 서버가 그린다(새 API 없음). 화면은 서버 렌더 결과(첫 그림)로 본다 — 이 저장소에는 DOM 시험 도구가 없다.
// 부서 이름은 지어낸 것이다.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-opsq-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-opsq.db';
process.env.STORAGE_ROOT = TMP_STORAGE;
process.env.CF_ACCESS_TEAM = 'test-team';
delete process.env.DEV_IDENTITY;

const pageAs = vi.hoisted(() => ({ who: '' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers(pageAs.who ? { 'x-test-identity': pageAs.who } : {}) }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => {} }),
}));

const MIN = 60_000;
const D = new Date('2026-10-15T14:00:00+09:00');
const at = (minutes: number) => new Date(D.getTime() + minutes * MIN);

let slot: import('@prisma/client').WeekSlot;
const ID = { op: 'opsq-op@test.local', lead: 'opsq-lead@test.local' };

beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  rmSync(path.join(root, 'prisma/test-opsq.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  const { prisma } = await import('@/server/db');
  const { ensureCurrentSlot } = await import('@/server/worklog');
  slot = await ensureCurrentSlot(D);
  const mk = (slug: string, nameKo: string) => prisma.division.create({ data: { slug, nameKo, nameEn: slug, isActive: true } });
  const [a, b, c, d] = [await mk('Opsq_A', '가실'), await mk('Opsq_B', '나실'), await mk('Opsq_C', '다실'), await mk('Opsq_D', '라실')];
  await prisma.user.create({ data: { email: ID.op, name: '운영', divisionId: a.id, isOperator: true, divisionRole: 'lead', mustChangePassword: false } });
  await prisma.user.create({ data: { email: ID.lead, name: '담당', divisionId: b.id, divisionRole: 'lead', mustChangePassword: false } });
  const run = await prisma.mergeRun.create({
    data: {
      divisionId: a.id,
      weekSlotId: slot.id,
      status: 'succeeded',
      outputPath: 'm.hwp',
      sourceIds: '[]',
      ruleSnapshot: '{}',
      reviewJson: JSON.stringify({
        model: {
          used: true,
          tables: [
            { table: 'achievements', used: true, reason: null, kind: null },
            { table: 'plans', used: false, reason: '모델 호출 시간 초과', kind: 'timeout' },
            { table: 'notes', used: false, reason: '묶을 행 없음', kind: 'skipped' },
            { table: 'categories', used: true, reason: null, kind: null },
          ],
        },
      }),
      startedAt: at(1),
      finishedAt: at(2),
    },
  });
  const job = (divisionId: string, orderKey: number, data: Record<string, unknown>) =>
    prisma.mergeJob.create({ data: { divisionId, weekSlotId: slot.id, trigger: 'auto', orderKey, enqueuedAt: at(1), ...data } as never });
  await job(a.id, 1, { status: 'done', startedAt: at(1), finishedAt: at(2), mergeRunId: run.id, attempt: 1 });
  await job(d.id, 2, { status: 'failed', startedAt: at(2), finishedAt: at(3), errorText: '표 개수가 달라졌습니다 (3 → 2)', attempt: 1 });
  await job(b.id, 3, { status: 'running', startedAt: at(8), leaseUntil: at(20), attempt: 1 });
  await job(c.id, 4, { status: 'queued', trigger: 'manual' });
}, 60_000);

afterAll(() => {
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

describe('PG-90 `/ops` 「병합 줄」 카드', () => {
  it('[PG-T170] ★ 작업을 줄 순서로 — 순번 · 상태(끝 · 실패 · 병합 중 경과 · 줄 n번째) · 표별 모델 사용과 못 쓴 사유 · 머리의 「n/m 끝 · 대기 · 예상 끝」', async () => {
    const { MergeQueueCard } = await import('@/app/ops/MergeQueueCard');
    const out = renderToStaticMarkup(await MergeQueueCard({ slot, now: at(10) }));
    expect(out).toContain('병합 줄');
    expect(out).toMatch(/1\/4 끝 · 대기 1 · 예상 끝 14:\d\d/);
    const pos = (t: string) => out.indexOf(t);
    expect(pos('가실')).toBeLessThan(pos('라실'));
    expect(pos('라실')).toBeLessThan(pos('나실'));
    expect(pos('나실')).toBeLessThan(pos('다실'));
    expect(out).toContain('>끝<');
    expect(out).toContain('실패');
    expect(out).toContain('표 개수가 달라졌습니다 (3 → 2)');
    expect(out).toContain('병합 중 2:00');
    expect(out).toContain('줄 2번째');
    // 부르지 않은 표(특이 — 묶을 행 없음)는 세지 않는다: 3개 중 2개
    expect(out).toContain('2/3');
    expect(out).toContain('계획: 모델 호출 시간 초과');
    expect(out).toContain('모델 쉼');
  });

  it('[PG-T170] 이번 주 작업이 없으면 표 대신 「이번 주 병합 없음」', async () => {
    const { prisma } = await import('@/server/db');
    const { MergeQueueCard } = await import('@/app/ops/MergeQueueCard');
    const other = await prisma.weekSlot.create({
      data: { isoKey: '2026-W50', year: 2026, month: 12, weekOfMonth: 2, label: '12월 2주차', opensAt: new Date('2026-12-07T00:00:00+09:00') },
    });
    const out = renderToStaticMarkup(await MergeQueueCard({ slot: other, now: at(10) }));
    expect(out).toContain('이번 주 병합 없음');
    expect(out).not.toContain('<table');
  });

  it('[PG-T170] (TACP-30) 운영자가 아니면 `/ops`는 404 그대로 — 카드를 그리기 전에 멈춘다', async () => {
    const { default: OpsPage } = await import('@/app/ops/page');
    pageAs.who = ID.lead;
    const digest = await OpsPage()
      .then(() => null)
      .catch((e: { digest?: string }) => String(e.digest));
    expect(digest).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    pageAs.who = ID.op;
    await expect(OpsPage()).resolves.toBeTruthy();
  });
});
