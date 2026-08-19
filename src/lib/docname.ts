// 문서 이름 규칙 — **한 곳에서만 정한다**.
//
// 지금까지 다섯 군데가 제각각이었다: 연도가 있기도 없기도, 부서가 빠지기도,
// 순서도 달랐다. 파일이 바탕화면에 쌓이면 이름이 곧 분류라서, 규칙이 흔들리면
// 정렬도 검색도 안 된다.
//
//   {연도}_{M월 W주차}_{부서}_{무엇}.{확장자}
//   2026_8월_3주차_AI홍보전략실_주간업무.hwp
//
// 연도를 맨 앞에 두는 이유: 이름순 정렬이 곧 시간순이 된다.
// 부서를 종류보다 앞에 두는 이유: 한 폴더에 여러 부서가 섞일 때 부서별로 묶인다.

export type DocKind =
  | '주간업무' // 병합본 — 취합게시판에 그대로 올리는 것
  | '월간업무' // 그 달 마지막 주의 병합본 (WS-14)
  | '양식' //     빈 양식
  | '제출물'; //  개인 제출물 묶음(zip)

/** 파일명에 못 쓰는 글자를 지운다. 윈도우 기준이 가장 좁아서 그쪽에 맞춘다 */
function safe(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .trim();
}

import type { WeekKind } from './week';

export interface DocNameParts {
  year: number;
  /** "8월 3주차" */
  weekLabel: string;
  divisionName: string;
  /** 개인 제출물이면 이름, 아니면 종류 */
  suffix: string;
  ext: 'hwp' | 'zip';
}

export function docName({ year, weekLabel, divisionName, suffix, ext }: DocNameParts): string {
  return `${year}_${safe(weekLabel)}_${safe(divisionName)}_${safe(suffix)}.${ext}`;
}

/**
 * 병합본 — 담당자가 받아서 **그대로 올린다.** 그래서 이름이 곧 그 문서의 정체다.
 * 월간 주(WS-14)의 병합본을 "주간업무"라고 부르면 받는 쪽이 잘못 분류한다.
 */
export const mergedName = (
  year: number,
  weekLabel: string,
  divisionName: string,
  kind: WeekKind = 'weekly',
) =>
  docName({
    year,
    weekLabel,
    divisionName,
    suffix: kind === 'monthly' ? '월간업무' : '주간업무',
    ext: 'hwp',
  });

/** 빈 양식 — 부서원이 받아서 채운다 */
export const templateName = (year: number, weekLabel: string, divisionName: string) =>
  docName({ year, weekLabel, divisionName, suffix: '양식', ext: 'hwp' });

/** 개인 제출물 — 이름이 들어가야 담당자가 누구 것인지 안다 */
export const submissionName = (year: number, weekLabel: string, divisionName: string, userName: string) =>
  docName({ year, weekLabel, divisionName, suffix: userName, ext: 'hwp' });

/**
 * 취합게시판 **답변 제목**. 받는 쪽이 그대로 쓰는 문자열이라 형식이 곧 규격이다.
 *
 *   주간  `8월3주차 연구운영회의 주간업무(AI홍보전략실)`
 *   월간  `8월 연구운영회의 월간업무(AI홍보전략실)`
 *
 * 월간에 주차 번호를 빼는 이유: 그 주 한 주가 아니라 **그 달 전체**의 보고라서
 * "8월5주차 월간업무"라고 쓰면 5주차만의 보고로 읽힌다.
 * 주간에서 `8월 3주차`의 공백을 지우는 것은 받은 예시 형식 그대로다.
 */
export function boardTitle(
  month: number,
  weekLabel: string,
  divisionName: string,
  kind: WeekKind = 'weekly',
): string {
  const period = kind === 'monthly' ? `${month}월` : weekLabel.replace(/\s+/g, '');
  const doc = kind === 'monthly' ? '월간업무' : '주간업무';
  return `${period} 연구운영회의 ${doc}(${divisionName})`;
}

/** 전체 묶음 */
export const zipName = (year: number, weekLabel: string, divisionName: string) =>
  docName({ year, weekLabel, divisionName, suffix: '제출물', ext: 'zip' });
