# S-03. 인증 · 인가 · 부서 격리

구현: `src/server/auth.ts`, `src/server/authz.ts`, `src/middleware.ts`
v2: 역할·부서 격리 추가 — [ADR-0005](../adr/0005-multi-division-tenancy.md)

---

## 1. 방침

**앱은 인증(authentication)을 구현하지 않는다.** Cloudflare Access가 신원을 확정하고,
앱은 그 신원으로 **인가(authorization) — 역할과 부서 격리 — 를 판단한다.** (원칙 P3·P5)

```
브라우저 ──TLS──► Cloudflare Edge ──► Access 정책 검사 (SSO/OTP)
                        │  통과 시 JWT 발급 + 헤더 주입
                        ▼
                  Cloudflare Tunnel (아웃바운드)
                        ▼
              cloudflared (이 서버, 상주 중)
                        ▼
              앱 127.0.0.1:11111
                 │
                 ├─ ① JWT 서명 검증  ← 앱의 책임
                 └─ ② email → User 조회 → 인가
```

## 2. 요구사항

### AU-01 — 앱은 127.0.0.1에만 바인딩

```
HOST=127.0.0.1  PORT=11111
```

터널을 우회한 직접 접근을 네트워크 계층에서 차단한다.
`0.0.0.0` 바인딩은 **금지**. 이 서버는 이미 `0.0.0.0:80`, `:3100`, `:3101` 등을 외부에 열고 있어
같은 실수를 반복하면 사내망 누구나 무인증 접근이 가능해진다.

> 실측: 포트 `11111`, `10000` 모두 사용 중이지 않음. **11111 채택** (사용자 지정, 기억 쉬움).

### AU-02 — 헤더만 믿지 않는다 ★

Cloudflare는 `Cf-Access-Authenticated-User-Email` 헤더를 넣어준다.
**이 헤더만으로 신원을 확정하면 안 된다.** 헤더는 위조 가능한 평문이다.

반드시 `Cf-Access-Jwt-Assertion` JWT를 검증한다.

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose';

const TEAM   = 'aidt-kei';
const ISSUER = `https://${TEAM}.cloudflareaccess.com`;
const JWKS   = createRemoteJWKSet(new URL(`${ISSUER}/cdn-cgi/access/certs`));

export async function verifyAccess(req: Request): Promise<AccessIdentity> {
  const token = req.headers.get('cf-access-jwt-assertion');
  if (!token) throw new AuthError('missing_assertion');

  const { payload } = await jwtVerify(token, JWKS, {
    issuer:   ISSUER,
    audience: process.env.CF_ACCESS_AUD!,   // Access 애플리케이션 AUD 태그
  });

  const email = String(payload.email ?? '').toLowerCase();
  if (!email) throw new AuthError('no_email_claim');
  return { email, sub: String(payload.sub), expiresAt: new Date(payload.exp! * 1000) };
}
```

- 서명·`iss`·`aud`·`exp` 전부 검증
- JWKS는 `jose`가 캐시하고 자동 갱신한다
- `AUD`는 Access 애플리케이션마다 다르다 → 환경변수로 주입 ([Q-04](../../OPEN-QUESTIONS.md))

> AU-01(네트워크)과 AU-02(암호학)를 **둘 다** 건다. 심층 방어.
> 어느 하나가 잘못 설정돼도 다른 하나가 막는다.

### AU-03 — 개발 모드 우회

로컬 개발엔 Cloudflare가 없다.

```ts
if (process.env.NODE_ENV !== 'production' && process.env.DEV_IDENTITY) {
  return { email: process.env.DEV_IDENTITY, sub: 'dev', expiresAt: farFuture };
}
```

**`NODE_ENV === 'production'`에서는 이 분기가 절대 동작하지 않아야 한다.**
전용 테스트로 고정한다.

```ts
it('[AU-T03] production에서는 DEV_IDENTITY가 무시된다', ...)
```

### AU-04 — 미등록 이메일은 거부

Access를 통과했어도 `User` 테이블에 없거나 `isActive=false`면 403.

```
403  { error: "not_registered" }
```

화면에는 `등록되지 않은 사용자입니다. 운영자에게 문의하세요.` 를 띄운다.

> Access 정책과 DB 시드는 **따로** 관리되므로 어긋날 수 있다.
> 조용히 통과시키지 말고 명시적으로 거부한다.

### AU-04b — 미온보딩 부서는 "준비 중"

`User`는 있으나 소속 `Division.isActive=false`면 (전 직원이 시드되므로 흔한 상태):

```
로그인 성공 → 전용 안내 화면
"OO실 페이지는 아직 준비 중입니다. 도입을 원하시면 운영자에게 문의하세요."
```

403이 아니라 **온보딩 대기 안내**다 — 미래 사용자를 문전박대하지 않는다.

### AU-05 — 업로더는 서버가 정한다 ★

업로드 요청의 사용자 지정은 **서버가 신원에서 도출**한다.
클라이언트가 보내는 `userId`/`name`은 **무시**한다.

```ts
// ✔ 옳음
const identity = await verifyAccess(req);
const user = await requireActiveUser(identity.email);

// ✘ 금지
const user = await findUser(formData.get('userId'));
```

이로써 사칭이 구조적으로 불가능해진다. UI의 이름 선택 드롭다운도 사라진다 (DM-01).

### AU-06 — 역할 매트릭스 (v2) ★

역할은 Access 정책이 아니라 **DB**가 정한다: `divisionRole`(member|lead) + `isOperator`.

| 행위 | member | lead | operator |
|---|---|---|---|
| 자기 부서 페이지 접근 | ✔ | ✔ | ✘ (자기 부서원 자격일 때만) |
| 본인 업로드/재업로드/본인 파일 다운로드 | ✔ | ✔ | — |
| 부서 제출 현황 (전원) | ✘ | ✔ | ✘ |
| 타인 제출물 열람(드로어)·다운로드·zip | ✘ | ✔ (자기 부서만) | ✘ |
| 병합 규칙 편집 / 병합 실행 / 양식 관리 / onRoster 관리 | ✘ | ✔ (자기 부서만) | ✘ |
| 부서(테넌트) 생성·활성화, 사용자 배정·역할 변경 | ✘ | ✘ | ✔ |
| 임의 부서의 제출물·현황·병합본 접근 | ✘ | ✘ | **✘ (AU-15)** |

- member는 **자기 제출물만** 본다. 같은 부서원의 제출 여부도 보이지 않는다 —
  격리 요구("냈는지 안 냈는지 감시 불가")를 부서 안에서도 보수적으로 적용한 기본값.
  담당자만 현황을 본다. (완화 여부는 [Q-15](../../OPEN-QUESTIONS.md))
- 권한 없는 라우트는 전부 **404** (403 아님 — 존재를 노출하지 않는다).

### AU-13 — 부서 격리는 쿼리 레벨에서 강제 ★

핸들러마다 if문으로 거르지 않는다. **스코프된 저장소 계층만 존재하게 만든다.**

```ts
// src/server/authz.ts — 핸들러가 얻을 수 있는 유일한 진입점
export async function requireDivisionScope(req: Request): Promise<Scope> {
  const identity = await verifyAccess(req);
  const user = await requireActiveUser(identity.email);
  return {
    user,
    // 모든 조회가 이 divisionId로 시작한다. 요청의 slug·id는 검증용일 뿐 스코프가 아니다
    db: scopedRepo(user.divisionId),
    isLead: user.divisionRole === 'lead',
  };
}
```

- URL의 `slug`가 `user.division.slug`와 다르면 **404** — 리다이렉트하지 않는다
  (리다이렉트는 "그 부서가 존재한다"를 노출한다)
- `Submission`·`Template`·`MergeRun` 조회는 예외 없이 `divisionId` 첫 축 (DM-12)
- 전역(스코프 없는) repo는 `operator` 전용 모듈에만 존재하며, 그 모듈은 테넌시
  테이블(Division/User)만 다루고 Submission 계열을 import하지 않는다 — AU-15의 코드적 집행

### AU-14 — 격리 회귀 테스트가 릴리스 게이트

격리는 기능이 아니라 **불변식**이므로 전용 테스트 스위트를 둔다 (§5 AU-T12~T17).
하나라도 깨지면 배포 금지.

### AU-15 — 운영자는 내용에 접근하지 않는다

operator 권한은 테넌시 관리(부서 생성·활성화, 사용자 배정)뿐이다.
**타 부서의 제출물·현황·병합본·규칙 내용은 운영자에게도 보이지 않는다.**
서버 관리자로서 디스크를 직접 볼 수 있다는 사실과, 제품이 그것을 화면으로
제공하는 것은 다른 문제다 — 제품은 제공하지 않는다. (완화 여부는 [Q-14](../../OPEN-QUESTIONS.md))

### AU-07 — 세션 없음

요청마다 JWT를 검증한다. 앱은 세션·쿠키·CSRF 토큰을 만들지 않는다.
로그아웃은 Cloudflare가 담당한다 (`/cdn-cgi/access/logout`).

### AU-08 — 로그아웃 링크

관리자·사용자 화면 모두 우상단에 제공.

```
https://worklog.excusa.uk/cdn-cgi/access/logout
```

### AU-09 — 감사 로그

`upload`, `download`, `download_zip`, `merge` 는 `AuditLog`에 남긴다.
`actor`는 **검증된 JWT의 이메일**이어야 한다 (헤더 값이 아니라).

---

## 3. Cloudflare 측 설정

### AU-10 — 터널은 원격 관리형(remote-managed)이다 ★

**실측 결과, 이 서버의 cloudflared는 로컬 `config.yml`을 쓰지 않는다.**

```
$ systemctl status cloudflared
  Active: active (running) since 2026-06-17  (1개월 26일 가동)
  /usr/bin/cloudflared --no-autoupdate tunnel run --token eyJhIjoi…

$ ls /etc/cloudflared/config.yml   → 없음
$ ls ~/.cloudflared/config.yml     → 없음
```

토큰 방식 = **Cloudflare 대시보드가 라우팅 설정의 정본**이다.

→ 스펙 §10의 "기존 설정 파일 위치" 항목은 **해당 없음**으로 해소. 파일을 찾을 필요가 없다.
→ 서버에서 손댈 것이 없다. **cloudflared 재시작 불필요** (다른 서비스에 영향 없음).

토큰에서 디코딩한 값:

| 항목 | 값 |
|---|---|
| Account ID | `<CF_ACCOUNT_ID>` |
| Tunnel ID | `<CF_TUNNEL_ID>` |

### AU-11 — 추가 절차 (대시보드)

**① Public Hostname 추가** — Zero Trust → Networks → Tunnels → 해당 터널 → Public Hostname

| 항목 | 값 |
|---|---|
| Subdomain | `worklog` |
| Domain | `excusa.uk` |
| Service | `HTTP` → `localhost:11111` |

**② Access 애플리케이션 생성** — Zero Trust → Access → Applications → Self-hosted

| 항목 | 값 |
|---|---|
| Application domain | `worklog.excusa.uk` |
| Session Duration | 24h (권장) |
| Policy | **파일럿**: Allow · Emails = AI홍보전략실 명단<br>**확산 시**: Allow · `Emails ending in @kei.re.kr` — 개별 나열은 337명 규모에서 유지 불가. 실제 가입 게이트는 앱의 DB(AU-04)가 담당 ([Q-13](../../OPEN-QUESTIONS.md)) |

**③ AUD 태그 복사** → `.env`의 `CF_ACCESS_AUD`

> ①만 하고 ②를 빼먹으면 **인터넷 전체에 공개된다.**
> 그래서 AU-02(JWT 검증)를 필수로 두었다 — Access 앱이 없으면 JWT가 없고, 앱이 모든 요청을 거부한다.
> **안전한 실패(fail-closed).**

### AU-12 — 검증 절차

배포 후 반드시 확인한다.

```bash
# 1) 로컬 바인딩 확인 — 127.0.0.1 이어야 함
ss -tlnp | grep 11111

# 2) 사내망 다른 기기에서 직접 접근 → 거부되어야 함
curl -m 5 http://<서버-내부-IP>:11111/          # 실패해야 정상

# 3) 시크릿 창에서 https://worklog.excusa.uk → Access 로그인 화면
# 4) 미허용 계정으로 로그인 → 차단
# 5) 허용 계정 → 통과, 상단에 본인 이름 표시
```

---

## 4. 위협 모델

| 위협 | 완화 |
|---|---|
| 터널 우회 직접 접근 | AU-01 (127.0.0.1 바인딩) |
| 헤더 위조 | AU-02 (JWT 서명 검증) |
| 타인 사칭 업로드 | AU-05 (서버가 신원 도출) |
| 관리자 화면 무단 접근 | AU-06 (DB 기반, 404) |
| Access 앱 설정 누락 | AU-02가 fail-closed로 차단 |
| 토큰 유출 | 터널 토큰은 systemd 유닛에 있음. 파일 권한 확인 필요 → [Q-07](../../OPEN-QUESTIONS.md) |
| 악성 파일 업로드 | [S-04](04-storage.md) ST-04~07 |
| 퇴사자 접근 | Access 정책 + `isActive=false` **양쪽** 해제 |

## 5. 테스트

| ID | 내용 |
|---|---|
| AU-T01 | JWT 없는 요청 → 401 |
| AU-T02 | 서명 위조 JWT → 401 |
| AU-T03 | production에서 `DEV_IDENTITY` 무시 |
| AU-T04 | 만료 JWT(`exp` 과거) → 401 |
| AU-T05 | `aud` 불일치 → 401 |
| AU-T06 | 유효 JWT + 미등록 이메일 → 403 `not_registered` |
| AU-T07 | 유효 JWT + `isActive=false` → 403 |
| AU-T08 | member가 담당자 화면(`/{slug}/manage`) 접근 → 404 |
| AU-T09 | 업로드 시 위조 `userId`/`divisionId` 필드 → **무시되고 JWT 신원으로 저장** |
| AU-T10 | `Cf-Access-Authenticated-User-Email`만 있고 JWT 없음 → 401 |
| AU-T11 | 미온보딩 부서 사용자 → "준비 중" 안내 (AU-04b) |

**격리 스위트 (AU-14 릴리스 게이트)**

| ID | 내용 |
|---|---|
| AU-T12 | A부서 member가 B부서 페이지 `GET /{B-slug}` → **404** |
| AU-T13 | A부서 lead가 B부서 submissionId 다운로드/드로어 → **404** |
| AU-T14 | A부서 lead가 B부서 zip/현황 API → **404** |
| AU-T15 | member가 같은 부서 타인 submissionId → **404** (AU-06 기본값) |
| AU-T16 | operator가 임의 부서 제출물·현황 API → **404** (AU-15) |
| AU-T17 | 존재하지 않는 slug와 남의 slug의 응답이 **구별 불가능** (동일 404) |

> AU-T09·T10(위조 방어)과 AU-T12~T17(격리)이 이 스펙의 핵심 회귀 테스트다.
