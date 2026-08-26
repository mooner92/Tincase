/**
 * 메신저 알림 실전 점검 — **실제로 발송된다.**
 *
 *   npx tsx scripts/notify-test.ts            # 상태만 보여주고 끝 (기본)
 *   npx tsx scripts/notify-test.ts --send     # 실제 발송
 *   npx tsx scripts/notify-test.ts --reminder # 마감 1시간 전 알림을 지금 강제로 한 번
 *
 * 기본이 «상태만»인 이유: 이 스크립트를 무심코 실행해도 남의 화면에 팝업이 뜨지 않아야 한다.
 * 발송은 `--send`를 손으로 붙였을 때만 일어난다.
 *
 * 누구에게 가는지는 `MESSENGER_ALLOWLIST`가 정한다. 목록이 비면 아무에게도 가지 않는다.
 */
import { env } from '../src/server/env';
import { sendAlert, messengerStatus } from '../src/server/messenger';
import { runDueReminders } from '../src/server/notify/deadline-reminder';

async function main() {
  const send = process.argv.includes('--send');
  const reminder = process.argv.includes('--reminder');
  const st = messengerStatus();

  console.log('메신저 알림 설정');
  console.log(`  주소        ${env.MESSENGER_URL || '(없음 — 기능 꺼짐)'}`);
  console.log(`  허용 사번   ${env.MESSENGER_ALLOWLIST || '(비어 있음 — 아무에게도 안 감)'}`);
  console.log(`  보내는 이   ${env.MESSENGER_SENDER_NAME} (${env.MESSENGER_SENDER_ID}) · ${env.MESSENGER_SYSTEM_NAME}`);
  console.log(`  링크 기준   ${env.MESSENGER_LINK_BASE || '(없음 — 링크 없이 발송)'}`);
  console.log(`  상태        ${st.enabled ? `보낼 수 있음 (대상: ${st.allow})` : `꺼짐 — ${st.reason}`}`);

  if (reminder) {
    console.log('\n마감 1시간 전 알림을 지금 실행합니다…');
    const out = await runDueReminders();
    if (out.length === 0) {
      console.log('  보낼 대상 없음 (마감 1시간 전 창이 아니거나, 이미 보냈거나, 미제출자가 없음)');
    }
    out.forEach((r) => console.log(`  ${r.division} ${r.isoKey}: 대상 ${r.targets} · 발송 ${r.sent} · 차단 ${r.blocked}`));
    return;
  }

  if (!send) {
    console.log('\n실제로 보내려면 --send 를 붙이세요. (--reminder 는 마감 전 알림 경로를 그대로 실행)');
    return;
  }

  const res = await sendAlert({
    recvIds: (env.MESSENGER_ALLOWLIST || '').split(',').map((s) => s.trim()).filter((s) => s && s !== '*'),
    subject: '[Tincase] 알림 연결 확인',
    contents: [
      'Tincase 알림이 정상적으로 연결되었습니다.',
      '',
      '마감 1시간 전(목 13:00)에 아직 내지 않으신 분께만 이런 알림이 한 번 갑니다.',
    ].join('\n'),
    url: env.MESSENGER_LINK_BASE || undefined,
  });

  console.log('\n결과');
  console.log(`  요청 ${res.requested}명 · 발송 ${res.sent.length}명 ${res.sent.join(',')}`);
  if (res.blocked.length) console.log(`  차단 ${res.blocked.length}명 ${res.blocked.join(',')} (허용 목록 밖)`);
  if (res.errors.length) console.log(`  오류 ${res.errors.join(' / ')}`);
  if (res.disabled) console.log('  기능이 꺼져 있어 아무것도 보내지 않았습니다.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
