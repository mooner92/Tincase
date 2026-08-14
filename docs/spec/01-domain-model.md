# S-01. 도메인 모델

구현: `prisma/schema.prisma` · 접근 계층: `src/server/repo/*.ts`
v2: 부서(테넌트)·역할 도입 — [ADR-0005](../adr/0005-multi-division-tenancy.md)

---

## 1. 엔티티 관계

```
Division ──1───∞── User ──1───∞── Submission ──∞───1── WeekSlot (전역 달력)
    │                                  │
    ├──1───∞── Template                └ divisionId (비정규화 — 격리 인덱스)
    ├──1───∞── MergeRun (Phase 2)
    └──1───1── 병합 규칙/마감 정책 (Division 컬럼)

AuditLog (독립)
```

## 2. Prisma 스키마

```prisma
datasource db { provider = "sqlite"; url = env("DATABASE_URL") }
generator client { provider = "prisma-client-js" }

model Division {
  id            String  @id @default(cuid())
  slug          String  @unique          // "AI_and_Public_Relations_Division" (정식)
  shortSlug     String? @unique          // "aiprd" — 접속 시 정식 슬러그로 redirect (Q-18)
  nameKo        String  @unique          // "AI홍보전략실"
  nameEn        String                   // "AI and Public Relations Division"
  isActive      Boolean @default(false)  // 온보딩된 부서만 true

  deadlineDow   Int     @default(4)      // 마감 요일 1=월 … 7=일 (기본 목 — DM-10)
  deadlineTime  String  @default("14:00")// "HH:mm" KST
  mergeRuleText String  @default("")     // 부서 병합 규칙 (S-08 §6)
  guideText     String  @default("")     // 업로드 화면 작성 안내 (줄 단위, CP-21)

  createdAt     DateTime @default(now())
  users         User[]
  templates     Template[]
  submissions   Submission[]
  mergeRuns     MergeRun[]
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique          // Access 신원 대조 키 (소문자)
  name         String
  divisionId   String
  divisionRole String   @default("member") // "member" | "lead"
  isOperator   Boolean  @default(false)    // 최종 관리자(Sean). 테넌시·인원 + 전체 열람 (AU-15)
  isCoordinator Boolean @default(false)    // 전사 총괄(기획조정실). 전 부서 읽기 (AU-16)
  isActive     Boolean  @default(true)     // 전출·퇴사 시 false. 삭제 금지
  onRoster     Boolean  @default(true)     // 제출 대상인지 (운영자가 관리 — DM-04)
  sortOrder    Int      @default(100)      // 병합·현황 정렬
  createdAt    DateTime @default(now())

  division    Division @relation(fields: [divisionId], references: [id])
  submissions Submission[]

  @@index([divisionId, isActive, onRoster, sortOrder])
}

model WeekSlot {                          // 전역 주 달력 — 부서와 무관한 사실
  id          String   @id @default(cuid())
  isoKey      String   @unique            // "2026-W33"
  label       String                      // "8월 2주차"
  year        Int
  month       Int
  weekOfMonth Int
  opensAt     DateTime                    // 월 00:00 KST (UTC 저장)
  createdAt   DateTime @default(now())
  submissions Submission[]
  mergeRuns   MergeRun[]

  @@index([opensAt])
}

model Submission {
  id           String   @id @default(cuid())
  divisionId   String                     // = user.divisionId (DM-12 불변식)
  userId       String
  weekSlotId   String
  version      Int
  isLatest     Boolean  @default(true)

  filePath     String                     // STORAGE_ROOT 기준 상대경로
  originalName String
  byteSize     Int
  sha256       String

  uploadedAt   DateTime @default(now())
  uploadedFrom String?

  division Division @relation(fields: [divisionId], references: [id])
  user     User     @relation(fields: [userId], references: [id])
  weekSlot WeekSlot @relation(fields: [weekSlotId], references: [id])

  @@unique([userId, weekSlotId, version])
  @@index([divisionId, weekSlotId, isLatest])   // 격리 스코프 조회의 기본 축
}

model Template {                          // 부서별 마스터 양식 이력
  id          String   @id @default(cuid())
  divisionId  String
  filePath    String
  sha256      String
  version     Int                         // 부서 내 1부터 증가
  isActive    Boolean  @default(true)     // 부서당 active 1개 (DM-14)
  uploadedBy  String                      // User.id (lead)
  uploadedAt  DateTime @default(now())
  division    Division @relation(fields: [divisionId], references: [id])

  @@unique([divisionId, version])
  @@index([divisionId, isActive])
}

model MergeRun {                          // Phase 2
  id          String   @id @default(cuid())
  divisionId  String
  weekSlotId  String
  status      String                      // "running"|"succeeded"|"failed"
  outputPath  String?
  sourceIds   String                      // JSON: Submission id[]
  ruleSnapshot String                     // 실행 시점의 mergeRuleText (재현성)
  rowCounts   String?
  warnings    String?                     // JSON: string[]
  errorText   String?
  startedAt   DateTime @default(now())
  finishedAt  DateTime?
  division Division @relation(fields: [divisionId], references: [id])
  weekSlot WeekSlot @relation(fields: [weekSlotId], references: [id])

  @@index([divisionId, weekSlotId, startedAt])
}

model AuditLog {
  id        String   @id @default(cuid())
  at        DateTime @default(now())
  actor     String                        // 검증된 이메일
  divisionId String?                      // 격리 감사용
  action    String                        // upload|download|download_zip|preview|merge|rule_update|template_update|reject
  target    String?
  detail    String?
  @@index([at])
  @@index([divisionId, at])
}
```

---

## 3. 요구사항

### DM-01 — 이메일이 신원의 정본

Access가 확인한 이메일(소문자 정규화)로 `User`를 찾는다. 이름은 표시·파일명 전용.

### DM-02 — 시드는 인사자료에서 생성

`tools/extract-seed.py` → `docs/private/seed.json`(git 제외) → `prisma/seed.ts`가 읽는다.
휴대전화·사번 등은 추출 단계에서 이미 배제된다 ([R-002 §6](../research/002-kei-org-and-collection-flow.md)).

- 시드 시점: **전 부서 30개를 `isActive=false`로 넣되**, 파일럿(AI홍보전략실)만 `true`
- 사용자도 마찬가지 — 미온보딩 부서 사용자는 로그인해도 "준비 중" 안내 (AU-04b)

### DM-03 — 삭제 금지, 비활성화만

`User.isActive=false` / `Division.isActive=false`. 제출 이력의 참조 무결성 보존.

### DM-04 — `onRoster`: 제출 대상 명단은 **운영자가** 관리 ★

인사자료의 부서원과 실제 제출 대상은 다를 수 있다.
**인원 배치는 운영자(Sean) 소관** — 사용자 확정 (2026-08-13). 담당자는 문서만 다룬다.

- 시드 초기값: **직책이 실장/단장/본부장/센터장/원장급이면 `false`**, 그 외 전원 `true`
  (Q-12 확정: "팀장(실장) 제외, 나머지는 열어둔다 — 제출하고 싶은 게 있을 수 있다")
- 미제출은 페널티가 아니다. 현황에 표시될 뿐이다
- **현황 집계 분모 = `isActive && onRoster`**

> 원 스펙의 "8명"이 명부상 13명과 달랐던 이유가 이것이다. 숫자를 하드코딩하지 않는다.

### DM-15 — 취합게시판 제출 이력 (`boardStatus`) ★

전사 취합게시판에서 **실제로 제출하는 부서**를 기록한다. 30개 부서가 모두 제출하지는 않는다 —
상위 조직이 대표로 내거나, 하위 실 담당자가 상위 본부 명의로 내는 구조가 섞여 있다.

| 값 | 의미 | 온보딩 |
|---|---|---|
| `confirmed` | 제출일이 확인된 부서 | **1순위** |
| `unclear` | 담당자는 지정됐으나 제출 미확인 · 보고 단위 모호 | 확인 후 판단 |
| `none` | 게시판에 나타나지 않음 | 후순위 |

출처는 2026-08-13 게시판 화면 기준의 **관찰**이므로 확정 사실이 아니다.
운영자가 `/ops`에서 갱신할 수 있게 DB 필드로 둔다 (상수 하드코딩 금지).
반영: `scripts/apply-board-history.ts`

### DM-05 — `isLatest` 불변식 (v1과 동일)

`(userId, weekSlotId)`당 `isLatest=true` 정확히 1개. 단일 트랜잭션 + 유니크 제약으로 보증.

### DM-06 — 제출물 삭제 없음 (P2)

### DM-07 — 동일 sha256 재업로드 허용 + 안내 (v1과 동일)

### DM-08 — 현황은 조회로 파생

```ts
type MemberStatus = { user: User; latest: Submission | null; versionCount: number };
// 분모: division.users.filter(isActive && onRoster)
```

### DM-09 — 정렬

부서 내 정렬은 `sortOrder → name`. (v1의 팀 정렬은 부서 병합 규칙으로 이동 — S-08 §6)

### DM-10 — Division 마감 정책

`deadlineDow`(1~7) + `deadlineTime`("HH:mm"). **기본 목요일 14:00.**

근거: 전사 취합게시판 마감이 **목 15:00**이므로 ([R-002 §2](../research/002-kei-org-and-collection-flow.md)),
부서 내부 마감을 목 14:00으로 두면 담당자가 병합·제출할 1시간이 남는다.
부서별로 더 앞당길 수 있다 (운영자가 `/ops`에서 조정).
유효 마감 계산은 [S-02 WS-13](02-week-slot.md). 검증: `deadlineDow ∈ 1..7`, 시각 형식, 그리고
**월 00:00보다 뒤여야 함** (같은 주 안에서 열림→마감 순서 보장).

### DM-11 — WeekSlot은 전역 달력

부서와 무관한 사실(그 주의 월요일)만 담는다. **deadline 컬럼이 없다** — v1에서 변경.
부서별 마감은 항상 계산값이다. 슬롯 upsert는 v1(WS-11)과 동일하게 지연 생성.

### DM-12 — `Submission.divisionId` 정합 불변식 ★

```
∀ s: Submission → s.divisionId === s.user.divisionId (업로드 시점)
```

업로드 트랜잭션에서 서버가 `user.divisionId`로 채운다. 요청 본문 값은 쓰지 않는다 (AU-05).
비정규화 이유: 격리 스코프 조회(`WHERE divisionId = ?`)를 모든 목록 쿼리의 첫 축으로 강제.

> 사용자의 부서 이동(전보) 시 과거 제출물은 **이전 부서에 남는다** — 그 주의 보고는
> 그 부서의 보고였기 때문. 이동은 `divisionId` 변경 + 과거 데이터 불변으로 처리.

### DM-13 — 병합 규칙 스냅샷

`MergeRun.ruleSnapshot`에 실행 시점 규칙 원문을 저장한다. "그때 왜 이 순서로 나왔지"를
재현 가능하게 — 규칙은 계속 편집되므로 참조가 아니라 복사여야 한다.

### DM-14 — 부서 양식 불변식

부서당 `Template.isActive=true` 정확히 1개 (온보딩 완료 부서 기준).
교체는 새 버전 insert + 이전 deactivate — 파일도 DB 행도 지우지 않는다 (ST-19).

---

## 4. 상태 전이

### 4.1 부서 주차 (부서 × WeekSlot)

```
월 00:00 (전역 opensAt)      부서 마감 (기본 화 14:00)        다음 월 00:00
     │                            │                              │
─────┼──────── OPEN ──────────────┼───────── LOCKED ─────────────┼── 다음 주차
     업로드/재업로드 가능       업로드 409                      새 슬롯
     담당자: 현황·열람          담당자: 현황·열람·병합(P2)
```

`LOCKED`는 되돌아가지 않는다. **예외·대리 업로드 없음 — 사용자 확정 (2026-08-13).**
놓친 사람은 다음 주차에 낸다. 시스템은 이에 대해 어떤 우회로도 제공하지 않는다.

### 4.2 Submission (v1과 동일)

```
(없음) ─업로드→ v1(isLatest) ─재업로드→ v2(isLatest, v1은 false) → … 영구 보관
```

---

## 5. 인덱스 근거

| 인덱스 | 쿼리 |
|---|---|
| `Division.slug` (unique) | 페이지 라우팅 |
| `Submission(divisionId, weekSlotId, isLatest)` | 담당자 현황 / zip / 병합 대상 — **모든 목록 조회의 기본 축** |
| `Submission(userId, weekSlotId, version)` (unique) | 버전 경합 방어 |
| `User(divisionId, isActive, onRoster, sortOrder)` | 현황 분모 |
| `Template(divisionId, isActive)` | 양식 다운로드 |
| `WeekSlot.isoKey` (unique) | 슬롯 upsert |

## 6. 규모 전망

전 부서 온보딩 가정: 337명 × 52주 × 2(재업로드) ≈ **연 3.5만 행, 파일 ~3.5 GB/년**.
SQLite로 충분 ([ADR-0003](../adr/0003-sqlite-prisma.md)). `/data` 여유 21TB — 문제 없음.

## 7. 마이그레이션 정책 (v1과 동일)

운영 `prisma migrate deploy`, 마이그레이션 전 자동 백업(OPS-06), 파괴적 변경은 2단계.
