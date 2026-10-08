# 배포 절차 — 체크리스트

> 목표: 월요일 8/17 00:00 주차 오픈 전에 `https://worklog.excusa.uk` 가동.
> ⚠ 표시는 실수하면 보안 사고인 지점.

## ✅ 현재 상태 (2026-08-14, v1.1.0 — 사내망 개통 완료)

| 항목 | 상태 |
|---|---|
| 컨테이너 | **가동 중** `0.0.0.0:11111` · health ok · v1.1.0 |
| **사내망 접속** | **열림** — `http://<서버-내부-IP>:11111` 로그인 동작 확인 |
| 데이터 | `/data/worklog` (부서 30 · 사용자 337 · 파일럿 양식 v1) |
| 비밀번호 | **AI홍보전략실 13명 전원 발급 완료** (첫 로그인 시 변경 강제) |
| 백업 | 크론 (db 매일 03:00 · files 일 03:30) · verify 통과 |
| Cloudflare | 미개통 — **운영자 외부 통로용으로만** 설정 예정 (§3) |

**부서원은 이미 사용 가능하다.** §3은 Sean의 외부 접속을 위한 선택 작업이다.

### 비밀번호 배포 (AU-22)

발급 CSV는 이 세션 스크래치에 있고 **평문이므로 배포 후 즉시 폐기**해야 한다.
개인별로 전달하고, 각자 첫 로그인 시 변경 화면으로 강제 이동된다.

**개별 재발급은 `/ops` 화면의 [초기화] 버튼이 가장 빠르다** (AU-27) — 안내문 복사까지 한 번에.
여러 명 한꺼번에 발급할 때만 CLI를 쓴다.

```bash
export DATABASE_URL=file:/data/worklog/db/worklog.db

# 신규 부서 온보딩 — Excel로 열 거면 반드시 --bom (없으면 한글이 깨진다)
npx tsx scripts/issue-passwords.ts --division 연구관리실 --bom > /tmp/pw.csv

# 개인별 안내문으로 뽑기 (메신저에 그대로 붙여넣기 좋음)
npx tsx scripts/issue-passwords.ts --division 연구관리실 --messages > /tmp/pw.txt

# 특정인 재발급
npx tsx scripts/issue-passwords.ts --division 연구관리실 --reset 홍길동
```

⚠ **출력을 `| head` 등으로 자르지 말 것.** SIGPIPE로 스크립트가 중단되어
일부만 발급되고 그 비밀번호는 유실된다 (실제로 겪음). 파일로 리다이렉트한 뒤 열어볼 것.

### Windows로 내려받기

```
scp -P <SSH포트> mhchoi@<서버-내부-IP>:/home/mhchoi/repman/docs/private/<파일명> D:\경로\
```

한글 파일명은 Windows scp에서 깨지므로 **ASCII 파일명**으로 저장할 것.
Excel에서 한글이 깨지면 인코딩 문제다 — `--bom`으로 다시 뽑거나 CP949로 변환:
`iconv -f utf-8 -t cp949 in.csv > out.csv`

---

## 0. 사전 조건

- [ ] `main` 최신 (`git pull`)
- [ ] 로컬 검증: `npm test` **전부** 통과, `npx tsc --noEmit -p .` 통과
- [ ] **재배포면 §2b부터** — §1·§2는 첫 설치 한 번뿐이다

## 1. 호스트 준비 (1회, sudo 필요)

```bash
sudo mkdir -p /data/worklog/db
sudo chown -R mhchoi:mhchoi /data/worklog       # 스키마·시드는 mhchoi가 만든다 (§2)
mkdir -p /mnt/backup/worklog                     # NFS 쓰기 확인
touch /mnt/backup/worklog/.probe && rm /mnt/backup/worklog/.probe
```

컨테이너는 uid 10001(app)로 돈다. 바인드 볼륨 권한은 **`10001:mhchoi` + 그룹 쓰기 + 디렉터리 setgid** 다 —
컨테이너가 주인이고, 호스트의 mhchoi(백업 `backup.sh`·`prisma db push`·`issue-passwords.ts`)는 **그룹으로** 읽고 쓴다.
setgid라 컨테이너가 새로 만드는 파일·디렉터리도 그룹이 mhchoi로 따라온다. (§2 끝에서 실행)

```bash
sudo chown -R 10001:mhchoi /data/worklog
sudo chmod -R g+rwX,o-rwx /data/worklog
sudo find /data/worklog -type d -exec chmod g+s {} +
```

⚠ **`chown -R 10001:10001`은 쓰지 않는다** — mhchoi는 그룹 10001이 아니어서 `/data/worklog`에 들어가지 못하고,
03:00 백업이 매일 Permission denied로 조용히 실패한다 (OPS-15).

## 2. 스키마 + 시드 (첫 설치, 호스트에서, 컨테이너 기동 전) ⚠ 순서 중요

컨테이너는 스키마를 만들지 않는다 — DB가 비어 있으면 fail fast로 죽는다 (entrypoint).

```bash
cd ~/repman
# ① mhchoi 소유로 만들고 (chown을 먼저 하면 시드가 못 쓴다)
sudo chown -R mhchoi:mhchoi /data/worklog

# ② 스키마 → ③ 시드
DATABASE_URL=file:/data/worklog/db/worklog.db npx prisma db push --skip-generate
DATABASE_URL=file:/data/worklog/db/worklog.db \
STORAGE_ROOT=/data/worklog \
SEED_TEMPLATE=1 npx tsx prisma/seed.ts
# 기대 출력: 부서 30 · 사용자 337 · 파일럿 양식 v1 등록

# ④ 컨테이너 uid로 넘긴다 — §1의 세 줄 (10001:mhchoi · 그룹 쓰기 · setgid)
sudo chown -R 10001:mhchoi /data/worklog
sudo chmod -R g+rwX,o-rwx /data/worklog
sudo find /data/worklog -type d -exec chmod g+s {} +
```

**재배포는 이 절차가 아니다 → §2b.** 예전에는 「스키마 변경이 있는 재배포 때도 ①→②→④」였는데, 그러면 ①과 ④
사이에 돌고 있는 컨테이너가 DB에 쓰지 못하고, ④가 그룹까지 바꾸면 백업이 멈춘다.

## 2b. 재배포 (매번) — OPS-15

순서와 이유는 [spec 09 OPS-15](spec/09-deployment-ops.md). **chown 하지 않는다** — mhchoi는 그룹 권한으로 이미 쓸 수 있다.

**빌드·기동은 `bash scripts/deploy.sh`로만 한다** ([OPS-43](spec/09-deployment-ops.md)). `sudo` 없이 돌린다 — docker만 안에서 sudo로 부른다.
스크립트가 빌드 직전에 금지 시간대(2b-0)·디스크(2b-1)를 다시 보고, 롤백 태그(2b-2)를 붙이고, 기동 뒤 health를 기다린 다음
**우리 빌드 찌꺼기만**(표식 `org.tincase.app=repman`) 치운다. 손으로 할 것은 스냅샷(2b-2)과 코드·스키마(2b-3)다 —
`db push`보다 스냅샷이 먼저여야 해서 스크립트에 넣지 않았다.

| 명령 | 하는 일 |
|---|---|
| `bash scripts/deploy.sh prod` | 운영 — main에서만 · 금지 시간대면 멈춤 · 디스크 5G 미만이면 멈춤 · `repman:rollback` 태그 · 빌드 · 기동 · health · 청소 |
| `bash scripts/deploy.sh prod --no-build` | 빌드 없이 지금 `repman:latest`로 다시 띄운다(`--force-recreate`) — 환경변수 변경·롤백. 이것도 main에서만 — 이 체크아웃의 compose 설정이 운영에 들어간다 |
| `bash scripts/deploy.sh test` | 테스트 서버(11112) — 금지 시간대 없음. `TINCASE_TEST_MODE`가 있으면 넘긴다 |
| `bash scripts/deploy.sh prune` | 빌드 없이 청소만 — 손으로 빌드한 뒤 · 디스크 경보 때 |
| `--ignore-window` | 운영 금지 시간대를 넘는다 — 긴급 수정·롤백·병합 일시정지(OPS-16a) 때만 |

### 2b-0. 금지 시간대인가 (OPS-16)

**그 주 마감 전날 11:30 ~ 마감 +2시간 30분에는 하지 않는다** (기본값: 수 11:30 ~ 목 16:30).
연휴 주는 총괄이 마감을 당긴다(WS-19) — **이번 주 마감부터 본다**:

```bash
sudo docker exec repman sqlite3 /data/db/worklog.db \
  "SELECT isoKey, label, deadlineDowOverride, deadlineTimeOverride, deadlineNote FROM WeekSlot ORDER BY opensAt DESC LIMIT 2;
   SELECT deadlineDow, deadlineTime, COUNT(*) FROM Division WHERE isActive=1 GROUP BY 1,2;"
# 위 두 줄: 최근 주차의 예외 (총괄이 다음 주를 미리 정했으면 다음 주가 맨 위다 — isoKey로 이번 주를 고른다. 칸이 비면 예외 없음)
# 마지막 줄: 켜진 부서의 마감 (요일 1=월 … 4=목 … 7=일)
# 예외가 있으면 그것이, 없으면 부서 값이 마감이다. 가장 이른 마감 기준으로 금지 시간대를 잡는다
```

`deploy.sh prod`도 빌드 직전에 같은 표로 이번 주·다음 주를 세어 금지 시간대면 멈춘다. 그래도 여기서 먼저 보는 이유:
스냅샷·`db push`(2b-2·2b-3)도 금지 시간대에 하지 않기 위해서다.

### 2b-1. 디스크 (OPS-19 · OPS-42)

루트 여유가 **5G 이상**이어야 빌드한다. 2G대에서 빌드하면 `npm ci`·이미지 레이어를 쓰다 ENOSPC로 죽는다.
`deploy.sh`가 빌드 직전에 다시 재고, 모자라면 우리 찌꺼기를 먼저 치운 뒤에도 모자라면 빌드하지 않고 할 일을 출력한다.

```bash
df -h / | tail -1
bash scripts/deploy.sh prune        # 우리 빌드 찌꺼기만 (표식 org.tincase.app=repman) — 태그 붙은 이미지·남의 이미지는 그대로
npm cache clean --force             # mhchoi의 npm 캐시 (수 G). 다음에 다시 받을 뿐이다
pip cache purge                     # 〃 pip
df -h / | tail -1                   # 아직 5G 미만이면 멈추고: sudo du -sh /var/lib/containerd (OPS-42)
```

**필터 없는 `docker image prune`, `builder prune`, `system prune`은 쓰지 않는다** — 공용 서버라 남의 태그 없는 이미지(그 사람의
빌드 캐시일 수 있다)·멈춘 컨테이너·볼륨까지 지운다. 우리 것은 표식으로 가려 우리가 치운다 (OPS-43).

### 2b-2. DB 스냅샷 · 롤백 태그

```bash
TS=$(date +%Y%m%d-%H%M)
# 컨테이너 안에서 .backup — cp 금지(OPS-07). tmp/는 기동 때 지워지므로 db/에 둔다.
# backup.sh db를 손으로 돌리지 않는다 — 그날 야간본을 같은 이름으로 덮는다
sudo docker exec repman sqlite3 /data/db/worklog.db ".backup '/data/db/worklog.db.predeploy-$TS'"
ls -l /data/worklog/db/

git -C ~/repman log -1 --oneline    # 지금 돌고 있는 커밋 — 적어 둔다
```

롤백 태그(`repman:latest` → `repman:rollback`)는 **`deploy.sh prod`가 빌드 직전에 붙인다** — 손으로 하지 않는다.
빌드가 `repman:latest`를 덮으면 옛 이미지는 태그 없는 찌꺼기가 되어 배포 끝 청소에 지워지는데, 태그가 붙잡고 있으면 닿지 않는다.

### 2b-3. 코드 · 스키마 · 권한

```bash
cd ~/repman && git pull
DATABASE_URL=file:/data/worklog/db/worklog.db npx prisma db push --skip-generate
#   「already in sync」면 바뀐 것 없음. 추가만인 변경은 프롬프트 없이 끝나고, 돌고 있는 옛 앱도 그대로 동작한다.
#   ⚠ 데이터 손실 경고·확인을 물으면 **멈춘다** — --accept-data-loss를 붙이지 않는다

stat -c '%u:%G %A %n' /data/worklog /data/worklog/db /data/worklog/db/worklog.db
#   10001:mhchoi drwxrws--- /data/worklog
#   10001:mhchoi drwxrws--- /data/worklog/db
#   10001:mhchoi -rw-rw---- /data/worklog/db/worklog.db
#   다르면 §1의 세 줄로 되돌린다 — 이대로 두면 백업이 조용히 멈춘다
```

### 2b-4. 빌드 · 기동 · 확인

```bash
cd ~/repman && bash scripts/deploy.sh prod
#   끝에 health 본문이 나온다 — ok:true · checks 전부 ok · warnings 비어 있음 (있으면 읽는다 — 대개 루트 디스크, OPS-19)
#   checks.template만 fail이면 배포 탓이 아니다 — 양식 파일이 빠진 켠 부서가 있다(OPS-41). 롤백하지 말고 /ops의 「파일 없음」을 본다
#   그 사이: 금지 시간대 확인 → 디스크 → 롤백 태그 → 빌드 → 기동 → health(최대 120초) → 찌꺼기 청소 → df 전·후
```

멈추는 경우와 할 일 — 스크립트가 같은 말을 출력한다:

| 출력 | 뜻 · 할 일 |
|---|---|
| `운영은 main에서만 돌린다` | 다른 브랜치를 운영 이미지로 구우면 다음 재기동이 조용히 그것으로 뜬다(`--no-build`면 그 브랜치의 compose 설정이 들어간다). `git switch main` |
| `git으로 브랜치를 읽지 못했다` | 대개 `sudo bash …`로 돌린 것 — root에게 git이 답하지 않는다. sudo 없이 다시 |
| `배포 금지 시간대다` | 마감 뒤로 미룬다. 꼭 해야 하면 `--ignore-window` |
| `마감을 DB에서 읽지 못했다` | 판정을 못 하면 막는다. 2b-0을 손으로 보고 `--ignore-window` |
| `… 미만이라 빌드하지 않는다` | 우리 찌꺼기는 이미 치웠다. 출력된 순서대로 비운다. 빌드 없이 다시 띄우기는 `--no-build`로 된다 |
| `빌드 실패` · `기동 실패` | 돌던 컨테이너는 그대로다. 찌꺼기는 `bash scripts/deploy.sh prune` |
| `health가 … ok:true가 아니다` | 본문의 checks를 읽고, 배포 탓이면 아래 롤백 |
| `다른 deploy.sh가 돌고 있다` | 겹치면 이쪽 청소가 저쪽 빌드의 스테이지 이미지를 지울 수 있다. 끝난 뒤 다시 |

### 2b-롤백 — 재빌드하지 않는다 (OPS-17)

```bash
sudo docker tag repman:rollback repman:latest
bash scripts/deploy.sh prod --no-build     # 지금 태그로 다시 띄우고 health까지 — 롤백 태그는 옮기지 않는다
#   금지 시간대 안이면 --ignore-window를 붙인다 — 롤백은 대개 급하다
```

**DB는 보통 되돌리지 않는다.** 스키마가 「추가만」이면 옛 앱은 새 열을 모르고 지나간다. 데이터가 망가졌을 때만
스냅샷으로 되돌린다 — 배포 뒤에 들어온 제출·수정도 함께 사라진다:

```bash
sudo docker compose stop app
cp /data/worklog/db/worklog.db.predeploy-$TS /data/worklog/db/worklog.db   # 있는 파일에 덮는다 — 주인·권한이 그대로 남는다
ls /data/worklog/db/                     # worklog.db-journal · -wal · -shm 이 남아 있으면 지운다
sudo docker compose up -d
```

스냅샷(`worklog.db.predeploy-*`)은 다음 배포가 무사히 끝나면 지운다.

## 2c. 복원 — NFS 백업에서 (OPS-08 · OPS-09)

디스크가 망가졌거나 데이터를 날짜째로 되돌려야 할 때. **DB와 파일은 같은 날짜**를 쓴다.

```bash
sudo docker compose stop app
D=2026-10-08                                                  # 되돌릴 날짜
gunzip -c /mnt/backup/worklog/db/worklog-$D.db.gz > /data/worklog/db/worklog.db
tar xzf /mnt/backup/worklog/files/divisions-$D.tar.gz -C /data/worklog
# └ 이름은 divisions-지만 안에 divisions/와 (있으면) org/가 같이 들어 있다 — tar tzf로 확인할 수 있다
sudo chown -R 10001:mhchoi /data/worklog && sudo chmod -R g+rwX,o-rwx /data/worklog \
  && sudo find /data/worklog -type d -exec chmod g+s {} +     # §1의 세 줄
sudo docker compose up -d && sleep 15 && curl -fsS http://127.0.0.1:11111/api/health | python3 -m json.tool
```

- 파일 묶음은 **2026-10-08부터 매일**이다. 그 전 날짜는 일요일 것만 있고, `org/`(3단계 취합)는 들어 있지 않다.
- 파일 묶음(03:30)이 DB(03:00)보다 30분 늦다. 그 사이에 낸 파일은 행 없이 남는다 — 화면에 안 보일 뿐 해가 없다.
- 복원한 뒤 health의 `checks.template`이 fail이면 양식 파일이 빠진 부서가 있다는 뜻이다 (OPS-41).

## 3. Cloudflare 대시보드 (AU-11)

**① Public Hostname** — Zero Trust → Networks → Tunnels → (기존 터널) → Public Hostname 추가

| 항목 | 값 |
|---|---|
| Subdomain | `worklog` · Domain `excusa.uk` |
| Service | `HTTP` → `localhost:11111` |

**② Access 애플리케이션** — Zero Trust → Access → Applications → Self-hosted

| 항목 | 값 |
|---|---|
| Application domain | `worklog.excusa.uk` |
| Session Duration | 24h |
| Policy | **Allow · Emails = 운영자(Sean) 1명** — v1.1 개정 ([ADR-0006](adr/0006-internal-password-auth.md)). 나머지 직원은 사내망 사용 |

⚠ **①만 하고 ②를 빼먹으면 안 된다** — 앱의 JWT 검증(AU-02)이 fail-closed로 막아주지만, 설정도 제대로.

**③ AUD 태그 복사** — Access 앱 → Overview → Application Audience(AUD) Tag

```bash
cd ~/repman
echo 'CF_ACCESS_AUD=<복사한 AUD>' > .env.production
chmod 600 .env.production
```

## 4. 기동

```bash
cd ~/repman
# docker는 sudo 필요 (mhchoi가 docker 그룹 아님) — 스크립트가 안에서 sudo로 부른다. compose 플러그인은
# /usr/local/lib/docker/cli-plugins에 설치되어 있음 (2026-08-13)
bash scripts/deploy.sh prod      # 빌드 · 기동 · health · 빌드 찌꺼기 청소 (OPS-43)
# 첫 설치에는 돌던 컨테이너도 repman:latest도 없다 — 금지 시간대는 「읽지 못함」으로 알리고 지나가고, 롤백 태그는 건너뛴다
# 기대: 끝에 ok:true, checks 전부 ok  (이미 8/13에 스모크 컨테이너로 검증됨)
```

## 5. 검증 (AU-12) ⚠

```bash
# 1) 바인딩 확인 — v1.1부터 0.0.0.0이 정상 (사내망 접속 허용, ADR-0006)
ss -tlnp | grep 11111

# 2) 미인증 접근 → /login 리다이렉트여야 정상 (200으로 내용이 보이면 즉시 중단)
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://<서버IP>:11111/

# 3) 루트 디스크 보호 (OPS-19) — 실측: 이 서버는 97~99%를 오간다
bash scripts/deploy.sh prune     # 우리 빌드 찌꺼기만 — 앞뒤 df를 출력한다 (OPS-43)
```

브라우저:

- [ ] 시크릿 창 `https://worklog.excusa.uk` → **Access 로그인 화면**이 뜬다
- [ ] KEI 계정 로그인 → `/AI_and_Public_Relations_Division`으로 리다이렉트
- [ ] `worklog.excusa.uk/aiprd` → 정식 주소로 리다이렉트
- [ ] 비 KEI 계정(개인 gmail) → Access 차단
- [ ] 타 부서 KEI 직원(가능하면) → "준비 중" 화면 (AU-04b)

## 6. 실전 리허설 (S1-12)

- [ ] 본인 계정으로 양식 다운로드 → 파일명에 주차 포함 확인
- [ ] hwp 업로드 → v1 → 재업로드 → v2 · `이전 버전과 동일` 안내
- [ ] `/manage` 현황 → 본인 제출 표시 · zip 다운로드 → 압축 해제 확인
- [ ] `.hwpx` 업로드 시도 → 거부 문구에 변환 방법 표시
- [ ] `docker compose restart` 후 health ok (재기동 내성)

## 7. 백업 크론 (OPS-08)

```bash
chmod +x ~/repman/scripts/backup.sh
crontab -e
# 이 두 줄 — files도 매일이다 (2026-10-08 개정: 일요일 `0` → 매일 `*`. 이미 크론이 있으면 그 한 글자만 바꾼다)
# 0 3 * * *   /home/mhchoi/repman/scripts/backup.sh db    >> /home/mhchoi/kei-backups/worklog-backup.log 2>&1
# 30 3 * * *  /home/mhchoi/repman/scripts/backup.sh files >> /home/mhchoi/kei-backups/worklog-backup.log 2>&1
# 수동 1회 실행으로 확인 (db는 그날 야간본을 같은 이름으로 덮는다 — 첫 설치 때만):
~/repman/scripts/backup.sh db && ~/repman/scripts/backup.sh verify
```

**NFS가 fstab에 있어야 한다.** `backup.sh`는 `/mnt/backup`이 마운트 지점이 아니면 `[backup] FATAL`을 찍고 멈춘다 —
재부팅 뒤 마운트가 빠지면 루트 디스크에 쓰게 되기 때문이다. 지금 마운트는 손으로 한 것이라 운영자가 한 번 넣는다
(sudo, 정확한 줄은 [spec 09 OPS-08](spec/09-deployment-ops.md)):

```bash
findmnt -no SOURCE /mnt/backup        # 이 값을 아래 <NFS-내부-IP>:<경로> 자리에
echo '<NFS-내부-IP>:<경로>  /mnt/backup  nfs4  defaults,_netdev,nofail,hard,timeo=600  0  0' | sudo tee -a /etc/fstab
sudo systemctl daemon-reload && sudo mount -a && findmnt /mnt/backup
```

## 8. 월요일 아침 안내문 (붙여넣기용 초안)

> [주간업무 제출 안내]
> 이번 주부터 주간 업무일지를 웹으로 제출합니다. **사내망에서만 접속됩니다.**
> ① http://<서버-내부-IP>:11111 접속
> ② KEI 이메일 + 개별 전달드린 임시 비밀번호로 로그인 → 비밀번호 변경
> ③ [빈 양식 다운로드] → 작성 → 끌어다 놓기로 제출
> 마감: 목요일 14:00 (이후 자동 잠김)
> ※ 한 번 로그인하면 한 달간 유지됩니다.
> ※ 이번 주는 기존 이메일 제출도 병행합니다. 문제 있으면 저에게 바로 연락 주세요.

비밀번호는 **개인별로 따로** 전달하세요 (단체 메시지 금지).

## 장애 시 (OPS-18)

시스템이 죽고 마감이 임박하면 **그 주는 이메일로 되돌린다**:
`/data/worklog/divisions/AI_and_Public_Relations_Division/template/active.hwp`를 메일로 배포.

## 배포 금지 시간대 (OPS-16)

**그 주 마감 전날 11:30 ~ 마감 +2시간 30분 동안 재배포 금지.** 기본값(목 14:00 마감)이면 **수 11:30 ~ 목 16:30**.
전날 11:45·당일 09:00·13:00·13:50 알림, 마감 직전 제출, 14:01 병합, 14:10·14:30 안내, 15:00 대외 마감,
3단계를 켰으면 16:00 본부 기한까지가 이 안에 있다. 배포는 **목 16:30 이후 ~ 다음 주 화요일**.
**연휴 주는 마감이 당겨진다** — 배포 전에 §2b-0으로 이번 주 마감부터 본다. `deploy.sh prod`도 빌드 전에 같은 계산으로 막는다
(넘는 길은 `--ignore-window` 하나).


---

## 9. 병합 보조 모델 (HM-24)

병합은 모델 **없이도** 완결된다 (`MERGE_MODEL`이 비면 결정론 병합만). 아래는 켤 때의 절차다.

### 9.1 Tincase 전용 ollama

이 서버에는 ollama 인스턴스가 여럿 있고 **대부분 다른 사람 것**이다.
남의 인스턴스에 운영을 의존하면 그쪽이 내리는 순간 목요일 마감에 조용히 실패한다.
그래서 **전용 인스턴스를 따로 띄운다.** 모델 파일은 공유하므로 추가 다운로드는 없다.

```bash
OLLAMA_HOST=0.0.0.0:11437 \
OLLAMA_MODELS=/home/mhchoi/.ollama-test/models \
OLLAMA_CONTEXT_LENGTH=8192 \
  pm2 start ~/ollama-latest/bin/ollama --name tincase-ollama -- serve
pm2 save
```

`0.0.0.0` 바인딩이지만 **방화벽이 도커 대역만 통과시킨다** (아래). 기존 인스턴스는 건드리지 않는다.

### 9.2 방화벽

컨테이너는 compose 네트워크(`172.18.x`)에 있고 ufw는 `INPUT DROP`이라 그냥은 못 닿는다.
도커가 쓰는 사설 대역 전체를 허용한다 — 서브넷이 바뀌어도 살아남는다.

```bash
sudo ufw allow from 172.16.0.0/12 to any port 11437 proto tcp comment 'Tincase: docker -> ollama'
```

사내망(192.168.x)에는 규칙이 없으므로 여전히 차단된다.

### 9.3 컨테이너 설정

`docker-compose.yml`에 이미 들어 있다.

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"   # 서브넷이 바뀌어도 호스트를 찾는다
environment:
  MERGE_MODEL: hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M
  MERGE_MODEL_URL: http://host.docker.internal:11437
```

### 9.4 확인

```bash
sudo docker exec repman node -e "fetch(process.env.MERGE_MODEL_URL+'/api/tags').then(r=>r.json()).then(d=>console.log(d.models.length))"
sudo docker logs repman 2>&1 | grep '\[merge\]'      # 스케줄러 등록 확인
```

### 9.5 되돌리기

```bash
pm2 delete tincase-ollama && pm2 save
sudo ufw delete allow from 172.16.0.0/12 to any port 11437 proto tcp
# docker-compose.yml에서 MERGE_MODEL 을 비우고 재기동 → 결정론 병합으로 계속 동작한다
```
