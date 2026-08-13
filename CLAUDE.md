# repman — KEI 주간 업무일지 수합 시스템

한국환경연구원 AI홍보전략실 주간 업무일지를 웹으로 수합하고 hwp로 자동 병합하는 사내 시스템.

**현재 상태: 설계 완료 · 구현 착수 전.** 저장소에 코드는 아직 없다.
먼저 [README.md](README.md) → [docs/spec/00-overview.md](docs/spec/00-overview.md) → [ROADMAP.md](ROADMAP.md) 순으로 읽을 것.

## 이 저장소의 작업 규약

**스펙이 정본이다 (SDD).** 동작이 바뀌면 `docs/spec/`을 먼저 고치고 코드를 맞춘다.

- 요구사항에는 안정적인 ID가 붙는다 — `WS-03`, `AU-02`, `HM-10` 등.
  코드 주석과 테스트가 이 ID를 참조한다.
  ```ts
  it('[WS-T02] 2026-08-10은 "8월 2주차"', ...)
  ```
- ID 접두사: `DM` 도메인 · `WS` 주차계산 · `AU` 인증 · `ST` 저장 · `API` · `PG` 페이지 ·
  `CP` 컴포넌트 · `HM` 병합엔진 · `OPS` 운영 · `Q` 미결사항
- 설계 결정은 `docs/adr/`에 남긴다. "왜 이렇게 했나"를 코드에서 추측하게 두지 않는다.
- **측정한 것과 가정한 것을 구분한다.** 실측값은 근거와 함께 `docs/research/`에 둔다.

**Phase 2·3은 사용자의 명시적 지시 전까지 착수하지 않는다.** ([00-overview §9](docs/spec/00-overview.md))

## 공개 저장소 주의

이 저장소는 public이다. 아래는 커밋에서 제외되어 있고 로컬에만 있다.

| 제외 | 내용 |
|---|---|
| `fixtures/*.hwp` | 실제 제출된 KEI 내부 업무보고서 |
| `docs/private/` | Cloudflare Account/Tunnel ID, 서버 내부 IP |

문서의 `<CF_ACCOUNT_ID>` · `<CF_TUNNEL_ID>` · `<서버-내부-IP>` 는 플레이스홀더다.
**실제 값이나 내부 문서 내용을 커밋에 넣지 말 것.**

## Agent skills

### Issue tracker

GitHub Issues (`mooner92/repman`) — `gh` CLI 사용. See `docs/agents/issue-tracker.md`.

### Triage labels

기본 5종 라벨을 그대로 사용 (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — 루트 `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
