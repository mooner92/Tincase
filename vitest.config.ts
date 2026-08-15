import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    // 통합 테스트(DB)가 같은 파일을 공유하므로 파일 단위 직렬 실행
    fileParallelism: false,
    env: {
      // HM-24 — 테스트는 결정론적이어야 한다. 모델을 켜면 병합 테스트가 외부 프로세스에
      // 의존하고 느려진다(실측 25초). 하네스 자체는 dedupe.ts 단위 테스트가 검증한다.
      MERGE_MODEL: '',
      MERGE_SCHEDULER: 'off',
    },
  },
});
