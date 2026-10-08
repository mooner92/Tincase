# v2 운영 전환 — 2026-10-12(월) 아침 순서

> 대상: 운영자 · 운영 서버(체크아웃 `~/repman`, 컨테이너 `repman`, 11111) · 10/12(월) 07:00~09:30
> 근거: [DEPLOY.md](DEPLOY.md) §2b(재배포) · §2b-5(v2 전환 — 더해지는 표·열) · §2b-롤백. 여기서는 그 절을 **이날 어떤 순서로, 무엇을 더해** 돌리는지만 적는다.
> 함께: [NOTIFICATIONS-v2.md](NOTIFICATIONS-v2.md)(나갈 쪽지 전부) · [ANNOUNCE-v2.md](ANNOUNCE-v2.md)(부서 안내문) · [REHEARSAL.md](REHEARSAL.md)(한 주 리허설 결과)
> ⚠ 공개 저장소다. 주소·이메일·사람은 자리표시자로 둔다 — `<서버-내부-IP>` · `<운영자-이메일>` · `<총괄-이메일>` · `<운영자 연락처>` · `<부서-slug>`.
> 누가 담당·부서장·총괄인지는 `docs/private/`에 둔다. DB는 운영자가 손으로 바꾼다(이 문서의 SQL을 운영자가 붙여 넣는다).

이 판(main v1.39.0 → **v2.0.0**): 제출은 웹 작성만 · 부서원 홈 하나 · 기능 정리 · 3단계 자동 진행(**부서장·본부장의 승인 = 위로 넘김**) · 병합 줄 ·
모델 상주 · 사용 안내 v2 + 첫 로그인 둘러보기 · 빌드 찌꺼기를 치우는 배포 스크립트 · 기동 스키마 검사. 바뀐 것 전부는 CHANGELOG 「미출시」 절들.

## 0. 한눈에

| 시각 | 단계 | 여기서 멈추면 |
|---|---|---|
| 07:00 | ① 준비 · 금지 시간대(OPS-16) · 디스크 · 야간 백업 · 배포 전 기록 · **v1 이미지 고정 태그** | 아무 일 없음 — 옛 앱이 돈다 |
| 07:10 | ② 작업 공지 | 〃 |
| 07:15 | ③ `main`에 합치고 `v2.0.0` 태그 | 〃 |
| 07:20 | ④ DB 스냅샷 (컨테이너 안) | 〃 |
| 07:22 | ⑤-0 스냅샷 **사본**에 `prisma db push` — 실제 데이터로 먼저 (3초) | 〃 |
| 07:25 | ⑤ `prisma db push` (운영 DB) | 〃 — 더한 표·열은 옛 앱이 모르고 지나간다 |
| 07:30 | ⑥ `bash scripts/deploy.sh prod` (빌드 5~10분) | **여기부터 새 앱** — 문제면 §3 |
| 07:45 | ⑦ health · 기동 로그 FATAL | §3 |
| 07:50 | ⑧ 첫 스케줄러 틱 · 모델 데우기 | |
| 08:00 | ⑨ 설정 — 부서 · 사람 · 알림 스위치 · 섹션 · 3단계 | 3단계만 안 되면 끈 채로 간다(9-9) |
| 08:40 | ⑩ 스모크 (운영자 계정) | §3 |
| 08:55 | ⑪ Go/No-go(§4) → 안내문 · 설정 링크 | |
| 09:00~ | ⑫ 지켜보기 · 이번 주 알림 시각 | |

시간이 밀려도 ⑥ 전에는 사용자에게 아무 일도 없다. 09:00을 넘기면 ⑥을 점심(12:00~13:00)으로 미뤄도 된다 — 금지 시간대는 수요일 11:30부터다.

## 1. 전날까지 (금~일) — 월요일 아침에 정하지 않는다

- [ ] **릴리스 커밋** = `feat/org-rollup`의 끝. 테스트 서버(11112)·리허설에서 본 코드와 같은지 확인하고 해시를 적어 둔다(③에서 맞춘다).
      개발 쪽 게이트(`npm test` · `tsc` · `check-secrets.sh`)는 **종료 코드로** 판정한다(`| tail` 금지).
      `npm test`는 env가 있어야 한다 — 없으면 아홉 파일이 `[env] 환경변수 검증 실패`로 떨어진다(코드 탓이 아니다):
      `STORAGE_ROOT=$(mktemp -d) CF_ACCESS_TEAM=t DATABASE_URL=file:$(mktemp -u)/x.db npm test; echo $?` (2026-10-09 검토 끝: 59파일 1001개 통과).
- [ ] **11112를 원래대로** — 리허설이 끝나면 리허설 덧붙임(`TINCASE_REHEARSAL=on`) 없이 다시 올려 스케줄러가 꺼진 상태로. 11112와 운영은
      **같은 모델 서버(:11437)**를 쓴다 — 목요일 마감에 시험 서버가 자동 병합을 돌리면 운영 병합과 모델을 다툰다.
      `TINCASE_TEST_MODE=demo bash scripts/deploy.sh test --no-build` (시연 모드로 떠 있으니 변수가 있어야 한다 — 없으면 deploy.sh가 멈춘다) →
      `sudo docker exec repman-test printenv MERGE_SCHEDULER` 가 `off`.
- [ ] **수신 허용 목록** — 새 부서 사람이 쪽지를 받으려면 `.env.production`의 `MESSENGER_ALLOWLIST`가 `*`이거나 그 사번을 담아야 한다.
      `MESSENGER_LINK_BASE`가 없으면 설정 링크가 나가지 않는다(409). 바꿀 거면 **⑥ 전에** — 배포가 컨테이너를 새로 만들며 읽는다. 파일은 그 자리에서 고치고 복사하지 않는다.
- [ ] **사람 명단**(비공개): 12개 쓰는 부서의 담당자(lead)·부서장(head), 기획경영본부의 본부 담당·본부장, 총괄 계정 — ⑨-4에서 넣는다.
- [ ] **문구 검토** — [NOTIFICATIONS-v2.md](NOTIFICATIONS-v2.md) §5. [ANNOUNCE-v2.md](ANNOUNCE-v2.md)의 자리표시자를 채운다.
- [ ] §5의 질문에 답.
- [ ] (권장 · 일요일) **실제 데이터로 미리 한 번** — 이행 리허설은 지어낸 사람의 DB로만 돌았다(운영 사본은 개인정보라 에이전트가 복사하지 않았다).
      월요일의 ⑤-0(사본에 push)과 9-3b(파일 점검)를 일요일에 먼저 돌려 두면 월요일 아침에 놀랄 일이 줄어든다. **브랜치 체크아웃 `~/repman-rollup`에서** —
      일요일의 `~/repman`은 아직 v1 스키마라 거기서 push하면 아무것도 바뀌지 않는다. 10/07 13:12의 `.bak-20261007-pre-rollup`은 v1.39.0 전
      (main이 `mergeSort`·`MergeReview`를 더하기 전)이라 월요일의 출발점이 아니다 — 쓰지 않는다. 운영 DB·파일은 읽기만 한다.

```bash
D=~/sunday-check && mkdir -m 700 -p $D && R=$D/rehearse.db
sudo docker exec repman sqlite3 /data/db/worklog.db ".backup '/data/db/worklog.db.sunday-check'"   # 살아 있는 DB는 컨테이너 안에서 .backup으로만 (OPS-07)
cp /data/worklog/db/worklog.db.sunday-check "$R" && rm /data/worklog/db/worklog.db.sunday-check
c() { for t in $(sqlite3 "$R" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY 1"); do
        echo "$t $(sqlite3 "$R" "SELECT COUNT(*) FROM \"$t\"")"; done; }
c > $D/before.txt
cd ~/repman-rollup && DATABASE_URL=file:$R npx prisma db push --skip-generate      # 확인 질문 없이 「in sync」 (물으면 N — 월요일 No-go감)
c > $D/after.txt; sqlite3 "$R" "PRAGMA integrity_check; PRAGMA foreign_key_check;"; diff $D/before.txt $D/after.txt   # ok · `>` 일곱 줄(새 표 0)뿐
cd ~/repman-rollup && DATABASE_URL=file:/data/worklog/db/worklog.db STORAGE_ROOT=/data/worklog npx tsx scripts/check-files.ts --all-templates; echo "exit=$?"
#   --all-templates: 아직 꺼진 12개 부서의 양식도 웹 작성 길로 채워 본다(그 줄은 숫자만 — 종료 코드에 넣지 않는다). 실패가 있으면 월요일 9-2 전에 그 부서 양식을 다시 받는다
rm -rf $D
```

## 2. 월요일 순서

### ① 07:00 준비

```bash
TS=$(date +%Y%m%d-%H%M); mkdir -m 700 ~/deploy-$TS && echo "$TS" > ~/deploy-current
#   새 터미널에서는: TS=$(cat ~/deploy-current)
q() { sudo docker exec repman sqlite3 -header -column /data/db/worklog.db "$@"; }   # 새 터미널마다 다시 정의한다
cd ~/repman
```

- **금지 시간대** — [DEPLOY.md](DEPLOY.md) §2b-0의 쿼리 그대로. W42가 기본(목 14:00)이면 금지는 **10/14(수) 11:30 ~ 10/15(목) 16:30** — 월요일은 밖이다.
  연휴 예외가 있으면 그 값으로 다시 센다. ⑥의 `deploy.sh`도 이번 주·다음 주를 다시 본다.
- **디스크** — §2b-1. 루트 여유 5G 이상.
- **야간 백업** — 오늘 03:00 db · 03:30 files 둘 다 성공:

```bash
tail -4 ~/kei-backups/worklog-backup.log
df -h / | tail -1
```

- **배포 전 기록** (사람 이름 없음 — 수만):

```bash
q "SELECT COUNT(*) AS 부서, SUM(isActive) AS 켜짐, SUM(notifyEnabled) AS 알림, SUM(boardStatus='confirmed') AS 집계 FROM Division;
   SELECT COUNT(*) AS 사람, SUM(isActive) AS 활성 FROM User;
   SELECT (SELECT COUNT(*) FROM Submission) AS 제출, (SELECT COUNT(*) FROM MergeRun) AS 병합, (SELECT COUNT(*) FROM NotifyLog) AS 알림기록;" \
  | tee ~/deploy-$TS/before.txt
sudo docker logs repman 2>&1 | grep -E '\[알림\] (켜짐|꺼짐)' | tail -1 > ~/deploy-$TS/notify-before.txt   # 수신 허용 · 발송 부서
sudo docker image inspect repman:latest --format '{{.Id}} {{.Created}}' > ~/deploy-$TS/image-before.txt
```

- **v1 이미지를 고정 태그로 붙잡는다** — 롤백(§3)의 근거다. ⑥의 `deploy.sh`도 `repman:rollback`을 붙이지만, ⑥을 **빌드째 다시** 돌리면
  (첫 번째가 빌드를 마친 뒤 health에서 멈췄을 때 등) 그 태그가 v2로 옮겨지고 v1 이미지는 태그 없는 찌꺼기가 되어 그 실행의 청소에 지워진다.
  `repman:v1.39.0`은 deploy.sh가 옮기지도 지우지도 않는다(청소는 태그 없는 것만 — OPS-43). 디스크는 더 들지 않는다(같은 이미지).

```bash
RUNNING=$(sudo docker inspect repman --format '{{.Image}}'); LATEST=$(sudo docker image inspect repman:latest --format '{{.Id}}')
[ "$RUNNING" = "$LATEST" ] && echo IMAGE-SAME || echo "다름 — 멈춘다"   # 다르면 누가 빌드만 하고 띄우지 않았다: ⑥의 롤백 태그가 지금 도는 v1이 아니다
sudo docker tag "$RUNNING" repman:v1.39.0 && sudo docker image inspect repman:v1.39.0 --format '{{.Id}}' | tee ~/deploy-$TS/image-v1.txt
```

### ② 07:10 작업 공지

운영자가 직접 — 지금 쓰고 있는 파일럿 부서와 기획조정실 담당에게(메신저):

> [Tincase] 오늘(10/12) 07:30~08:30 새 판으로 바꿉니다. 그 사이 몇 분 접속이 끊길 수 있습니다. 끝나면 다시 안내드리겠습니다.

새 부서 전체 안내는 ⑪에서 [ANNOUNCE-v2.md](ANNOUNCE-v2.md)로.

### ③ 07:15 `main`에 합치고 `v2.0.0` 태그

**왜 main인가.** `deploy.sh prod`는 체크아웃이 `main`이 아니면 멈춘다(OPS-43g) — 다른 브랜치를 구우면 `repman:latest`가 그 이미지가 되어
다음 재기동이 조용히 그것으로 뜨고, `--no-build`도 그 체크아웃의 `docker-compose.yml`로 운영 컨테이너를 다시 만든다. 운영 체크아웃 `~/repman`은
`main`이고 DEPLOY·롤백이 「운영 = main」을 전제한다. 태그는 「지금 무엇이 돌고 있나」의 답이다.

**앞으로 감기가 아니라 합치기다.** `main`에는 `711fb76`(deploy.sh의 sudo 확인)이 있고, 브랜치에는 같은 변경이 `4143baf`로 따로 들어 있다.
2026-10-09에 `git merge-tree`로 충돌이 없음을 봤다. `~/repman-rollup`은 같은 저장소의 작업 트리라 fetch 없이 `feat/org-rollup`이 보인다.

```bash
cd ~/repman
git status --porcelain --untracked-files=no                            # 비어 있어야 한다
git rev-parse --short HEAD | tee ~/deploy-$TS/old-commit               # 지금 운영 코드 (711fb76 예상)
git rev-parse --short feat/org-rollup | tee ~/deploy-$TS/release       # 1절에 적은 릴리스 커밋과 같아야 한다 — 다르면 멈춘다
git merge-tree --write-tree --name-only HEAD feat/org-rollup >/dev/null && echo MERGE-CLEAN   # 안 나오면 멈춘다 (아침에 충돌을 풀지 않는다)
git merge --no-ff feat/org-rollup -m "Merge branch 'feat/org-rollup' — v2 운영 전환 (2026-10-12)"
git tag -a v2.0.0 -m "v2.0.0 — 웹 작성만 · 홈 하나 · 3단계 자동 진행 · 병합 줄 · 사용 안내 v2"
git describe --tags --exact-match                                      # v2.0.0
git diff --quiet "$(cat ~/deploy-$TS/old-commit)" HEAD -- package.json package-lock.json && echo DEPS-SAME   # 호스트 npm ci 필요 없음
```

- 추적 안 된 `docs/adr/0011-operator-repair-authority.md`는 그대로 둔다 — 브랜치에 같은 경로가 없다.
- push는 배포에 필요 없다. 할 거면 끝난 뒤 따로(맨 아래 「끝나고」).

### ④ 07:20 DB 스냅샷 — 컨테이너 안에서

[DEPLOY.md](DEPLOY.md) §2b-2 그대로 — `cp` 금지(OPS-07), `backup.sh db`를 손으로 돌리지 않는다(그날 야간본을 같은 이름으로 덮는다).

```bash
sudo docker exec repman sqlite3 /data/db/worklog.db ".backup '/data/db/worklog.db.predeploy-$TS'"
ls -l /data/worklog/db/          # worklog.db.predeploy-$TS 가 worklog.db와 비슷한 크기로 있다
```

`repman:rollback` 태그는 ⑥이 빌드 직전에 붙인다 — 손으로 하지 않는다(롤백은 ①의 고정 태그 `repman:v1.39.0`으로 한다 — §3.1).

### ⑤-0 07:22 스냅샷 **사본**에 먼저 push — 실제 데이터로

이행 리허설(2026-10-09)은 v1.39.0 코드로 만든 **지어낸 사람의 DB**로 돌았다 — push 3초 · 데이터 손실 확인 없음 · 행 수 그대로 · 옛 앱이 새 DB를 읽고 씀.
실제 데이터로는 아직이다. ④의 스냅샷이 바로 월요일의 출발점이니, 그 **사본**에 같은 명령을 먼저 돌린다(3초). 사본은 `~/deploy-$TS`(700)에 두고 끝나면 지운다.
닫힌 스냅샷이라 `cp`해도 된다 — OPS-07이 막는 것은 **살아 있는** DB의 `cp`다.

```bash
R=~/deploy-$TS/rehearse.db
cp /data/worklog/db/worklog.db.predeploy-$TS "$R"      # Permission denied면: sudo docker exec repman chmod g+r /data/db/worklog.db.predeploy-$TS
c() { for t in $(sqlite3 "$R" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY 1"); do
        echo "$t $(sqlite3 "$R" "SELECT COUNT(*) FROM \"$t\"")"; done; }
c > ~/deploy-$TS/rehearse-before.txt
cd ~/repman && DATABASE_URL=file:$R npx prisma db push --skip-generate 2>&1 | tee ~/deploy-$TS/rehearse-push.txt
c > ~/deploy-$TS/rehearse-after.txt
sqlite3 "$R" "PRAGMA integrity_check; PRAGMA foreign_key_check;"                       # ok 한 줄뿐
diff ~/deploy-$TS/rehearse-before.txt ~/deploy-$TS/rehearse-after.txt                 # `>` 일곱 줄(새 표, 모두 0)뿐 · `<` 줄이 없다
rm -f "$R" "$R-wal" "$R-shm" "$R-journal"
```

- 기대: 「Your database is now in sync」 · 데이터 손실 경고·확인 **없음** · `ok` · diff는 `> GuideTourSeen 0` … 일곱 줄. 이 파일들에는 표 이름과 수만 있다.
- 확인을 물으면 N(Ctrl+C) — **No-go**(§4). 사본이라 아무것도 바뀌지 않았다. ⑤를 하지 않고 옛 앱 그대로 둔다.

### ⑤ 07:25 `prisma db push` — 운영 DB

**무엇이 더해지나** — [DEPLOY.md](DEPLOY.md) §2b-5 표: 새 표 7(`ReportSubmission` · `RollupRun` · `OrgRollupSetting` · `OrgSection` · `OrgSectionUpload` ·
`MergeJob` · `GuideTourSeen`) · 새 열 6(`Division.rollupOrder`·`rollupNote`·`rollupPageBreak`·`rollupSelf` · `MergeReview.filePath` · `MergeRun.outputSha`).
**전부 더하기만**이다. `Division`은 기본값 있는 NOT NULL 열 넷 때문에 Prisma가 표를 새로 만들어 옮긴다(행·외래 키 그대로) — 그래서 ④가 먼저다.

```bash
cd ~/repman
DATABASE_URL=file:/data/worklog/db/worklog.db npx prisma db push --skip-generate
```

- 기대: 「Your database is now in sync with your Prisma schema」. 「already in sync」면 체크아웃이 v2가 아니다 — 멈추고 ③을 본다.
- ⛔ **데이터 손실 경고나 확인(y/N)을 물으면 N(또는 Ctrl+C)으로 멈춘다.** 묻는 단계에서는 아직 아무것도 바뀌지 않았다. `--accept-data-loss`를 붙이지 않는다 —
  그럴 변경이 없으니 체크아웃을 의심한다.
- 「database is locked」면 몇 초 뒤 다시(옛 앱이 쓰는 중).

```bash
sudo docker exec repman sqlite3 /data/db/worklog.db ".tables" | tr -s ' ' '\n' \
  | grep -cE '^(ReportSubmission|RollupRun|OrgRollupSetting|OrgSection|OrgSectionUpload|MergeJob|GuideTourSeen)$'   # 7
q "PRAGMA integrity_check; PRAGMA foreign_key_check;"                                                                  # ok (그 뒤 빈 줄)
q "SELECT COUNT(*) AS 부서 FROM Division; SELECT COUNT(*) AS 사람 FROM User; SELECT COUNT(*) AS 제출 FROM Submission;"   # before.txt와 같다
stat -c '%u:%G %A %n' /data/worklog /data/worklog/db /data/worklog/db/worklog.db                                       # §2b-3의 세 줄과 같다
```

옛 앱은 이 시점에도 그대로 돈다.

### ⑥ 07:30 배포

```bash
cd ~/repman && bash scripts/deploy.sh prod 2>&1 | tee ~/deploy-$TS/deploy.txt; echo "exit=${PIPESTATUS[0]}"
```

- `sudo` 없이 돌린다(docker만 안에서 sudo). 하는 일(OPS-43): main 확인 → 금지 시간대 → 디스크 5G → `repman:rollback` 태그 → 빌드 → 기동 →
  health 최대 120초 → **우리 빌드 찌꺼기만** 청소(표식 `org.tincase.app=repman`) → 디스크 전·후.
- 기대: `exit=0`, 끝에 health 본문 `ok:true`. 멈추는 경우와 할 일은 [DEPLOY.md](DEPLOY.md) §2b-4 표 — 이날 가장 그럴듯한 둘:
  - 로그 `[boot] FATAL: DB 스키마가 이 판보다 오래됐습니다` → ⑤를 빠뜨렸다(OPS-48). **롤백하지 않는다** — ⑤ 뒤 `bash scripts/deploy.sh prod --no-build`
  - `checks.template`만 fail → 배포 탓이 아니다(OPS-41). 롤백하지 않고 ⑨-2
- ⚠ **⑥을 다시 돌릴 때는 `--no-build`만.** 첫 실행이 빌드를 마친 뒤(health에서) 멈췄는데 빌드째 다시 돌리면, deploy.sh가 `repman:rollback`을
  **지금의 `repman:latest`(= 방금 구운 v2)**로 옮기고 v1 이미지는 그 실행의 청소에 지워진다. ①의 `repman:v1.39.0`이 있으면 롤백은 그대로 되지만,
  다시 구울 이유가 없다 — 코드를 고친 게 아니면 `bash scripts/deploy.sh prod --no-build`.

### ⑦ 07:45 health · 기동 로그

```bash
curl -sS http://127.0.0.1:11111/api/health | python3 -m json.tool
#   ok:true · checks.db / storage / template = ok · rootDisk ok(또는 warn) · warnings 비어 있음
echo "FATAL 줄: $(sudo docker logs --since 20m repman 2>&1 | grep -c FATAL)개"     # 0
sudo docker logs --since 20m repman 2>&1 | grep -E '^\[boot\]|\[merge\]|\[알림\]'
sudo docker exec repman printenv | grep -E '^(TINCASE_ENV|MESSENGER_SINK|MERGE_SCHEDULER|SESSION_COOKIE_NAME|SUBMIT_HWP_UPLOAD)=' || echo "테스트 값 없음"
```

기동 로그에 있어야 하는 줄:

- `[boot] 4/4 서버 시작 (Division 30개)`
- `[알림] 켜짐 (수신 허용: …) · 발송 부서 n/30개: …` — `notify-before.txt`와 같다(부서 알림은 ⑨-5에서 켠다 · 1절에서 허용 목록을 바꿨으면 그 칸만 다르다)
- `[merge] 자동 병합 스케줄러 등록 (1분 주기)` — 이 줄이 있으면 환경 검사(OPS-46)와 스키마 검사(OPS-48)를 지났다
- `[merge] 모델 데우기 — 기동 · n초 · keep_alive -1` — 몇 초~수십 초 뒤에 찍힌다

`printenv`에서 하나라도 나오면 테스트 compose 값이 섞였다 — No-go(§3.1 뒤 compose 확인). `SUBMIT_HWP_UPLOAD`가 없는 것이 정상이다:
기본값 `on`은 이제 「전사」의 [올리기](Tincase 밖 섹션의 게시판 hwp를 총괄이 넣는 길, RU-60a)만 연다 — 부서원 hwp 제출은 코드째 없다(WA-39).

### ⑧ 07:50 첫 스케줄러 틱 · 모델 데우기

첫 틱은 기동 20초 뒤, 그다음 1분마다다. 월요일 아침에는 할 일이 없어 조용한 것이 정상이다 — 오류 줄이 없고 이번 주 슬롯이 있으면 돈 것이다.

```bash
sleep 60
sudo docker logs --since 5m repman 2>&1 | grep -E 'FATAL|오류|실패' || echo "틱 오류 없음"
q "SELECT isoKey, label FROM WeekSlot WHERE isoKey IN ('2026-W42', '2026-W43') ORDER BY isoKey;"        # 2026-W42가 있다 (W43은 일정 화면을 연 뒤면 있을 수 있다)
curl -s http://127.0.0.1:11437/api/ps | python3 -m json.tool | grep -E '"name"|"expires_at"'           # 모델이 올라와 있고 expires_at이 아주 먼 미래(상주)
```

- `/ops`의 「병합 줄」 카드: 「이번 주 병합 없음」과 모델 문 한 줄.
- 데우기가 실패해도 No-go는 아니다 — 병합은 모델 없이도 결정론으로 끝난다. 목요일 전에 고친다(`pm2 status tincase-ollama` · DEPLOY §9.4).
  목요일 13:50(마감 10분 전)에 한 번 더 데운다 — 로그 `[merge] 모델 데우기 — 기준 …`.

### ⑨ 08:00 설정

순서가 있다: 부서·사람 → 알림 스위치 → 섹션 → **3단계는 맨 끝**(켜는 순간 이번 주를 위에서 아래로 맞춘다 — RU-79).
화면이 있는 것은 화면으로(감사 기록이 남는다). SQL로 바꾼 것은 감사 기록이 없으니 출력을 `~/deploy-$TS/`에 남긴다.

**9-1 취합게시판 값(boardStatus) 3건** — `/ops` 부서 표 → 그 줄 [편집] → 「업무일지」 칸에서 고르고 [완료]. 표는 이 값으로 나뉘어 보인다 — 줄이 안 보이면 표 위 분류를 바꾼다.

| 부서 | 값 | 이유 |
|---|---|---|
| 경영지원실 | 제출함 (집계) | 실제 최종본 13섹션에 「경영지원실」이 있다 |
| 국가지속가능발전연구센터 | 제출함 (집계) | 〃 |
| 기획경영본부 | 안 냄 | 최종본에 본부 명의 블록이 없다 — 산하 실들이 각자 섹션이다 |

고치지 않으면 「전사」 합계·「섹션 밖」 줄·주차 감사 문서가 틀린다(PG-51c). **`scripts/apply-board-history.ts`는 돌리지 않는다** — 목록 밖 부서를 `none`으로 덮어 위 두 곳을 되돌린다.

```bash
q "SELECT nameKo AS 부서, boardStatus AS 게시판 FROM Division WHERE boardStatus = 'confirmed' OR nameKo = '기획경영본부' ORDER BY createdAt;"
#   confirmed 13줄 + 기획경영본부 none
```

**9-2 양식 파일** — `/ops` 부서 표 「양식」 열: 9-3에서 켤 부서에 「파일 없음」·「없음」이 없어야 한다. 파일이 없으면 그 부서는 켜지지 않는다(409 `no_template`).
넣는 양식은 **그 부서가 실제 쓰는 것**이어야 한다 — 30개 부서에 한 파일을 등록했던 사고(OPS-41)를 되풀이하지 않는다. 9-3 뒤 health의 `checks.template`이 다시 ok인지 본다
(health는 켠 부서만 본다).

**9-3 부서 켜기** — `/ops` 부서 표 → 그 줄 [편집] → 「비활성 · 켜기」.

| 묶음 | 부서 |
|---|---|
| 쓰는 부서 12 | 임원실 · 글로벌대외협력단 · 기획조정실 · 연구관리실 · AI홍보전략실(이미 켜짐) · 인사관리실 · 경영지원실 · 탄소중립에너지연구실 · 순환경제연구실 · 국토환경연구본부 · 환경평가본부 · 국가기후위기적응센터 |
| 본부 1 | **기획경영본부** — 문서를 쓰지 않지만 본부장·본부 담당이 로그인하려면 켜져 있어야 한다(꺼진 부서는 403). 알림은 끄고(9-5) 자기 문서는 뺀다(9-6) |
| 보류 | **국가지속가능발전연구센터** — §5 질문 1. 양식·담당이 없으면 꺼 둔다: 그 섹션은 「Tincase 밖」이 되고 총괄이 게시판으로 받은 hwp를 「전사」 [올리기]로 넣는다 |

섹션 「기후대기전략연구본부」·「생활환경연구본부」는 산하 실(탄소중립에너지연구실·순환경제연구실)이 채운다 — 그 두 본부는 켜지 않는다.

**9-3b 파일 점검 — 이 판의 읽기로 운영 파일을 한 번 연다** (OPS-49 · 읽기 전용 · 숫자만)

이행 리허설은 지어낸 파일로만 돌았다 — 8~9월에 한글에서 올린 실제 제출물 · 옛 엔진이 쓴 병합본 · 새로 켠 부서의 실제 양식을 v2로 연 적이 없다.
v2는 지난 제출물·병합본을 부서원 홈에서 열고, 켠 부서의 양식은 웹 작성이 그대로 채운다. 9-3 뒤에(켠 부서가 정해진 뒤) 돌린다 — 몇십 초.

```bash
cd ~/repman && DATABASE_URL=file:/data/worklog/db/worklog.db STORAGE_ROOT=/data/worklog npx tsx scripts/check-files.ts \
  | tee ~/deploy-$TS/files.txt; echo "exit=${PIPESTATUS[0]}"
```

- 기대: `exit=0` · 「끝: 모두 읽혔다」. 「template(꺼진 부서 · 있는지만)」의 「파일 없음」은 문제가 아니다(OPS-41 정리 뒤 남은 기록).
- 「template(켠 부서 · 웹 작성으로 채워 봄)」에 실패가 있으면 **그 부서는 목요일에 아무도 못 낸다** — 바로 아래 「└ 부서: …」 줄이 어느 부서인지 말한다
  (부서 이름만 — 경로·사람 이름은 찍지 않는다). 그 부서 설정에서 양식을 다시 올린다(올릴 때 이 판이 검증한다). 오늘 못 고치면 그 부서는 끈다(9-3) — No-go는 아니다.
- 「submission」·「mergeRun」의 실패는 그 주의 지난 문서가 홈에서 열리지 않는다는 뜻이다 — 수를 적어 두고 Go(목요일 전 할 일).

**9-4 사람** — `/ops` 부서 표 → 그 줄 [열기] → 인원 드로어.

- 켠 부서마다 **담당자(lead) 1명 이상**. 부서장(head)은 승인할 사람이다 — 없으면 마감 뒤 병합본이 저절로 위로 올라간다(RU-71).
- 지금 담당이 비어 있던 곳: 경영지원실 · 글로벌대외협력단 · 기획경영본부(본부 담당 + 본부장) — 12 §10.
- 사번이 없으면 쪽지가 안 간다(인원 드로어에서 넣는다 — NT-22). 집계 대상(onRoster)에서 부서장·휴직자는 뺀다(DM-16).
  기획경영본부는 문서를 쓰지 않으니 본부 담당·본부장 밖의 사람은 집계 대상에서 뺀다(이유 「본부 — 문서 없음」).
- 총괄(`isCoordinator`)·운영자는 화면으로 못 바꾼다(TACP-2) — 아래로 확인만 하고, 없을 때만 SQL.

```bash
q "SELECT d.nameKo AS 부서, d.isActive AS 켜짐, d.notifyEnabled AS 알림, d.boardStatus AS 게시판, d.rollupSelf AS 자기문서,
          d.deadlineDow AS 요일, d.deadlineTime AS 시각,
          SUM(u.isActive AND u.onRoster) AS 명단, SUM(u.isActive AND u.divisionRole = 'lead') AS 담당,
          SUM(u.isActive AND u.divisionRole = 'head') AS 부서장, SUM(u.isActive AND u.employeeNo IS NULL) AS 사번없음,
          SUM(u.isActive AND u.passwordHash IS NULL) AS 비번없음, SUM(u.isActive AND u.divisionRole = 'head' AND u.onRoster) AS 부서장명단
   FROM Division d LEFT JOIN User u ON u.divisionId = d.id
   WHERE d.isActive = 1 OR d.boardStatus = 'confirmed' OR d.nameKo = '기획경영본부'
   GROUP BY d.id ORDER BY d.createdAt;" | tee ~/deploy-$TS/divisions-after.txt
q "SELECT d.nameKo AS 총괄부서, COUNT(*) AS 총괄, SUM(u.employeeNo IS NOT NULL AND u.notifyEnabled) AS 알림받음
   FROM User u JOIN Division d ON d.id = u.divisionId WHERE u.isActive = 1 AND u.isCoordinator = 1 GROUP BY d.id;
   SELECT COUNT(*) AS 운영자, SUM(employeeNo IS NOT NULL AND notifyEnabled) AS 알림받음 FROM User WHERE isActive = 1 AND isOperator = 1;"
```

- 기대: 켠 부서마다 담당 ≥ 1 · 요일 4 · 시각 14:00(다르면 그 부서 담당과 확인) · **부서장명단 0** · 총괄 ≥ 1(알림받음 ≥ 1) · 운영자 알림받음 1.
- **부서장명단이 0이 아니면 9-5 전에 고친다** — 집계 대상(onRoster)인 부서장은 매주 「미제출」로 잡히고, 알림을 켜는 순간 **부서장에게 마감 독촉 세 통**이 간다
  (마감 전 알림은 명단 안 미제출자에게 — NOTIFICATIONS-v2 §3.1). 인원 드로어에서 그 줄을 집계 제외(이유 「부서장」). 이행 리허설 보고 6.
- 총괄이 없을 때만: `q "UPDATE User SET isCoordinator = 1 WHERE email = '<총괄-이메일>' AND isActive = 1; SELECT changes();" | tee -a ~/deploy-$TS/sql.txt` → 1.

**9-5 부서 알림 스위치** (화면 없음 — SQL)

```bash
q "UPDATE Division SET notifyEnabled = 1 WHERE isActive = 1 AND boardStatus = 'confirmed';
   UPDATE Division SET notifyEnabled = 0 WHERE nameKo = '기획경영본부';
   SELECT nameKo AS 부서, isActive AS 켜짐, notifyEnabled AS 알림 FROM Division WHERE isActive = 1 OR notifyEnabled = 1 ORDER BY createdAt;" \
  | tee -a ~/deploy-$TS/sql.txt
```

- 켜면: 그 부서 미제출자에게 마감 전 세 통, 담당자·부서장에게 마감 뒤 안내 — [NOTIFICATIONS-v2.md](NOTIFICATIONS-v2.md) §2. **첫 쪽지는 10/14(수) 11:45.**
  받는 사람 수는 그 문서 §6의 쿼리로 미리 센다.
- 기획경영본부는 끈다 — 켜 두면 문서가 없는 본부 담당에게 마감 독촉·「병합본이 아직 없어요」가 간다. 본부장에게 가는 3단계 쪽지는 이 스위치를 보지 않는다(RU-52).

**9-6 기획경영본부 자기 문서 빼기** (12 §12 Q3 — 산하 실만 모은다)

```bash
q "UPDATE Division SET rollupSelf = 0 WHERE nameKo = '기획경영본부'; SELECT nameKo, rollupSelf FROM Division WHERE nameKo = '기획경영본부';" \
  | tee -a ~/deploy-$TS/sql.txt
```

빼지 않으면 본부 자신이 기여 단위가 되어 본부본이 늘 「아직 1곳」(본부 자신)을 기다린다.

**9-7 병합 규칙 초안 — 조건부** (`scripts/apply-merge-rule-drafts.ts`)

- 하는 일(2026-10-08 HM-51 · ADR-0018 뒤): **기획조정실·인사관리실 두 부서의 분류 순서(`mergeCategories`)만, 비어 있을 때만** 넣는다. 지침·정렬은 엔진이
  더 읽지 않아 스크립트에서 지웠다 — 옛 초안의 「지침 덧붙이기·정렬은 병합한 적 없는 부서만」 설명은 이제 틀리다.
- 기본은 미리 보기, `--apply`일 때만 쓴다. 부서마다 감사 기록 `rule_update`(`ACTOR`). 몇 번 돌려도 같다. 이름이 안 맞는 부서는 건너뛰고 경고한다.
- **초안이다** — 그 부서 담당자가 순서를 확인한 뒤에만 반영한다. 오늘 못 하면 건너뛴다(분류가 없어도 병합은 된다 — 제출자 순).
- 호스트의 Prisma 클라이언트는 옛 스키마로 만들어져 있지만(`--skip-generate`) 이 스크립트는 옛 열만 읽고 써서 그대로 돈다.

```bash
cd ~/repman
DATABASE_URL=file:/data/worklog/db/worklog.db npx tsx scripts/apply-merge-rule-drafts.ts > ~/deploy-$TS/drafts-preview.txt 2>&1; echo "exit=$?"
cat ~/deploy-$TS/drafts-preview.txt
# 담당자와 합의한 뒤에만:
DATABASE_URL=file:/data/worklog/db/worklog.db ACTOR=<운영자-이메일> npx tsx scripts/apply-merge-rule-drafts.ts --apply > ~/deploy-$TS/drafts-apply.txt 2>&1; echo "exit=$?"
```

**9-8 섹션 목록** — 운영자가 「전사」(`/org`)를 연다. 섹션 표가 비어 있으면 **여는 순간** 기본 13개가 부서 이름으로 이어져 저장된다(취합을 여는 사람만 —
3단계가 꺼진 동안은 운영자). 그 뒤로는 기본값이 바뀌어도 이 목록은 그대로다(RU-61).

```bash
q "SELECT s.sortOrder AS 순서, s.title AS 제목, s.kind AS 꼴, s.isActive AS 켜짐, d.nameKo AS 부서, d.isActive AS 부서켜짐
   FROM OrgSection s LEFT JOIN Division d ON d.id = s.divisionId ORDER BY s.sortOrder;" | tee ~/deploy-$TS/sections.txt
```

- 13줄, **부서 칸이 빈 줄이 없다**(비면 부서 이름이 안 맞은 것 — 「섹션 구성 편집」에서 부서를 골라 저장). 섹션은 부서 **이름**(`nameKo`)으로 한 번 이어지고
  그 뒤로 다시 맞추지 않는다 — 이행 리허설의 지어낸 DB에서는 13개 중 10개만 이어졌다(이름이 달랐다). 한 줄로: `q "SELECT COUNT(*) AS 섹션, SUM(divisionId IS NULL) AS 부서빈칸 FROM OrgSection;"` → 13 · 0.
- 제목: 「경영지원실」(접두 없음) · 「기획경영본부(기획조정실)」 … 「기획경영본부(AI홍보전략실)」.
- 「전사」 섹션 표에서 「Tincase 밖」 표시는 9-3에서 보류한 섹션뿐이어야 한다(기후대기·생활환경 줄은 본부가 꺼져 있어도 산하 실이 채운다).

**9-9 3단계 켜기 — 맨 끝, 따로 판정**

켜기 전 조건 — 하나라도 아니면 **켜지 않고** 나머지만으로 간다:

- [ ] 기획경영본부: 켜짐 · 담당 ≥ 1 · 본부장 1 · 알림 0 · 자기문서 0 · 게시판 none (9-1~9-6)
- [ ] 산하 실 다섯(기획조정실 · 연구관리실 · AI홍보전략실 · 인사관리실 · 경영지원실) 켜짐
- [ ] 섹션 13줄, 부서 칸 빈 줄 없음 (9-8) · 총괄 ≥ 1 (9-4)
- [ ] 이번 주 승인 0 — 월요일 아침이라 당연하다. 켜는 순간 이번 주의 승인이 위로 가기 때문에 따지는 것이다(RU-79)
- [ ] **누가 누구에게 내나** — 단위 나무는 ERP 「상위부서」(`Division.parentKo`)로 정해진다(RU-07 · 인원 최신화가 맞추는 값). 틀리면 받는 곳·쪽지의 「{받는 곳}」이 틀린다

```bash
q "SELECT w.isoKey AS 주차, COUNT(r.id) AS 승인 FROM WeekSlot w LEFT JOIN MergeReview r ON r.weekSlotId = w.id WHERE w.isoKey = '2026-W42' GROUP BY w.id;"   # 0 (줄이 없어도 0)
q "SELECT nameKo AS 부서, parentKo AS 상위부서 FROM Division WHERE isActive = 1 ORDER BY parentKo, createdAt;"
#   산하 실 다섯의 상위부서 = 기획경영본부 · 탄소중립에너지연구실 = 기후대기전략연구본부 · 순환경제연구실 = 생활환경연구본부 ·
#   나머지 켠 부서 = 한국환경연구원(또는 꺼진 본부). 다르면 켜지 않는다 — 인원 최신화(roster-sync)가 맞출 값이다
```

방법: 운영자 「전사」 → **[일정 바꾸기]** → 펼친 칸 맨 아래 줄 「3단계 취합 ☐ 꺼짐 · 실·팀 → 본부 +1시간 · 본부 → 총괄 +2시간」에서 간격을 확인하고
(실·팀 → 본부 15:00 · 본부 → 총괄 16:00, 12 §12 Q6 기본 — 다르면 [간격 바꾸기] → [저장]) **체크 상자를 켠다**(누르는 즉시 켜진다). 끄기는 같은 자리에서 「끄기」를 한 번 더 누른다.
꺼져 있는 동안 스위치는 운영자에게만 보이고, 켠 뒤에는 총괄에게도 열린다(RU-52).

```bash
q "SELECT enabled, unitDueMinutes, hqDueMinutes FROM OrgRollupSetting;"     # 1 · 60 · 120
sudo docker logs --since 5m repman 2>&1 | grep -E '\[자동\]' | tail -5        # 오류 줄이 없다
```

- 「전사」 머리 주차 줄: 부서 마감 목 14:00 → 실·팀 → 본부 15:00 → 본부 → 총괄 16:00.
- 16:00 본부 기한은 금지 시간대(마감 +2:30 = 16:30) 안에 있다 — OPS-16 그대로 맞다.
- **켜지 않기로 하면**: 담당자는 v1처럼 병합본을 받아 취합게시판에 올린다(그날 쪽지 문구도 그 말을 한다 — NOTIFICATIONS-v2 §3.2 ②).
  ANNOUNCE-v2의 3단계 문장을 빼고 보낸다. 켜는 날은 다른 월요일 오전(승인이 생기기 전).

### ⑩ 08:40 스모크 — 운영자 계정으로

운영이다 — **제출 · 병합 · 승인 · 마감 바꾸기 · 3단계 끄기는 누르지 않는다.**

| 무엇 | 어디 | 기대 |
|---|---|---|
| 비로그인 | `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:11111/` | 30x → `/login`. `/login`·`/forgot` 열림 · 맨 위 띠 없음 |
| 기존 로그인 | 쓰던 브라우저를 새로 고침 | 다시 로그인하지 않고 열린다(쿠키 이름 그대로) |
| 운영 | `/ops` | 부서 표(양식 · 업무일지 열) · 「병합 줄」 카드 · 머리에 [알림 수신함] 없음 · `/ops/notify-sink`는 404 |
| 부서원 홈 | 내 부서 `/<부서-slug>` | 이번 주 카드 「마감 목 14:00」과 [작성하기] 하나 · 지난 주차 달별 · 업로드·드롭존·「양식 받기」 없음 · 지난 hwp 제출물이 열린다 · [작성하기] → 양식 표 셋(제출하지 않고 Esc) |
| 담당자 | `/<부서-slug>/manage` (내 부서, 아니면 아래 열람) | 제출 현황 · [이름 복사] · 병합 카드 · 머리 링크 「부서 설정」 → 양식 · 3단계를 켰으면 「위로」 카드에 받는 곳·기한 |
| 새 부서 (열람) | 「전사」 섹션 표 → 부서 이름 | 타 부서 칩(읽기 전용) · 명단 수 · 양식 상태 |
| 본부 (열람, 3단계 켠 뒤) | `/hq?node=<기획경영본부-slug>` | 산하 다섯 · 본부본 없음 · 승인 단추 없음(읽기 전용) |
| 총괄 | 「전사」 — 켠 뒤 총괄이 보는 것과 같은 문 | 13섹션 · 「Tincase 밖」 표시 · 전사본 「아직 없음」 · [일정 바꾸기]는 열어 보기만 |
| 옛 주소 | `/<부서-slug>/archive` · `/<부서-slug>/history` · `/ops/monitor` | 앞의 둘은 수합 관리·홈으로 보낸다(이미 나간 쪽지 링크, 2026-12-31까지) · `/ops/monitor`는 404 |
| 사용 안내 | 메뉴 「사용 안내」 · 사용자 메뉴 「화면 둘러보기」 | 안내가 열리고 둘러보기가 지금 화면 위에 뜬다 — 운영자에게는 구석 카드가 뜨지 않는 것이 정상 |

운영자 계정으로 볼 수 없는 것 — 실·팀장 [승인], 본부장 [검토 완료 · 승인], 총괄의 전사본 받기, 처음 로그인하는 사람의 구석 카드 — 은 한 주 리허설에서 봤다
([REHEARSAL.md](REHEARSAL.md): 기대 47통 모두 창 안에 한 번 · 뜻밖 0 · 승인 9/9). 운영에서는 첫 사용(목 14:10~)에 ⑫에서 본다.
협조해 줄 담당자·부서장이 있으면 [작성하기]·[내용 보기]를 **열어 보기만** 부탁한다.

### ⑪ 08:55 Go/No-go → 안내문 · 설정 링크

§4로 판정한다. Go면:

1. **설정 링크를 자신에게 먼저 한 통** — `/ops` 인원 드로어에서 내 줄의 「링크 보내기」(지금 비밀번호는 그대로 — 링크는 쓸 때만 바꾼다).
   이 판부터 설정 링크도 다른 쪽지처럼 주소를 `URL` 필드에 싣는다(AU-T90 — 본문의 주소는 메신저에서 눌리지 않는다, messenger.md §7 실측).
   메신저에서 **쪽지 제목을 누르면 설정 화면이 열리는지** 본다 — 열리면 그 화면에서 아무것도 저장하지 않고 닫는다(보낸 링크는 3일 뒤 저절로 죽는다).
   안 열리면 안내문의 「주소를 복사해 주소창에 붙여 넣어」 쪽을 쓴다(ANNOUNCE-v2 머리말).
2. **안내문** — [ANNOUNCE-v2.md](ANNOUNCE-v2.md)를 13개 부서에(메신저 단체 쪽지 · 취합게시판). 작업 끝 공지를 겸한다.
3. **설정 링크** — `/ops` 부서 줄 [열기] → 인원 드로어 → 「미발급 n명에게 링크 보내기」(한 번에 60명까지 · 운영자당 1분에 10번 — 「요청이 너무 잦습니다」면 몇 초 뒤 다시).
   **3일 만료** — 오늘 보내면 목요일 아침까지다. 링크는 본인 알림 설정과 상관없이 간다(NT-20).
   사번이 없는 사람은 이 목록에서 빠진다 — 인원 드로어에 사번을 넣거나, 그 사람만 줄 끝 [직접](임시 비밀번호 표시 — 개인별로 전달, 단체 쪽지 금지).
   결과에 「수신 허용 목록 밖」이 있으면 1절의 허용 목록이다.

No-go면 §3.

### ⑫ 09:00~ 지켜보기

```bash
sudo docker logs -f --since 1m repman 2>&1 | grep --line-buffered -E 'FATAL|오류|\[알림\]|\[merge\]|\[자동\]'
q "SELECT chapter AS 장, outcome AS 고른것, COUNT(*) AS 사람 FROM GuideTourSeen GROUP BY 1, 2;"   # 첫 로그인 둘러보기
```

`/ops` 인원의 「미발급」 수가 줄어드는지, `/ops/audit`의 「설정 링크 발송」을 본다.

**이번 주(W42) 시각표** — 기본 목 14:00 · 3단계 켬. 쪽지 문구와 받는 사람은 [NOTIFICATIONS-v2.md](NOTIFICATIONS-v2.md) §2·§3.

| 시각 | 무엇 | 운영자가 볼 것 |
|---|---|---|
| 수 10/14 11:30 | 금지 시간대 시작 | 배포·재기동하지 않는다 |
| 수 11:45 | 마감 하루 전 쪽지 — 12개 부서 미제출자 | `[알림] 마감 하루 전 — {부서} 2026-W42: n/m명 발송` · 「허용 목록 밖」 줄 |
| 목 13:00 · 13:50 | 1시간 전 · 10분 전 | 〃 |
| 13:50 | 모델 다시 데우기 | `[merge] 모델 데우기 — 기준 …` |
| 14:01 | 자동 병합 — 줄에 넣고 하나씩 | `[merge] 자동 병합 n건 줄에 넣음` · `[merge] 줄 k/n — …` · `/ops` 「병합 줄」 |
| ~14:15까지 | 「병합 점검」 — 운영자·기획조정실 담당 | 받은 쪽지의 실패·모델 못 씀·보류 |
| 14:10~ · 14:30~ | 부서장 검토 요청 · 담당자 안내 | |
| 14:45 | 기획경영본부 산하 실장 중 승인 안 한 사람에게 15분 전 | 막힌 실이 있으면 담당자의 「승인 없이 올리기」가 열린다 |
| 15:00 | 기획경영본부 본부장 「본부본 준비」(다 모였으면 그 전에) | |
| 15:45 | 본부장 · 바로 총괄로 가는 부서장 중 승인 안 한 사람에게 15분 전 | |
| 16:00 | 총괄 「전사본 준비」(다 들어왔으면 그 전에) | 「전사」 최종본 열 |
| 16:30 | 금지 시간대 끝 | |

나간 쪽지 수는 NOTIFICATIONS-v2 §6의 둘째 쿼리.

## 3. 롤백

| 상황 | 할 일 |
|---|---|
| ⑥ 전 어디서든 멈춤 | **앱은 아무것도 안 한다** — 옛 앱이 돈다. ⑤로 더한 표·열은 옛 앱이 모르고 지나간다(2026-10-09 v1.39.0 모양의 DB로 옛 앱의 읽기·쓰기 확인 — 이행 리허설). 오늘 안에 다시 하면 합침·태그를 그대로 쓴다. **며칠 미루면 `main`을 되돌린다** — 그대로 두면 다음 `deploy.sh prod`(빌드)가 v2를 굽는다: `git -C ~/repman reset --hard "$(cat ~/deploy-$TS/old-commit)" && git -C ~/repman tag -d v2.0.0` (push 전이라 안전 · 추적 안 된 ADR 파일은 그대로) |
| `[boot] FATAL: DB 스키마가 …` | 롤백 아님 — ⑤ 뒤 `bash scripts/deploy.sh prod --no-build` |
| health `checks.template`만 fail | 롤백 아님 — 양식 파일이 빠진 켠 부서(⑨-2) |
| 3단계만 이상하다 | 「전사」에서 3단계를 끈다 — 나머지는 그대로. 끄면 숨을 뿐 데이터는 남는다 |
| 쪽지만 멈춰야 한다 | §3.3 |
| health `ok:false`(template 밖) · 스케줄러 등록 줄 없음 · 띠가 뜬다 · `printenv`에 테스트 값 · 주요 화면 500 · 전원 로그아웃 | **§3.1 이미지만** |
| 데이터가 망가졌다 | §3.1 + §3.2 |

### 3.1 이미지만 (OPS-17 — 재빌드하지 않는다)

```bash
cd ~/repman
sudo docker tag repman:v1.39.0 repman:latest       # ①에서 붙인 고정 태그 — repman:rollback은 ⑥을 빌드째 다시 돌렸으면 v2일 수 있다
sudo docker image inspect repman:latest --format '{{.Id}}' | diff - ~/deploy-$TS/image-v1.txt && echo V1-TAGGED
bash scripts/deploy.sh prod --no-build --ignore-window
sudo docker inspect repman --format '{{.Image}}' | diff - ~/deploy-$TS/image-v1.txt && echo V1-RUNNING
```

- `repman:v1.39.0` = ① 시점에 돌던 이미지(v1). `repman:rollback`도 보통 같은 이미지다(⑥이 한 번만 빌드했으면). 자세한 것은 [DEPLOY.md](DEPLOY.md) §2b-롤백.
- `--no-build`는 지금 체크아웃(v2)의 `docker-compose.yml`로 컨테이너를 만든다 — v1.39.0과 다른 것은 `MERGE_MODEL_KEEP_ALIVE` 한 줄이고 옛 앱은 읽지 않는다(2026-10-09 diff).
- 며칠 v1으로 갈 거면 `main`도 되돌린다(위 표 첫 줄) — 그대로 두면 다음 빌드가 v2를 굽는다.
- DB는 그대로다 — ⑨에서 한 설정(부서 켜기 · 사람 · 알림 스위치)이 남고 옛 앱도 그것을 따른다. 새 부서에도 **v1 쪽지**가 간다
  (당일 09:00 알림 포함, 끝 줄 「취합게시판에 올리고」).
- 옛 앱에는 **hwp 업로드 제출이 다시 열린다.** 「웹 작성만」이라고 안내했으면 한 줄 정정한다.
- 체크아웃은 그대로 둔다(동작은 이미지가 정한다). 3단계 스위치 값도 DB에 남는다 — 나중에 v2를 다시 올리면 켜진 채로 뜬다. 옛 앱에는 그 화면이 없으니
  다시 올리기 전에 끌 거면 `q "UPDATE OrgRollupSetting SET enabled = 0;"`.

### 3.2 DB까지 — 데이터가 망가졌을 때만

④ 뒤에 들어온 **제출·수정·설정·설정 링크가 모두 사라진다.**

```bash
cd ~/repman
sudo docker tag repman:v1.39.0 repman:latest                                  # §3.1과 같다 — 고정 태그
sudo docker compose -f docker-compose.yml -p repman stop app
rm -f /data/worklog/db/worklog.db-wal /data/worklog/db/worklog.db-shm /data/worklog/db/worklog.db-journal   # 덮기 **전에** — v2 DB의 남은 로그가 v1 스냅샷에 적용되지 않게
cp /data/worklog/db/worklog.db.predeploy-$TS /data/worklog/db/worklog.db     # 있는 파일에 덮는다 — 주인·권한이 그대로 남는다 (닫힌 스냅샷 · 멈춘 앱 — OPS-07의 「cp 금지」는 살아 있는 DB)
stat -c '%u:%G %A %n' /data/worklog/db/worklog.db                             # 10001:mhchoi -rw-rw---- (호스트 sqlite3로 열지 않는다 — 남긴 -wal·-shm이 mhchoi 것이면 앱이 못 쓴다)
bash scripts/deploy.sh prod --no-build --ignore-window
q "PRAGMA integrity_check; SELECT COUNT(*) AS 제출 FROM Submission;"           # ok · before.txt의 제출 수와 같다 (컨테이너 안에서)
```

- 스냅샷은 ⑤ 전이라 스키마도 v1으로 돌아간다 — 옛 이미지와 맞는다. (이 DB로 v2 이미지를 띄우면 OPS-48이 막는다.)
- 이미 보낸 설정 링크는 무효가 된다(토큰이 DB에 없다) — 다시 보낸다. 그 사이 **링크로 비밀번호를 정한 사람도 다시 정해야 한다**(비밀번호가 ④ 시점으로 돌아간다). ⑨는 다시 한다.
- 새 앱이 만든 파일(`divisions/*/reports/` · `org/`)은 남는다 — 행 없는 파일이라 해가 없다.

### 3.3 쪽지만 멈추기

| 멈출 것 | 방법 | 계속 가는 것 |
|---|---|---|
| 한 부서의 부서원·담당자·부서장 쪽지 | `q "UPDATE Division SET notifyEnabled = 0 WHERE nameKo = '<부서>';"` | 본부장·총괄의 3단계 쪽지 · 병합 점검 |
| 한 사람 | `/ops` 인원 드로어 → 알림 끄기(NT-22) | |
| 3단계 쪽지 전부 | 「전사」 3단계 끄기(자동 진행도 멈춘다) | |
| 병합 · 병합 안내 · 병합 점검 | `MERGE_PAUSE_UNTIL` — [spec 09 OPS-16a](spec/09-deployment-ops.md) (금지 시간대 안이면 `--ignore-window`) | 마감 전 쪽지 · 3단계 쪽지 |
| 전부 | `.env.production`의 `MESSENGER_URL`을 비우고 `bash scripts/deploy.sh prod --no-build --ignore-window` | 앱은 돈다 — 설정 링크·비밀번호 찾기도 멈춘다 |

## 4. Go / No-go

**Go — 모두 ✓ (⑪에서)**

- [ ] ① `IMAGE-SAME` · `repman:v1.39.0` 태그 있음 (`image-v1.txt`)
- [ ] ⑤-0 사본 push — 확인 질문 없음 · `ok` · diff는 새 표 일곱 줄뿐
- [ ] ⑤ 새 표 7 · `integrity_check` ok · 행 수가 `before.txt`와 같다
- [ ] ⑥ `exit=0` · ⑦ health `ok:true`, checks 전부 ok · FATAL 0
- [ ] 로그 `[merge] 자동 병합 스케줄러 등록 (1분 주기)` · `[알림] 켜짐 (수신 허용: …)`
- [ ] `printenv`에 테스트 값 없음 · 띠 없음 · `/ops/notify-sink` 404
- [ ] ⑧ 틱 오류 없음 · 모델 상주 (아니면 목요일 전 할 일로 적고 Go)
- [ ] 기존 로그인 유지
- [ ] `divisions-after.txt`가 기대대로 — 켜짐 12 + 기획경영본부 · 알림 12 · 담당 ≥ 1 · **부서장명단 0** · 기획경영본부 알림 0·자기문서 0·게시판 none · 사번없음 0(아니면 누구인지 안다)
- [ ] 9-3b 파일 점검 — 켠 부서 양식 실패 0 (실패한 부서는 껐다). 제출·병합본 실패는 수를 적고 Go
- [ ] 총괄 ≥ 1 · 운영자 알림받음 1
- [ ] 섹션 13줄 · 부서 칸 빈 줄 없음
- [ ] ⑩ 스모크 통과
- [ ] 수신 허용 목록이 새 부서 사람을 담는다 (내게 보낸 설정 링크가 왔다)
- [ ] 11112 스케줄러 꺼짐 (1절)

**No-go — 하나라도면 멈춘다**

- ①의 이미지가 다르다(`IMAGE-SAME` 아님) → 누가 무엇을 구웠는지 알기 전에는 ⑥을 하지 않는다 — 롤백할 이미지가 v1이라는 보장이 없다
- ⑤-0이나 ⑤가 데이터 손실을 묻는다 · 새 표가 7이 아니다 · `integrity_check`가 ok가 아니다 · 행 수가 줄었다 → ⑥을 하지 않는다(옛 앱 그대로)
- 금지 시간대 · 디스크 5G 미만 · 오늘 야간 백업 실패 → ⑥을 하지 않는다
- ⑥ 뒤: health `ok:false`(template 밖) · 스케줄러 등록 줄 없음 · 띠 · `printenv`에 테스트 값 · 전원 로그아웃 → §3.1

**3단계는 따로** — 9-9의 조건. 아니면 3단계만 끈 채로 Go.

## 5. 운영자에게 남은 질문

1. **국가지속가능발전연구센터** — 월요일에 켜나(양식 · 담당 · 부서장)? 아니면 「Tincase 밖」으로 두고 총괄이 [올리기]로 넣나. 12 §11a RU-60a는
   「2026-10-12부터는 전 섹션이 Tincase」라고 적었는데, 대상 부서 기록(13곳)에는 이 센터가 없다.
2. **3단계를 이날 켜나** — 12 §10·§11은 「운영에는 3단계를 시연 전 주(10/26 주)에 올린다」였고, 옛 초안은 코드 전환과 3단계 켜기를 다른 날로 나눴다.
   이 문서는 같은 날 켜되 9-9에서 따로 판정한다.
3. **수신 허용 목록** — `*`로 여나, 사번 목록을 늘리나.
4. **총괄 계정** — 누구에게 `isCoordinator`가 있나. 「전사본 준비」는 총괄 각자에게 간다. 최종본을 NAMS에 올리는 사람과 같은가.
5. ~~설정 링크 본문 주소가 메신저에서 눌리나~~ — **고쳤다(2026-10-09, AU-T90).** 본문 주소는 눌리지 않는다는 것이 이미 실측(messenger.md §7)이라
   설정 링크·비밀번호 찾기도 주소를 `URL` 필드에 싣는다(제목을 누르면 열린다). 남은 것은 ⑪-1에서 제목을 눌러 열리는지 한 번 보는 것뿐.
6. **모델 서버를 11112와 함께 쓴다** — 「목요일 마감 시간에 11112에서 병합하지 않는다」로 충분한가, 인스턴스를 나누나.
7. **병합 규칙 초안**(기획조정실·인사관리실 분류 순서) — 담당자 확인 전이면 넣지 않는다.
8. **CHANGELOG** — 「미출시」 절들을 `v2.0.0 — 2026-10-12`로 묶는 일을 ③ 전에 릴리스 커밋에 넣을지, 배포 뒤에 할지.
9. **이행 리허설을 실제 데이터로** — 2026-10-09 리허설은 운영 사본 복사가 막혀(개인정보) 지어낸 사람의 DB로만 돌았다. 이 문서는 그 빈 곳을
   ⑤-0(스냅샷 사본에 push)과 9-3b(파일 점검)로 월요일에 메운다. 더 일찍 알고 싶으면 일요일에 같은 둘을 돌린다(1절 끝). 실제 데이터로 화면을
   한 바퀴 도는 것(이행 리허설 3)은 ⑩ 스모크가 대신한다 — 3단계를 켠 흐름은 한 주 리허설(REHEARSAL.md · 지어낸 사람)에서만 봤다.

## 끝나고

- 스냅샷 `worklog.db.predeploy-$TS`는 **다음** 배포가 무사히 끝난 뒤 지운다.
- `repman:v1.39.0` 태그도 v2로 한 주(첫 목요일 마감)를 무사히 지난 뒤 떼어 낸다 — `sudo docker rmi repman:v1.39.0`(그 이미지에 다른 태그가 없으면 이미지째 지워진다 — 그때는 더 쓸 일이 없다).
- `~/deploy-$TS/sql.txt`가 이날 SQL로 바꾼 것(9-4 · 9-5 · 9-6)의 유일한 기록이다 — 감사 기록이 없다.
- 다음 날 아침 야간 백업 로그: db·files 둘 다 성공(새 디렉터리 `divisions/*/reports/`·`org/`도 files 묶음에 들어간다).
- push(선택) — 공개 저장소다. `bash scripts/check-secrets.sh >/dev/null 2>&1; echo $?`가 0인지 **종료 코드로** 본 뒤 `git push origin main v2.0.0`.
  이력에 남은 실명 문제(비공개 전환·이력 재작성)는 따로 정한다.

## 부록 — 옛 초안(2026-10-08 운영 전환 런북, 저장소 밖)과 다른 점

| 옛 초안 | 지금 | 왜 |
|---|---|---|
| 코드 전환(A)과 3단계 켜기(B)를 다른 날에 | 같은 날, 9-9에서 따로 판정 | 자동 진행(auto-flow)이 합쳐졌고 한 주 리허설을 통과했다(OPS-47). 3단계만 끈 채로 갈 길은 남겼다 |
| `main`을 앞으로만 감기 | `--no-ff` 합치기 | `main`에 `711fb76`이 있다(같은 변경이 브랜치에 `4143baf`) |
| compose에 `SUBMIT_HWP_UPLOAD: "off"` 한 줄 | 넣지 않는다 | 부서원 hwp 제출은 코드째 지웠다(WA-39). 스위치는 「전사」 [올리기]만 — 운영은 기본 `on`으로 Tincase 밖 섹션을 받는다 |
| `docker compose build && up -d`를 손으로, 롤백 태그도 손으로 | `bash scripts/deploy.sh prod` | 금지 시간대·디스크·롤백 태그·health·찌꺼기 청소를 한 번에(OPS-43) |
| 새 표 5 · 열 4 | 새 표 7 · 새 열 6 | `MergeJob`(병합 줄) · `GuideTourSeen`(둘러보기) · `MergeReview.filePath` · `MergeRun.outputSha` |
| push를 빠뜨리면 health는 초록인데 화면이 500 | 뜨지 않고 없는 표·열을 말한다 | 기동 스키마 검사(OPS-48) |
| 스냅샷 사본에서 스키마 리허설(`migrate diff` · push) | **한다** — ⑤-0, 그날 스냅샷의 사본에 같은 push (3초) | 2026-10-09 이행 리허설은 지어낸 사람의 DB(v1.39.0 코드로 만든 모양)로만 돌았다 — 실제 데이터로는 그날 스냅샷이 처음이다. 10/07의 `.bak-20261007-pre-rollup`은 v1.39.0 전이라 출발점이 아니다 |
| 롤백은 `repman:rollback` | `repman:v1.39.0` 고정 태그(①) | ⑥을 빌드째 다시 돌리면 `repman:rollback`이 v2로 옮겨지고 v1 이미지가 청소에 지워진다 |
| 병합 규칙 초안이 지침·정렬까지 넣는다 | 분류 순서 둘만 | HM-51 · ADR-0018 |
| 3단계 쪽지 `ru_hq_collect` · `hq_approved` · 당일 09:00 알림 | 없다 | 막고 있는 사람에게만(ADR-0015) · R13 |
| 섹션 13개는 「섹션 구성 편집」에서 그대로 저장 | 운영자가 「전사」를 열면 생긴다 | 편집기의 [저장]은 바뀐 것이 있어야 눌린다. 여는 순간 기본 13개를 저장한다 |
