// WA-30~34 · ADR-0014 — 제출 경로 스위치. hwp 업로드는 단계적으로 닫는다.
//
// 스위치를 읽는 곳은 **여기 하나**다. 라우트와 화면이 `env`를 각자 읽으면 「서버는 닫았는데
// 화면은 드롭존을 그리는」 상태가 생긴다 — 판정을 복사하면 언젠가 갈라진다(TACP-12와 같은 이유).
//
// authz.ts에 두지 않는 이유: 이건 「누가 할 수 있나」가 아니라 「서버가 이 길을 여는가」다.
// 누구에게나 같은 답이라 숨길 것이 없고, 그래서 404가 아니라 410이다.
import { env } from './env';
import { HttpError } from './authz';

export type HwpUploadSwitch = 'on' | 'off';

/** 부서원이 hwp를 올려 제출할 수 있는가. 화면은 이 값으로 탭·드롭존·「양식 받기」를 그린다 (PG-11) */
export function hwpUploadOpen(value: HwpUploadSwitch = env.SUBMIT_HWP_UPLOAD): boolean {
  return value !== 'off';
}

/**
 * API-54 — 업로드 라우트의 문. 파일을 읽기 전에 부른다 — 닫혀 있으면 아무것도 남기지 않는다.
 *
 * `uploadSubmission()`에는 걸지 않는다(WA-34): 웹 작성도 같은 함수로 저장하고,
 * 테스트 데이터 스크립트도 이 함수를 부른다. 막을 것은 파일을 들고 오는 문 하나다.
 */
export function assertHwpUploadOpen(value: HwpUploadSwitch = env.SUBMIT_HWP_UPLOAD): void {
  if (!hwpUploadOpen(value)) {
    throw new HttpError(410, 'upload_closed', 'HWP 업로드는 닫혔습니다 — 웹에서 작성해 주세요.');
  }
}
