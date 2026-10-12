// ST-19a·b (2026-10-10) — 부서 양식을 **받기 전에** 웹 작성과 병합을 한 번씩 해 본다.
//
// 왜: 양식 검사는 「표가 파싱되는가」까지만 봤다(ST-19). 표가 둘인 양식(3번 특이사항 표를 지운 꼴)도 「관례상 정상」 경고와 함께 201로
// 받았고, 그날부터 그 부서 전원의 [작성하기]·[고치기]가 500(「3번째 표가 없습니다」), 병합은 3번 줄을 경고 한 줄로 버렸다
// (2026-10-10 점검에서 실측). 모양 검사(ST-19a)가 그 경우를 짧은 말로 막고, 모양이 맞아도 이 엔진이 실제로 채우고 다시 읽을 수 있는지를
// 시험 작성·시험 병합(ST-19b)이 본다 — 우리가 만든 것이라고 봐주지 않는다(WA-05 · HM-22와 같은 읽기).
import { HttpError } from './authz';
import { buildWorklogHwp } from './worklog-doc';
import { composeMergedHwp, verifyMerged, type MergedGroup } from './merge';
import { openHwp } from '@/lib/hwp/ole';
import { parseRecords } from '@/lib/hwp/record';
import { worklogShapeProblem } from '@/lib/hwp/template-shape';
import { logger } from './logger';

type Bucket = 'achievements' | 'plans' | 'notes';
const BUCKETS: Bucket[] = ['achievements', 'plans', 'notes'];

/**
 * 시험 내용 — 지어낸 줄이다. 양식의 기본 줄보다 **많은** 표(늘리기)와 **적은** 표(줄이기)를 함께 둔다: 행 복제가 깨지는 양식(마지막 줄의
 * 병합 셀 등)은 늘릴 때 드러난다. 두 줄 칸(HM-39) · 「공유」(HM-37 — 강조 서식을 새로 만드는 길)도 한 번씩 지나간다.
 */
interface SampleRow {
  content: string;
  date: string;
  place: string;
  attendee: string;
  emphasis: boolean;
}
const row = (content: string, extra: Partial<SampleRow> = {}): SampleRow => ({ content, date: '', place: '', attendee: '', emphasis: false, ...extra });
const SAMPLE: Record<Bucket, SampleRow[]> = {
  achievements: [
    row('양식 점검 실적 1', { date: '10/6', place: '세종', attendee: '담당', emphasis: true }),
    row('양식 점검 실적 2\n두 줄로 적은 칸'),
    ...Array.from({ length: 10 }, (_, i) => row(`양식 점검 실적 ${i + 3}`)),
  ],
  plans: [row('양식 점검 계획 1', { date: '10/13' })],
  notes: Array.from({ length: 6 }, (_, i) => row(`양식 점검 특이사항 ${i + 1}`)),
};

const DRY_RUN_FAILED = '이 양식으로 시험 작성·병합을 해 보니 내용이 그대로 들어가지 않습니다.';

/**
 * 부서 양식으로 받아도 되는가 — 아니면 422 `invalid_template`(짧은 이유). 형식(hwp인가·열리는가)은 `validateHwpUpload`가 먼저 본다.
 * `divisionName`은 병합본 맨 위 부서명(HM-46) — 실제 병합과 같은 길을 지나게 넣는다.
 */
export function assertUsableTemplate(bytes: Buffer, divisionName: string): void {
  // ST-19a — 모양. 첫 구역에 5칸 표 셋
  const shape = worklogShapeProblem(parseRecords(openHwp(bytes).sections[0]));
  if (shape) throw new HttpError(422, 'invalid_template', shape);

  // ST-19b — 시험 작성(웹 작성·담당자 첨삭과 같은 길). 스스로 다시 읽어 세 표의 행 수를 본다(WA-05)
  try {
    buildWorklogHwp(bytes, SAMPLE, { check: 'template' });
  } catch (e) {
    logger.warn({ err: (e as Error).message }, '[양식] 시험 작성 실패 — 양식을 받지 않는다');
    throw new HttpError(422, 'invalid_template', DRY_RUN_FAILED);
  }

  // ST-19b — 시험 병합(자동 병합·병합본 수정과 같은 길). 다시 읽어 표 수와 줄을 본다(HM-22와 같은 판정)
  const tableRows = {} as Record<Bucket, string[][]>;
  const emphasis = {} as Record<Bucket, boolean[]>;
  const grouped = {} as Record<Bucket, MergedGroup[]>;
  BUCKETS.forEach((b, t) => {
    tableRows[b] = SAMPLE[b].map((r, i) => [`${t + 1}-${i + 1}`, r.content, r.date, r.place, r.attendee]);
    emphasis[b] = SAMPLE[b].map((r) => r.emphasis);
    grouped[b] = SAMPLE[b].map((r) => ({
      row: { ...r },
      authors: ['양식 점검'],
      category: '',
      sources: [],
      reason: '',
      emphasis: r.emphasis,
      keptIndex: 0,
      identical: true,
    }));
  });
  let problem: string | null;
  try {
    const composed = composeMergedHwp(bytes, tableRows, emphasis, divisionName);
    // 줄을 넣지 못한 경고(「양식에 n번 표가 없어…」)는 곧 내용 손실이다 — 강조·부서명 경고는 병합이 그대로 하는 일이라 막지 않는다
    problem = composed.warnings.find((w) => w.includes('넣지 못했습니다')) ?? verifyMerged(composed.bytes, grouped, composed.tableCount);
  } catch (e) {
    problem = (e as Error).message ?? String(e);
  }
  if (problem) {
    logger.warn({ problem }, '[양식] 시험 병합 실패 — 양식을 받지 않는다');
    throw new HttpError(422, 'invalid_template', DRY_RUN_FAILED);
  }
}
