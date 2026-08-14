// AU-20 — 비밀번호 해시. Node 내장 scrypt만 사용 (네이티브 의존성 없음).
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// OWASP 권장 수준: N=2^16, r=8, p=1 → 128*N*r = 64MB 필요.
// Node 기본 maxmem은 32MB라 명시적으로 올려야 한다 (없으면 RangeError).
const PARAMS = { N: 1 << 16, r: 8, p: 1 } as const;
const MAXMEM = 160 * 1024 * 1024;
const KEYLEN = 64;

/** 저장 형식: scrypt$N$r$p$saltB64$hashB64 — 파라미터를 함께 저장해 나중에 상향 가능 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { ...PARAMS, maxmem: MAXMEM });
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scrypt(password.normalize('NFKC'), salt, expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// 헷갈리는 글자 제외 (0/O, 1/l/I) — 종이·메신저로 전달되므로 오독 방지
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 초기 발급용 임시 비밀번호 (AU-22) */
export function generateInitialPassword(length = 12): string {
  const buf = randomBytes(length * 2);
  let out = '';
  for (let i = 0; out.length < length && i < buf.length; i++) {
    const idx = buf[i] % 256;
    if (idx < ALPHABET.length * Math.floor(256 / ALPHABET.length)) {
      out += ALPHABET[idx % ALPHABET.length];
    }
  }
  return out.padEnd(length, ALPHABET[0]).slice(0, length);
}

export const PASSWORD_MIN_LENGTH = 10;

/** AU-24 — 비밀번호 정책. 복잡도보다 길이 (NIST 800-63B 방향) */
export function validatePasswordPolicy(pw: string, opts: { name?: string; email?: string } = {}): string | null {
  const p = pw.normalize('NFKC');
  if (p.length < PASSWORD_MIN_LENGTH) return `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`;
  if (p.length > 200) return '비밀번호가 너무 깁니다.';
  if (/^\s|\s$/.test(pw)) return '비밀번호 앞뒤에 공백을 넣을 수 없습니다.';
  const lower = p.toLowerCase();
  const local = opts.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 3 && lower.includes(local)) return '아이디(메일 주소)를 비밀번호에 포함할 수 없습니다.';
  const banned = ['password', 'qwerty', '123456789', 'kei12345', 'worklog', '00000000'];
  if (banned.some((b) => lower.includes(b))) return '너무 쉬운 비밀번호입니다. 다른 값을 사용해 주세요.';
  if (/^(.)\1+$/.test(p)) return '같은 문자만으로는 만들 수 없습니다.';
  return null;
}
