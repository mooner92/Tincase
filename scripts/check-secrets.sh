#!/usr/bin/env bash
# 공개 저장소 위생 검사 — 커밋 전에 돌린다.
#
# 왜 필요한가: 내부망 IP를 2026-08-14에 한 번 지웠는데 8/16·8/19에 다시 들어갔다.
# 사람이 매번 기억하는 것으로는 안 지켜진다 — GitGuardian 경고를 받고서야 알았다.
#
# **오탐을 내지 않는 것이 이 검사의 생명이다.** 매번 헛경고를 내면 그냥 무시하게 되고,
# 그러면 없느니만 못하다. 그래서 아래 두 가지는 일부러 통과시킨다:
#   - 사설 **대역**(172.16.0.0/12 같은 CIDR) — Docker 기본 범위이지 우리 주소가 아니다
#   - tests/ 의 더미 비밀번호 — 인증을 시험하려면 문자열이 있어야 한다
#
#   bash scripts/check-secrets.sh
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
me='scripts/check-secrets.sh'

report() { # 이름, 결과
  if [ -n "$2" ]; then
    echo "✗ $1"
    echo "$2" | sed 's/^/    /' | head -8
    fail=1
  else
    echo "✓ $1"
  fi
}

files() { git ls-files -z; }

# ① 내부망 **호스트** 주소. 대역 표기(x.x.0.0/nn)는 뺀다
report "내부망 IP" "$(files | xargs -0 grep -nIE \
  '(^|[^0-9.])(192\.168|10\.|172\.(1[6-9]|2[0-9]|3[01]))\.[0-9]{1,3}\.[0-9]{1,3}([^0-9./]|$)' 2>/dev/null \
  | grep -v "^$me:" || true)"

# ② 앱·스크립트의 하드코딩 비밀번호 (tests/ 제외 — 더미가 있어야 시험이 된다)
report "하드코딩된 비밀번호" "$(files | xargs -0 grep -nIE \
  "(hashPassword|password)\s*[:(=]\s*'[^']{8,}'" 2>/dev/null \
  | grep -vE "^(tests/|$me:)" || true)"

# ③ 개인 키·서비스 토큰
report "개인 키·토큰" "$(files | xargs -0 grep -nIE \
  'BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-' 2>/dev/null \
  | grep -v "^$me:" || true)"

# ④ Cloudflare Account/Tunnel ID (32자 hex) — 자리표시자만 있어야 한다
report "Cloudflare 실제 ID" "$(files | xargs -0 grep -nIE '\b[0-9a-f]{32}\b' 2>/dev/null \
  | grep -vE "^(package-lock\.json|.*\.(png|jpg|gif|webp|woff2|hwp):|$me:)" || true)"

# ⑤ 개인정보가 든 산출물이 실수로 추적되고 있지 않은가
report "docs/private 추적 여부" "$(git ls-files 'docs/private/*' || true)"

# ⑥ 동료 실명 (2026-09-03 신설)
#
# 저장소가 public인데 실명이 60곳 가까이 들어가 있었다. 이름만이면 그나마인데
# 「누가 무엇을 어떻게 적었는지」가 붙어 있었다 — 특정 개인의 업무 행동이
# 검색 가능한 형태로 남는다. 커밋은 되돌리기 어려우므로 나가기 전에 막는다.
#
# 명단 자체가 개인정보라 **검사 목록도 저장소에 두지 않는다** (docs/private/names.txt).
# 파일이 없으면 이 검사는 조용히 건너뛴다 — 새 기기에서 검사 전체가 멈추는 것보다 낫다.
NAMES_FILE="docs/private/names.txt"
if [ -s "$NAMES_FILE" ]; then
  pattern=$(grep -vE '^\s*(#|$)' "$NAMES_FILE" | paste -sd'|' -)
  report "동료 실명" "$(files | xargs -0 grep -nIE "$pattern" 2>/dev/null | grep -v "^$me:" || true)"
else
  echo "  — 동료 실명 (건너뜀: $NAMES_FILE 없음)"
fi

if [ $fail -ne 0 ]; then
  echo
  echo "커밋하지 말 것. 자리표시자(<서버-내부-IP> 등)로 바꾸거나 docs/private/ 로 옮기세요."
  exit 1
fi
echo
echo "공개 저장소 위생 검사 통과"
