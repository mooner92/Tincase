// HM-33 — 「내용이 없다」는 뜻으로 보이는 행을 **찾아서 알린다. 지우지 않는다.**
//
// `server/`가 아니라 `lib/`에 있는 이유: 같은 판정을 **입력 화면과 병합이 함께** 쓴다.
// 두 벌로 두면 화면은 귀띔했는데 병합은 못 잡는(또는 그 반대인) 상태가 언젠가 온다.
//
// 시작은 실제 사고였다: 한 부서원이 실적 칸에 「특이사항 없음」을 적어 냈고,
// 그게 그대로 병합본에 들어가 취합게시판으로 갈 뻔했다.
//
// **왜 지우지 않는가.** 지우려면 판정이 정확해야 하고, 정확하지 않으면 남의 한 주가
// 조용히 사라진다. 실측으로 45행 중 가장 짧은 정상 업무가 「보도자료 배포」(7자)인데
// 「특이사항 없음」도 7자다 — 길이로는 못 가른다. 모델에 맡기는 것도 답이 아니다:
// 지금 모델이 하는 일(중복 묶기)은 틀려도 원문이 검토 패널에 남지만, 삭제는 되돌릴
// 근거까지 없앤다.
//
// **그래서 탐지와 처분을 나눈다.** 기계는 «이거 좀 보세요»까지만 하고, 지울지는 사람이 정한다.
// 처분이 알림 한 줄이면 오탐 비용이 거의 없으므로, 탐지는 오히려 **느슨하게** 잡아도 된다.
// 이게 이 설계의 핵심이다 — 판정을 정확하게 만드는 대신 **틀려도 싼 자리**로 옮겼다.
import type { WorklogRow } from './hwp/reader';

/**
 * 걸러 볼 낱말. **부분 일치**다.
 *
 * **부서마다 따로 정한다** (`Division.emptyWords`). 이건 한 부서에서 실제로 겪은 일이지
 * 전사 규칙이 아니다 — 부서마다 쓰는 말이 다르고, 남의 부서에 우리 습관을 강요할 이유가 없다.
 * 비워두면 검사하지 않는다.
 *
 * 아래는 **처음 채워 넣는 기본값**이다. 「없음」 하나로 시작한다 —
 * 업무 내용에 그 낱말이 쓰일 일이 거의 없다.
 * 실측(제출물 12건·45행)에서 이 낱말에 걸린 것은 문제의 그 한 건뿐이었다 (오탐 0).
 *
 * 목록에 없는 것과 그 이유:
 *   `-` `—`  「…요구자료 제출 -2022년 ~ 현재까지…」처럼 **정상 문장에 걸린다** (실측)
 *   `해당`   「해당 부서와 협의」 같은 정상 표현이 흔하다
 *   길이     가장 짧은 정상 업무와 글자 수가 같다
 *
 * 늘리는 것은 **실제로 놓친 사례가 나온 뒤**에 한다. 미리 넓히면 오탐만 늘고,
 * 알림에 헛것이 섞이기 시작하면 그 알림은 곧 안 읽힌다.
 */
export const DEFAULT_FLAG_WORDS = ['없음'] as const;

/** 부서 설정 문자열 → 낱말 목록. 쉼표·가운뎃점 아무거나 (분류 순서와 같은 관대함) */
export function parseFlagWords(raw: string): string[] {
  return raw
    .split(/[,·\/|]/)
    .map((w) => w.trim())
    .filter(Boolean)
    .filter((w, i, a) => a.indexOf(w) === i)
    .slice(0, 12);
}

export interface FlaggedRow {
  /** 어느 표인가 */
  bucket: 'achievements' | 'plans' | 'notes';
  /** 화면에 보이는 구분 번호 (1-6 등) */
  no: string;
  /** 누가 냈는가 — 담당자·부서장만 보는 정보다 (TACP-17) */
  who: string;
  content: string;
  /** 걸린 낱말 */
  word: string;
}

const TABLE_NO = { achievements: 1, plans: 2, notes: 3 } as const;

/**
 * 이 행이 걸리는가. 걸리면 그 낱말을, 아니면 null.
 * `words`가 비면 **아무것도 걸리지 않는다** — 설정을 안 한 부서는 이 기능이 없는 것과 같다.
 */
export function flagWordOf(content: string, words: readonly string[]): string | null {
  if (words.length === 0) return null;
  const c = content.trim();
  if (!c) return null;
  return words.find((w) => c.includes(w)) ?? null;
}

/**
 * 병합 결과에서 확인이 필요한 행을 뽑는다.
 * `rows`는 표에 들어간 **최종 순서**여야 한다 — 구분 번호가 화면과 같아야
 * 담당자가 알림을 보고 그 행을 바로 찾는다.
 */
export function findFlaggedRows(
  grouped: Record<'achievements' | 'plans' | 'notes', { row: WorklogRow; authors: string[] }[]>,
  words: readonly string[],
): FlaggedRow[] {
  const out: FlaggedRow[] = [];
  for (const bucket of ['achievements', 'plans', 'notes'] as const) {
    grouped[bucket].forEach((g, i) => {
      const word = flagWordOf(g.row.content, words);
      if (!word) return;
      out.push({
        bucket,
        no: `${TABLE_NO[bucket]}-${i + 1}`,
        who: g.authors.join(', '),
        content: g.row.content.trim(),
        word,
      });
    });
  }
  return out;
}

/** 알림·화면이 함께 쓰는 한 줄 요약 (「실적 1-6 김영인 「특이사항 없음」」) */
export function describeFlagged(f: FlaggedRow): string {
  const label = { achievements: '실적', plans: '계획', notes: '특이사항' }[f.bucket];
  return `${label} ${f.no} ${f.who ? f.who + ' ' : ''}「${f.content}」`;
}
