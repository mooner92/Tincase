import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone', // OPS-04a — Docker 배포용
  // Next 16 dev 서버는 허용되지 않은 origin의 내부 자산 요청을 403으로 막는다.
  // 이 서버는 사내망 IP로 접속하므로 개발 중 클라이언트 JS가 통째로 안 뜬다
  // (버튼이 아무 반응도 안 하고, 원인이 화면에 드러나지 않아 찾기 어렵다).
  // 운영(next start)에는 영향이 없다.
  allowedDevOrigins: ['127.0.0.1', 'localhost', '192.168.1.104'],
};

export default nextConfig;
