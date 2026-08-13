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
  },
});
