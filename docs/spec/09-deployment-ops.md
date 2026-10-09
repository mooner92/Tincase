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

> ⚑ **v1.0.0 때 규칙이다 — 지금은 아니다.** 앱이 직접 인증하게 되면서(AU-20~26) 바인딩을
> `0.0.0.0:11111`(사내망)로 개정했다 — [ADR-0006](../adr/0006-internal-password-auth.md) · [AU-01](03-auth.md).
> 사내망 평문 HTTP는 [ADR-0010](../adr/0010-plain-http-on-lan.md)으로 감수한다. 테스트 서버도 `0.0.0.0:11112`다.
> 아래와 OPS-01 그림의 `127.0.0.1`은 당시 기록이다.

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
| `SUBMIT_HWP_UPLOAD` | `off` | | 기본 `on`. `off`면 「전사」 게시판 hwp [올리기]를 닫는다(RU-60a) — 테스트 서버만 `off`. 부서원 제출과는 상관없다: hwp 업로드 제출은 2026-10-08에 코드째 없어졌다(WA-39 · [ADR-0014](../adr/0014-web-only-submission.md)). [올리기]가 걷히면 이 변수도 지운다 |
| `DEV_IDENTITY` | `me@kei.re.kr` | | **개발 전용** (AU-03) |
| `TINCASE_ENV` | `test` · `demo` | | 시험(11112 평소)·시연(11112 시연 모드) 서버 표식 — 띠(RU-43·47)·기동 검사(RU-45 · OPS-46)·가짜 알림 수신함(NT-56)이 같은 값을 본다. **운영에는 없다** — 운영 compose가 빈 값으로 못 박는다(OPS-46a) |
| `MESSENGER_SINK` | `on` | | 기본 `off`. 가짜 알림 수신함(`/api/dev/messenger-sink` · `/ops/notify-sink`)의 명시 스위치 — `TINCASE_ENV`가 test·demo일 때만 뜻이 있다(NT-56). 운영 compose는 `off`로 못 박는다(OPS-46a) |

### OPS-06 — 기동 시 환경변수 검증

zod로 스키마 검증. 누락·형식 오류면 **즉시 종료**하고 무엇이 잘못됐는지 출력한다.
production에서 `DEV_IDENTITY`가 설정돼 있으면 **거부**한다.
(2026-10-08) 검증은 **기동할 때** 한다 — `instrumentation.ts`가 맨 먼저 env를 읽는다. 그 전에는 처음 읽힐 때(첫 요청)였고,
스케줄러가 꺼진 서버(테스트 11112)는 첫 요청 전까지 잘못된 설정으로 「떠 있었다」.

### OPS-46 — 알림이 엉뚱한 곳으로 가는 설정이면 뜨지 않는다 (2026-10-08)

가짜 알림 수신함(NT-56)이 생기면서 메신저 주소가 둘이 됐다. 둘이 바뀌어 꽂히면 **조용히** 틀린다 — 그래서 기동을 거부한다.
판정은 `src/lib/messenger-sink.ts` `sinkBootProblem` 하나이고, env.ts(앱)와 `scripts/entrypoint.sh`(컨테이너 입구, node보다 먼저 이유를 남긴다)가 같은 규칙을 본다.

| 설정 | 왜 막나 |
|---|---|
| 시험·시연 아님(`TINCASE_ENV` 없음) + `MESSENGER_URL`이 수신함 | 운영 알림이 사람 대신 수신함으로 — 아무에게도 안 간다 |
| `TINCASE_ENV` test·demo + `MESSENGER_URL`이 수신함이 **아닌** 곳 | 운영 사본·가짜 데이터에서 실제 사람 화면에 팝업이 뜬다 (RU-41이 막던 것) |
| `MESSENGER_URL`이 수신함 + `MESSENGER_SINK=on`이 아님 | 알림마다 404로 실패한다 — 시험한 사람은 「알림이 안 간다」를 앱 잘못으로 읽는다 |

비어 있는 `MESSENGER_URL`은 어디서나 괜찮다(알림 끔). 수신함 주소는 **경로**(`/api/dev/messenger-sink`)로 알아본다 — 호스트·포트는 컨테이너 안팎에서 다르다.
시험 `[NT-T76]`(`tests/messenger-sink.test.ts`).

**OPS-46a — 운영은 시험 서버 설정을 물려받지 않는다 (2026-10-10).** 두 구멍을 막는다.
① **표기.** 같은 경로의 다른 표기(겹 빗금 `//api//dev/…` · 대소문자 · 퍼센트 부호 · 물음표 뒤)는 예전 판정에서 「수신함 아님」이라 운영이 수신함으로
보내는 설정이 그대로 떴다. 이제 `isSinkUrl`은 경로를 풀어(퍼센트) 소문자로 · 겹 빗금을 하나로 · 끝 빗금을 떼고 견준다. `entrypoint.sh`도 물음표·# 뒤를 떼고
소문자 · 겹 빗금 하나로 같은 판정을 한다(퍼센트 부호는 앱이 멈춘다 — 이유가 로그 첫 줄이 아닐 뿐).
② **env 파일.** 운영 compose의 `environment`에 `TINCASE_ENV: ""` · `MESSENGER_SINK: "off"`를 못 박는다 — `environment`는 `env_file`(`.env.production`)보다 이겨서,
시험 서버 설정을 옮겨 붙이는 실수가 운영에 수신함을 열거나(TACP-26) 띠를 띄우지 못한다. 옛 앱(v1.39.0)은 두 값을 읽지 않는다 — 롤백에도 그대로다.
시험 `[NT-T85]`(compose · 표기 · 입구 — `tests/messenger-sink.test.ts`).

### OPS-48 — DB 스키마가 이 판보다 오래됐으면 뜨지 않는다 (2026-10-09)

배포 절차(DEPLOY §2b-3)의 `prisma db push`를 빠뜨리면 **조용히** 틀린다 — 2026-10-09 운영 main(v1.39.0) 스키마 DB 사본에 v2를 띄워 실측:
기동은 되고 health는 `ok:true`(DB 연결·저장소·양식만 본다)라 `deploy.sh`가 성공으로 끝나는데, 부서를 읽는 화면은 모두 500(`Division.rollupOrder` 없음),
병합 줄은 로그에 오류만 남긴다(`MergeJob` 없음) — 목요일 자동 병합이 하나도 돌지 않는 것을 15:00에야 안다.

그래서 기동할 때(`instrumentation.ts`, 환경 검사 OPS-06·46 바로 뒤 · 회수와 스케줄러 앞) DB의 표·열을 **이 판의 Prisma 클라이언트**(`Prisma.dmmf` — schema.prisma에서
생성된 것, 손으로 적은 목록이 아니다)와 견준다. 모자라면 `[boot] FATAL:` 아래에 **없는 표 · 없는 열 이름과 할 일**(스냅샷 뒤 `db push` → 다시 띄우기)을 찍고 종료 코드 1로 멈춘다.
컨테이너는 health에 닿지 못하고 deploy.sh가 health 단계에서 멈춘다. 판정은 `src/server/schema-check.ts` 하나.

- **모자란 것만** 본다 — DB에만 있는 표·열(지난 판 · 롤백한 옛 앱이 남긴 것)은 문제가 아니다
- 관계 필드(`Division.reportSubmissions` 등)는 열이 아니므로 보지 않는다
- 검사 질의 자체가 실패하면(잠김 등) 경고 한 줄 뒤 그대로 뜬다 — 검사를 못 한 것을 「모자람」으로 치면 멀쩡한 서버가 뜨지 않는다
- 엔트리포인트(OPS-05)의 「빈 DB」 검사는 그대로 둔다 — 빈 DB는 시드 안내가 다르다

`deploy.sh`는 health에 닿지 못하면(본문이 JSON이 아니면) 「앱이 기동하다 멈췄다 — 로그의 FATAL 줄」을 덧붙인다 — 운영자가 곧장 롤백하지 않고 이유부터 보게(스키마면 push 뒤 `--no-build`).

시험 `[OPS-T35]`(`tests/schema-check.test.ts` — 판정 · v2로 더해지는 표 7·열 7이 기준에 있음 · 표 하나·열 하나를 지운 DB에서 이름으로 말하고 멈춤 · push하면 뜸 · 기동 순서) ·
`[OPS-T35b]`(`tests/deploy-script.test.ts` — health에 닿지 못할 때만 FATAL 안내).

### OPS-49 — 운영 파일을 이 판의 읽기로 한 번 열어 본다 (2026-10-09)

v2 전환 이행 리허설은 지어낸 사람의 DB로 돌았다(운영 사본은 개인정보라 에이전트가 복사하지 않는다). 그래서 **8~9월에 한글에서 올린 실제 파일과
옛 엔진이 쓴 병합본**을 v2의 읽기로 연 적이 없다 — v2는 그것들을 부서원 홈의 「내 일지」·「병합본」(PG-70)으로 열고, 켠 부서의 양식은 웹 작성이 그대로 채운다(WA-04).
`scripts/check-files.ts`가 DB가 가리키는 파일을 모두 열어 본다 — 운영자가 운영 데이터에 그대로 돌린다(LAUNCH-v2 9-3b — 기획조정실을 켠 뒤).

- **읽기 전용** — DB는 `sqlite3 -readonly`(Prisma 클라이언트를 쓰지 않으니 호스트 클라이언트가 옛 스키마여도 같다), 파일은 앱과 같은 `readStoredFile`(ST-03)
- **숫자만** — 무리별 행 · 읽힘 · 파일 없음 · 실패, 실패는 종류(클래스 이름·코드)로만. 경로·사람 이름·오류 문구를 찍지 않는다(제출 파일 이름에 사람 이름이 들어간다).
  예외는 양식 — 없거나 실패한 양식의 **부서 이름**만 「└ 부서:」로 붙인다(조직도라 사람이 아니고, 어느 부서 양식을 다시 받을지 알아야 고친다)
- `--all-templates` — 꺼진 부서 양식도 웹 작성 길로 채워 본다(전환 전에 켤 부서의 양식을 미리 볼 때)
- 무리: 최신 제출 · 옛 판 · 성공한 병합본은 `readWorklog`로, **켠 부서 양식은 `buildWorklogHwp`(웹 작성과 같은 길)로 한 줄씩 채워 본다**, 꺼진 부서 양식은 있는지만
- 종료 코드 0 모두 읽힘 · 1 문제 · 2 실행 오류. 꺼진 부서 양식 무리는 숫자만 보이고 종료 코드에 넣지 않는다(파일 없음은 OPS-41 정리 뒤에 남은 기록)

시험 `[OPS-T36]`·`[OPS-T36b]`(`tests/check-files.test.ts` — 세는 법 · 오류 문구를 버린다 · 실제로 돌려 경로가 출력에 없고 DB 바이트가 그대로다).

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
| DB | 매일 03:00 | 30일 | `/mnt/backup/worklog/db/` (NFS, 실측 227T 여유) |
| `divisions/**` + `org/**`(있을 때) | **매일 03:30** | 12주 | `/mnt/backup/worklog/files/divisions-날짜.tar.gz` |

목적지는 **다른 노드의 NFS**(<NFS-내부-IP>) — 이 서버 디스크 장애에도 생존.
NFS에는 백업 파일만 둔다. 라이브 SQLite 상주 금지 (ADR-0003). 스크립트는 `scripts/backup.sh {db|files|verify}`.

**파일도 매일이다 (2026-10-08).** 예전에는 일요일에만 묶었다. 그러면 어제 DB로 복원했을 때 지난 일요일 뒤에 낸
제출물(최대 6일 치)은 **행만 있고 파일이 없다.** 묶음이 1.5MB 남짓이라 매일 돌려도 부담이 없다.

**`org/`도 묶는다.** 3단계 취합(총괄이 올린 섹션 원본·전사 취합본)은 `STORAGE_ROOT/org/` 아래에 저장된다.
DB 백업에는 그 행(`OrgSectionUpload`·`RollupRun`)이 들어가므로 파일이 빠지면 복원 뒤 「행은 있는데 파일이 없다」가 된다.
`org/`가 아직 없는 서버에서는 빼고 묶는다 — 없는 디렉터리 때문에 `tar`가 실패하지 않게.

**NFS가 마운트돼 있지 않으면 멈춘다.** `/mnt/backup`이 마운트 지점이 아니면 `backup.sh`는 아무것도 쓰지 않고
`[backup] FATAL …`을 찍고 1로 끝난다. 재부팅 뒤 마운트가 빠지면 `/mnt/backup`은 **루트 디스크의 빈 디렉터리**가 되고,
거기에 쓰면 「서버 디스크 장애에도 살아남을」 백업이 이미 찬 루트 디스크에 쌓이기 때문이다.
**2026-10-10 운영자가 fstab에 넣었다** — `defaults,_netdev,nofail,hard,timeo=600` · 원본 `/etc/fstab.bak-20261010` · `findmnt --verify` 오류 0 ·
`daemon-reload` 뒤 `mnt-backup.mount`가 생겨 붙어 있다. 그 전에는 손으로 붙인 마운트라 재부팅하면 빠졌다. 새 서버라면 아래를 한 번 (sudo):

```bash
findmnt -no SOURCE /mnt/backup            # 지금 붙어 있는 NFS 주소:경로 — 아래 줄에 그대로 쓴다
sudo cp /etc/fstab /etc/fstab.bak-$(date +%F)
echo '<NFS-내부-IP>:<경로>  /mnt/backup  nfs4  defaults,_netdev,nofail,hard,timeo=600  0  0' | sudo tee -a /etc/fstab
sudo systemctl daemon-reload && sudo mount -a && findmnt /mnt/backup   # 오류 없이 같은 줄이 나오면 끝
```

`nofail`은 NFS가 없어도 부팅이 멈추지 않게, `_netdev`는 네트워크가 올라온 뒤 붙게 한다.

**cron (mhchoi, 운영자가 바꾼다)** — files 줄의 요일 `0`을 `*`로:

```
0 3 * * *   /home/mhchoi/repman/scripts/backup.sh db     >> /home/mhchoi/kei-backups/worklog-backup.log 2>&1
30 3 * * *  /home/mhchoi/repman/scripts/backup.sh files  >> /home/mhchoi/kei-backups/worklog-backup.log 2>&1
```

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
업로드 성공/실패 · 마감 거부 · 다운로드 · ~~zip~~(2026-10-08 폐지) · 병합 · 인증 실패 · 미등록 접근 · 기동/종료
```

### OPS-13 — 헬스체크

`GET /api/health` (API-31~33). Docker healthcheck + 외부 모니터링 양쪽에서 사용.

- 양식은 **파일까지** 본다 — 활성 부서 중 양식 파일이 없는 곳이 있으면 `checks.template` fail (OPS-41과 같은 판정).
  예전에는 `Template` 행 수만 세어서, 파일이 하나뿐인 2026-09-10 상태에서도 `ok`라고 답했을 것이다.
- 루트 디스크는 `checks.rootDisk`와 맨 위 `warnings[]` — 판정은 OPS-19.

### OPS-14 — 화요일 아침 점검 (권장)

마감 3시간 전(화 11:00) 제출 현황을 로그에 남긴다.
Phase 3 리마인드의 밑거름이 되고, 그 전에도 Sean이 로그만 봐도 상황 파악이 된다.

---

## 7. 릴리스

### OPS-15 — 재배포 절차 ★ (2026-10-08 개정)

명령은 [DEPLOY.md](../DEPLOY.md) §2b에 있다. 순서와 이유만 여기 둔다.
빌드·기동은 **`scripts/deploy.sh`** 하나로 한다(OPS-43) — 0·1·3·6단계는 스크립트가 빌드 직전·직후에 다시 한다.

| 단계 | 하는 일 | 왜 |
|---|---|---|
| 0 | 이번 주 마감 확인 → 금지 시간대면 멈춘다. `deploy.sh prod`도 빌드 전에 같은 계산으로 막는다 | OPS-16. 연휴 주는 마감이 당겨진다(WS-19) |
| 1 | 디스크: `df -h /` 여유 5G 이상. 모자라면 `deploy.sh prune`(우리 찌꺼기만) · npm/pip 캐시. `deploy.sh`도 빌드 전에 보고, 모자라면 빌드하지 않는다 | 빌드가 루트 디스크에 쌓인다(OPS-42·43). 2G대에서 빌드하면 도중에 ENOSPC로 죽는다 |
| 2 | DB 스냅샷 — 컨테이너 안에서 `sqlite3 .backup` → `/data/db/worklog.db.predeploy-시각` | `cp` 금지(OPS-07). `tmp/`는 기동 때 지워지므로 거기 두지 않는다. 야간본(`backup.sh db`)을 손으로 돌리면 **그날 야간본을 덮는다**. 4단계(`db push`)보다 먼저여야 하므로 스크립트에 넣지 않았다 |
| 3 | **지금 떠서 health가 ok인** 운영 컨테이너의 이미지를 `repman:rollback`으로 태그 — `deploy.sh prod`가 빌드 직전에 한다. 멈췄거나 아프면 옮기지 않는다(OPS-17a) | 빌드가 `repman:latest`를 덮으면 옛 이미지는 태그 없는(dangling) 이미지가 되고 배포 끝 청소(OPS-43)에 지워진다. 그 뒤 롤백은 재빌드뿐이다 |
| 4 | `git pull` → 스키마가 바뀌었으면 `prisma db push` (**chown 없이**) | 아래 「chown 하지 않는다」. 빠뜨리면 6단계의 새 앱이 뜨지 않고 없는 표·열을 로그 첫 FATAL 줄에 적는다(OPS-48) — push한 뒤 `deploy.sh prod --no-build` |
| 5 | 권한 확인: `stat` → `10001:mhchoi drwxrws---` · DB `-rw-rw----` | 틀어졌으면 백업이 조용히 멈춘다 |
| 6 | `bash scripts/deploy.sh prod` — 빌드 → 기동 → health `ok:true` → 우리 빌드 찌꺼기 청소 | OPS-43 |

**재배포 때는 chown 하지 않는다.** `/data/worklog`는 **`10001:mhchoi`, 그룹 쓰기, 디렉터리 setgid**다. 컨테이너(uid 10001)가
주인이고, 호스트의 mhchoi는 **그룹으로** 읽고 쓴다 — `backup.sh`의 gzip·tar, `prisma db push`, `issue-passwords.ts`가 모두
그 그룹 권한으로 돈다. 예전 문서대로 `chown -R 10001:10001`을 하면 그룹이 바뀌어 mhchoi가 디렉터리에 들어가지 못하고,
03:00 백업이 매일 Permission denied로 실패한다 — 로그 파일에만 남고 알림은 없다. 반대로 `chown mhchoi:mhchoi`를 먼저 하면
그 사이 컨테이너가 DB에 쓰지 못한다. 지금 권한에서는 mhchoi가 그룹으로 이미 쓸 수 있으므로 chown이 필요 없다.

**스키마는 「추가만」인지 본다.** `db push`가 데이터 손실 경고나 확인을 물으면 **멈춘다** — `--accept-data-loss`를 붙이지
않는다. 추가만인 변경(새 표·기본값 있는 열)은 프롬프트 없이 끝나고, 돌고 있는 옛 앱도 그대로 동작한다.
SQLite에서 Prisma는 **NOT NULL + 기본값 열**을 더할 때 표를 새로 만들어 옮긴다(`new_Division` → 옛 표 지움 → 이름 바꿈, 외래 키 검사를 잠시 끈 채) —
v2 전환의 `Division`이 그렇다. 행·열·외래 키는 그대로다(2026-10-09 main 스키마 DB 사본으로 확인: 옮긴 뒤 원래 열 값 같음 · `foreign_key_check` 0 ·
`Division`을 가리키는 외래 키가 계속 막는다). 그래서 2단계 스냅샷이 4단계보다 먼저다.

### OPS-16 — 배포 금지 시간대 ★ (2026-10-08 개정 — 목요일 마감 기준)

**그 주 마감 전날 11:30 ~ 마감 +2시간 30분에는 배포하지 않는다.** 기본값(목 14:00 마감)이면 **수 11:30 ~ 목 16:30**.

| 이 사이에 있는 것 | |
|---|---|
| 전날 11:45 · 13:00 · 13:50 마감 전 알림 | NT-41·10·42 — 13:50은 창이 3분이다 (당일 09:00 NT-45는 폐지 2026-10-08) |
| 제출이 몰리는 시간 (전날 오후 ~ 마감) | 재기동 1분이 「마감 직전에 안 올라간다」가 된다 |
| 14:01 자동 병합 · 14:10 검토 요청 · 14:30 제출 안내 | HM-25·NT-40 |
| 15:00 대외업무 마감 · 3단계를 켰으면 16:00 본부 기한(마감 +2시간) | 그 뒤 30분은 여유 |

**배포 전에 그 주 마감부터 본다.** 연휴 주는 총괄이 마감을 당긴다(WS-19) — 수요일 마감이면 금지 시간대도 하루 당겨진다.
부서마다 마감이 다를 수 있으니 가장 이른 것을 기준으로 한다. 확인 명령은 DEPLOY.md §2b-0.

**`deploy.sh prod`가 빌드 전에 다시 본다 (OPS-43).** 이번 주와 다음 주 주차의 예외(`WeekSlot`)와 켜진 부서의 마감(`Division`)을
컨테이너 안 `sqlite3 -readonly`로 읽어 위 규칙대로 금지 시간대를 세고, 그 안이면 빌드하지 않는다. 다음 주도 보는 이유: 마감이
월요일로 당겨지면 금지 시간대가 **지난 주 일요일**에 시작한다. 계산식은 `deadlineFor`·`dayBeforeAt`(WS-13·NT-41)과 같고,
테스트가 두 결과를 맞대 본다. 넘는 길은 `--ignore-window` 하나다 — 마감 직전의 긴급 수정·롤백·`MERGE_PAUSE_UNTIL`(OPS-16a)
적용처럼 금지 시간대에 해야 하는 일이 실제로 있다. 판정을 못 하면(질의 실패·값 이상) **막는다.** 운영 컨테이너가 아예 떠 있지
않으면 읽을 곳이 없으므로 알리고 지나간다 — 이미 멈춘 서비스를 올리는 일은 금지 시간대가 막으려는 사고를 키우지 않는다.

권장: **목 16:30 이후 ~ 다음 주 화요일** (마감이 당겨진 주는 그만큼 앞당겨 끝낸다).

v2 전환(2026-10-13 화 — [LAUNCH-v2](../LAUNCH-v2.md))은 이 권장 안이다: 화 07:00~ 열림 · 수 11:29까지 열림 · 수 11:30부터 목 16:30까지 막힘
(W42 · 목 14:00). 그 사이의 롤백은 `--ignore-window`다(LAUNCH-v2 §3.1 명령에 이미 붙어 있다). 시험 `[OPS-T19d]`가 이 경계를 고정한다.

### OPS-16a — 자동 병합을 잠시 멈춰야 할 때

`MERGE_SCHEDULER=off`(영구 정지)가 아니라 **기한부**로 멈춘다 — 되살리는 일이 사람
기억에 남지 않게. 규칙과 이유는 [HM-44](08-hwp-merge-engine.md#hm-44--자동-병합-기한부-일시정지-).

```yaml
MERGE_PAUSE_UNTIL: "2026-09-21T09:00:00+09:00"   # 반드시 새 주차가 열린 뒤로
```

```bash
bash scripts/deploy.sh prod --no-build   # 재빌드 불필요 — 환경변수만 바뀐다 (OPS-43)
#   멈추는 일은 대개 마감 직전, 곧 금지 시간대(OPS-16) 안이다 — 그때는 --ignore-window를 붙인다
sudo docker compose logs app | grep '일시정지'
```

지나고 나면 그 줄은 아무것도 하지 않는다. 다음 정리 때 지운다.

### OPS-42 — 빌드가 디스크를 먹는다 ★

2026-09-18에 루트 볼륨이 **95%(23G 남음)** 까지 찼다. 원인을 따라가니 도커였다.

```
/var/lib/docker       1.3G     ← Docker Root Dir. 여기만 보면 멀쩡하다
/var/lib/containerd    54G     ← 실제 데이터는 여기 있다
```

**이 서버의 도커는 이미지를 `/var/lib/docker`에 두지 않는다.** Docker 29는 containerd
이미지 스토어를 쓴다(`driver-type: io.containerd.snapshotter.v1`). 그래서 디스크를 볼 때
`Docker Root Dir`만 확인하면 **문제를 못 본다.** `du -sh /var/lib/containerd`를 봐야 한다.

**왜 쌓였나 — buildx가 없다.**

```
$ ls /usr/libexec/docker/cli-plugins/
docker-trust  docker-compose          ← docker-buildx 없음

$ sudo docker compose up -d --build
warning: Docker Compose requires buildx plugin to be installed   ← classic builder로 떨어진다
```

우분투 `docker.io` 패키지로 설치돼 있어 buildx가 안 들어온다. classic builder는 빌드 캐시를
**중간 이미지**로 들고 있어서, 다음 빌드 때 그게 통째로 태그 없는(dangling) 이미지가 된다.
관리되는 캐시가 아니므로 buildkit의 GC 정책이 적용되지 않는다 — `docker system df`가
`Build Cache 0B`라고 하는 것은 캐시가 없어서가 아니라 **캐시를 캐시로 세지 않기 때문**이다.

repman은 3단계 빌드라 **한 번 빌드할 때마다 약 1.2GB가 버려진다.** 17번 다시 빌드한
결과 dangling 이미지가 51개(회수 52G) 쌓였다.

**왜 buildx를 깔지 않았나.** Docker 공식 apt 저장소를 추가해야 하는데, 이 서버는 사용자
6명과 GPU 컨테이너가 도는 공용 장비다. `docker.io` 패키지와 섞다가 도커가 흔들리면
남의 작업까지 멈춘다. 얻는 것(자동 GC)에 비해 위험이 크다.

**대신 청소를 자동으로 만들었다.** 빌드를 누가 어떻게 하든 잡히도록 시스템 타이머로 둔다 —
배포 스크립트에 넣으면 스크립트를 안 쓴 빌드는 그대로 쌓이고, 문서에 적으면 사람이 기억해야 한다.

```
/etc/systemd/system/docker-image-prune.{service,timer}   일요일 04:00 · docker image prune -f
```

`image prune`만 쓴다. **`system prune`은 쓰지 않는다** — 멈춘 컨테이너·네트워크·볼륨까지
지워서 공용 서버에서는 남의 작업을 없앤다. dangling 이미지는 태그가 없어 이름으로 참조할
수 없으므로 지워도 아무것도 깨지지 않는다.

```bash
systemctl list-timers docker-image-prune.timer    # 다음 실행 확인
sudo journalctl -u docker-image-prune.service     # 회수량 기록
sudo systemctl disable --now docker-image-prune.timer   # 되돌리기
```

> ⚑ **2026-10-08 — 일주일에 한 번으로는 모자랐다.** 이틀 사이 빌드를 거듭하자 찌꺼기 약 45개(약 35G)가 쌓여 루트가 100%가
> 됐다. 그래서 빌드 **직후** 배포 스크립트가 치우고, 「우리 것」을 가리는 표식을 이미지에 박았다 → **OPS-43.**
> 위 「배포 스크립트에 넣으면 스크립트를 안 쓴 빌드는 그대로 쌓인다」는 표식으로 풀었다 — 표식은 Dockerfile에 있으므로
> 누가 어떻게 빌드하든 붙고, `deploy.sh prune`·타이머가 같은 필터로 잡는다. 타이머는 그물로 남긴다.

**디스크가 찼을 때 볼 순서:**

```bash
df -h /
sudo du -sh /var/lib/containerd          # ← /var/lib/docker 아니다
bash scripts/deploy.sh prune             # 우리 빌드 찌꺼기만 (OPS-43). 필터 없는 image prune은 남의 것까지 지운다
sudo sh -c 'du -sh /var/lib/containerd/*/ | sort -rh'
```

마지막 줄에 `sudo sh -c`를 쓰는 이유: 글로브는 sudo **밖**에서 펼쳐져서, 읽을 권한이 없으면
조용히 빈 결과가 나온다. 「아무것도 없다」와 「못 봤다」가 똑같이 보인다.

### OPS-43 — 빌드 찌꺼기는 배포 스크립트가 치운다 · 표식으로, 우리 것만 ★ (2026-10-08)

2026-10-08, 이틀 사이 테스트·운영 빌드를 거듭하자 태그 없는 이미지가 **약 45개(약 35G)** 쌓여 루트 디스크가 **100%**가 됐다.
일요일 타이머(OPS-42)는 그 사이에 돌지 않았고, `image prune` 한 번은 사슬의 끝만 떨어뜨린다 — 손으로 `docker rmi`를 여러
차례 돌려(태그 없음 · `WorkingDir=/app`) 치웠다. 서버를 함께 쓰는 쪽에서도 「가장 큰 원인이 repman 빌드 찌꺼기」라고 알려 왔다.
**사람이 기억해서 치우는 것으로는 안 된다** — 빌드하는 그 명령이 치우게 한다.

| ID | 요구사항 |
|---|---|
| OPS-43a | `Dockerfile`의 **모든 스테이지**에서 `FROM` 바로 다음 줄이 `LABEL org.tincase.app="repman"`이다. 그 밖의 빌드는 그대로 |
| OPS-43b | 빌드와 컨테이너를 새로 만드는 재기동의 입구는 **`scripts/deploy.sh <prod\|test\|prune> [--no-build] [--ignore-window]`** 하나다. 운영은 `docker-compose.yml`(프로젝트 `repman`), 테스트는 `docker-compose.test.yml -p repman-test`. 한 번에 하나만 돈다(`flock`) — 겹치면 이쪽 청소가 저쪽 빌드가 다음 스테이지에서 쓸 스테이지 이미지(태그 없음 — 찌꺼기와 똑같이 보인다)를 지울 수 있다. 멈췄다 켜기(`stop`/`start`, 복원 절차의 `up -d`)는 compose 그대로 — 새 이미지가 생기지 않아 찌꺼기도 없다 |
| OPS-43c | 기동(`up`)이 성공하면 `docker image prune -f --filter label=org.tincase.app=repman`을 **지운 것이 없을 때까지** 되풀이한다 (상한 30회) |
| OPS-43d | 표식이 생기기 전 이미지(레거시)는 **repman 최종 이미지의 지문이 그대로일 때만** `docker rmi`(`-f` 없이)로 지운다 — 태그 없음 · `WorkingDir=/app` · `User=app` · `Entrypoint=["/usr/bin/tini","--"]` · `Cmd=["./scripts/entrypoint.sh"]` |
| OPS-43e | **남의 것과 태그 붙은 것은 건드리지 않는다.** `repman:latest`·`repman:rollback`·`repman:test`도 지우지 않는다. 필터 없는 `image prune`, `-a`, `system`·`builder`·`container`·`volume` prune, `rmi -f`를 스크립트에 쓰지 않는다 — 테스트가 스크립트를 읽어 막는다 |
| OPS-43f | 빌드 전 루트 여유가 **5 GiB 미만**이면 우리 찌꺼기를 먼저 치우고 다시 잰다. 그래도 모자라면 **빌드하지 않고** 할 일을 출력한다 (OPS-19) |
| OPS-43g | 운영은 `main`에서만 돈다 — 다른 브랜치를 구우면 `repman:latest`가 그 이미지가 되어 다음 재기동이 조용히 그것으로 뜬다. `--no-build`도 같다: 그 체크아웃의 `docker-compose.yml`(환경변수·볼륨)로 운영 컨테이너를 다시 만들고, 프로젝트 이름(`repman`)을 박았으므로 다른 worktree에서 돌려도 운영을 가리킨다. 브랜치를 읽지 못하면(흔히 `sudo bash …` — root에게 git이 답하지 않는다) 막는다. 금지 시간대(OPS-16)면 멈춘다 — `--no-build` 재기동도(재기동이 곧 중단이다). 빌드 직전 **지금 떠서 건강한 운영 컨테이너의 이미지** → `repman:rollback`(OPS-15 3단계 · OPS-17a — 2026-10-10 개정, 예전에는 `repman:latest`). `--no-build`는 지금 이미지로 다시 띄우기만 한다(`--force-recreate`) — 롤백 태그를 옮기지 않는다 |
| OPS-43h | 테스트 서버는 `TINCASE_TEST_MODE`가 있으면 그대로 넘긴다(`sudo` **뒤에** 붙여서 — RU-45의 함정을 스크립트가 대신 피한다). 시연 모드로 떠 있는데 변수 없이 다시 올리려 하면 멈춘다 — 되돌리려면 `TINCASE_TEST_MODE=test`를 적는다. `docs/DEMO.md`의 `sudo TINCASE_TEST_MODE=… docker compose … up -d`는 `feat/org-rollup` 머지(2026-10-08) 때 `TINCASE_TEST_MODE=… bash scripts/deploy.sh test --no-build`로 바꿨다(되돌리기는 `TINCASE_TEST_MODE=test`) — `docker-compose.test.yml` 머리 주석도 같다 |
| OPS-43i | 시작·끝에 `df -h /`, 끝에 health 결과를 출력한다. health가 `ok:true`가 아니면 0이 아닌 값으로 끝나고 롤백 명령을 보여 준다 |

**왜 표식인가 — 공용 서버라서.** 필터 없는 `docker image prune -f`는 **서버 전체**의 태그 없는 이미지를 지운다. 이 서버는 여러
사람이 도커를 함께 쓴다. 남의 태그 없는 이미지는 그 사람의 빌드 캐시이거나, ID로 잡아 두고 쓰는 이미지일 수 있다. 지워도
우리 쪽은 아무 일이 없지만 **그 판단은 그 사람 몫이다** — 우리가 만든 것만 우리가 치운다. 그런데 찌꺼기는 이름(태그)이
없어서, 이름 말고는 「우리 것」을 가릴 방법이 이미지에 박힌 표식뿐이다.

**왜 모든 스테이지에, 왜 `FROM` 바로 다음인가.** 레이블은 그 스테이지 안에서 **그 뒤** 명령으로만 이어진다. 마지막 스테이지(`run`)에만
붙이면 `deps`·`build` 스테이지가 남긴 이미지 — `npm ci`·`next build` 결과라 찌꺼기 용량의 대부분 — 가 표식 없이 남는다.
classic builder(OPS-42 — buildx가 없다)는 명령마다 중간 이미지를 만들고, 표식은 `LABEL` 다음에 만들어진 것부터 붙는다.
맨 앞에 두어야 스테이지의 중간 이미지가 하나도 빠지지 않는다.

**왜 되풀이하나.** classic builder의 찌꺼기는 부모-자식 **사슬**이다. `image prune`은 자식 없는(dangling) 것만 지우므로 한 번에
사슬 끝이 하나씩 떨어진다. 지운 것이 없을 때까지 돌린다. `run` 스테이지 사슬이 15단 남짓이라 상한은 30회로 넉넉히 둔다.

**왜 레거시 지문은 최종 이미지뿐인가.** 표식 없는 `deps`·`build` 스테이지 이미지는 `node` 기본 이미지와 설정이 같다
(`WorkingDir=/app`, `Entrypoint=docker-entrypoint.sh`) — 남의 Node 프로젝트와 **구별할 수 없다.** 구별할 수 없으면 지우지 않는다.
대신 끝에 「태그 없는 이미지 N개가 남았다」를 알린다. 이 변경 뒤에 구운 이미지는 모두 표식이 있으므로 이 경로는 곧 할 일이 없어진다.

**왜 기동이 성공한 뒤인가.** 빌드·기동이 실패했을 때는 그 상태를 그대로 둔다 — 무엇이 남았는지 보고 판단하게.
치워야 하면 `deploy.sh prune`. 기동 뒤 health가 실패해도 청소는 한다: 되돌릴 이미지는 `repman:rollback` **태그**가 붙잡고 있어서
청소가 닿지 않고, 컨테이너가 쓰는 이미지는 `image prune`이 지우지 않는다.

**치르는 값.** `deps` 스테이지 캐시(`npm ci` 결과)도 찌꺼기와 함께 지워져 다음 빌드는 `npm ci`부터 다시 한다(수 분).
예전 §2b도 배포 끝에 `image prune`을 돌려 같은 값을 치르고 있었다 — 디스크와 바꾼다.

**스크립트를 안 거친 빌드.** 표식은 Dockerfile에 있으므로 `sudo docker compose up -d --build`로 손수 빌드해도 붙는다.
그 뒤 `bash scripts/deploy.sh prune` 한 번이면 같은 청소를 한다. 일요일 타이머(OPS-42)는 그물로 남긴다 — 다만 지금은 필터 없이
서버 전체를 지운다. 같은 이유로 **표식 필터로 좁히기를 권한다** (운영자 판단, sudo, 1회):

```ini
# /etc/systemd/system/docker-image-prune.service 의 ExecStart를 이 한 줄로.
# `$`를 쓰지 않은 이유: systemd가 ExecStart의 $이름을 먼저 펼쳐 버린다 — 셸 변수가 빈 문자열이 된다
ExecStart=/bin/sh -c 'for n in `seq 30`; do docker image prune -f --filter label=org.tincase.app=repman | grep -qiE "^(deleted|untagged):" || break; done'
```

```bash
sudo systemctl daemon-reload && sudo systemctl start docker-image-prune.service && sudo journalctl -u docker-image-prune.service -n 20
```

### OPS-47 — 한 주 리허설 (2026-10-08 · v2 운영 전환 10/12 전 주말)

진짜 스케줄러로 **마감부터 전사본까지** 한 주를 한 번 돌리고, 가짜 알림 수신함(NT-56)에 쌓인 알림이 「각 종류가 맞는 사람에게, 한 번, 제 창 안에」
갔는지 판정한다. 함수 하나씩 시험한 것은 이미 있다 — 리허설이 보는 것은 그것들이 **한 프로세스에서 1분 주기로 함께 돌 때**다(HM-50 · RU-54·57처럼
「마감 + n분」·「병합이 끝난 시각」·「다 모인 순간」이 얽히는 곳). 절차 [docs/REHEARSAL.md](../REHEARSAL.md).

| ID | 요구사항 |
|---|---|
| OPS-47a | `scripts/rehearsal.ts prepare` — 가짜 조직(fake-org의 사람 + 단위마다 역할 이름의 사람 — 지어낸 이름도 쓰지 않는다), **13개 단위(전사 섹션) 모두 켬**, 사번 `RH001`~(사번 꼴이 아니라 실제 메신저로 새어도 아무도 못 찾는다), 이번 주 제출(단위마다 안 낸 사람, 한 곳은 아무도 안 냄), 마감은 이번 주 일요일 23:00으로 미뤄 둔다. 본부(기획경영본부) 자신은 부서 알림을 끈다 — 문서가 없는 본부에 마감 독촉·「병합본이 아직 없어요」가 가지 않게. 저장소는 `/data/worklog-demo` 또는 임시 디렉터리만(시연 시드와 같은 경계), 실제 계정이 하나라도 있으면 거절. 승인·마감 옮기기용 세션은 여기서 만들어 `rehearsal/sessions.json`(0600)에 둔다 — run은 서버가 쓰는 DB에 쓰지 않는다 |
| OPS-47b | `run --base=` — 총괄의 [일정 바꾸기]와 같은 API(`POST /api/schedule/deadline`)로 마감을 **지금 + N분**(기본 12)으로 당기고, 3단계 기한은 `--stages`면 총괄 설정 API로. 부서장·본부장은 **받은 알림을 보고** HTTP로 승인한다(검토 요청 뒤 · 기한 임박 뒤 — 각본 `scripts/rehearsal-plan.ts`). 알림이 창이 끝나도록 안 오면 그냥 승인하고 실패로 남긴다. 「본부 → 총괄」 기한 + 14분에 끝나 보고서(`rehearsal/report-*.txt`)를 찍는다 — 종료 코드 0 = 통과. 판정 규칙은 앱 코드를 불러 쓰지 않고 messenger.md 표를 옮겨 적었다 — 같은 함수로 기대값을 만들면 틀린 것도 맞다고 나온다 |
| OPS-47c | 판정: 기대 알림마다 **창 안에 정확히 한 번**(창 시작 5초 전 ~ 끝 90초 뒤). 두 번·창 밖·안 옴은 실패, 기대하지 않은 알림(다른 사람·다른 종류)도 실패. 리허설 시작 전에 끝난 창은 기대하지 않고, 창 도중에 시작했거나 받는 사람이 그 알림을 보고 움직이는 경우는 「와도 되는」 쪽(한 번 넘으면 실패) |
| OPS-47d | 테스트 서버(11112)에서 돌릴 때만 스케줄러를 켠다 — **덧붙이는 compose `docker-compose.rehearsal.yml`**(`MERGE_SCHEDULER: "on"` 한 줄). `TINCASE_TEST_MODE=demo TINCASE_REHEARSAL=on bash scripts/deploy.sh test --no-build`로 시작, 변수 없이 다시 올리면 꺼진다. **평소 모드(실명 사본)에서는 스크립트가 멈춘다** — 켜면 그 주가 저절로 병합·넘김된다. `docker-compose.test.yml`의 변수는 그대로 `TINCASE_TEST_MODE` 하나다(RU-45) |
| OPS-47e | `local` — 로컬 끝까지 한 번에: 임시 저장소 · 가짜 병합 모델(`scripts/fake-model.ts` — ollama `/api/generate` 흉내, 묶을 것 없음·분류는 첫 이름) · `next dev`(수신함·스케줄러 켬) · run. 개발 서버는 경로를 처음 부를 때 컴파일하므로 수신함·승인 경로를 미리 부른다. `next dev`가 고쳐 쓰는 `CLAUDE.md`·`next-env.d.ts`는 끝나면 되돌린다 |
| OPS-47f | 주차를 넘기지 않는다 — 끝(「본부 → 총괄」 + 14분)이 월요일 00:00을 넘으면 run이 시작하지 않는다(스케줄러가 새 주를 본다). prepare도 이번 주가 3시간 안에 끝나면 거절 |

시험 `[OPS-T30]`~`[OPS-T33]`(`tests/rehearsal.test.ts` — 각본·기대 알림·판정·가짜 모델) · `[OPS-T34]`(`tests/deploy-script.test.ts` — 스케줄러 판정·덧붙이는 compose).

### OPS-50 — 브라우저 e2e 스모크 (2026-10-09 · v2 운영 전환 10/13)

리허설(OPS-47)은 **알림과 스케줄러**를 보고, 사람의 일은 HTTP로 흉내 낸다. 화면 시험(vitest)은 함수와 그리기를 따로 본다. 둘 다 「운영 빌드에서
실제 단추를 누르면 그 화면이 되나」는 보지 않는다 — 그래서 `scripts/e2e-v2.cjs`가 **운영과 같은 빌드**를 띄우고 역할마다 실제 화면을 누르고 쳐서
한 주를 끝까지 간다. 사람의 일에는 API를 부르지 않는다(준비 — 마감을 지금 + N분으로 옮기기 — 만 API). 절차 [docs/REHEARSAL.md](../REHEARSAL.md)의 「브라우저 e2e 스모크」 절.

| ID | 요구사항 |
|---|---|
| OPS-50a | 빌드는 **체크아웃을 작업 디렉터리에 복사해서**(`.env*`·`docs/private`·DB 파일 빼고, node_modules는 하드링크) `next build` → standalone을 Dockerfile의 run 단계와 같은 모양으로(`.next/static`·`public`). 체크아웃에는 아무것도 쓰지 않는다 — 운영 배포 체크아웃에서 돌려도 그 빌드·`.next`를 건드리지 않는다. `--app=<dir> --no-build`면 빌드해 둔 복사본을 다시 쓴다 |
| OPS-50b | 저장소는 매번 새 임시 디렉터리 — `rehearsal.ts prepare`(OPS-47a: 13개 단위 · @example.invalid 사람 · 이번 주 제출 · 알림 켬) + `scripts/e2e-seed.ts`(AI홍보전략실 지난 다섯 주의 제출·병합본 — 접힌 달이 생기게 · 역할 세션 · 운영자 새 비밀번호, `<store>/e2e/seed.json` 0600). 시드는 임시 디렉터리 안 · 리허설 표식이 있는 저장소 · 가짜 사람만인 저장소만 받는다. 한 번 쓴 저장소는 다시 쓰지 않는다 — 그래서 몇 번을 돌려도 같은 출발점이다 |
| OPS-50c | 서버는 `NODE_ENV=production` standalone · `TINCASE_ENV=demo` · 알림은 **같은 서버의 가짜 수신함**(NT-56, OPS-46이 다른 주소를 거부) · 스케줄러 켬 · 가짜 병합 모델(지연 `--model-delay-ms`, 기본 2.5초 — 줄에 선 모습이 화면에 보이게) · 어떤 Cloudflare 앱에도 없는 AUD. **셸의 환경을 넘기지 않는다**(PATH·HOME·언어만) — `DATABASE_URL`·`MESSENGER_URL`이 딸려 가지 않게. 운영·테스트·시연 포트(11111·11112·11113)는 받지 않는다 |
| OPS-50d | 브라우저는 `http://tincase.e2e:<포트>`(Chromium 호스트 매핑)로 들어간다 — 사내망처럼 보안 컨텍스트가 아니어서 클립보드 대체 경로(CP-65)를 그대로 탄다. 복사한 글자는 보안 컨텍스트 페이지(127.0.0.1)에서 클립보드를 읽어 맞춘다 |
| OPS-50e | 흐름 — 부서원(첫 로그인 카드 · 작성 · v2 · 제출 취소 · 지난 주차 · 병합본) · 담당(미제출 이름 복사 · 마감 뒤 스케줄러 병합 줄 → 준비됨 · [다시 병합] 자리 · 병합본 수정 · [고치기] · 분류 순서) · 실장(고쳐 저장 = 승인 · 다시 승인) · 본부장(/hq 승인) · 총괄(전사본 받기 — OLE 머리·HWP 서명 · 다음 주 마감 바꾸기 → 평소대로) · 운영자(로그인 화면 · 병합 줄 · 수신함 종류 · 감사 로그 행동) · 사용 안내(발표 PageDown ×5 · B · 발표자 창 동기화 · 체험하기 주소) · 400px(홈 · 작성 · 수합 관리 — 가로 넘침 없음). 단계마다 **그 뒤 화면이 보이는 것**을 확인한다 |
| OPS-50f | 기다림은 화면 상태로 한다(그 글자·그 칩이 보일 때까지, 한도 있음). 시각을 기다리는 곳은 부서 마감 하나뿐이다. 앞 단계가 실패하면 그 단계에 기대는 뒤 단계는 「건너뜀」으로 남긴다 — 뒤의 실패가 앞 실패의 그림자로 읽히지 않게. 실패한 단계는 그 화면을 찍어 둔다 |
| OPS-50g | 결과는 흐름 × 단계 PASS/FAIL 표(`<work>/e2e-report.txt`·`.json`) · 서버 로그의 오류 줄도 한 단계로 센다. 종료 코드 0 = 모두 통과 · 1 = 실패·건너뜀 있음 · 2 = 준비 실패. 통과하면 저장소·복사본을 지운다(`--keep`이면 남긴다), 실패하면 늘 남긴다 |
| OPS-50h | **출시 범위** `--scope=launch` (2026-10-10). 기본(`full`)은 13개 단위·3단계 켬이라 출시일의 모양에서만 생기는 일(「위로」가 없어야 하는 화면 · 꺼진 부서로 새는 쪽지 · 「병합 점검」을 누가 받나)을 보지 않는다. 그래서 같은 빌드를 **10/13 전환의 범위 그대로** 줄인 저장소에 띄운다(`scripts/e2e-plan.ts` → `e2e-seed.ts --scope=launch`): 켠 부서 둘(기획조정실 · AI홍보전략실) · 나머지 꺼짐 · 3단계 끔 · 부서 알림은 그 둘 — 그리고 범위 밖 꺼진 부서 하나에 켜 둔 스위치(운영자가 LAUNCH-v2 9-5의 2처럼 화면에서 끈다 · 끄기 전 「10분 전」 창도 그 부서에 가지 않아야 한다 — NT-30) · 기획조정실은 부서장 없이 · 총괄은 담당이 아니다(「병합 점검」이 총괄이 아니라 총괄이 있는 부서의 담당에게 가는지 가른다 — TACP-30) · 가짜 운영자 알림 켬. 흐름: 부서원(`full`과 같다) · 담당(같은 흐름 + [받기] 파일 이름 · [제목 복사] — 게시판에 올릴 것) · 실장(고쳐 저장 = 승인 · 담당이 고친 뒤 [고칠 것 없음 · 승인] — 「담당자에게 알렸습니다」, 「올라갔어요」·「위로」 카드는 어디에도 없다) · 부서장 없는 부서의 담당(승인 줄 없음) · 총괄(「전사」는 제출 현황판만 — 최종본 열·전사본 카드·「본부 취합」 없음 · `/hq` 404 · 남의 수합 관리에도 「위로」 없음) · 운영자(「알림」 칩 · 범위 밖 한 줄 끄기 · 병합 줄 2/2 · 수신함 · 감사에 「위로 제출」·「본부본·전사본」 없음) · **수신함 판정** — 수신함 파일(NT-56b)을 시드가 적은 사실(사람 → 부서 → 켜짐)로 본다: 꺼진 부서 사람에게 간 쪽지 0 · 3단계 쪽지(`ru_*` · `merge_reapprove`) 0 · 종류 없는 쪽지 0 · 「병합 점검」은 운영자와 기획조정실 담당 · 「승인 완료」는 승인마다 담당에게 한 통(끝 줄 「취합게시판에 올려주세요」). 판정은 앱 코드를 부르지 않는다(OPS-47b와 같은 까닭) |

시험 `[OPS-T37]`(`tests/e2e-script.test.ts` — 셸 환경을 넘기지 않음 · 금지 포트 · 시드의 경계 — 체크아웃이 `/tmp` 아래여도 같은 답, 2026-10-10) ·
`[OPS-T37b]`(범위 이름 · 출시 범위의 모양 · 수신함 판정이 새는 쪽지·3단계 쪽지·종류 없는 쪽지를 정말 잡는다). 흐름 자체는 빌드·브라우저가 필요해 vitest 게이트에 넣지 않는다 —
전환 전·배포 뒤에 손으로 돌린다(약 15분, 범위마다).

### OPS-51 — 분류 순서 초안은 부서를 골라 넣는다 (`--only`, 2026-10-09)

`scripts/apply-merge-rule-drafts.ts`(HM-27 · HM-51)는 분류가 비어 있는 초안 부서를 **한꺼번에** 쓴다. 부서는 하나씩 켜는데(LAUNCH-v2 §6)
초안은 두 부서 것이다 — 10/13에 켜는 기획조정실 것을 넣으면 아직 꺼져 있고 담당 확인 전인 인사관리실 것까지 들어간다(9-6).

| ID | 요구사항 |
|---|---|
| OPS-51 | `--only=<부서명>[,<부서명>…]` — 그 이름의 초안만 미리 보고 `--apply`면 쓴다. 나머지 초안 부서는 「- {부서}: 건너뜀 (--only 밖)」으로 찍는다. **초안에 없는 이름이 하나라도 있으면** DB를 열기 전에 그 이름을 찍고 종료 코드 2 — 오타가 「바꿀 것 없음」처럼 조용히 지나가거나 반만 쓰이지 않게. 값 없는 `--only`도 2. `--only`가 없으면 예전과 같다(초안 전부). 담당이 적은 분류를 덮지 않는 것 · 감사 `rule_update`(`via: apply-merge-rule-drafts`)는 그대로 |

시험 `[OPS-T38]`(`tests/merge-rule-drafts.test.ts` — 이름 고르기 · 실제로 돌려 `--only=기획조정실 --apply`가 기획조정실만 쓰고 인사관리실은 비운 채 · 감사 한 줄 ·
모르는 이름은 종료 코드 2이고 아무것도 쓰지 않음 · `--only` 없는 미리 보기는 두 부서 모두).

### OPS-17 — 롤백 (2026-10-08 개정)

**재빌드하지 않는다.** 배포 전에 태그해 둔 이미지로 되돌린다 — 디스크가 모자라도, 빌드가 깨져도 된다.

```bash
sudo docker tag repman:rollback repman:latest
bash scripts/deploy.sh prod --no-build    # 지금 태그로 다시 띄우고(--force-recreate) health까지 본다 — 롤백 태그는 옮기지 않는다
#   금지 시간대(OPS-16) 안이면 --ignore-window — 롤백은 대개 급하다
```

**OPS-17a — 롤백 태그는 지금 떠서 건강한 이미지에만 (2026-10-10).** 예전 `deploy.sh`는 빌드 직전에 늘 `repman:latest`를 `repman:rollback`으로 옮겼다.
그런데 `latest`는 「돌고 있는 것」이 아니다 — 빌드만 하고 띄우지 않았거나, 배포를 빌드째 거듭 돌리면(첫 번째가 빌드 뒤 health에서 멈춤) 둘째의 태그가
방금 구운 새 판을 가리켜 옛 이미지가 태그를 잃고 그 실행의 청소에 지워졌다. 이제 「되돌아갈 곳」의 두 조건을 직접 본다: 운영 컨테이너가 **떠 있고**
그 **이미지**(`docker inspect repman --format '{{.Image}}'`)이며, 지금 health가 **ok**다. 아니면 태그를 옮기지 않고 그대로 둔 것을 알린다.
배포가 실패하면 되돌리는 명령을 적는데, 사람이 붙인 **고정 태그**(v2 전환의 `repman:v1.39.0` — `deploy.sh`가 옮기지도 지우지도 않는다)가 있으면 그쪽을 먼저 적는다.
시험 `[OPS-T40]`(떠서 건강할 때만 · 그 컨테이너의 이미지에 · 아프거나 멈췄으면 그대로 · 빌드째 두 번) · `[OPS-T41]`(실패 안내는 고정 태그 먼저) — `tests/deploy-script.test.ts`.

**DB는 보통 되돌리지 않는다.** 스키마 변경이 「추가만」(OPS-15)이면 옛 앱은 새 열을 모르고 지나간다. DB 스냅샷(OPS-15 2단계)으로
되돌리는 것은 데이터가 망가졌을 때만이다 — 배포 뒤에 들어온 제출·수정도 함께 사라진다. 절차는 DEPLOY.md §2b-롤백.

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
| 빌드는 `scripts/deploy.sh`로만 — 기동이 끝나면 **우리 빌드 찌꺼기**(표식 `org.tincase.app=repman`)를 다 지운다 (2026-10-08 개정) | 빌드 찌꺼기가 `/var/lib/containerd`(= `/`)에 쌓인다(OPS-42). 예전 「`builder prune` 정기 실행」은 buildx가 없는 이 서버에서 0B였고, 서버 전체 캐시라 남의 것이기도 하다 → OPS-43 |
| 이미지 태그 2세대만 유지 — `repman:latest` · `repman:rollback` (테스트는 `repman:test` 하나) | 롤백 태그가 옮겨 가면 그 전 세대는 태그 없는 찌꺼기가 되어 같은 청소에 지워진다 |
| 헬스체크에 루트 디스크 여유 감시 추가 — 5G 미만이면 경고 | 다른 서비스가 채워도 우리가 먼저 안다 |
| 배포 직전 디스크 확인 — 5 GiB 미만이면 우리 찌꺼기를 먼저 치우고, 그래도 모자라면 **빌드하지 않는다** (`deploy.sh`가 한다) | OPS-15 1단계 · OPS-43f. 2G대에서 빌드하면 도중에 ENOSPC로 죽고, 죽은 빌드의 찌꺼기가 또 쌓인다 |

**health가 디스크를 말하는 방법 (2026-10-08 결정).**

| 루트 여유 | `checks.rootDisk` | 맨 위 `warnings[]` | `ok` · HTTP |
|---|---|---|---|
| 5G 이상 | `ok` | — | 그대로 |
| 1G ~ 5G | `warn: 2.6G free` | `root disk low: 2.6G free` | **그대로 200** |
| 1G 미만 | `fail: 0.8G free` | 같은 줄 | **`false` · 503** → 도커 `unhealthy` |

1~5G에서 `ok`를 뒤집지 않는 이유: 이 서버는 평소 97~99%를 오간다. 그때마다 503이면 도커 상태가 늘 `unhealthy`라
정말 위험할 때를 가려내지 못한다. 대신 **`warnings` 배열**로 따로 꺼내 둔다 — `jq '.warnings'` 한 번이면 보이고,
값을 읽지 않는 healthcheck는 영향받지 않는다. 1G 밑은 SQLite 저널·로그 쓰기가 실패할 수 있는 수준이라 앱이 정말로
건강하지 않다. 그때는 숨기지 않는다 (`restart: unless-stopped`는 unhealthy에 반응하지 않으므로 재기동 폭주도 없다).

근본 대책(Docker data-root를 `/data`로 이전)은 **다른 서비스에 영향을 주므로 이 프로젝트
범위 밖** — 운영자 판단 사항으로 기록만 한다 ([Q-17](../../OPEN-QUESTIONS.md)).
