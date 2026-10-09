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
    ├──1───∞── MergeJob (병합 줄 — HM-59, 2026-10-08. 외래 키 없이 divisionId · weekSlotId)
    └──1───1── 병합 규칙/마감 정책 (Division 컬럼)

AuditLog (독립)
```

> 아래 스키마는 처음 설계의 발췌다 — 정본은 `prisma/schema.prisma`. 2026-10-08 2단계에 더한 것: `MergeJob`(병합 줄의 작업 — 대기 · 병합 중 ·
> 끝 · lease, HM-59) · `MergeRun.outputSha`(병합이 쓴 바이트의 sha — 점검 요약이 파일과 기록이 같은지 본다, HM-56e). 둘 다 더하기만 한다(`prisma db push`).

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
  // 2026-10-08 (HM-51 · ADR-0018) — 부서가 고르는 병합 설정은 mergeCategories 하나다. 아래 넷은 열만 남는다(아무도 읽지 않는다)
  mergeRuleText String  @default("")     // ~~부서 병합 규칙 (S-08 §6)~~ 엔진이 읽지 않는다
  mergeSort     String  @default("input")// ~~"input" 제출자 순 | "date" 일자 오름차순 (HM-48)~~ 제출자 순 고정
  mergeUndated  String  @default("last") // ~~날짜 없는 줄의 자리 (HM-48)~~ 읽지 않는다
  guideText     String  @default("")     // ~~업로드 화면 작성 안내 (줄 단위, CP-21)~~ 작성 안내는 폐지 2026-10-08 (R5)

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
  action    String                        // upload|download|download_zip(2026-10-08 폐지 — 옛 기록)|preview|merge|rule_update|template_update|reject
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
| `confirmed` | 업무일지를 내는 부서 (게시판 답변일자 확인) | **대상** |
| `none` | 업무일지를 쓰지 않는 부서 | 대상 아님 |

**`unclear`는 2026-08-26에 폐기했다.** 조사 단계(R-002)에서는 게시판만 보고 판단해야 해서
「담당자는 있는데 제출은 못 봤다」는 중간 상태가 필요했다. 운영자가 게시판 답변일자로
**실제 담당자 11명**을 확정하면서 모호함이 사라졌다 — 나머지는 **연구부서라 업무일지를
아예 쓰지 않는다.** 답이 나온 뒤에도 「확인 필요」를 남겨두면 볼 때마다 끝난 확인을 다시 한다.

값 자체는 문자열이라 옛 데이터에 `unclear`가 남아 있어도 깨지지 않는다.
화면은 「confirmed가 아닌 전부」를 이력 없음으로 묶어 보여주므로 사라지는 부서가 없다.

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

담기는 것: `trigger` · `categories` (2026-10-08 — HM-51. 부서가 고르는 것이 분류 순서 하나다. 고정값은 날짜로 안다).
~~`dedupe` · `dropNotes` · `guidance` · `sort` · `undated` (HM-48) · `emphasisWords` (HM-38)~~ — 그 전 실행의 스냅샷에는 이 키들이 그대로 있다.
**순서를 바꾸는 설정은 빠짐없이 들어가야 한다** — 하나라도 빠지면 「왜 이 순서」의 답이 스냅샷에 없다.
목록은 `ruleSnapshotOf()` 하나가 정한다. ~~수합 관리의 「규칙 바뀜」(CP-107)도 같은 목록으로 지금 설정과 비교한다~~ — 「규칙 바뀜」은 폐지 2026-10-08 (R4).

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
| `Submission(divisionId, weekSlotId, isLatest)` | 담당자 현황 / 병합 대상 (zip은 폐지 2026-10-08) — **모든 목록 조회의 기본 축** |
| `Submission(userId, weekSlotId, version)` (unique) | 버전 경합 방어 |
| `User(divisionId, isActive, onRoster, sortOrder)` | 현황 분모 |
| `Template(divisionId, isActive)` | 양식 다운로드 |
| `WeekSlot.isoKey` (unique) | 슬롯 upsert |

## 6. 규모 전망

전 부서 온보딩 가정: 337명 × 52주 × 2(재업로드) ≈ **연 3.5만 행, 파일 ~3.5 GB/년**.
SQLite로 충분 ([ADR-0003](../adr/0003-sqlite-prisma.md)). `/data` 여유 21TB — 문제 없음.

## 7. 마이그레이션 정책 (v1과 동일)

운영 `prisma migrate deploy`, 마이그레이션 전 자동 백업(OPS-06), 파괴적 변경은 2단계.

## DM-16/17 — 명단은 집계 대상이지 제출 권한이 아니다 (v1.10.0)

### DM-16 — `onRoster`의 뜻

| | |
|---|---|
| `onRoster = true` | **이번 주 낼 것으로 기대되는 사람.** 현황의 분모, 미제출 독촉 대상 |
| `onRoster = false` | 기대하지 않는 사람 — 부서장·휴직 등. **낼 수는 있다** |

전에는 이 플래그가 제출 권한까지 겸했다. 그러면 *안 내도 되는 사람*이 *못 내는 사람*이 된다.
부서장이 한 주 특별히 쓸 일이 생겨도 방법이 없었다.

**`rosterNote`** — 뺀 이유를 같이 적는다 (`"휴직"`, `"부서장"` 등).
빼는 것과 이유를 함께 남기지 않으면 몇 주 뒤에 왜 뺐는지 아무도 모르고,
복직처럼 **되돌려야 할 때** 판단할 근거가 없다. 되돌리기는 체크박스를 다시 켜는 것뿐이며,
과거 제출 이력은 그대로 남는다.

### DM-17 — 명단 밖 제출은 «추가 제출»로 보인다

제출을 열어두면 그 제출물이 묻힐 수 있다. 현황은 명단만 보기 때문이다.
그래서 현황이 세 갈래로 답한다:

| | 뜻 |
|---|---|
| `members` | 집계 대상 (분모) |
| `extras` | 명단 밖인데 **낸 사람** — 담당자 화면에 «추가 제출»로 |
| `offRoster` | 집계 제외 인원 + 사유 |

**병합은 원래 낸 사람 전부를 담는다** (`isLatest` 기준, 명단을 보지 않는다).
그래서 추가 제출도 병합본에 들어간다.

진척률(`submitted/roster`)과 **모인 파일 수**(`submitted + extras`)는 다른 수다.
병합 패널은 후자를 쓴다(zip은 폐지 2026-10-08) — 전자를 쓰면 추가 제출만 있을 때
"제출된 파일이 없습니다"라고 하면서 병합은 되는 모순이 생긴다.

| ID | 검증 |
|---|---|
| ST-T34 | `onRoster=false`도 제출 201 |
| ST-T35 | 분모에는 없고 `extras`로 잡힌다 |
| ST-T36 | 병합 대상 조회에 포함된다 |
| ST-T37 | 제외 사유가 현황에 함께 나온다 |

---

### DM-18 — 부서장(`head`)과 담당자(`lead`)는 다른 사람이다 ★

역할은 다섯 가지다 (TACP v1.3 · [ADR-0008](../adr/0008-head-principal.md)).
새로 생긴 것은 **`head`(부서장)** — 실·본부·단·센터의 장이다.

| | 하는 일 | 부서 문서 권한 |
|---|---|---|
| `lead` 담당자 | 병합본을 받아 **취합게시판·웹디스크에 제출** | 열람·양식·규칙·병합·수정 |
| `head` 부서장 | 병합본을 **검토**하고 고칠 곳을 알려준다 | **위와 같다** |

**권한이 같은데 왜 나누는가.** 다른 것은 권한이 아니라 **책임**이고, 그것은 알림 시점으로
나타난다 (NT-40). 부서장은 마감 +10분에 「검토해주세요」를, 담당자는 +30분에
「제출해주세요」를 받는다. 대외업무 마감(15:00)까지 남은 한 시간을 둘로 나눈 것이다.

**3단계에서는 부서장의 승인이 곧 제출이다 (2026-10-08, [12 §2a](12-org-rollup.md) · [ADR-0015](../adr/0015-approval-is-handoff.md)).**
「실팀장 승인 후엔 담당자가 고칠 것이 없다」(사용자) — 그래서 승인하는 순간 그 판이 본부(또는 총괄)로 간다. 담당자의 「제출」은
없어지고, 담당자에게 남는 것은 병합본 확인·수정(고치면 부서장이 다시 승인해야 올라간다)과, 부서장이 자리에 없을 때의
「승인 없이 올리기」(기한 15분 전부터, 위에서 주황으로 보인다)다. 부서장이 없는 부서는 마감 뒤 최종본이 그대로 올라간다.

### DM-18b — 위로 간 판의 **근거** (2026-10-08)

위로 간 사본(`ReportSubmission`)은 「누가 올렸나」와 함께 **무엇을 근거로 갔나**(`basis`)를 가진다 — 위에서 그 판을 얼마나 믿어도 되는지가 거기서 갈린다.

| `basis` | 뜻 | 기록의 주체 | 위의 화면 |
|---|---|---|---|
| `approved` | 부서장(본부장)이 승인한 그 바이트 | 승인한 사람 | 그대로(승인 시각) |
| `no_head` | 승인할 사람이 없는 단위 — 마감 뒤 최종본 | `system` | 「부서장 없음」 |
| `unapproved` | 담당자가 비상구로 올린 지금 판 | 그 담당자 | **주황** 「승인 없이」 |
| `manual` | 2026-10-08 전의 [제출] (옛 기록) | 누른 사람 | 그대로 |

같은 바이트라도 근거가 바뀌면(승인 없이 올린 판을 나중에 승인) 새 행이다 — 「언제부터 승인된 판이었나」가 남는다.

### DM-18a — 한 주의 알림 시각 (NT-10 · NT-41 · NT-42 · NT-40)

AI홍보전략실(목 14:00 마감) 기준. 부서 마감이 다르면 **그 부서 마감을 기준으로** 같은 간격이다.

| 시각 | 받는 사람 | 내용 | ID |
|---|---|---|---|
| 전날 11:45 | 미제출자 | 「내일이 마감이에요」 | NT-41 |
| ~~당일 09:00~~ | ~~미제출자~~ | ~~「오늘 14:00 마감이에요」~~ — 폐지 2026-10-08 | ~~NT-45~~ |
| 13:00 | 미제출자 | 「아직 안 냈어요」 | NT-10 |
| 13:50 | 미제출자 | 「10분 뒤 마감입니다」 — **최후** | NT-42 |
| **14:00** | — | **마감 · 제출 잠김** | WS-06 |
| 14:01 | — | 자동 병합 시작 | HM-25·HM-35 |
| 14:10 | `head` 부서장 | 「병합본 준비됐어요, 검토 부탁드려요」 — **이미 승인했으면 보내지 않는다**(NT-47)<br>실패 시 → `lead`에게 「지금 병합을 눌러주세요」 | NT-40 |
| 부서장이 저장·승인한 **즉시** | `lead` 담당자 | 「○○ 실장님이 검토를 마쳤어요 — 승인 완료. 바뀐 곳: …」 — 3단계면 끝 줄이 **「○○에 자동으로 올라갔어요」**(NT-46′, 취합게시판 안내 대신) | **NT-46** |
| 14:30 | `lead` 담당자 | 「최종 확인하고 제출해주세요」 + **승인 상태 한 줄**(승인 완료 · 시각 / 아직 승인 전). 3단계면 **할 일이 있을 때만**(NT-47′): 승인돼 올라갔으면 안 보낸다 · 승인 전이면 「승인되면 저절로 ○○에 올라갑니다(기한 15:00)」 · 부서장 없는 부서면 「올라갔어요 — 고치면 다시 올라갑니다」 | NT-40 · **NT-47** · RU-53 |
| 승인 뒤 병합본이 바뀐 **즉시** (3단계) | `head` 부서장 | 「담당자가 승인 뒤 n곳 고쳤어요 / 다시 병합됐어요(늦게 낸 n명) — 다시 승인하면 올라갑니다」. **승인마다 한 번**(2026-10-08 개정 — 새 판마다 → 승인마다. 다시 승인하기 전에 또 바뀌어도 할 일은 같다) | **NT-52** (HM-47) |
| 그 단위 기한 15분 전 (3단계) | `head` 부서장 | 마감 뒤 병합본이 승인 전·승인 뒤 바뀜일 때만: 「15분 남았어요 — 승인하면 바로 ○○에 올라갑니다」 | **RU-56a** |
| 마감 열기가 닫힌 뒤 | `lead` 담당자 | 사람이 고친 최종본이라 **자동 재병합을 멈췄을 때만**: 「n명이 더 냈어요 — [다시 병합]하면 고친 내용은 사라져요」. 닫힘마다 한 번 | **NT-51** (HM-49) |
| 15:00 | — | 대외업무 마감 | |

3단계 알림(본부장·총괄에게 가는 것)은 [12 §8](12-org-rollup.md) RU-53~57b. 테스트(2026-10-08 추가 — `tests/rollup-notices.test.ts`):
`[NT-T63]` NT-46′ — 3단계면 「○○에 자동으로 올라갔어요」, 꺼져 있으면 지금 문구 · `[NT-T64]` NT-47′ — 승인돼 올라갔으면 안 보냄 /
승인 전 / 부서장 없음 세 갈래 · `[NT-T65]` NT-52 — **승인마다 한 번**(2026-10-08 개정: 그 승인 뒤 또 고치거나 다시 병합해도 더 보내지 않는다 · 다시 승인한 뒤 바뀌면 다시 한 번), 부서장에게만, 부서 알림 스위치·3단계 스위치를 따른다 ·
`[NT-T66]` (2026-10-08 검증) 가장 최근 승인에 대해 NT-52가 이미 갔으면 마감 뒤 +10분 검토 요청(NT-40 `merge_review`)을 부서장에게 또 보내지 않는다 —
실장이 14:03에 승인하고 담당자가 14:06에 고치면 같은 할 일이 4분 사이에 두 번 가던 틈. NT-52가 없었으면 검토 요청은 그대로

**병합이 돌고 있으면 기다린다 — 멈춘 것은 기다리지 않는다** (HM-35 · HM-55). 마감 +10분에 아직 running이면 「병합본이 아직 없어요」를 미루지만,
예산 + 여유(기본 10분)보다 오래된 running은 재시작 등으로 끊긴 기록이라 기다리지 않고 담당자에게 알린다.

**병합이 늦게 끝나면 14:10·14:30 창도 그만큼 늦게 연다** (HM-50). 창의 시작은 `max(마감 + n분, 병합이 끝난 시각)`이고,
대외 마감(+60분)이 지나서 끝난 병합에는 보내지 않는다. 부서가 많아 병합이 줄을 서도 먼저 끝난 부서는 기다리지 않는다.

**연휴 주.** 표의 시각은 전부 **그 주의 부서 마감**에서 계산한다(`effectiveDeadline`). 총괄이 공지를 붙여넣어
마감을 옮기면(WS-19) 전날·마감 전·검토·제출 알림이 **한꺼번에 같은 간격으로** 옮겨진다. 승인 알림(NT-46)은
시각이 아니라 승인하는 순간이라 따로 옮길 것이 없다.

**왜 최후 알림이 따로 필요한가 (NT-42).** 13:00 알림은 「아직 시간이 있다」로 읽힌다 —
회의에 들어가면서 「이따 하지」가 되고, 나와 보면 마감이다. 10분 전은 그 여지가 없다.
같은 사람에게 가는 세 번째라 **문구를 다르게** 만든다: 제일 짧고, 남은 분을 숫자로 적고,
놓쳤을 때 무엇을 해야 하는지(담당자에게 말한다, TACP-18)를 적는다.

**창이 마감을 넘지 않는다.** 넘으면 「10분 남았습니다」가 마감 뒤에 나가고, 그건 거짓말이자
이미 못 내게 된 사람에 대한 재촉이다. 스케줄러가 1분 주기라 창은 3분이면 족하다.

**왜 전날 11:45인가.** 편의가 아니라 «방해하지 않기»가 이유다. 사내 메신저는 알림이 오면
화면이 번쩍여서, 업무 중에 받으면 알림 자체가 방해다. 11:45는 점심으로 자리를 뜨기 직전이라
번쩍여도 아무 일도 끊지 않는다. 더해서, 13:00 알림만으로는 늦다 — 그때 회의 중이면 못 쓴다.
전날 알림은 「지금 쓰라」가 아니라 「오늘 중에 시간을 잡으라」다.

~~**당일 09:00 (NT-45, 2026-10-06 신설).**~~ — **폐지 2026-10-08** (기능 정리 R13). 출근 직후 「오늘 마감이에요」였다.
같은 사람에게 한 주에 네 번이 되었고, 실측으로 이 단계가 따로 잡은 사람이 적었다(1주 9명 — 전날 알림은 5주 44명, 1시간 전은
6주 25명이 매주 돌았다). 10분 전(NT-42)은 남긴다 — 마감 직전에 실제로 사람을 잡았다. 지난 주의 `NotifyLog.kind = 'deadline_day'`
기록은 지우지 않고, 그 주를 열면 「알림 받음」(NT-31)에 그대로 센다.

**걷으면서 되돌아온 구멍.** 이 알림은 **전날 알림을 놓친 주의 안전망**이기도 했다. 연휴로 마감이 당겨질 때(WS-18) 공지는
대개 전날 오후에 나오는데, 그때는 전날 11:45가 이미 지났다. 알림은 창 안에서만 나가고 소급하지 않으므로(NT-43), 그런 주에는
**마감 한 시간 전이 첫 알림**이다(2026-10-06 주가 그랬을 사례 — NT-T62가 고정해 둔다). 마감을 당긴 총괄은 공지와 함께 메신저로
한 번 알리는 편이 낫다.

**왜 마감 정각이 아니라 +1분인가**, 그리고 **왜 마감 전 병합은 최종본이 아닌가**는
[ADR-0009](../adr/0009-deadline-as-event.md)에 있다 — 2026-08-27 자동 병합 누락 사고의 기록이다.

권한을 조각내지 않은 이유는 ADR-0008에 있다 — 「볼 수는 있는데 못 고치는」 중간 단계는
행렬 칸만 늘리고 실제로 막는 것이 없다. 장이 담당자에게 "고쳐줘"라고 말하는 것과
직접 고치는 것 사이에는 보안 경계가 없다.

### NT-20·21·22 — 알림 끄기

| ID | 규칙 |
|---|---|
| NT-20 | `User.notifyEnabled=false`인 사람에게는 마감·병합·취합 알림을 보내지 않는다 — 제출 의무와는 별개다. 비밀번호 링크(AU-30·32)는 본인이나 운영자가 그때 요청한 것이라 이 설정을 보지 않는다 |
| ~~NT-21~~ | ~~본인이 사용자 메뉴의 「알림 받기」 스위치로 끈다 (`PUT /api/me/notify`)~~ — **폐지 2026-10-08** (R12). 끈 사람이 0명이었다(바꾼 기록 2건은 운영자의 시험) |
| NT-22 | 운영자가 인원 드로어의 알림 칸으로 끈다 — **사람마다** 알림을 끄는 유일한 자리다(부서 전체는 NT-61). 사번이 없으면 칸이 잠긴다(알림이 갈 데가 없다) |

### NT-30·61 — 부서 알림 스위치 `Division.notifyEnabled`

부서마다 따로 켠다 — 「한 부서에서 먼저 써 보고 하나씩 넓힌다」가 이 층으로 된다. 부서를 켜는 것(`isActive` — 로그인·제출)과 쪽지가 가기 시작하는 것을
가른 이유는, 켠 날 사람 칸(역할 · 집계 제외 · 사번)을 맞추기 전에 독촉이 나가면 되돌릴 수 없어서다(집계 대상인 부서장에게 마감 독촉 세 통 — LAUNCH-v2 9-4).

| ID | 규칙 |
|---|---|
| NT-30 | 부서 알림은 부서가 **켜져 있고(`isActive`) 그리고** 이 스위치가 켜졌을 때만 나간다(기본 꺼짐). 그 부서 부서원·담당자·부서장에게 가는 것 전부다 — 마감 전(NT-10) · 병합 뒤(NT-40) · 승인 완료(NT-46) · 다시 승인(NT-52) · 늦게 낸 사람 빠짐(NT-51) · 실·팀 기한 15분 전(RU-56a). 본인 설정(NT-20)·사번(NT-01)은 그 위에 그대로. 이 스위치를 보지 **않는** 것: 본부장·총괄의 3단계 알림(RU-52) · 「병합 점검」(NT-60 — 부서 켜짐도 보지 않는다) · 설정 링크·비밀번호 찾기 |
| NT-61 | 운영자가 `/ops` 부서 표의 「알림」으로 켜고 끈다 (2026-10-09 — PG-91 · API-66). **켜짐과 따로 움직인다** — 꺼진 부서에 미리 켜 둘 수 있고, 켜기 전까지는 아무것도 나가지 않는다(NT-30의 「그리고」). 바꾸면 감사 기록 `rule_update`에 `changed`(`notifyEnabled`)와 바뀐 값이 남는다. 예전에는 화면이 없어 운영 DB에 SQL로 바꿨다 — 감사 기록이 없어 그날 명령 출력이 유일한 기록이었다 |

검증: `[API-T26]` 운영자만 · 불리언만 · 저장 · 감사(`tests/ops-notify.test.ts`) · `[NT-T91]` 꺼진 부서는 스위치가 켜져 있어도 받지 않는다 — 마감 전 알림 ·
승인 완료. 운영자는 꺼진 부서에 속해도 들어오므로(`requireScope` — AU-04b의 예외) 운영자 겸 부서장의 승인은 꺼진 부서에서도 들어온다 — 승인 알림은 부르는 쪽에 기대지 않고 켜짐을 함께 본다(`tests/ops-notify.test.ts`)

### NT-56 — 가짜 알림 수신함 (시험·시연 서버, 2026-10-08) ★

v2 전환(10/12) 전 주말에 알림을 **실제로 보내지 않고** 끝까지 시험해야 한다. 메신저는 사람 화면에 팝업을 띄우므로 시험 서버는 메신저를 껐고(RU-41),
그래서 「어느 알림이 누구에게 언제 가나」는 운영에서 처음 보였다. 수신함은 **같은 앱 안의 주소**다 — 클라이언트(`src/server/messenger.ts`)는
진짜 메신저와 구별하지 않고 보내고, 밖으로는 아무것도 나가지 않는다. 운영자는 화면(PG-88)에서 보고, 리허설(OPS-47)은 같은 기록으로 판정한다.

| ID | 규칙 |
|---|---|
| NT-56 | **문** — `TINCASE_ENV`가 test·demo **그리고** `MESSENGER_SINK=on`일 때만 열린다(`sinkOpen`). 그 밖에서는 받는 경로(`POST`·`GET /api/dev/messenger-sink`)·화면(`/ops/notify-sink`)·비우기(`DELETE /api/ops/notify-sink`)가 **누구에게나 404**다(TACP-5) — 운영에서 `MESSENGER_SINK=on`을 줘도 닫혀 있다 |
| NT-56a | **받는 것** — 클라이언트가 진짜 메신저에 보내는 요청 그대로: `POST` · `application/x-www-form-urlencoded` · 필드 16개(messenger.md §6). 응답은 진짜 메신저의 성공 응답과 같은 평문 `send ok` — 클라이언트가 「처음 보는 응답」 경고를 내지 않는다. `CMD=ALERT`·`RecvId`가 없으면 422(진짜 메신저에서 조용히 무시될 요청을 먼저 드러낸다). 본문 64KB까지 — 길이 머리 없이 와도 넘는 순간 끊는다(413). 신원을 묻지 않는다 — 부르는 쪽이 앱 자신이고 진짜 메신저도 신원을 받지 않는다(TACP §6 예외). **쓰기만** 한다 — `GET`은 「열려 있다」(`{sink:'on'}`)만 답하고 기록을 내주지 않는다 |
| NT-56b | **기록** — `STORAGE_ROOT/dev/messenger-sink.jsonl`, 한 통 = 한 줄: 받은 시각 · 종류 · 받는 사람(사번 → 그 사번의 사람 이름·이메일, 모르는 사번은 빈 칸으로 남긴다 — 「누구에게 갔어야 했나」) · 제목 · 본문 · 주소 · 받은 폼 전체. DB가 아닌 이유: 시험 전용 기록에 표를 늘리면 운영 DB에도 빈 표가 생기고 지울 때 마이그레이션이 따라온다 — 파일은 저장소와 함께 다닌다(평소·시연 모드). 5MB를 넘으면 뒤의 3000줄만 남긴다 |
| NT-56c | **종류** — 부르는 곳이 `NotifyLog.kind`와 같은 값을 `sendAlert({kind})`로 넘기고, 클라이언트는 **수신함으로 갈 때만** 머리 `x-tincase-kind`에 싣는다. 진짜 메신저가 받는 요청은 바이트 하나 달라지지 않는다. NotifyLog에 남지 않는 알림(비밀번호 링크)은 `forgot`·`setup_link`. **보내는 곳은 모두 싣는다** — 빠진 곳은 수신함에 「종류 없음」으로 남고 리허설(OPS-47)이 뜻밖의 알림으로 잡는다(병합 줄과 합칠 때 「병합 점검」 `merge_batch`·`merge_batch_done`이 빠져 있었다 — NT-60) |
| NT-56d | **허용 목록** — 테스트 서버 compose는 `MESSENGER_ALLOWLIST: "*"`. 허용 목록(NT-03)은 「실제 사람 누구에게 보내도 되나」를 거르는 마지막 문인데 수신함으로 가는 알림은 이 앱 자신에게 간다 — 거를 사람이 없고, 거르면 「누구에게 갔을 것인가」가 기록에 남지 않는다. 거른 사번은 여전히 로그에만 남는다(NT-03 그대로). 운영의 허용 목록은 `.env.production`에만 있고 테스트 compose는 그 파일을 읽지 않는다 |
| NT-56e | **나간 것으로 센다** — 수신함이 받은 알림은 `NotifyLog`에 「보냄」으로 남는다(`send ok` = 성공). 그래서 「한 주차·한 종류에 한 번」(NT-42) · 「기록을 먼저 잡고 보낸다」(12 §8)가 시험 서버에서도 그대로 확인된다. 예전 테스트 서버(메신저 끔)는 아무것도 나가지 않아 `NotifyLog`도 남지 않았다 |
| NT-56f | **기동** — 알림이 엉뚱한 곳으로 가는 설정(운영이 수신함으로 · 시험 서버가 실제 메신저로 · 수신함 주소인데 문이 닫힘)이면 서버가 뜨지 않는다 — OPS-46 |

시험 `[NT-T75]` 문 판정 · `[NT-T76]` 기동 거부 · `[NT-T77]` 운영 404(운영자에게도) · `[NT-T78]` 클라이언트 → 수신함 왕복(종류 머리는 수신함에만) · 화면·비우기는 운영자만 ·
`[NT-T79]` 테스트 compose · `[NT-T80]` 보내는 곳마다 종류 · 수신함 화면의 종류 이름(`tests/messenger-sink.test.ts`).

### DM-19 — 역할·집계는 ERP 「직책」에서 유도한다 (RS-05·06)

| 직책 | 역할 | 집계 |
|---|---|---|
| 실장 · 본부장 · 단장 · 센터장 | `head` | 제외 (사유 = 직책) |
| 원장 · 경영부원장 · 연구부원장 | `member` | 제외 — 원장단은 부서의 장이 아니다 |
| 담당 | `member` | 포함 |

**`lead`는 어떤 규칙으로도 유도되지 않는다.** 담당자는 취합게시판 답변일자를 근거로
운영자가 직접 지정한다 — ERP는 그런 걸 모른다. 이미 담당자인 사람은 직책이 실장이어도
담당자로 남는다(제출 책임이 우선).

337명 중 332명이 이 규칙과 맞았고, 어긋난 5명은 **사람이 정한 예외**다
(휴직 2 · 작성X 1 · 부원장 2). 그래서 유도 규칙은 수동 예외를 덮지 않는다 → RS-09.

| ID | 검증 |
|---|---|
| RS-T01~04 | 직책 → 역할·집계 유도 |
| RS-T05~08 | 보존 규칙 (멱등 · 수동 예외 · 첫 채움 방향 · 양방향 추적) |
| DM-T18 | `head`도 `lead`도 아닌 사람은 병합본을 못 고친다 |

### DM-25 — 화면 둘러보기 기록 `GuideTourSeen` (2026-10-08 · PG-84) — 더하기만

```prisma
/// 화면 둘러보기(첫 로그인 안내)를 권했고 사람이 고른 기록. 장마다 한 줄. 고르지 않았으면 줄이 없다 — 그러면 다음에 또 권한다
model GuideTourSeen {
  userId    String
  chapter   String   // 'member' | 'lead' | 'head' | 'hq' | 'org'
  outcome   String   // 'dismissed' | 'started' | 'done' | 'skipped'
  version   Int      @default(1)   // 둘러보기의 판 — 내용이 크게 바뀌어 다시 권해야 할 때 올린다
  decidedAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@id([userId, chapter])
}
// model User { … guideTours GuideTourSeen[] } — 관계 필드만(열이 생기지 않는다)
```

- **더하기만** — `prisma db push`가 표 하나를 만들 뿐 기존 행·열은 그대로다. 운영을 이 판으로 덮어써도 데이터가 남고, 옛 코드로 되돌려도 이 표를 모른 채 돈다
- `User` 열로 두지 않은 이유: 인원 최신화(DM-20)가 `User` 행을 고친다 — 보존 규칙과 섞이지 않게 따로 둔다
- 「봤다」를 브라우저에 두지 않는 이유: 다른 PC·브라우저에서 또 뜬다. 사용자는 지우지 않으므로(DM-03) Cascade는 형식이다
- 쓰는 곳은 `POST /api/me/tour`(API-60) 하나, 읽는 곳은 페이지의 제안 계산(`src/server/tour.ts`) 하나 — 둘 다 세션의 사람 것만

### DM-20 — 인원 최신화는 **계획하고 승인한다** (RS-01~16)

ERP에 API가 없어 주 1회 운영자가 「부서별 인원 현황」 엑셀을 올린다.
설계의 중심은 «잘 반영하는 것»이 아니라 **«잘못 반영되지 않는 것»**이다 —
필터가 걸린 채 저장된 엑셀 하나로 멀쩡한 사람 수백 명이 잠긴다.

1. **미리보기 → 승인 → 적용.** 파일을 고르자마자 반영되는 버튼은 없다
2. **대량 이탈 차단.** 한 번에 10명 넘게 사라지면 적용을 막는다 (`MAX_DEACTIVATIONS`)
3. **사람이 정한 값은 엑셀이 덮지 않는다** — 담당자·집계여부·제외사유·알림설정·비밀번호
4. **담당자가 사라지면 반드시 알린다** — 조용히 넘어가면 그 부서가 무주공산이 된다
5. **삭제하지 않는다.** 엑셀에 없는 사람은 `isActive=false`이고 제출 이력은 남는다
6. 사번과 이메일이 **서로 다른 사람**을 가리키면 건드리지 않고 알린다 (RS-08)

매칭 키는 **사번 우선, 이메일 보조**다. 둘 다 337명 전원이 1:1이었다(2026-08 실측).
사번은 ERP가 발급하는 불변값이고 이메일은 개명·정정으로 바뀔 수 있어 사번을 앞에 둔다.

**직책 기록(`backfills`)은 화면에 보여주지 않지만 반드시 저장한다.** 저장이 안 되면
다음 주에도 「첫 채움」이라 승진·보직변경을 영영 감지하지 못한다. 첫 주에만 300건이
나오므로 목록에 넣으면 정작 볼 것(퇴사·부서이동)이 묻힌다 → RS-16.

| ID | 검증 |
|---|---|
| RS-T09~12 | 안전장치 (대량 차단 · 담당자 경고 · 사번/이메일 충돌) |
| RS-T13~18 | 변화 감지 (개명 · 부서이동 · 새 부서 · 신규 · 재입사 · 빈 행) |
