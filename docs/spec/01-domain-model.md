# S-01. 도메인 모델

구현: `prisma/schema.prisma` · 접근 계층: `src/server/repo/*.ts`

---

## 1. 엔티티 관계

```
User ──1───∞── Submission ──∞───1── WeekSlot
                    │
                    └──∞──1── MergeRun (Phase 2, 선택)

AuditLog  (독립, 참조만)
```

## 2. Prisma 스키마

```prisma
datasource db { provider = "sqlite"; url = env("DATABASE_URL") }
generator client { provider = "prisma-client-js" }

model User {
  id          String   @id @default(cuid())
  email       String   @unique          // Cloudflare Access 신원과 대조하는 키
  name        String                    // "최명헌"
  team        String?                   // "AI" | "홍보" | "시스템" | "도서관"  ← 병합 정렬용
  sortOrder   Int      @default(100)    // 병합 시 항목 순서
  isAdmin     Boolean  @default(false)
  isActive    Boolean  @default(true)   // 퇴사/전보 시 false. 삭제하지 않음
  createdAt   DateTime @default(now())
  submissions Submission[]

  @@index([isActive, sortOrder])
}

model WeekSlot {
  id           String   @id @default(cuid())
  isoKey       String   @unique         // "2026-W33"  ← 유일 식별자 (WS-09)
  label        String                   // "8월 2주차" ← 표시 전용
  year         Int
  month        Int                      // 월요일 기준
  weekOfMonth  Int                      // 1..5
  opensAt      DateTime                 // 월 00:00 KST (UTC 저장)
  deadlineAt   DateTime                 // 화 14:00 KST (UTC 저장)
  createdAt    DateTime @default(now())
  submissions  Submission[]
  mergeRuns    MergeRun[]

  @@index([opensAt])
}

model Submission {
  id           String   @id @default(cuid())
  userId       String
  weekSlotId   String
  version      Int                      // 1부터. (userId, weekSlotId) 내에서 증가
  isLatest     Boolean  @default(true)

  filePath     String                   // 저장 루트 기준 상대경로 (S-04)
  originalName String                   // 업로더가 올린 원래 파일명
  byteSize     Int
  sha256       String                   // 무결성 + 중복 감지
  contentKind  String                   // "hwp" | "hwpx"

  uploadedAt   DateTime @default(now())
  uploadedFrom String?                  // 감사용 IP

  user     User     @relation(fields: [userId],     references: [id])
  weekSlot WeekSlot @relation(fields: [weekSlotId], references: [id])

  @@unique([userId, weekSlotId, version])
  @@index([weekSlotId, isLatest])
  @@index([weekSlotId, userId])
}

model MergeRun {                        // Phase 2
  id          String   @id @default(cuid())
  weekSlotId  String
  status      String                    // "pending"|"running"|"succeeded"|"failed"
  outputPath  String?
  sourceIds   String                    // JSON 배열: 사용된 Submission id 목록
  rowCounts   String?                   // JSON: {"t1":24,"t2":19,"t3":0}
  errorText   String?
  startedAt   DateTime @default(now())
  finishedAt  DateTime?
  weekSlot    WeekSlot @relation(fields: [weekSlotId], references: [id])

  @@index([weekSlotId, startedAt])
}

model AuditLog {
  id        String   @id @default(cuid())
  at        DateTime @default(now())
  actor     String                      // 이메일
  action    String                      // "upload"|"download"|"download_zip"|"merge"|"reject"
  target    String?
  detail    String?                     // JSON
  @@index([at])
}
```

---

## 3. 요구사항

### DM-01 — `User`는 이메일이 정본

Cloudflare Access가 넘겨주는 이메일이 신원의 유일한 근거다.
`name`은 표시·파일명 생성용이며 인증에 쓰지 않는다.

> **스펙 §4.2 대비 개선**: 원 스펙은 "이름을 선택하고 업로드"였다.
> Access가 이미 신원을 확정하므로 **이름 선택 드롭다운을 없앤다.**
> 클릭 하나가 줄고, 타인 사칭이 구조적으로 불가능해진다. ([S-03 AU-05](03-auth.md))

### DM-02 — `User`는 시드로 관리

8명은 회원가입하지 않는다. `prisma/seed.ts`에 명시하고 배포 시 반영한다.
인원 변동은 시드 수정 + 재실행. 관리 UI는 만들지 않는다 (8명 규모에 과함).

### DM-03 — 비활성 사용자는 삭제하지 않는다

`isActive = false`로만 바꾼다. 과거 제출 이력의 참조 무결성을 지킨다.
현황 집계는 `isActive = true`인 사람만 대상으로 한다.

### DM-04 — `version`은 1부터 단조 증가

`(userId, weekSlotId)` 조합 내에서만 의미를 갖는다.

### DM-05 — `isLatest`는 조합당 정확히 하나

```
∀ (userId, weekSlotId) with ≥1 submission :
    count(isLatest = true) == 1
```

이는 **불변식**이다. 갱신은 반드시 단일 트랜잭션으로:

```ts
await prisma.$transaction(async (tx) => {
  const last = await tx.submission.findFirst({
    where: { userId, weekSlotId },
    orderBy: { version: 'desc' },
  });
  await tx.submission.updateMany({
    where: { userId, weekSlotId, isLatest: true },
    data:  { isLatest: false },
  });
  return tx.submission.create({
    data: { userId, weekSlotId, version: (last?.version ?? 0) + 1, isLatest: true, ... },
  });
});
```

> `@@unique([userId, weekSlotId, version])`가 경합 시 두 번째 요청을 실패시킨다.
> 실패하면 한 번 재시도한다. SQLite는 쓰기 직렬화되므로 실무상 충분하다.

### DM-06 — 제출은 삭제하지 않는다 (P2)

`Submission` 행도, 파일도 지우지 않는다. 잘못 올렸으면 다시 올리면 된다.
"삭제" API는 만들지 않는다.

### DM-07 — 동일 파일 재업로드

같은 `sha256`을 다시 올려도 **새 버전을 만든다**. 거절하지 않는다.
사용자가 재업로드했다는 것 자체가 의도이므로 존중한다. 다만 UI에서
`이전 버전과 내용이 동일합니다` 안내는 띄운다.

### DM-08 — 제출 현황 파생

`Submission`을 지우지 않으므로 현황은 항상 조회로 계산한다. 별도 상태 컬럼 없음.

```ts
type MemberStatus = {
  user: User;
  latest: Submission | null;   // null이면 미제출
  versionCount: number;
};
```

### DM-09 — `team` / `sortOrder`는 Phase 2 병합용

스펙 §3의 항목 순서 `AI → 홍보(정간물 포함) → 시스템 → 도서관`을 코드로 표현하는 자리다.

```ts
const TEAM_ORDER = ['AI', '홍보', '시스템', '도서관'] as const;
```

Phase 1에서는 **표시 정렬에만** 쓴다. 값이 비어 있어도 Phase 1은 동작해야 한다.
→ 8명의 팀 배정은 [Q-02](../../OPEN-QUESTIONS.md) 확인 후 시드에 반영.

---

## 4. 상태 전이

### 4.1 WeekSlot

```
     월 00:00                     화 14:00                다음 월 00:00
        │                            │                          │
   ─────┼──────── OPEN ──────────────┼──────── LOCKED ──────────┼──── (다음 슬롯 OPEN)
        │                            │                          │
   업로드 가능                   업로드 거부                 새 슬롯 생성
   다운로드 가능                 다운로드 가능              이전 슬롯 영구 LOCKED
   병합 가능(Phase2)             병합 가능(Phase2)
```

`LOCKED`는 **되돌아가지 않는다**. 마감 후 열리는 일은 없다 (스펙 §4.3).

### 4.2 Submission

```
       업로드            재업로드
(없음) ───────→ v1 ─────────────→ v2 ─────→ …
              isLatest=T       isLatest=T
                  │  isLatest=F ←┘
                  ↓
             (영구 보관)
```

---

## 5. 인덱스 근거

| 인덱스 | 쿼리 |
|---|---|
| `WeekSlot.isoKey` (unique) | 슬롯 upsert (WS-11) — 가장 빈번 |
| `Submission(weekSlotId, isLatest)` | 관리자 현황 / zip 대상 조회 |
| `Submission(weekSlotId, userId)` | 본인 제출 이력 |
| `Submission(userId, weekSlotId, version)` (unique) | 버전 경합 방어 (DM-05) |
| `User(isActive, sortOrder)` | 현황 표 정렬 |

## 6. 데이터 규모 전망

8명 × 52주 × (재업로드 감안) 2배 ≈ **연 830행**, 파일 약 100 MB/년.
SQLite로 10년 이상 여유. ([ADR-0003](../adr/0003-sqlite-prisma.md))

## 7. 마이그레이션 정책

- 개발: `prisma migrate dev`
- 운영: `prisma migrate deploy` — 컨테이너 기동 시 자동 실행
- **마이그레이션 전 자동 백업** ([S-09 OPS-06](09-deployment-ops.md))
- 파괴적 변경(컬럼 삭제/타입 변경)은 2단계로: 추가 → 이관 → 다음 릴리스에서 제거
