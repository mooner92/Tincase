// RU-43 — 테스트 서버 띠. **운영과 헷갈려 실제 업무를 여기에 내는 일을 막는다.**
// 운영(TINCASE_ENV 없음)에서는 아무것도 그리지 않는다.
import { connection } from 'next/server';

export async function EnvBanner() {
  await connection(); // 빌드 때 굳히지 않고 요청 때 환경을 읽는다 — 같은 이미지가 운영·테스트에 쓰인다
  if (process.env.TINCASE_ENV !== 'test') return null;
  return (
    <div className="bg-warning px-4 py-1.5 text-center text-[13px] font-semibold text-white">
      테스트 서버입니다 — 여기서 낸 것은 실제 업무에 반영되지 않습니다 · 알림이 나가지 않습니다
    </div>
  );
}
