// NT-01~06 — 사내 메신저(UCWare) 알림 전송.
//
// **이 API는 실제로 사람 화면에 팝업을 띄운다.** 그래서 이 파일의 설계 목표는
// "잘 보내는 것"이 아니라 **"의도하지 않은 발송이 불가능한 것"**이다.
//
// 안전장치 셋 (NT-03):
//   1. `MESSENGER_URL`이 비어 있으면 아무것도 안 한다 — 기본이 꺼짐이다
//   2. `MESSENGER_ALLOWLIST`에 있는 사번에게만 나간다. **비어 있으면 아무에게도 안 간다**
//      («열려 있음»이 아니라 «닫혀 있음»이 기본값이다. 실수는 늘 열려 있을 때 난다)
//   3. 걸러진 대상은 조용히 사라지지 않고 로그에 남는다 — 왜 안 갔는지 알아야 고친다
//
// 프로토콜은 레거시 폼 전송이다: `application/x-www-form-urlencoded`,
// 텍스트 필드마다 `*_Encode=UTF-8`을 **쌍으로** 보내야 한글이 안 깨진다.
// 응답은 JSON이 아니라 **짧은 평문**이다 — 성공이면 `send ok\n` (2026-09-23 실측).
// 「HTML이라 본문으로 판정할 수 없다」고 적혀 있었는데 사실이 아니었다.
import { env } from './env';
import { logger } from './logger';
import { isSinkUrl, SINK_KIND_HEADER } from '@/lib/messenger-sink';

export interface AlertInput {
  /** 수신자 사번. 메신저는 이메일이 아니라 사번으로만 사람을 찾는다 */
  recvIds: string[];
  subject: string;
  contents: string;
  /** 누르면 열릴 주소. 없으면 메신저 보관함이 열린다 */
  url?: string;
  /**
   * NT-56 — 알림 종류(`NotifyLog.kind`와 같은 값). **가짜 알림 수신함으로 갈 때만** 머리(`x-tincase-kind`)로 실린다 —
   * 진짜 메신저가 받는 요청은 그대로다(폼 16개 필드, messenger.md §6). 수신함 화면·리허설이 「무슨 알림이 누구에게」를 이것으로 가른다
   */
  kind?: string;
}

export interface SendResult {
  requested: number;
  /** 실제로 전송한 사번 */
  sent: string[];
  /** 허용 목록 밖이라 보내지 않은 사번 */
  blocked: string[];
  /** 기능이 꺼져 있어 아무것도 하지 않았다 */
  disabled: boolean;
  errors: string[];
}

/** 한 요청에 넣는 수신자 수. 문서 권장 50~100 (패킷 크기·타임아웃) */
const CHUNK = 50;

function allowlist(): { all: boolean; ids: Set<string> } {
  const raw = env.MESSENGER_ALLOWLIST.trim();
  if (raw === '*') return { all: true, ids: new Set() };
  return {
    all: false,
    ids: new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  };
}

/** 지금 알림을 보낼 수 있는 상태인가 — 화면·스크립트가 상태를 설명할 때 쓴다 */
export function messengerStatus(): { enabled: boolean; reason: string; allow: string } {
  if (!env.MESSENGER_URL) return { enabled: false, reason: 'MESSENGER_URL 미설정', allow: '' };
  const { all, ids } = allowlist();
  if (!all && ids.size === 0) {
    return { enabled: false, reason: 'MESSENGER_ALLOWLIST 비어 있음 (아무에게도 안 감)', allow: '' };
  }
  return { enabled: true, reason: '', allow: all ? '전원' : [...ids].join(',') };
}

/**
 * AU-32a — 이 사번에게 **지금 쪽지가 갈 수 있나**(주소 있음 · 허용 목록 안). 보내기 전에 무언가를 바꾸는 길이 묻는다 —
 * 비밀번호 찾기는 새 링크를 만들면 그 사람의 옛 링크(운영자가 보낸 것)를 죽인다. 쪽지가 못 가는데 만들면 이미 간 링크만 쪽지 없이 죽는다.
 */
export function canReach(employeeNo: string): boolean {
  if (!env.MESSENGER_URL) return false;
  const { all, ids } = allowlist();
  return all || ids.has(employeeNo.trim());
}

/** 문서 3장 — 텍스트 필드는 값과 인코딩을 **쌍으로** 보낸다. 빠지면 한글이 깨진다 */
function appendEncoded(form: URLSearchParams, key: string, value: string): void {
  form.append(key, value);
  form.append(`${key}_Encode`, 'UTF-8');
}

function buildForm(recvIds: string[], input: AlertInput): URLSearchParams {
  const form = new URLSearchParams();
  form.append('CMD', 'ALERT');
  form.append('Action', 'ALERT');
  form.append('key', '');
  appendEncoded(form, 'SystemName', env.MESSENGER_SYSTEM_NAME);
  form.append('SendID', env.MESSENGER_SENDER_ID);
  appendEncoded(form, 'SendName', env.MESSENGER_SENDER_NAME);
  // 공백이 섞이면 사번을 못 찾는다 (문서 06 §3)
  form.append('RecvId', recvIds.join(','));
  appendEncoded(form, 'Subject', input.subject);
  appendEncoded(form, 'Contents', input.contents);
  if (input.url) {
    appendEncoded(form, 'URL', input.url);
    form.append('Option', env.MESSENGER_URL_OPTION); // 기본값은 사내 샘플과 동일 (WB=NEW,WA=EDGE)
  }
  return form;
}

/**
 * 알림 전송. **던지지 않는다** — 알림이 실패해도 본업(제출·병합)이 멈추면 안 된다.
 * 실패는 결과에 담아 돌려주고 로그에 남긴다.
 */
export async function sendAlert(input: AlertInput): Promise<SendResult> {
  const ids = [...new Set(input.recvIds.map((s) => s.trim()).filter(Boolean))];
  const result: SendResult = { requested: ids.length, sent: [], blocked: [], disabled: false, errors: [] };

  if (!env.MESSENGER_URL) {
    result.disabled = true;
    logger.info({ subject: input.subject, requested: ids.length }, '[알림] MESSENGER_URL 미설정 — 보내지 않음');
    return result;
  }

  const { all, ids: allowed } = allowlist();
  const targets = all ? ids : ids.filter((id) => allowed.has(id));
  result.blocked = ids.filter((id) => !targets.includes(id));

  if (result.blocked.length > 0) {
    // 조용히 사라지면 "왜 안 왔지"를 못 푼다
    logger.info({ blocked: result.blocked, subject: input.subject }, '[알림] 허용 목록 밖 — 건너뜀');
  }
  if (targets.length === 0) {
    result.disabled = !all && allowed.size === 0;
    return result;
  }

  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };
      if (input.kind && isSinkUrl(env.MESSENGER_URL)) headers[SINK_KIND_HEADER] = input.kind;
      const res = await fetch(env.MESSENGER_URL, {
        method: 'POST',
        headers,
        body: buildForm(chunk, input).toString(),
        signal: AbortSignal.timeout(10_000),
      });
      /*
       * 지금은 HTTP 200만 보고 성공으로 친다. **그건 「접수됨」이지 「전달됨」이 아니다.**
       * 실제 응답 본문은 `send ok`라 판정에 쓸 수 있지만(위 실측), 실패했을 때 무엇을
       * 돌려주는지는 아직 한 번도 못 봤다. 성공 문자열 하나만 알고 «그 외는 실패»로
       * 좁히면, 정상 응답의 변종에도 「실패」를 찍어 멀쩡한 알림을 실패로 기록한다.
       *
       * 그래서 지금은 **본문을 남기기만 한다.** 실패 사례가 한 번이라도 잡히면 그때
       * 판정에 넣는다 — 추측으로 좁히지 않는다.
       */
      const body = (await res.text()).trim().slice(0, 200);
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${body}`);
      if (body !== 'send ok') {
        // 조용히 넘어가면 «보냈다는데 안 왔다»를 영영 못 푼다
        logger.warn({ chunk, body, subject: input.subject }, '[알림] 처음 보는 응답');
      }
      result.sent.push(...chunk);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`${chunk.join(',')}: ${msg}`);
      logger.error({ chunk, err: msg }, '[알림] 전송 실패');
    }
  }

  logger.info(
    { subject: input.subject, sent: result.sent.length, blocked: result.blocked.length, errors: result.errors.length },
    '[알림] 전송 완료',
  );
  return result;
}
