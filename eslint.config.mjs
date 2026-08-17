import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // hwp 포맷 조사용 단독 Node 스크립트 — 앱 코드가 아니라 CommonJS로 둔다.
    // 같은 디렉터리의 .py 파일들과 성격이 같다 (tools/roundtrip.py 등).
    "tools/**/*.js",
    // 안내 GIF 녹화기 — Playwright를 직접 물고 도는 단독 CommonJS 스크립트.
    // 앱 번들에 들어가지 않으므로 앱과 같은 모듈 규칙을 적용하지 않는다.
    "scripts/**/*.cjs",
  ]),
]);

export default eslintConfig;
