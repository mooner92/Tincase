// RU-01·02 — 위로 간 **사본**(`ReportSubmission`)을 읽는 기본 도구. 사본을 **만드는** 곳은 handoff.ts 하나다(TACP-23).
//
// 2026-10-08(ADR-0015) 전에는 여기에 [제출]·[제출 취소](`submitReport`·`withdrawReport`)가 있었다. 승인이 곧 제출이 되면서
// 사람이 누르는 제출은 없어졌고, 화면의 상태(「위로」 카드)는 state.ts가 계산한다.
import path from 'node:path';
import type { WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { readStoredFile, sanitizeSegment, sha256 } from '../storage';

export type ReportLevel = 'unit' | 'hq';

/** 「지금 올라가 있는 것」 — 가장 최근의 취소되지 않은 행 (RU-01). 취소는 v1.7부터 생기지 않는다(RU-03) */
export async function currentReport(divisionId: string, weekSlotId: string, level: ReportLevel) {
  return prisma.reportSubmission.findFirst({
    where: { divisionId, weekSlotId, level, withdrawnAt: null },
    orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
  });
}

/** 사본 자리. 원본 병합본 경로와 다른 곳이다 — 원본은 다시 병합하면 덮인다 (RU-02) */
export function reportRelPath(divisionSlug: string, slot: Pick<WeekSlot, 'year' | 'label'>, level: ReportLevel, stamp: string): string {
  return path.join(
    'divisions',
    sanitizeSegment(divisionSlug),
    'reports',
    String(slot.year),
    `${sanitizeSegment(slot.label.replace(/ /g, '_'))}_${level}_${sanitizeSegment(stamp)}.hwp`,
  );
}

/**
 * RU-02 — 보낸 사본과 지금 결과가 **내용으로** 다른가. 실행 id로 보지 않는다.
 *
 * 다시 병합(이어 붙이기)해도 같은 파일이 나오면 새 사본을 만들지 않는다(같은 판). 그런데 「바뀜」을 실행 id로 정하면
 * 그 경우 영영 풀리지 않는다. 반대로 같은 실행이라도 담당자가 고치면(API-50) 파일이 바뀐다. 그래서 둘 다 내용(sha256) 하나로 본다.
 * 파일을 못 읽으면 「바뀜」 쪽으로 — 보낸 것이 지금 것이라고 말할 근거가 없다.
 */
export async function outputDiffers(outputPath: string, sentSha256: string): Promise<boolean> {
  try {
    return sha256(await readStoredFile(outputPath)) !== sentSha256;
  } catch {
    return true;
  }
}

/** 파일의 sha — 못 읽으면 null */
export async function fileSha(filePath: string | null | undefined): Promise<string | null> {
  if (!filePath) return null;
  try {
    return sha256(await readStoredFile(filePath));
  } catch {
    return null;
  }
}
