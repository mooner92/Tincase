// OPS-11 — 구조적 로그 (JSON 한 줄). 파일 내용·JWT 원문은 절대 로깅하지 않는다.
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: undefined, // pid/hostname 생략 — 컨테이너 1개
  timestamp: pino.stdTimeFunctions.isoTime,
});
