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
| `SUBMIT_HWP_UPLOAD` | `off` | | 기본 `on`. `off`면 hwp 업로드 제출을 닫고 웹 작성만 받는다 — 테스트 서버만 `off` (WA-30 · [ADR-0014](../adr/0014-web-only-submission.md)) |
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
지금 마운트는 손으로 한 것이라(fstab에 없음) 재부팅하면 빠진다 — **운영자가 fstab에 넣는다** (sudo, 1회):

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

| 단계 | 하는 일 | 왜 |
|---|---|---|
| 0 | 이번 주 마감 확인 → 금지 시간대면 멈춘다 | OPS-16. 연휴 주는 마감이 당겨진다(WS-19) |
| 1 | 디스크: `df -h /` 여유 5G 이상, 아니면 `docker image prune` · `builder prune` · npm/pip 캐시 | 빌드가 루트 디스크에 쌓인다(OPS-42). 2G대에서 빌드하면 도중에 ENOSPC로 죽는다 |
| 2 | DB 스냅샷 — 컨테이너 안에서 `sqlite3 .backup` → `/data/db/worklog.db.predeploy-시각` | `cp` 금지(OPS-07). `tmp/`는 기동 때 지워지므로 거기 두지 않는다. 야간본(`backup.sh db`)을 손으로 돌리면 **그날 야간본을 덮는다** |
| 3 | 지금 이미지를 `repman:rollback`으로 태그 | 빌드가 `repman:latest`를 덮으면 옛 이미지는 태그 없는(dangling) 이미지가 되고 일요일 prune에 지워진다. 그 뒤 롤백은 재빌드뿐이다 |
| 4 | `git pull` → 스키마가 바뀌었으면 `prisma db push` (**chown 없이**) | 아래 「chown 하지 않는다」 |
| 5 | 권한 확인: `stat` → `10001:mhchoi drwxrws---` · DB `-rw-rw----` | 틀어졌으면 백업이 조용히 멈춘다 |
| 6 | 빌드 → 기동 → health `ok:true` | |

**재배포 때는 chown 하지 않는다.** `/data/worklog`는 **`10001:mhchoi`, 그룹 쓰기, 디렉터리 setgid**다. 컨테이너(uid 10001)가
주인이고, 호스트의 mhchoi는 **그룹으로** 읽고 쓴다 — `backup.sh`의 gzip·tar, `prisma db push`, `issue-passwords.ts`가 모두
그 그룹 권한으로 돈다. 예전 문서대로 `chown -R 10001:10001`을 하면 그룹이 바뀌어 mhchoi가 디렉터리에 들어가지 못하고,
03:00 백업이 매일 Permission denied로 실패한다 — 로그 파일에만 남고 알림은 없다. 반대로 `chown mhchoi:mhchoi`를 먼저 하면
그 사이 컨테이너가 DB에 쓰지 못한다. 지금 권한에서는 mhchoi가 그룹으로 이미 쓸 수 있으므로 chown이 필요 없다.

**스키마는 「추가만」인지 본다.** `db push`가 데이터 손실 경고나 확인을 물으면 **멈춘다** — `--accept-data-loss`를 붙이지
않는다. 추가만인 변경(새 표·기본값 있는 열)은 프롬프트 없이 끝나고, 돌고 있는 옛 앱도 그대로 동작한다.

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

권장: **목 16:30 이후 ~ 다음 주 화요일** (마감이 당겨진 주는 그만큼 앞당겨 끝낸다).

### OPS-16a — 자동 병합을 잠시 멈춰야 할 때

`MERGE_SCHEDULER=off`(영구 정지)가 아니라 **기한부**로 멈춘다 — 되살리는 일이 사람
기억에 남지 않게. 규칙과 이유는 [HM-44](08-hwp-merge-engine.md#hm-44--자동-병합-기한부-일시정지-).

```yaml
MERGE_PAUSE_UNTIL: "2026-09-21T09:00:00+09:00"   # 반드시 새 주차가 열린 뒤로
```

```bash
sudo docker compose up -d        # 재빌드 불필요 — 환경변수만 바뀐다
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

**디스크가 찼을 때 볼 순서:**

```bash
df -h /
sudo du -sh /var/lib/containerd          # ← /var/lib/docker 아니다
sudo docker image prune -f
sudo sh -c 'du -sh /var/lib/containerd/*/ | sort -rh'
```

마지막 줄에 `sudo sh -c`를 쓰는 이유: 글로브는 sudo **밖**에서 펼쳐져서, 읽을 권한이 없으면
조용히 빈 결과가 나온다. 「아무것도 없다」와 「못 봤다」가 똑같이 보인다.

### OPS-17 — 롤백 (2026-10-08 개정)

**재빌드하지 않는다.** 배포 전에 태그해 둔 이미지로 되돌린다 — 디스크가 모자라도, 빌드가 깨져도 된다.

```bash
sudo docker tag repman:rollback repman:latest
sudo docker compose up -d --no-build --force-recreate
curl -fsS http://127.0.0.1:11111/api/health
```

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
| Docker 빌드는 `docker builder prune` 정기 실행과 함께 | 빌드 캐시가 `/var/lib/docker`(= `/`)에 쌓임 |
| 이미지 태그 2세대만 유지 | 〃 |
| 헬스체크에 루트 디스크 여유 감시 추가 — 5G 미만이면 경고 | 다른 서비스가 채워도 우리가 먼저 안다 |
| 배포 직전 디스크 확인 — 5G 미만이면 먼저 비운다 | OPS-15 1단계 |

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
