// RH-90~95 — ERP 주간업무보고 인쇄본 읽기 · 같은 일 묶기 · 미리 고르기 · 다듬기. 글은 실측 모양을 본뜬 것이고 이름·과제는 지어낸 것이다.
import { describe, expect, it } from 'vitest';
import { buildCandidates, daysOf, formatErpDays, parseErpText, tidyContent, tidyPlace } from '@/lib/erp-report';

const UNIT = `    [가나평가실] (2026-10-08 ~ 2026-10-15)

                           1. 회의개최

○ 하천 평가 고도화 연구(수탁, 홍길동)

- 중간보고회(10/14, 서울역 KTX2 회의실, 홍길동, 김철수)

○ 소음 기준 개선 연구(기본, 이영희)

 - 최종보고회 사전 논의(10/12, 9층 소회의실, 이영희)
 - 자료 정리 회의(10/13, 914호, 이영희)

                           2. 국내출장
 - 하천 평가 고도화 연구 (과제 중간자문 발표 및 회의 참석, 10/14 , 서울역
회의실 , 홍길동)
 - 다른 연구 (학회 발표, 10/ 15 , 경주 , 박민수)

                           3. 해외출장
○ 박민수 : (2026-10-14 ~ 2026-10-17) 어느나라, 수도 연수
 - 정책 경험 공유
 - 역량 강화

                           4. 대외활동
○ 개발사업 환경영향평가 심의 (2026-10-14 09:30~11:30, 경기
도 수원시 장안구, 이영희)
`;

const HQ = `    [가나본부] (2026-10-08 ~ 2026-10-15)
                           1. 회의개최
○ 평가서 검토(기본, 최본부)
- 평가서 검토를 위한 주간심의회의(4개실)(10/13, KEI 회의실, 최본부, 담당자)
                           2. 행사개최
○ 이해관계자 라운드테이블 추진 계획(안) (2026-10-22 10:00~17:00, 대전컨벤션센터, 최본부)
`;

describe('RH-91 — 읽기', () => {
  it('[RH-T90] 머리의 부서 · 회의개최는 과제 아래 항목 · 출장은 앞머리가 과제 · 줄바꿈 잇기 · 해외출장의 「-」는 그 출장의 글머리', () => {
    const { unit, entries } = parseErpText(UNIT);
    expect(unit).toBe('가나평가실');
    expect(entries.map((e) => [e.sec, e.content])).toEqual([
      ['회의개최', '중간보고회'],
      ['회의개최', '최종보고회 사전 논의'],
      ['회의개최', '자료 정리 회의'],
      ['국내출장', '과제 중간자문 발표 및 회의 참석'],
      ['국내출장', '학회 발표'],
      ['해외출장', '해외출장 — 어느나라'],
      ['대외활동', '개발사업 환경영향평가 심의'],
    ]);
    expect(entries[0].task).toEqual({ title: '하천 평가 고도화 연구', type: '수탁', owner: '홍길동' });
    expect(entries[0].place).toBe('서울역 KTX2 회의실');
    expect(entries[0].people).toEqual(['홍길동', '김철수']);
    expect(entries[3].task?.title).toBe('하천 평가 고도화 연구');
    expect(entries[3].place).toBe('서울역회의실'); // 줄바꿈 「서울역\\n회의실」 — 한글끼리는 붙인다(띄어쓰기를 알 수 없다 — 다듬기가 「서울역」으로 줄인다)
    expect(entries[4].days).toEqual([[10, 15]]); // 「10/ 15」
    expect(entries[5].days).toEqual([[10, 14], [10, 17]]);
    expect(entries[5].raw).toContain('역량 강화');
    expect(entries[6].place).toBe('경기도 수원시 장안구'); // 「경기\\n도」는 붙인다
  });

  it('[RH-T91] 날짜 모양들 · 기간 쓰기', () => {
    expect(daysOf('9/17~18')).toEqual([[9, 17], [9, 18]]);
    expect(daysOf('2026- 09-04 15:30~18:00')).toEqual([[9, 4]]);
    expect(daysOf('09/ 10 , 서울')).toEqual([[9, 10]]);
    expect(formatErpDays([[9, 17], [9, 18]])).toBe('9/17~18');
    expect(formatErpDays([[9, 30], [10, 2]])).toBe('9/30, 10/2');
  });
});

describe('RH-92~95 — 후보', () => {
  const entries = [...parseErpText(UNIT).entries, ...parseErpText(HQ).entries];
  const cands = buildCandidates(entries, '가나본부', [10, 20]);
  const by = (content: string) => cands.find((c) => c.content.includes(content))!;

  it('[RH-T92] 회의개최와 그 회의의 출장은 한 건(대표는 회의개최) · 같은 날이라도 다른 일은 따로', () => {
    const mid = by('중간보고회의');
    expect(mid.secs.sort()).toEqual(['국내출장', '회의개최']);
    expect(cands.filter((c) => c.secs.includes('회의개최') && c.unitKo === '가나평가실')).toHaveLength(3);
  });

  it('[RH-T93] 미리 고르기 — 단계 회의는 넣고, 준비·내부 회의·학회 발표·해외출장·대외활동·주간심의는 이유와 함께 뺀다', () => {
    expect(by('중간보고회의')).toMatchObject({ pick: true, reason: '단계 회의·행사' });
    expect(by('사전 논의')).toMatchObject({ pick: false, reason: '준비·내부 논의' });
    expect(by('자료 정리')).toMatchObject({ pick: false, reason: '내부 회의' }); // KEI 안 작은 방 · 단계 낱말 없음
    expect(by('학회 발표')).toMatchObject({ pick: false, reason: '다른 기관 행사 참석' });
    expect(by('해외출장')).toMatchObject({ pick: false, reason: '해외출장' });
    expect(by('심의')).toMatchObject({ pick: false, reason: '대외활동 — 개인 자격' });
    expect(by('주간심의회의')).toMatchObject({ pick: false, reason: '준비·내부 논의' });
    expect(by('라운드테이블')).toMatchObject({ pick: true });
  });

  it('[RH-T94] 다듬기 — 내용 · 장소 · 「책임자 외」 · 자리(실적 / 본부는 특이사항 / 뒤의 일은 계획) · 종류', () => {
    expect(by('중간보고회의')).toMatchObject({ content: '중간보고회의', place: '서울역', people: '홍길동 외', date: '10/14', section: 'results', kind: 0 });
    expect(by('라운드테이블')).toMatchObject({ content: '이해관계자 라운드테이블', place: 'DCC', section: 'plans', kind: 2 });
    expect(tidyContent('과제 착수보고회')).toBe('착수보고회의');
    expect(tidyContent('수요세미나 개최')).toBe('수요세미나');
    expect(tidyPlace('KEI 943호 회의실')).toBe('943호');
    expect(tidyPlace('스마트워크센터 오송역 회의실')).toBe('오송역');
    expect(tidyPlace('회의실샘(세종시 어진동) (4.6km)')).toBe('회의실샘');
  });
});
