# S-09. 배포 · 운영

> 스펙 §2 부가목표: "데모 수준이 아니라 실제 운영 가능한 수준".
> 이 문서가 그 부분을 담당한다. 8명짜리 도구지만 **운영 규율은 제대로 갖춘다.**

---

## 1. 런타임

### OPS-01 — 컨테이너 1개

```
worklog-app   Next.js standalone + SQLite   127.0.0.1:11111
데이터: /data/worklog (호스트 바인드)       ← ST-00. 루트 디스크(98% 사용) 금지
```

DB 컨테이너를 따로 두지 않는다 ([ADR-0003](../adr/0003-sqlite-prisma.md)).
파이썬 사이드카도 없다 ([ADR-0002](../adr/0002-typescript-single-runtime.md)).

### OPS-02 — 포트 11111

실측으로 `10000`·`11111` 모두 비어 있음을 확인했다. 사용자 지정에 따라 **11111** 채택.

이 서버는 이미 여러 포트를 쓰고 있으므로(`80`, `3100`, `3101`, `5000`, `8003`, `8005`, `9400`, `10345`, …)
충돌 확인은 배포 스크립트에 넣는다.

```bash
ss -tln | grep -q ':11111 ' && { echo "포트 11111 사용 중"; exit 1; }
```

### OPS-03 — 반드시 `127.0.0.1`에 바인딩

```yaml
ports:
  - "127.0.0.1:11111:3000"     # ← 호스트 IP 명시. "11111:3000" 금지
```

`"11111:3000"`으로 쓰면 `0.0.0.0`에 열려 **사내망 전체에 무인증 노출**된다.
AU-01의 실제 집행 지점이다. 코드 리뷰에서 반드시 확인할 한 줄.

---

## 2. Docker

### OPS-04 — 멀티스테이지 빌드

```dockerfile
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json prisma ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS run
ENV NODE_ENV=production TZ=Asia/Seoul
WORKDIR /app
RUN groupadd -r app && useradd -r -g app -u 10001 app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
USER app
EXPOSE 3000
CMD ["node", "server.js"]
```

| ID | 요구사항 |
|---|---|
| OPS-04a | `output: 'standalone'` (next.config) |
| OPS-04b | 비루트 실행 (uid 10001) |
| OPS-04c | `TZ=Asia/Seoul` — 다만 코드는 이것 없이도 옳아야 함 (WS-07) |
| OPS-04d | 이미지에 `.env`·픽스처 원본을 넣지 않는다 |

### compose

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    ports: ["127.0.0.1:11111:3000"]
    environment:
      DATABASE_URL: file:/data/db/worklog.db
      STORAGE_ROOT: /data
      CF_ACCESS_TEAM: aidt-kei
      CF_ACCESS_AUD: ${CF_ACCESS_AUD}
      TZ: Asia/Seoul
    volumes:
      - /data/worklog:/data          # ST-00: 22TB 로컬 디스크. /srv·홈 금지
    healthcheck:
      test: ["CMD","node","-e","fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "5" }
```

### OPS-05 — 기동 순서

```
1. prisma migrate deploy      ← 마이그레이션 (백업 후)
2. prisma db seed             ← 멱등. 8명 upsert
3. 저장소 디렉터리 확인/생성
4. tmp/ 청소                  ← 이전 실행의 중단 파일
5. 마스터 양식 존재 확인       ← 없으면 기동 실패 (fail fast)
6. 서버 시작
```

5번에서 **일부러 죽인다.** 양식 없이 뜨면 화요일 아침에야 발견된다.

---

## 3. 환경변수

| 변수 | 예 | 필수 | 설명 |
|---|---|---|---|
| `DATABASE_URL` | `file:/data/db/worklog.db` | ✔ | |
| `STORAGE_ROOT` | `/data` | ✔ | |
| `CF_ACCESS_TEAM` | `aidt-kei` | ✔ | |
| `CF_ACCESS_AUD` | `a1b2…` | ✔ | Access 앱 AUD ([Q-04](../../OPEN-QUESTIONS.md)) |
| `TZ` | `Asia/Seoul` | ✔ | |
| `MAX_UPLOAD_BYTES` | `20971520` | | 기본 20MB |
| `DEV_IDENTITY` | `me@kei.re.kr` | | **개발 전용** (AU-03) |

### OPS-06 — 기동 시 환경변수 검증

zod로 스키마 검증. 누락·형식 오류면 **즉시 종료**하고 무엇이 잘못됐는지 출력한다.
production에서 `DEV_IDENTITY`가 설정돼 있으면 **거부**한다.

---

## 4. Cloudflare

[S-03 AU-10~12](03-auth.md) 참조. 요약:

- 터널은 **원격 관리형**(토큰 방식) → 서버에 설정 파일 없음, **재시작 불필요**
- 대시보드에서 ① Public Hostname `worklog.excusa.uk → localhost:11111`
  ② Access 앱 + 8명 이메일 정책 ③ AUD 복사
- ②를 빼먹으면 공개된다. AU-02가 fail-closed로 막지만 **설정도 제대로 한다**

---

## 5. 백업 · 복구

### OPS-07 — SQLite는 `.backup`으로

```bash
sqlite3 /data/worklog/db/worklog.db ".backup '/mnt/backup/worklog/db-$(date +%F).db'"
```

**`cp` 금지.** WAL 모드에서 복사본이 깨질 수 있다.

### OPS-08 — 백업 주기와 목적지

| 대상 | 주기 | 보존 | 목적지 |
|---|---|---|---|
| DB | 매일 03:00 | 30일 | `/mnt/backup/worklog/` (NFS, 실측 227T 여유) |
| `divisions/**` | 매주 일 03:30 | 12주 | 〃 |

목적지는 **다른 노드의 NFS**(<NFS-내부-IP>) — 이 서버 디스크 장애에도 생존.
NFS에는 백업 파일만 둔다. 라이브 SQLite 상주 금지 (ADR-0003).

### OPS-09 — 복구 리허설

**분기 1회, 실제로 복구해 본다.** 해 보지 않은 백업은 백업이 아니다.

```
1. 백업본으로 별도 경로에 컨테이너 기동
2. 관리자 화면에서 과거 주차 조회
3. 파일 다운로드 → sha256 대조
```

### OPS-10 — 정합성 점검

주 1회, DB와 파일시스템 대조 (ST-10의 감지 장치).

```
· Submission 행은 있는데 파일 없음        → 경고 (심각)
· 파일은 있는데 Submission 행 없음        → 정보 (고아)
· sha256 불일치                          → 경고 (심각)
```

---

## 6. 관측

### OPS-11 — 구조적 로그

JSON 한 줄. `pino` 권장.

```jsonc
{ "level":"info", "t":"2026-08-13T15:47:02+09:00", "reqId":"a3f9c1",
  "actor":"choi@kei.re.kr", "action":"upload",
  "slot":"2026-W33", "version":2, "bytes":76123, "ms":412 }
```

| ID | 요구사항 |
|---|---|
| OPS-11a | 요청마다 `reqId`. 오류 화면의 코드와 동일 (PG-29) |
| OPS-11b | **파일 내용·JWT 원문 로깅 금지** |
| OPS-11c | 이메일은 로깅함 (감사 목적, 사내 도구) |

### OPS-12 — 반드시 로그를 남길 이벤트

```
업로드 성공/실패 · 마감 거부 · 다운로드 · zip · 병합 · 인증 실패 · 미등록 접근 · 기동/종료
```

### OPS-13 — 헬스체크

`GET /api/health` (API-31~33). Docker healthcheck + 외부 모니터링 양쪽에서 사용.

### OPS-14 — 화요일 아침 점검 (권장)

마감 3시간 전(화 11:00) 제출 현황을 로그에 남긴다.
Phase 3 리마인드의 밑거름이 되고, 그 전에도 Sean이 로그만 봐도 상황 파악이 된다.

---

## 7. 릴리스

### OPS-15 — 배포 절차

```bash
cd /srv/worklog/app
git pull
sqlite3 data/worklog.db ".backup 'backup/pre-deploy-$(date +%F-%H%M).db'"   # 필수
docker compose build
docker compose up -d
sleep 10
curl -fsS http://127.0.0.1:11111/api/health | jq .
```

### OPS-16 — 배포 금지 시간대 ★

**월요일 00:00 ~ 화요일 14:00 사이에는 배포하지 않는다.**

제출 창이 열려 있는 유일한 시간이다. 이때 장애가 나면 그 주차가 통째로 날아간다.

권장: **화요일 14:00 이후 ~ 일요일**.

### OPS-17 — 롤백

```bash
git checkout <이전태그>
docker compose up -d --build
# 스키마가 바뀌었다면 백업 DB도 함께 복원
```

마이그레이션이 파괴적이지 않게 관리하면(DM 마이그레이션 정책) 롤백이 단순해진다.

---

## 8. 용량

| 항목 | 연간 (파일럿 1개 부서) | 연간 (전 부서 337명 가정) |
|---|---|---|
| DB | < 5 MB | < 50 MB |
| 제출 파일 | 13명 × 52주 × 100 KB × 2 ≈ 135 MB | ≈ 3.5 GB |
| 병합본 | ≈ 8 MB | ≈ 250 MB |

`/data` 여유 21TB — 전 부서 가정으로도 수천 년치. 용량 관리는 사실상 불필요하다.
**단, 루트 디스크(98%)는 별개 문제다 — OPS-19.**

---

## 9. 장애 대응

| 증상 | 확인 | 조치 |
|---|---|---|
| 접속 안 됨 | `docker compose ps`, health | 재기동 |
| Access 로그인 반복 | Access 세션 설정 | 세션 24h로 |
| 업로드 실패 | 로그 `action:upload` | 디스크·권한 확인 |
| 마감 시각 이상 | `/api/health`의 `now`·`currentSlot` | TZ 확인 |
| 터널 끊김 | `systemctl status cloudflared` | 재시작 (다른 서비스 영향 확인 필요) |

### OPS-18 — 최후 수단

시스템이 완전히 죽고 부서 마감이 임박하면, **그 부서는 이메일 방식으로 되돌린다.**
부서 양식(`divisions/{slug}/template/active.hwp`)을 메일로 뿌리면 된다.

> 이 시스템은 기존 프로세스를 **대체**하지만 **파괴하지는 않는다.**
> 언제든 수동으로 되돌아갈 수 있어야 한다. 사내 도구에 HA를 붙이는 것보다
> 이 한 줄짜리 대비책이 현실적이다.

### OPS-19 — 루트 디스크 보호 ★ (실측: `/` 98% 사용, 11G 남음)

이 서버의 루트 디스크는 이미 위험 수위다. 이 프로젝트가 지킬 것:

| 수칙 | 이유 |
|---|---|
| 데이터·DB·백업 스테이징 전부 `/data` | ST-00 |
| Docker 빌드는 `docker builder prune` 정기 실행과 함께 | 빌드 캐시가 `/var/lib/docker`(= `/`)에 쌓임 |
| 이미지 태그 2세대만 유지 | 〃 |
| 헬스체크에 루트 디스크 여유 감시 추가 — 5G 미만이면 경고 | 다른 서비스가 채워도 우리가 먼저 안다 |

근본 대책(Docker data-root를 `/data`로 이전)은 **다른 서비스에 영향을 주므로 이 프로젝트
범위 밖** — 운영자 판단 사항으로 기록만 한다 ([Q-17](../../OPEN-QUESTIONS.md)).
