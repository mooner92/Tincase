// HM-47 — 부서장이 **어떻게** 고쳤나. 담당자가 알림 한 통으로 알아야 하는 것이다.
import { describe, expect, it } from 'vitest';
import { describeChange, diffTable, diffWorklog, summarizeChanges, type DiffRow } from '@/lib/merge-diff';

const r = (content: string, extra: Partial<DiffRow> = {}): DiffRow => ({ content, date: '', place: '', attendee: '', emphasis: false, ...extra });

describe('HM-47 바뀐 곳 계산', () => {
  it('[HM-T106] 글을 고친 줄은 「고침」 — 전·후가 같이 남는다', () => {
    const c = diffTable('achievements', [r('보도자료 배포(1건)'), r('웹진 발송')], [r('보도자료 배포(2건)'), r('웹진 발송')]);
    expect(c).toEqual([{ bucket: 'achievements', op: 'edit', before: '보도자료 배포(1건)', after: '보도자료 배포(2건)' }]);
    expect(describeChange(c[0])).toBe('실적 「보도자료 배포(1건)」 → 「보도자료 배포(2건)」');
  });

  it('[HM-T107] 뺀 줄·더한 줄·옮긴 줄을 가른다 — 순서만 바꾼 것을 「뺌+더함」으로 겁주지 않는다', () => {
    const before = [r('가'), r('나'), r('다'), r('라')];
    const after = [r('다'), r('가'), r('나'), r('마')];
    const c = diffTable('plans', before, after);
    expect(c.filter((x) => x.op === 'move').map((x) => x.before)).toEqual(['다']);
    expect(c.find((x) => x.op === 'edit')).toMatchObject({ before: '라', after: '마' });
    expect(summarizeChanges(c)).toBe('계획 1줄 고침 · 1줄 옮김');

    const removed = diffTable('plans', [r('가'), r('나')], [r('가')]);
    expect(removed).toEqual([{ bucket: 'plans', op: 'remove', before: '나' }]);
    const added = diffTable('plans', [r('가')], [r('가'), r('나')]);
    expect(added).toEqual([{ bucket: 'plans', op: 'add', after: '나' }]);
  });

  it('[HM-T108] 내용은 같고 일자·공유 표시만 바꾼 것도 「고침」 — 무엇을 바꿨는지 칸 이름으로', () => {
    const c = diffTable('achievements', [r('포럼 참석', { date: '10/8' })], [r('포럼 참석', { date: '10/9', emphasis: true })]);
    expect(c).toEqual([{ bucket: 'achievements', op: 'edit', before: '포럼 참석', after: '포럼 참석', fields: ['일자', '공유'] }]);
    expect(describeChange(c[0])).toBe('실적 「포럼 참석」 일자·공유 고침');
  });

  it('[HM-T115] 옮기면서 일자·공유도 바꿨으면 「옮김」에 그 칸이 붙는다 — 옮김만 적으면 고침이 사라진다', () => {
    const before = [r('가'), r('나'), r('다', { date: '10/8' })];
    const after = [r('다', { date: '10/9', emphasis: true }), r('가'), r('나')];
    const c = diffTable('achievements', before, after);
    const move = c.find((x) => x.op === 'move');
    expect(move).toEqual({ bucket: 'achievements', op: 'move', before: '다', after: '다', fields: ['일자', '공유'] });
    expect(describeChange(move!)).toBe('실적 옮김 「다」 · 일자·공유 고침');
    // 자리만 옮긴 것은 그대로 「옮김」 한마디
    const plain = diffTable('achievements', [r('가'), r('나')], [r('나'), r('가')]).find((x) => x.op === 'move')!;
    expect(plain.fields).toBeUndefined();
    expect(describeChange(plain)).toBe('실적 옮김 「가」');
  });

  it('[HM-T109] 아무것도 안 바뀌었으면 「고친 곳 없음」 · 띄어쓰기만 다른 것은 같은 글', () => {
    const t = { achievements: [r('가  나')], plans: [r('다')], notes: [] };
    const u = { achievements: [r('가 나')], plans: [r('다')], notes: [] };
    expect(diffWorklog(t, u)).toEqual([]);
    expect(summarizeChanges([])).toBe('고친 곳 없음');
  });
});
