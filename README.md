<img src="public/brand/tincase-lockup.svg" alt="Tincase" height="44">

# Tincase — KEI 주간 업무일지 수합 플랫폼

> 한국환경연구원 각 부서의 주간 업무일지를 **이메일 왕복 없이** 부서별 웹 페이지로 수합하고,
> 부서 담당자가 버튼 하나로 hwp 병합본을 얻는 사내 멀티테넌트 시스템.

**현재 상태: 🚀 v1.39.0 — 사내망 운영 중** (`http://<서버-내부-IP>:11111`, 운영 = `main`)
Spec Driven Development — 스펙이 먼저, 코드가 나중. 테스트 501개 (격리 게이트 포함) 통과 (2026-10-08).

> **운영(`main`)**: 부서 수합 · 자동 병합 · 웹 작성 · 담당자 첨삭 · 부서장 승인 · 전사 현황.
> **진행 중**: 3단계 취합(실·팀 → 본부 → 전사) · 웹 작성만 받는 제출 · 「전사」 한 화면 —
> `feat/org-rollup` 브랜치와 테스트 서버(11112)에만 있다 ([S-12](docs/spec/12-org-rollup.md)).
> 동작의 정본은 [docs/spec/](docs/spec/), 바뀐 것은 [CHANGELOG](CHANGELOG.md).
> [docs/STATUS.md](docs/STATUS.md)는 2026-08 기준이라 지금과 다르다.

---

## 시스템의 위치

전사 주간업무는 2단계로 수합된다. **운영(`main`)은 1단계를 대체한다.**
본부·전사 단계는 사용자 지시로 테스트 서버에서 만드는 중이다 ([S-12](docs/spec/12-org-rollup.md)).

```
[1단계 — 부서 내부]  부서원 작성 → 실무자가 이메일 취합 → 표 수작업 병합   ← 우리가 대체
[2단계 — 전사]      실무자가 병합본을 기획조정실 취합게시판에 제출          ← 그대로 유지
```

같은 고통을 부서별 실무자 12명 내외가 매주 겪는다 — Sean 혼자의 문제가 아니다.
그래서 단일팀 도구가 아니라 **부서 단위 멀티테넌트**로 설계한다
([ADR-0005](docs/adr/0005-multi-division-tenancy.md)). 파일럿은 AI홍보전략실(13명).

| | 지금 | 이후 | 상태 |
|---|---|---|---|
| 배포 | 빈 양식을 부서원에게 개별 메일 | 부서 페이지에서 상시 다운로드 | ✅ |
| 회신·수집 | 메일 회신을 일일이 수집 | 업로드 → 자동 수집 | ✅ |
| 확인 | 파일을 받아 하나씩 열어봄 | 화면 드로어에서 바로 열람 | ✅ |
| 병합 | 표를 손으로 복사·붙여넣기 | **마감 시각에 자동** | ✅ |
| 작성 | 한글에서 작성 후 업로드 | 웹에서 직접 작성 ([S-10](docs/spec/10-web-authoring.md)) | ✅ |
| 제출·보관 | 담당자 수작업 | 운영은 그대로 · 본부·전사 취합은 [S-12](docs/spec/12-org-rollup.md) | 🟡 테스트 서버 |

## 핵심 설계

- **부서 격리가 기본값** — member·lead에게 타 부서는 현황·파일·존재까지 안 보인다(404).
  부서 **안**에서는 현황이 서로 보인다(내용은 lead부터). 격리 테스트가 릴리스 게이트 (AU-14)
- **역할**: member(업로드+부서 현황) / lead(문서 전반 — 드로어·규칙·병합·양식) /
  coordinator(전사 총괄, 전 부서 읽기) / operator(최종 관리자 — 테넌시·인원 전권 + 전체 열람)
- **문서는 부서가, 인원은 운영자가** — 양식·규칙·병합은 담당자, 배치·역할·명단은 운영자(P7)
- **절대 규칙(HM-ABS)** — 표 규격 보존·내용 무손실은 어떤 부서 규칙으로도 못 바꾼다
- **대리 제출 없음** — 놓치면 다음 주차. 예외는 연휴 주차 마감(WS-18)과 담당자의 마감 잠시 열기(TACP-18)뿐
- **hwp only** — `.hwpx`는 받지 않는다. 업로드 자체도 웹 작성으로 옮기는 중 (ADR-0014, `feat/org-rollup`)
- **저장은 `/data`** — 루트 디스크 98% 실측. DB·파일 전부 `/data/worklog`, 백업은 NFS

## 실측으로 확인된 것 (추측 아님)

| 검증 항목 | 결과 |
|---|---|
| 실제 양식 | **`.hwp` (HWP 5.0 바이너리)** · 누름틀 없음 · 병합 셀 없음 |
| 리눅스 읽기/쓰기 | ✅ 왕복 **바이트 동일**(SHA-256) + 수정·재생성 성공, Node 단독 |
| "N주차" 규칙 | ✅ 실제 제출물 역산으로 조직 관례와 일치 확인 |
| 전사 수합 구조 | 2단계 (부서 내부 → 취합게시판, 전사 마감 목 15:00 관찰) |
| 조직·명부 | 337명 / 30개 부서, 실무자 12명 대조 완료 |
| 서버 | `/` 98% ⚠ · `/data` 21TB 여유 · NFS 백업 마운트 존재 · 터널은 원격 관리형 |

상세: [R-001 hwp 포맷](docs/research/001-hwp-format-findings.md) ·
[R-002 조직·수합 흐름](docs/research/002-kei-org-and-collection-flow.md)

## 문서

| | 문서 | 내용 |
|---|---|---|
| ★ | [TACP.md](TACP.md) | **접근제어 헌법** — Principal·권한행렬·불변식·게이트 |
| ★ | [docs/spec/00-overview.md](docs/spec/00-overview.md) | 범위 · 역할 · 용어 · 원칙 |
| | [01 domain-model](docs/spec/01-domain-model.md) | 부서·역할·스키마·불변식 |
| | [02 week-slot](docs/spec/02-week-slot.md) | 주차 계산 · 부서별 마감 |
| | [03 auth](docs/spec/03-auth.md) | Access JWT · 역할 · **격리** |
| | [04 storage](docs/spec/04-storage.md) | `/data` 경로 · 검증 · 백업 |
| | [05 api](docs/spec/05-api.md) | API 계약 (부서 스코프) |
| | [06 pages](docs/spec/06-pages.md) | 부서 페이지 · 드로어 · 설정 |
| | [07 components](docs/spec/07-components.md) | 컴포넌트 스펙 |
| | [08 hwp-merge-engine](docs/spec/08-hwp-merge-engine.md) | 병합 엔진 + 규칙 *(Phase 2)* |
| | [09 deployment-ops](docs/spec/09-deployment-ops.md) | 배포 · 백업 · 디스크 보호 |
| | [12 org-rollup](docs/spec/12-org-rollup.md) | 본부·전사 3단계 취합 *(진행 중)* |
| | [docs/STATUS.md](docs/STATUS.md) | 구현 현황 — **2026-08 기준, 낡음** |
| ★ | [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) | 미결 사항 |
| | [CHANGELOG.md](CHANGELOG.md) | 릴리스 이력 |
| | [docs/DEPLOY.md](docs/DEPLOY.md) | 배포·운영 절차 |
| | [docs/DEMO.md](docs/DEMO.md) | 11/2 운영회의 시연 서버(11113, 가짜 인원) — 준비·리허설·당일 절차 |
| ★ | [ROADMAP.md](ROADMAP.md) | 작업 순서 |

### 설계 결정 (ADR)

| # | 결정 |
|---|---|
| [0001](docs/adr/0001-hwp5-binary-record-engine.md) | HWP5 레코드 엔진 자체 구현 (pyhwpx 폐기) |
| [0002](docs/adr/0002-typescript-single-runtime.md) | TypeScript 단일 런타임 (`cfb` + `node:zlib`) |
| [0003](docs/adr/0003-sqlite-prisma.md) | SQLite + Prisma |
| [0004](docs/adr/0004-cloudflare-access-as-identity.md) | Access 신원 + 앱 JWT 검증 |
| [0005](docs/adr/0005-multi-division-tenancy.md) | 부서 단위 멀티테넌트 |
| [0006](docs/adr/0006-internal-password-auth.md) | **사내망 비밀번호 인증** (Cloudflare는 운영자 전용) |

## 기술 스택

Next.js (App Router) + TypeScript · SQLite + Prisma · Tailwind ·
`cfb` + `node:zlib` + 자체 레코드 계층 · 인증: scrypt 세션 + Cloudflare Access(`jose`) ·
Docker `0.0.0.0:11111`(사내망) · 데이터 `/data/worklog` · 백업 `/mnt/backup`(NFS)

## SDD 규약

1. **스펙 먼저.** 동작이 바뀌면 스펙부터
2. **요구사항 ID** (`AU-13`, `HM-ABS`…) — 코드 주석·테스트가 참조
3. **결정은 ADR로**, **실측은 research로** — 측정과 가정을 구분
4. **격리·마감·무손실은 테스트가 게이트** — AU-T12~17, WS-T, HM-T

## 저장소 구조

```
tincase/
├── docs/{spec,adr,research}/   ★ 정본
├── docs/private/               ⚠ git 제외 — 시드(개인정보)·인프라 실값
├── public/brand/               로고 자산 + 사용 규칙 (brand/README.md)
├── fixtures/                   ⚠ hwp는 git 제외 — fixtures/README.md 참조
└── tools/                      조사·시드 스크립트 (hwp5probe, extract-seed …)
```

> **이름에 대하여** — 제품명은 **Tincase**, 저장소·컨테이너·세션 쿠키 이름은 `repman`이다.
> 후자는 사용자에게 보이지 않고, 바꾸면 URL·배포 절차·활성 세션이 깨지므로 그대로 둔다.

### ⚠ 공개 저장소에서 제외된 것

| 제외 | 이유 |
|---|---|
| `fixtures/*.hwp` | 실제 KEI 내부 업무보고서 |
| `docs/private/` | **개인정보(명단·이메일)** · Cloudflare ID · 내부 IP |

공개 문서의 `<CF_ACCOUNT_ID>` 등은 플레이스홀더. 개인 이름·이메일·연락처는 공개 문서에 싣지 않는다.

## 지금 필요한 것

- 🟡 **3단계 취합 시연** — 11/2(월) 운영회의 목표. 개발은 테스트 서버, 강당 화면은 가짜 인원만 있는 시연 서버(11113) — [DEMO](docs/DEMO.md) · [S-12 §9a](docs/spec/12-org-rollup.md)
- 🟡 **다음 배포 전 운영 작업** — 백업 크론·fstab 줄 반영([DEPLOY](docs/DEPLOY.md) §7), 빌드 전 디스크 정리(§2b)

미결 목록: [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) *(2026-08 이후 갱신 안 됨)*
