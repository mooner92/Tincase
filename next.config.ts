import type { NextConfig } from "next";
import { existsSync } from "node:fs";
import path from "node:path";

/*
 * PG-92 — 사용 안내의 「누르라는 커서」. 운영자가 고른 그림(게임 커서)은 제3자 저작물이라 **공개 저장소에 넣지 않는다** —
 * 체크아웃의 `public/guide/local/cursor.png`(.gitignore)에 있으면 그것을, 없으면 저장소의 기본 커서(SVG 화살표)를 쓴다.
 * 빌드 때 한 번 정한다(클라이언트 번들에 박힌다). 그림을 넣거나 뺐으면 다시 빌드한다.
 */
const GUIDE_CURSOR = "/guide/local/cursor.png";
const guideCursorSrc = existsSync(path.join(process.cwd(), "public", GUIDE_CURSOR)) ? GUIDE_CURSOR : "";

const nextConfig: NextConfig = {
  output: 'standalone', // OPS-04a — Docker 배포용
  env: { GUIDE_CURSOR_SRC: guideCursorSrc },
  // Next 16 dev 서버는 허용되지 않은 origin의 내부 자산 요청을 403으로 막는다.
  // 이 서버는 사내망 IP로 접속하므로 개발 중 클라이언트 JS가 통째로 안 뜬다
  // (버튼이 아무 반응도 안 하고, 원인이 화면에 드러나지 않아 찾기 어렵다).
  // 운영(next start)에는 영향이 없다.
  // 개발 서버를 사내망 주소로 열어 볼 때 필요하다 (Next 16이 교차 출처 요청을 막는다).
  // **주소를 코드에 적지 않는다** — 공개 저장소다. 필요하면 DEV_ORIGIN으로 준다:
  //   DEV_ORIGIN=<서버-내부-IP> npm run dev
  allowedDevOrigins: ['127.0.0.1', 'localhost', ...(process.env.DEV_ORIGIN ? [process.env.DEV_ORIGIN] : [])],
  /*
   * AU-33 — 응답 보안 헤더. 같은 서버 다른 포트의 페이지는 브라우저에게 「같은 사이트」라서,
   * 이 앱을 iframe에 넣고 버튼 위에 투명한 것을 덮어 누르게 할 수 있다(클릭재킹). 앱은 다른 페이지를
   * iframe에 넣지도, 넣어지지도 않으므로(2026-10-08 확인) 프레임은 전부 막는다.
   * CSP는 frame-ancestors 하나만 둔다 — script-src까지 잠그면 Next 인라인 스크립트가 깨진다.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
