// NT-44a · NT-44b · NT-47a (2026-10-10 알림 점검) — 마감 뒤 쪽지의 할 일이 v2의 실제 흐름과 맞는가.
//
//   merge_review        「고칠 부분을 알려주세요」는 담당자에게 말하라는 뜻으로 읽혔다 → 단추 이름([고칠 것 없음 · 승인])과 「고쳐 저장 = 승인」
//   merge_missing · ①   「제출된 파일」은 v1 낱말 · 낸 사람이 0이면 [지금 병합]을 누를 일이 없다 → 「이번 주 제출이 한 건도 없어…」
//   merge_done ② 승인 뒤 바뀜   3단계가 꺼져 있으면 부서장에게 「다시 승인」 쪽지가 가지 않는다 → 「직접 부탁해 주세요」 (켜져 있으면 넣지 않는다)
//   그대로 둔 것        끝 줄 「취합게시판 … 웹디스크」 — 운영자가 정할 일(docs/KNOWN-ISSUES-v2.md 열린 질문)
//
// 문구는 순수 함수(composeNotice)로 본다 — DB가 없다. 사람·부서는 지어낸 것이다.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-notify-wording.db'; // 모듈을 읽을 때만 — 연결하지 않는다
process.env.STORAGE_ROOT = mkdtempSync(path.join(tmpdir(), 'tincase-wording-'));
process.env.CF_ACCESS_TEAM = 'test-team';
delete process.env.DEV_IDENTITY;

const who = { name: '이름예시', employeeNo: 'E0001' };
type Facts = Parameters<typeof import('@/server/notify/merge-notices').composeNotice>[4];
const base: Facts = {
  ok: true,
  sources: 3,
  counts: { achievements: 4, plans: 2, notes: 0 },
  flagged: [],
  stale: 0,
  approval: null,
  hasHead: true,
  submitTo: null,
  submitDue: null,
  submitted: 3,
};
const msg = async (kind: 'merge_review' | 'merge_missing' | 'merge_done', f: Partial<Facts> = {}) => {
  const { composeNotice } = await import('@/server/notify/merge-notices');
  return composeNotice(kind, who, '10월 2주차', false, { ...base, ...f });
};

describe('[NT-T86] ★ 마감 뒤 쪽지의 할 일 — v2 흐름에 맞춘 문구 (2026-10-10)', () => {
  it('merge_review — 단추 이름 [고칠 것 없음 · 승인]과 「고쳐 저장하면 그것이 승인」, 예전 「고칠 부분을 알려주세요」는 없다 (NT-44b)', async () => {
    const m = await msg('merge_review');
    expect(m.contents).toContain('Tincase 수합 관리에서 확인하고, 고칠 것이 없으면 [고칠 것 없음 · 승인]을 눌러 주세요.');
    expect(m.contents).toContain('고칠 곳은 직접 고쳐 저장하면 그것이 승인입니다 — 담당자에게 바로 알려집니다.');
    expect(m.contents).not.toContain('고칠 부분을 알려주세요');
    // 쪽지가 부르는 단추 이름이 화면의 단추와 글자까지 같다
    for (const f of ['src/components/MergePanel.tsx', 'src/components/MergedDrawer.tsx']) {
      expect(readFileSync(path.join(ROOT, f), 'utf8'), f).toContain('고칠 것 없음 · 승인');
    }
  });

  it('merge_missing — 낸 사람이 0이면 「한 건도 없어」 · [지금 병합] 없음 / 있으면 「병합에 실패했어요」 + [지금 병합] / 모르면 둘 다 (NT-44a)', async () => {
    const none = await msg('merge_missing', { ok: false, submitted: 0 });
    expect(none.contents).toContain('이번 주 제출이 한 건도 없어 병합본을 만들지 않았어요.');
    expect(none.contents).not.toContain('[지금 병합]');
    const failed = await msg('merge_missing', { ok: false, submitted: 2 });
    expect(failed.contents).toContain('병합에 실패했어요.');
    expect(failed.contents).toContain('[지금 병합]');
    const unknown = await msg('merge_missing', { ok: false, submitted: undefined });
    expect(unknown.contents).toContain('제출이 없거나 병합에 실패했을 수 있어요.');
    for (const m of [none, failed, unknown]) expect(m.contents).not.toContain('제출된 파일'); // v1 낱말
  });

  it('merge_done ① — 병합본이 없을 때도 같은 갈래: 낸 사람이 0이면 [지금 병합]을 시키지 않는다 (NT-44a)', async () => {
    const none = await msg('merge_done', { ok: false, submitted: 0 });
    expect(none.contents).toContain('이번 주 제출이 한 건도 없어 병합본을 만들지 않았어요.');
    expect(none.contents).not.toContain('[지금 병합]');
    const failed = await msg('merge_done', { ok: false, submitted: 2 });
    expect(failed.contents).toContain('[지금 병합]');
  });

  it('merge_done ② 승인 뒤 바뀜 — 3단계가 꺼져 있으면 「직접 부탁해 주세요」, 켜져 있으면 넣지 않는다 (NT-47a)', async () => {
    const approval = { by: '장 실장', at: new Date('2026-10-15T05:12:00Z'), summary: '고친 곳 없음', changedAfter: true };
    const off = await msg('merge_done', { approval });
    expect(off.contents).toContain('장 실장님이 승인한 뒤 병합본이 바뀌었어요 — 다시 확인을 받아주세요.');
    expect(off.contents).toContain('부서장에게는 쪽지가 가지 않으니 직접 부탁해 주세요.');
    const on = await msg('merge_done', { approval, submitTo: '기획경영본부', submitDue: '15:00' });
    expect(on.contents).not.toContain('직접 부탁해 주세요'); // 3단계에서는 부서장에게 「다시 승인해 주세요」(NT-52)가 간다
    // 승인이 그대로면 그 줄이 없다
    const kept = await msg('merge_done', { approval: { ...approval, changedAfter: false } });
    expect(kept.contents).not.toContain('직접 부탁해 주세요');
  });

  it('그대로 둔 것 — 3단계가 꺼진 담당자 끝 줄 「취합게시판 … 웹디스크」는 바꾸지 않았다(운영자가 정할 일)', async () => {
    const m = await msg('merge_done');
    expect(m.contents.split('\n').slice(-2)).toEqual(['Tincase에서 hwp로 받아 취합게시판에 올리고', '웹디스크에 업로드해주세요.']);
  });
});
