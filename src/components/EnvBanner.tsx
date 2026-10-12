// RU-43 — 테스트 서버 띠. **운영과 헷갈려 실제 업무를 여기에 내는 일을 막는다.**
// RU-47 — 시연 띠. 테스트 서버(11112)를 시연 데이터로 띄우면(TINCASE_TEST_MODE=demo → TINCASE_ENV=demo) 강당 화면을 보는
// 사람에게 **이름·업무가 지어낸 것**임을 알린다 — 모르는 이름이 실제 동료처럼 읽히지 않게. 「테스트」라고 하지 않는다 —
// 보는 사람에게는 서버 이름이 아니라 「이 사람들이 진짜인가」가 궁금한 것이다. 이 말이 참인지는 기동 때 본다(entrypoint.sh).
// 운영(TINCASE_ENV 없음)에서는 아무것도 그리지 않는다. 발표 무대(/guide/present)는 화면 전체를 덮어 이 띠가 보이지 않는다.
import { connection } from 'next/server';

export async function EnvBanner() {
  await connection(); // 빌드 때 굳히지 않고 요청 때 환경을 읽는다 — 같은 이미지가 운영·테스트(평소·시연 모드)에 쓰인다
  const kind = process.env.TINCASE_ENV;
  if (kind === 'test') {
    return (
      <div className="bg-warning px-4 py-1.5 text-center text-[13px] font-semibold text-white">
        테스트 서버입니다 — 여기서 낸 것은 실제 업무에 반영되지 않습니다 · 알림이 나가지 않습니다
      </div>
    );
  }
  if (kind === 'demo') {
    // 경고색이 아니다 — 시연 중에는 틀린 일이 아니라 알려 두는 일이다. 띠가 화면을 덜 차지하게 한 줄·작은 글자
    return (
      <div className="bg-info px-4 py-1 text-center text-[13px] font-semibold text-white">
        시연 — 사람과 업무는 모두 지어낸 것입니다 · 알림이 나가지 않습니다
      </div>
    );
  }
  return null;
}
