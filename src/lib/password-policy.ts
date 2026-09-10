// AU-24 — 비밀번호 정책. **순수 함수만** 있다.
//
// `server/password.ts`에서 떼어낸 이유: 이 규칙은 **화면에서도 필요하다.**
// 설정 폼이 「10자 이상」을 알려주려면 상수를 알아야 하는데, 서버 모듈을 그대로 가져오면
// scrypt까지 클라이언트 번들에 끌려온다. 규칙은 어차피 순수 계산이라 여기가 제자리다.
//
// 서버는 이 파일을 **다시 내보내** 쓴다 — 두 곳에 같은 규칙을 적으면 언젠가 갈라진다.

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
