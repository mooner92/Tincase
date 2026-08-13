# KEI 주간 업무일지 수합 시스템

> 한국환경연구원 AI홍보전략실 주간 업무일지를 **이메일 왕복 없이** 웹으로 수합하고,
> hwp 마스터 파일로 자동 병합하는 사내 시스템.

**현재 상태: 📐 설계 완료 · 구현 착수 전**
Spec Driven Development — 스펙이 먼저, 코드가 나중.

---

## 왜 만드는가

매주 반복되는 3단계를 없앤다.

| | 지금 | 이후 |
|---|---|---|
| 화요일 | 빈 양식을 8명에게 개별 메일 발송 | 웹에서 상시 다운로드 |
| 회신 | 메일함에서 8개 첨부 찾아 다운로드 | 서버에 이미 모여 있음 |
| 목요일 | **hwp 8개를 열어 표를 손으로 복사·붙여넣기** | 버튼 1회 *(Phase 2)* |

최종 검토와 제출, 웹디스크 보관은 **계속 사람이 한다.** 자동화 대상이 아니다.

---

## 지금까지 확인된 것 (추측 아님)

구현 전에 실제 파일을 파싱해서 **가장 위험한 가정부터 검증**했다.

| 검증 항목 | 결과 |
|---|---|
| 실제 양식 확장자 | **`.hwp` (HWP 5.0 바이너리)** — hwpx 아님 |
| 누름틀(필드) | **없음** → 셀 직접 치환 필요 |
| 병합 셀 | **없음** — 균일 5열 격자 (병합 엔진이 크게 단순해짐) |
| 리눅스에서 읽기 | ✅ 레코드 파싱 완전 성공 |
| 리눅스에서 쓰기 | ✅ **왕복 바이트 완전 동일** + 실제 수정·재생성 성공 |
| 한글 프로그램 필요 | **불필요** |
| "N주차" 규칙 | ✅ 실제 제출물로 조직 관례와 일치 확인 |
| Cloudflare 터널 | 원격 관리형 → **서버 설정 변경·재시작 불필요** |
| 포트 11111 | 사용 중 아님 |

> **핵심 근거**: 파싱 후 무수정 재직렬화가 원본과 SHA-256까지 동일하다.
> 즉 **손대지 않은 것은 절대 변하지 않는다**가 구조적으로 보장된다.
> "표 안 깨짐"이 희망이 아니라 설계 성질이 된다.

전체 실측 데이터: **[docs/research/001-hwp-format-findings.md](docs/research/001-hwp-format-findings.md)**

이 조사로 원 스펙 미결 사항 4개 중 **3개가 해소**됐다.

---

## 문서

### 먼저 읽을 것

| 문서 | 내용 |
|---|---|
| **[docs/spec/00-overview.md](docs/spec/00-overview.md)** | 범위·용어·설계 원칙 |
| **[docs/research/001-hwp-format-findings.md](docs/research/001-hwp-format-findings.md)** | hwp 포맷 실측 조사 ★ |
| **[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md)** | 확인 필요 사항 |
| **[ROADMAP.md](ROADMAP.md)** | 작업 순서 |

### 스펙

| # | 문서 | 내용 |
|---|---|---|
| 00 | [overview](docs/spec/00-overview.md) | 제품 개요 · 범위 · 원칙 |
| 01 | [domain-model](docs/spec/01-domain-model.md) | 엔티티 · Prisma 스키마 · 상태 전이 |
| 02 | [week-slot](docs/spec/02-week-slot.md) | 주차 계산 · 마감 규칙 |
| 03 | [auth](docs/spec/03-auth.md) | Cloudflare Access · JWT 검증 |
| 04 | [storage](docs/spec/04-storage.md) | 파일 경로 · 검증 · 보존 |
| 05 | [api](docs/spec/05-api.md) | 엔드포인트 계약 |
| 06 | [pages](docs/spec/06-pages.md) | 페이지별 스펙 |
| 07 | [components](docs/spec/07-components.md) | 컴포넌트별 스펙 |
| 08 | [hwp-merge-engine](docs/spec/08-hwp-merge-engine.md) | 병합 엔진 *(Phase 2)* |
| 09 | [deployment-ops](docs/spec/09-deployment-ops.md) | 배포 · 백업 · 운영 |

### 설계 결정 (ADR)

| # | 결정 | 이유 |
|---|---|---|
| [0001](docs/adr/0001-hwp5-binary-record-engine.md) | HWP5 레코드 엔진 자체 구현 | `pyhwpx`는 Windows+한글 필수 → 리눅스 불가 |
| [0002](docs/adr/0002-typescript-single-runtime.md) | TypeScript 단일 런타임 | 파이썬 `olefile`은 **읽기 전용**. `cfb`(npm)는 쓰기 가능 |
| [0003](docs/adr/0003-sqlite-prisma.md) | SQLite + Prisma | 연 830행 규모에 DB 서버는 과함 |
| [0004](docs/adr/0004-cloudflare-access-as-identity.md) | Access 신원 + **앱에서 JWT 검증** | 헤더만 믿으면 위조 가능 |

---

## 기술 스택

| 영역 | 선택 |
|---|---|
| 프레임워크 | Next.js (App Router) + TypeScript |
| DB | SQLite + Prisma |
| 스타일 | Tailwind CSS + shadcn/ui (선별) |
| 파일 저장 | 로컬 디스크 `연도/주차라벨/이름_v버전.hwp` |
| hwp 처리 | `cfb` (OLE) + `node:zlib` + 자체 레코드 계층 |
| 인증 | Cloudflare Access (JWT 검증, `jose`) |
| 배포 | Docker · `127.0.0.1:11111` · 기존 Cloudflare Tunnel |
| 테스트 | Vitest + Playwright |

---

## SDD 규약

이 저장소는 **스펙이 정본**이다.

1. **스펙 먼저.** 동작이 바뀌면 스펙부터 고친다
2. **요구사항에 ID.** `WS-03`, `AU-02`, `HM-10` … 코드 주석과 테스트가 이 ID를 참조한다
3. **테스트가 추적성을 만든다**
   ```ts
   it('[WS-T02] 2026-08-10은 "8월 2주차"', ...)
   it('[AU-T09] 위조 userId는 무시되고 JWT 신원이 쓰인다', ...)
   ```
4. **결정은 ADR로.** "왜 이렇게 했나"를 코드에서 추측하게 두지 않는다
5. **측정한 것과 가정한 것을 구분한다.** 실측값은 `docs/research/`에, 근거와 함께

### ID 접두사

```
DM  도메인 모델    WS  주차 계산    AU  인증      ST  저장
API API 계약       PG  페이지       CP  컴포넌트   HM  병합 엔진
OPS 운영           Q   미결 사항
```

---

## 저장소 구조

```
kei-worklog/
├── README.md
├── ROADMAP.md              작업 순서
├── OPEN-QUESTIONS.md       확인 필요 사항
├── docs/
│   ├── spec/               ★ 정본 스펙 (00~09)
│   ├── adr/                설계 결정 기록
│   └── research/           실측 조사
├── fixtures/               ★ 실제 hwp 파일 (테스트 기준)
│   ├── master-template.hwp       빈 마스터 양식
│   ├── sample-filled-w1.hwp      실제 취합본 (표1·2 14행, 표3 삭제됨)
│   ├── sample-filled-w2.hwp      실제 취합본 (표3 삭제 "정답" 파일)
│   └── verify-write-test.hwp     조사 중 생성 — Q-01 확인용
└── tools/                  조사 스크립트 (교차 검증용으로 보존)
    ├── hwp5probe.py              레코드 트리 덤프
    ├── roundtrip.py              왕복 동일성 검증
    ├── tables.py                 표 구조 요약
    ├── writetest.js              Node 쓰기 검증
    └── sentinel-check.js         cfb 센티널 스트림 확인
```

`fixtures/`는 **테스트의 기준점**이다. 특히 `sample-filled-w2.hwp`는
사람이 한글에서 3번 표를 삭제한 결과물이라 **"정답 파일"** 로 쓸 수 있다 (HM-24).

### ⚠ 공개 저장소에서 제외된 것

이 저장소는 공개되어 있어 아래 두 가지가 커밋에서 빠져 있다. **로컬에는 그대로 있다.**

| 제외 | 이유 |
|---|---|
| `fixtures/*.hwp` | **실제 제출된 KEI 내부 업무보고서.** 국회의원실 자료 제출 내역, 인사·조직개편 관련 시스템 작업, 연구사업 심의 내용 등이 그대로 들어 있다 |
| `docs/private/` | Cloudflare Account/Tunnel ID, 서버 내부 IP |

공개 문서의 `<CF_ACCOUNT_ID>` · `<CF_TUNNEL_ID>` · `<서버-내부-IP>` 는 플레이스홀더다.
파일 목록과 확보 방법: [fixtures/README.md](fixtures/README.md)

---

## 지금 필요한 것

### 🔴 Q-02 — 8명의 이름 · 이메일

Phase 1 착수의 **유일한 블로커**다. 팀 배정은 나중에 채워도 된다.

```
이름 / KEI 이메일 / 팀(AI·홍보·시스템·도서관) / 관리자 여부
```

### 🔴 Q-01 — `fixtures/verify-write-test.hwp`를 한글에서 열어 보기

*(Phase 2 착수 전까지만 하면 됨. Phase 1에는 영향 없음)*

조사 중 실제로 셀을 수정해 재생성한 파일이다.
`1-1` 행에 `AI데이터팀 주간회의 및 시스템 점검 (자동병합 테스트)` 가 보이고
표 서식이 멀쩡하면 [ADR-0001](docs/adr/0001-hwp5-binary-record-engine.md)이 확정된다.

나머지: [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md)

---

## 조사 재현

```bash
python3 -m venv .venv && .venv/bin/pip install olefile
.venv/bin/python3 tools/hwp5probe.py fixtures/master-template.hwp   # 레코드 트리
.venv/bin/python3 tools/roundtrip.py  fixtures/master-template.hwp   # 왕복 동일성
.venv/bin/python3 tools/tables.py                                    # 표 구조
node tools/writetest.js                                              # 쓰기 검증
```
