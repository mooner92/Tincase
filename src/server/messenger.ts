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
// 응답은 JSON이 아니라 HTML이므로 성공 판정은 HTTP 200으로 한다.
import { env } from './env';
import { logger } from './logger';

export interface AlertInput {
  /** 수신자 사번. 메신저는 이메일이 아니라 사번으로만 사람을 찾는다 */
  recvIds: string[];
  subject: string;
  contents: string;
  /** 누르면 열릴 주소. 없으면 메신저 보관함이 열린다 */
  url?: string;
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
    form.append('Option', 'WB=NEW,WA=DEFAULT'); // 특정 브라우저를 강제하지 않는다
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
      const res = await fetch(env.MESSENGER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: buildForm(chunk, input).toString(),
        signal: AbortSignal.timeout(10_000),
      });
      // 응답은 HTML이라 본문으로 성공을 판정할 수 없다 (문서 06 §2)
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
