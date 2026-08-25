import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone', // OPS-04a — Docker 배포용
  // Next 16 dev 서버는 허용되지 않은 origin의 내부 자산 요청을 403으로 막는다.
  // 이 서버는 사내망 IP로 접속하므로 개발 중 클라이언트 JS가 통째로 안 뜬다
  // (버튼이 아무 반응도 안 하고, 원인이 화면에 드러나지 않아 찾기 어렵다).
  // 운영(next start)에는 영향이 없다.
  // 개발 서버를 사내망 주소로 열어 볼 때 필요하다 (Next 16이 교차 출처 요청을 막는다).
  // **주소를 코드에 적지 않는다** — 공개 저장소다. 필요하면 DEV_ORIGIN으로 준다:
  //   DEV_ORIGIN=<서버-내부-IP> npm run dev
  allowedDevOrigins: ['127.0.0.1', 'localhost', ...(process.env.DEV_ORIGIN ? [process.env.DEV_ORIGIN] : [])],
};

export default nextConfig;
