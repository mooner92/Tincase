# S-03. 인증 · 인가 · 부서 격리

구현: `src/server/auth.ts`, `src/server/authz.ts`, `src/server/session.ts`, `src/server/password.ts`
v2: 역할·부서 격리 — [ADR-0005](../adr/0005-multi-division-tenancy.md)
**v3: 사내망 비밀번호 인증 추가 — [ADR-0006](../adr/0006-internal-password-auth.md)**

---

## 1. 방침 (v3)

**신원 제공자는 둘, 인가는 하나다.** 어느 경로로 들어와도 결과는 동일한 `AccessIdentity`이며,
인가 계층(`authz.ts`)은 신원의 출처를 모른다.

```
[사내망 — 전 직원]                        [외부 — 운영자 전용]
브라우저 → 192.168.1.104:11111            브라우저 → TLS → Cloudflare Edge
   │  비밀번호 로그인                          │  Access 정책 (Sean 이메일만)
   │  세션 쿠키 (30일)                         │  JWT 발급 + 헤더 주입
   ▼                                          ▼  Tunnel → cloudflared
   └──────────────► 앱 ◄──────────────────────┘
                     │
                     ├─ ① 세션 해석 또는 JWT 서명 검증  ← 앱의 책임
                     └─ ② User 조회 → 역할·부서 격리 판정
```

우선순위: **세션 쿠키 → Cloudflare JWT → (비-production) 개발 우회.**
세션을 먼저 보는 이유는, 외부에서 들어온 사람도 로그인했다면 그 신원이 더 구체적이기 때문이다.

## 2. 요구사항

### AU-01 — 바인딩 정책 (v3에서 개정) ★

```
0.0.0.0:11111   ← 사내망 직접 접속 허용
```

**v1.0.0에서는 `127.0.0.1` 전용이었다.** 당시엔 앱에 인증이 없어 터널만이 유일한 신원 경로였고,
LAN 노출은 곧 무인증 노출이었다. v3에서는 **앱 자체가 인증한다**(AU-20~26). 따라서 LAN 바인딩은
"무인증 노출"이 아니라 정당한 접속 경로다.

바뀌지 않은 것: **인증 없이 접근 가능한 엔드포인트는 `/api/health` 하나뿐**이며,
그 응답에는 사용자·부서 정보가 없다 (API-33).

> 실측: 포트 `11111` 미사용 확인. **11111 채택** (사용자 지정, 기억 쉬움).

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

### AU-06 — 역할 매트릭스 (v2.1) ★

역할은 Access 정책이 아니라 **DB**가 정한다:
`divisionRole`(member|lead) + 전역 플래그 `isCoordinator`, `isOperator`.

| 행위 | member | lead | coordinator | operator |
|---|---|---|---|---|
| 자기 부서 페이지 · 본인 업로드/다운로드 | ✔ | ✔ | ✔ (자기 부서원으로서) | ✔ |
| **부서 제출 현황 (이름·제출여부·시각)** | **✔ 자기 부서** | ✔ 자기 부서 | ✔ **전 부서** | ✔ 전 부서 |
| 타인 제출물 **내용** 열람(드로어)·다운로드·zip | ✘ | ✔ 자기 부서 | ✔ 전 부서 (읽기) | ✔ 전 부서 |
| 병합 규칙 편집 / 병합 실행 / 양식 관리 | ✘ | ✔ 자기 부서 | ✘ (읽기만) | ✔ |
| 인원 배치 — 부서 생성·활성화, 사용자 배정·역할·onRoster | ✘ | ✘ | ✘ | ✔ **전용** |

사용자 확정 (2026-08-13):

- **부서 안에서는 서로 보인다** — "지금도 (이메일 참조로) 누가 냈는지 알 수 있다.
  눈치 안 보고 아무도 안 내는 것을 막으려면 팀끼리는 보여야 한다."
  단 member가 보는 것은 **현황(이름·제출여부·시각)까지**다. 타인 파일 **내용**은 lead부터.
- **남의 팀 것은 절대 X** — member·lead 기준 타 부서는 현황·존재까지 404.
- **coordinator(총괄)**: 전사 취합 실무자(기획조정실). 2단계 병합이 이 사람 일이므로
  전 부서 읽기 가시성이 필요하다. 쓰기 권한은 없다.
- **operator(Sean) = 최종 관리자**: 인원 배치 전권 + **구축·안정화 단계 동안 전체 열람**.
  "안정화되면 (축소할지) 몰라도" — 축소는 미래 결정 사항으로 남긴다 (Q-14 종결).
- coordinator·operator의 타 부서 열람은 **전부 감사 로그**에 남는다 (AU-09).
- 권한 없는 라우트는 전부 **404** (403 아님 — 존재를 노출하지 않는다).

### AU-13 — 부서 격리는 쿼리 레벨에서 강제 ★

핸들러마다 if문으로 거르지 않는다. **스코프된 저장소 계층만 존재하게 만든다.**

```ts
// src/server/authz.ts — 핸들러가 얻을 수 있는 유일한 진입점
export async function requireDivisionScope(req: Request): Promise<Scope> {
  const identity = await verifyAccess(req);
  const user = await requireActiveUser(identity.email);
  const readAll = canReadAllDivisions(user);          // operator || coordinator (AU-15·16)
  return {
    user,
    // member·lead의 모든 조회는 이 divisionId로 시작한다. slug·id는 검증용일 뿐 스코프가 아니다
    db: readAll ? crossDivisionReadRepo(user) : scopedRepo(user.divisionId),
    isLead: user.divisionRole === 'lead',
  };
}
```

- (member·lead) URL의 `slug`가 `user.division.slug`·`shortSlug`와 다르면 **404** —
  리다이렉트하지 않는다 (리다이렉트는 "그 부서가 존재한다"를 노출한다).
  자기 부서의 `shortSlug`는 정식 슬러그로 302 (Q-18)
- `Submission`·`Template`·`MergeRun` 조회는 예외 없이 `divisionId` 첫 축 (DM-12)
- `crossDivisionReadRepo`는 **읽기 메서드만 노출**한다 — coordinator의 쓰기가 타입 수준에서 불가능.
  operator의 쓰기(인원·테넌시)는 별도 ops 모듈로만

### AU-14 — 격리 회귀 테스트가 릴리스 게이트

격리는 기능이 아니라 **불변식**이므로 전용 테스트 스위트를 둔다 (§5 AU-T12~T17).
하나라도 깨지면 배포 금지. (격리의 주체는 member·lead — coordinator·operator는 정의된 예외)

### AU-15 — 운영자 전체 열람 (구축 단계 방침, 사용자 확정)

operator(Sean)는 최종 관리자로서 **전 부서의 현황·제출물·병합본을 열람할 수 있다.**
"일단 만들 때는 이렇게. 나중에 시스템 안정화되면 몰라도" — 2026-08-13.

- 모든 타 부서 열람은 감사 로그에 남는다 (투명성)
- 안정화 후 축소(테넌시 관리만)로 전환할 수 있도록, 열람 권한 판정은
  `canReadAllDivisions(user)` 단일 함수에 모은다 — 나중에 한 곳만 고치면 되게

### AU-16 — 총괄(coordinator) 읽기 가시성

전사 취합 실무자(기획조정실 1명, 시드 지정)는 **전 부서 읽기 전용** 접근을 갖는다:
현황·제출물·병합본(Phase 2). 규칙·양식·인원에 대한 쓰기는 없다.
근거: 2단계(전사) 병합이 이 사람의 실제 업무다 ([R-002 §2](../research/002-kei-org-and-collection-flow.md)).
UI는 확산 단계(Phase 3)에 제공 — 파일럿 동안은 대상 부서가 1개라 의미가 없다.

### AU-07 — 세션 (v3에서 개정)

Cloudflare 경로는 여전히 무상태다 — 요청마다 JWT를 검증한다.
사내망 경로는 세션 쿠키를 쓴다 (AU-21).

### AU-08 — 로그아웃

경로에 따라 다르게 동작한다 (`<LogoutButton viaCloudflare>`).

| 신원 출처 | 동작 |
|---|---|
| 세션 (사내망) | `POST /api/auth/logout` → 세션 삭제 → `/login` |
| Cloudflare | `/cdn-cgi/access/logout` 으로 이동 |

---

## 2.5 사내망 비밀번호 인증 (v3 신설) — [ADR-0006](../adr/0006-internal-password-auth.md)

### AU-20 — 비밀번호 저장

Node 내장 **scrypt** (`N=2^16, r=8, p=1, keylen=64`). 네이티브 의존성을 추가하지 않는다.
저장 형식 `scrypt$N$r$p$salt$hash` — 파라미터를 함께 저장해 나중에 상향할 수 있게.

> ⚠ 구현 함정: 이 파라미터는 64MB를 요구하는데 Node 기본 `maxmem`은 32MB다.
> `maxmem`을 명시하지 않으면 런타임 `RangeError`가 난다.

### AU-21 — 세션

| 항목 | 값 | 근거 |
|---|---|---|
| 유효기간 | **30일** | 재로그인 피로도 완화 (사용자 결정) |
| 갱신 | 마지막 사용 24시간 경과 시 슬라이딩 연장 | 상시 사용자는 사실상 만료 없음 |
| 저장 | DB(`Session`)에 **SHA-256 해시만**. 쿠키에 원문 토큰 | DB 유출 시 세션 탈취 불가 |
| 쿠키 | `httpOnly`, `sameSite=lax`, `path=/` | XSS·CSRF 완화 |
| 폐기 | 로그아웃·비밀번호 변경·재발급 시 | AU-25 |

### AU-22 — 초기 비밀번호와 강제 변경

1. 운영자가 `scripts/issue-passwords.ts`로 **랜덤 12자** 임시 비밀번호를 발급 (CSV 출력)
2. 개인별로 안전하게 전달, 출력물은 폐기
3. 첫 로그인 시 `mustChangePassword=true` → **모든 보호 페이지가 `/password`로 강제 이동**
4. 변경 완료 시 해제

발급 알파벳에서 `0/O/1/l/I`를 제외한다 — 종이·메신저로 전달되므로 오독을 막는다.

### AU-23 — 무차별 대입 방어

- 연속 실패 **8회** → **10분 계정 잠금** (잠금 중엔 올바른 비밀번호도 거부)
- 성공 시 카운터 초기화
- **사용자 열거 방지**: 없는 계정·틀린 비밀번호·비밀번호 미발급 → 전부 동일한 401 문구

### AU-24 — 비밀번호 정책

길이 우선 (NIST 800-63B 방향). **10자 이상**, 복잡도 요구 없음(한글 허용).
거부: 아이디(메일 local part) 포함 · 흔한 값 · 동일 문자 반복 · 앞뒤 공백.

### AU-25 — 변경 시 전 세션 무효화

비밀번호 변경·재발급 시 그 사용자의 **모든 세션을 삭제**하고, 변경을 수행한 브라우저만 재발급한다.
분실·유출 상황에서 다른 기기의 로그인을 확실히 끊기 위함.

### AU-27 — 운영자의 비밀번호 초기화 ★

운영자는 `/ops` 인원 목록에서 **누구든 비밀번호를 초기화**할 수 있다.
셀프 리셋 경로(메일 발송)가 없으므로, 이것이 분실·잠금의 유일한 복구 수단이다.

```
POST /api/ops/password-reset { userId }
  → 새 임시 비밀번호 생성 · mustChangePassword=true · 잠금 해제 · 전 세션 파기
  → 평문을 응답에 **한 번만** 반환 (서버는 해시만 보관)
```

| 규칙 | 이유 |
|---|---|
| operator만, 그 외 **404** | 존재 은닉 (AU-06과 동일 원칙) |
| 평문은 응답·화면에만. 로그·DB에 절대 없음 | OPS-11b |
| 대상의 **모든 세션 파기** | 분실·유출 시 다른 기기 로그인을 확실히 끊는다 (AU-25) |
| 잠긴 계정도 함께 해제 | 초기화가 잠금 복구를 겸한다 |
| 감사 로그 `password_reset` | 누가 누구 것을 언제 |

화면에는 발급 결과가 목록으로 쌓이고 **복사**·**안내문 복사**(주소·아이디·임시비번 포함) 버튼을 제공한다.
"화면을 닫으면 다시 볼 수 없다"를 경고로 명시한다.

또한 인원 목록에 비밀번호 상태를 표시한다: `미발급` / `변경 대기` / `사용 중` / `잠김`.

### AU-26 — 평문 HTTP 위험 (수용된 잔여 위험) ★

사내망 접속은 `http://192.168.1.104:11111` 이므로 **비밀번호와 세션 쿠키가 LAN을 평문으로 지난다.**
따라서 세션 쿠키에 `secure` 플래그를 켤 수 없다 (켜면 사내망 로그인이 동작하지 않는다).
Cloudflare 경유(HTTPS)일 때만 `secure`를 켠다 — 요청의 프로토콜로 판단.

| 완화 | 상태 |
|---|---|
| 사내망 한정 (외부에서 도달 불가) | 적용됨 |
| 세션 토큰은 DB에 해시로만 | 적용됨 |
| 비밀번호는 절대 로깅하지 않음 | 적용됨 (OPS-11b) |
| TLS 적용 | **미적용** — 사내 인증서 필요. 확산 단계에서 재검토 |

> 사내 LAN 도청 위험은 낮지만 0이 아니다. **의식적으로 수용한 위험**이며,
> 전 부서 확산 시 사내 인증서 또는 리버스 프록시 TLS를 재검토한다.

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
| Policy | **v3 개정: Allow · Emails = 운영자(Sean) 1명** — Cloudflare는 운영자의 외부 통로로만 쓴다 ([ADR-0006](../adr/0006-internal-password-auth.md)). 나머지 직원은 사내망 + 비밀번호 로그인 |

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

**사내망 인증 스위트 (AU-20~26)** — `tests/auth-password.test.ts` 14개

| ID | 내용 |
|---|---|
| AU-T20 | 같은 비밀번호도 매번 다른 해시(salt), 검증 통과 |
| AU-T21 | 정책 — 짧음·아이디 포함·흔한 값·반복문자·공백 거부, 한글 허용 |
| AU-T22 | 초기 비밀번호에 `0/O/1/l/I` 없음, 12자 |
| AU-T23 | 없는 계정·틀린 비밀번호·미발급 → **동일 401 문구** (열거 방지) |
| AU-T24 | 로그인 성공 → 세션 쿠키(httpOnly, secure 없음) + `mustChangePassword` |
| AU-T25 | 연속 8회 실패 → 429 잠금, 올바른 비밀번호도 거부 |
| AU-T26 | 세션 쿠키만으로 API 200 · 위조 토큰 401 · 쿠키 없으면 401 |
| AU-T27 | 비밀번호 변경 → 다른 기기 세션 401, 현재 브라우저는 유지 (AU-25) |
| AU-T28 | 변경 후 옛 비밀번호 거부, 새 비밀번호 통과 |
| AU-T29 | 로그아웃 → 세션 파기 후 401 |
| AU-T30 | 세션 TTL = 30일 |
| AU-T31 | 비운영자의 초기화 요청 → 404 (AU-27) |
| AU-T32 | 운영자 초기화 → 12자 임시 비밀번호 발급, 그 값으로 로그인·변경 강제 |
| AU-T33 | 초기화 시 대상의 기존 세션 전부 401 |
| AU-T34 | 잠긴 계정이 초기화로 해제되고 감사 로그 기록 |

**격리 스위트 (AU-14 릴리스 게이트)**

| ID | 내용 |
|---|---|
| AU-T12 | A부서 member가 B부서 페이지 `GET /{B-slug}` → **404** |
| AU-T13 | A부서 lead가 B부서 submissionId 다운로드/드로어 → **404** |
| AU-T14 | A부서 lead가 B부서 zip/현황 API → **404** |
| AU-T15 | member가 같은 부서 **현황 조회 → 성공(이름·여부·시각)**, 타인 파일 다운로드/드로어 → **404** |
| AU-T16 | operator·coordinator의 타 부서 열람 → 성공 + **감사 로그 기록** (AU-15·16) |
| AU-T17 | (member 기준) 존재하지 않는 slug와 남의 slug의 응답이 **구별 불가능** (동일 404) |
| AU-T18 | coordinator가 타 부서 규칙/양식 **변경** 시도 → 404 (읽기 전용) |

> AU-T09·T10(위조 방어)과 AU-T12~T17(격리)이 이 스펙의 핵심 회귀 테스트다.
