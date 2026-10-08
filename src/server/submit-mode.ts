// RU-60a · ADR-0014 — hwp 올리기 스위치. **다음 웨이브에서 이 파일째 지운다.**
//
// 2026-10-08 — 부서원의 hwp 업로드 제출은 코드째 없어졌다(WA-39 · ADR-0014 완료): `POST /api/submissions`
// 라우트·드롭존·제출 탭·안내 한 줄. 이 스위치가 아직 남은 까닭은 하나다 — 「전사」 게시판 hwp [올리기]
// (`org/page.tsx` · `api/rollup/org/sections/upload`)가 이 판정을 부르는데, 그 두 파일은 3단계 흐름을 다시 쓰는
// 다른 작업의 영역이라 이번에 손대지 않았다. 그쪽에서 [올리기]가 걷히면 부르는 곳이 0이 되고, 그때 이 파일과
// `env.SUBMIT_HWP_UPLOAD`를 함께 지운다(WA-T33이 부르는 곳을 센다).
//
// 스위치를 읽는 곳은 **여기 하나**다. 라우트와 화면이 `env`를 각자 읽으면 「서버는 닫았는데
// 화면은 버튼을 그리는」 상태가 생긴다 — 판정을 복사하면 언젠가 갈라진다(TACP-12와 같은 이유).
//
// authz.ts에 두지 않는 이유: 이건 「누가 할 수 있나」가 아니라 「서버가 이 길을 여는가」다.
// 누구에게나 같은 답이라 숨길 것이 없고, 그래서 404가 아니라 410이다.
import { env } from './env';
import { HttpError } from './authz';

export type HwpUploadSwitch = 'on' | 'off';

/** 「전사」 화면이 [올리기]를 그릴지 (RU-60a) */
export function hwpUploadOpen(value: HwpUploadSwitch = env.SUBMIT_HWP_UPLOAD): boolean {
  return value !== 'off';
}

/**
 * RU-60a — 「전사」 섹션 올리기 라우트의 문. 파일을 읽기 전에 부른다 — 닫혀 있으면 아무것도 남기지 않는다.
 *
 * `uploadSubmission()`에는 걸지 않는다: 웹 작성이 그 함수로 저장한다(WA-04). 제출을 막는 스위치가 아니다.
 */
export function assertHwpUploadOpen(value: HwpUploadSwitch = env.SUBMIT_HWP_UPLOAD): void {
  if (!hwpUploadOpen(value)) {
    throw new HttpError(410, 'upload_closed', 'HWP 업로드는 닫혔습니다 — 웹에서 작성해 주세요.');
  }
}
