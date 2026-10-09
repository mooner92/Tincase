# v2 운영 전환 — 2026-10-13(화) 아침 순서

> **2026-10-10 운영자 결정 — 전환을 10/12(월)에서 10/13(화) 아침으로 옮긴다.** 운영자가 월요일에 없다. 월요일에는 v1(main v1.39.0)이 그대로 돈다 — 아래 「월요일(10/12) — v1이 하루 더」.
> 대상: 운영자 · 운영 서버(체크아웃 `~/repman`, 컨테이너 `repman`, 11111) · 10/13(화) 07:00~09:30
> 근거: [DEPLOY.md](DEPLOY.md) §2b(재배포) · §2b-5(v2 전환 — 더해지는 표·열) · §2b-롤백. 여기서는 그 절을 **이날 어떤 순서로, 무엇을 더해** 돌리는지만 적는다.
> 함께: [NOTIFICATIONS-v2.md](NOTIFICATIONS-v2.md)(나갈 쪽지 전부) · [ANNOUNCE-v2.md](ANNOUNCE-v2.md)(부서 안내문) · [REHEARSAL.md](REHEARSAL.md)(한 주 리허설 결과)
> ⚠ 공개 저장소다. 주소·이메일·사람은 자리표시자로 둔다 — `<서버-내부-IP>` · `<운영자-이메일>` · `<총괄-이메일>` · `<운영자 연락처>` · `<부서-slug>`.
> 누가 담당·부서장·총괄인지는 `docs/private/`에 둔다. DB는 운영자가 손으로 바꾼다(이 문서의 SQL을 운영자가 붙여 넣는다).

이 판(main v1.39.0 → **v2.0.0**): 제출은 웹 작성만 · 부서원 홈 하나 · 기능 정리 · 3단계 자동 진행(**부서장·본부장의 승인 = 위로 넘김**) · 병합 줄 ·
모델 상주 · 사용 안내 v2 + 첫 로그인 둘러보기 · 빌드 찌꺼기를 치우는 배포 스크립트 · 기동 스키마 검사. 바뀐 것 전부는 CHANGELOG 「미출시」 절들.

## 범위 — 전환일(10/13 화)에는 두 부서만 (2026-10-09 운영자 결정)

| | 10/13(화) | 그 뒤 |
|---|---|---|
| 켜는 부서 | **기획조정실**(새로 켬) · **AI홍보전략실**(파일럿 — 이미 켜짐) | — |
| 나머지 대상 부서 | 준비만 — 꺼짐(`isActive` 0) · 부서 알림 꺼짐(`notifyEnabled` 0). 양식은 10/06에 등록했고, 사람 칸(역할 · 집계 제외 · 사번)은 미리 넣어 둬도 된다(쪽지가 나가지 않는다) | 한 부서씩 — §6 |
| 3단계 (실·팀 → 본부 → 전사) | **꺼짐** — 코드는 들어가고 스위치만 꺼 둔다 | §7 — 기획경영본부 산하 다섯 실이 켜진 뒤, 늦어도 10/26 주(11/2 회의 준비 주) |
| env | `.env.production`에 `MESSENGER_ALLOWLIST="*"` · `MESSENGER_LINK_BASE` 있음(2026-10-09 확인) — **바꾸지 않는다** | 그대로 |
| 쪽지 문구 | 그대로 | 첫 목요일(10/15) 뒤 v2.0.1(NOTIFICATIONS-v2 §5) |

- **누가 받나**는 env가 아니라 부서 켜짐 + 부서 알림 스위치(9-5 — `/ops` 부서 표 「알림」)와 사람마다의 알림 칸(인원 드로어)이 정한다. 허용 목록이 `*`여도 꺼진 부서 사람에게는 부서 쪽지가 가지 않는다.
- **3단계를 끄는 이유** — 두 부서 모두 기획경영본부 산하다. 켜면 기획경영본부에 본부 단계가 생기는데 그 본부장은 아직 들어오지 않았다 — 두 부서의 병합본이 모두 거기서 기다린다.
  꺼 두면 아무것도 위로 저절로 가지 않는다 — 두 부서 담당은 지금처럼 병합본을 받아 취합게시판에 올리고(쪽지 끝 줄도 v1.39 그대로), 부서장을 두지 않은 부서는 담당이 확인한 병합본이 최종이다.
- 이 범위 그대로를 브라우저로 끝까지 눌러 본 것이 e2e 출시 범위 모드다(`node scripts/e2e-v2.cjs --scope=launch` — OPS-50h · [REHEARSAL.md](REHEARSAL.md)) — 「위로」 카드 · 「올라갔어요」가 어디에도 없고,
  총괄은 현황판만(최종본 열 없음 · `/hq` 404), 「병합 점검」은 운영자와 기획조정실 담당, **꺼진 부서 사람에게 간 쪽지 0**.

## 월요일(10/12) — v1이 하루 더

운영자는 월요일에 없다. 그날은 **아무것도 바꾸지 않는다** — v1이 평소처럼 돈다(월요일에 저절로 나가는 쪽지는 없다 — 이번 주 첫 쪽지는 수 11:45이고 그때는 v2다).

- **파일럿(AI홍보전략실) 부서원은 월요일에 W42를 v1으로 낼 수 있다 — hwp 업로드 포함.** 막지 않는다. 기획조정실은 아직 꺼져 있어 들어오지 못한다(화요일 9-3에서 켠다).
- 화요일에 v2로 바꾸면 그 제출물은 **그대로 이번 주 제출이다** — 홈 이번 주 카드 「제출 완료」(낸 시각 · v1), [열기]는 작성 화면을 **그 hwp의 표로 채워** 연다(웹 작성 길로 만든 파일이 아니어도 같은 읽기),
  고쳐 [제출]하면 v2(웹 작성)가 되고 월요일의 v1은 남는다. 담당의 수합 관리에도 「제출」로 센다. 시험 `[WA-T54]`(한글에서 만든 실제 제출물 꼴로 — WA-39d).
  병합은 원래 낸 것 전부를 담는다(어느 길로 냈는지 보지 않는다).
- 화요일 ①이 그 수를 적는다(`before.txt`의 「W42제출」) — 0이 아니면 ⑩에서 한 사람 것을 열어 본다. 9-3b 파일 점검도 그 파일들을 연다(「submission」 줄).
- 화요일 안내문(⑪)의 AI홍보전략실 판에 「월요일에 hwp로 내신 분은 그대로 제출된 것 — [열기]로 고쳐 다시 낼 수 있다」 한 줄이 있다([ANNOUNCE-v2.md](ANNOUNCE-v2.md)).

## 0. 한눈에

| 시각 | 단계 | 여기서 멈추면 |
|---|---|---|
| 07:00 | ① 준비 · 금지 시간대(OPS-16 — 화요일은 밖) · 디스크 · 야간 백업 · 배포 전 기록(월요일 W42 제출 수 포함) · **v1 이미지 고정 태그** | 아무 일 없음 — 옛 앱이 돈다 |
| 07:10 | ② 작업 공지 | 〃 |
| 07:15 | ③ `main`에 합치고 `v2.0.0` 태그 | 〃 |
| 07:20 | ④ DB 스냅샷 (컨테이너 안) | 〃 |
| 07:22 | ⑤-0 스냅샷 **사본**에 `prisma db push` — 실제 데이터로 먼저 (3초) | 〃 |
| 07:25 | ⑤ `prisma db push` (운영 DB) | 〃 — 더한 표·열은 옛 앱이 모르고 지나간다 |
| 07:30 | ⑥ `bash scripts/deploy.sh prod` (빌드 5~10분) | **여기부터 새 앱** — 문제면 §3 |
| 07:45 | ⑦ health · 기동 로그 FATAL | §3 |
| 07:50 | ⑧ 첫 스케줄러 틱 · 모델 데우기 | |
| 08:00 | ⑨ 설정 — 범위 확인 · 기획조정실 켜기 · 사람 · 알림 스위치(두 부서) · 범위 점검. **3단계는 켜지 않는다** | 기획조정실만 안 되면 끄고 AI홍보전략실만으로 간다(9-3) |
| 08:40 | ⑩ 스모크 (운영자 계정) | §3 |
| 08:55 | ⑪ Go/No-go(§4) → 두 부서에 안내문 · 설정 링크 | |
| 09:00~ | ⑫ 지켜보기 · 이번 주 알림 시각 | |

시간이 밀려도 ⑥ 전에는 사용자에게 아무 일도 없다. 09:00을 넘기면 ⑥을 점심(12:00~13:00)으로 미뤄도 된다 — 금지 시간대는 수요일 11:30부터다.
화요일에 못 끝내면 **수요일 아침(~11:29)이 마지막 창**이다(`deploy.sh`가 같은 계산으로 다시 본다 — `[OPS-T19d]`가 화 07:00·수 11:29 열림, 수 11:30 막힘을 고정).
그것도 넘기면 이번 주(W42)는 v1으로 마치고 다음 주 월·화로 이 문서를 한 주 민다(§3 첫 줄 — `main`을 되돌린다).

## 1. 전날까지 (금~일 — 운영자는 월요일에 없다) — 화요일 아침에 정하지 않는다

- [ ] **릴리스 커밋** = `feat/org-rollup`의 끝. 테스트 서버(11112)·리허설에서 본 코드와 같은지 확인하고 해시를 적어 둔다(③에서 맞춘다).
      「같은 코드」는 `git diff --stat <본 커밋> feat/org-rollup -- src prisma package.json package-lock.json Dockerfile docker-compose.yml scripts/entrypoint.sh`가
      비어 있는 것으로 본다 — v2 후보 `9728f6f` 뒤로는 스크립트·시험·문서만 더해졌다(2026-10-09). 문서를 더 고치면 해시가 바뀌니 마지막 커밋 뒤에 적는다.
      예외 하나 — 같은 날 `/ops` 부서 표의 「알림」 칸(NT-61 · 9-5)이 src에 더해졌다. 11112에는 없던 코드라 이 diff에 그것만 나오고, 그 커밋에서 아래 e2e 스모크를 다시 돌린다.
      개발 쪽 게이트(`npm test` · `tsc` · `check-secrets.sh`)는 **종료 코드로** 판정한다(`| tail` 금지).
      2026-10-10 출시 준비 갈래(`feat/pre-launch` — 74ab230에서)는 src에서 둘만 바꿨다 — 기동 로그 한 줄(`src/instrumentation.ts` · 새 `src/lib/notify-boot.ts` — NT-32:
      「발송 부서」는 켜짐 그리고 알림만 센다)과 월간 주의 감사 문서 이름(`src/server/report.ts` · `src/app/api/ops/report/route.ts` — WS-15). 나머지는 시험·e2e 스크립트·문서다.
      그 갈래를 합친 뒤의 끝이 릴리스 커밋이고, 위 diff에는 그 네 파일이 더 나온다.
      `npm test`는 env가 있어야 한다 — 없으면 아홉 파일이 `[env] 환경변수 검증 실패`로 떨어진다(코드 탓이 아니다):
      `STORAGE_ROOT=$(mktemp -d) CF_ACCESS_TEAM=t DATABASE_URL=file:$(mktemp -u)/x.db npm test; echo $?` (2026-10-09 e2e 스모크 커밋 뒤: 60파일 1006개 통과 · 「알림」 칸을 더한 `940b4a6`에서: 62파일 1025개 통과 ·
      2026-10-10 출시 준비 끝 `1923c49`에서: 64파일 1044개 통과 · `tsc` 0 · `check-secrets` 0).
      ~~체크아웃이 `/tmp` 아래면 OPS-T37 한 개가 환경 탓으로 떨어진다~~ — 2026-10-10 고쳤다(시험이 하위 프로세스에 빈 임시 디렉터리를 준다). 어느 체크아웃에서 돌려도 같은 답이다.
      시간대: 같은 판을 `TZ=Asia/Seoul`·`UTC`·`America/New_York`로 세 번 돌려 셋 다 위 OPS-T37 하나 말고 모두 통과(2026-10-09 — `npm run test:tz`와 같은 뜻).
- [ ] **11112를 원래대로** — 리허설이 끝나면 리허설 덧붙임(`TINCASE_REHEARSAL=on`) 없이 다시 올려 스케줄러가 꺼진 상태로. 11112와 운영은
      **같은 모델 서버(:11437)**를 쓴다 — 목요일 마감에 시험 서버가 자동 병합을 돌리면 운영 병합과 모델을 다툰다.
      `TINCASE_TEST_MODE=demo bash scripts/deploy.sh test --no-build` (시연 모드로 떠 있으니 변수가 있어야 한다 — 없으면 deploy.sh가 멈춘다) →
      `sudo docker exec repman-test printenv MERGE_SCHEDULER` 가 `off`.
      시연 저장소(`/data/worklog-demo`)는 리허설의 `prepare --wipe`가 덮었다 — [REHEARSAL.md](REHEARSAL.md) 「11112」 4)의 `restore before-rehearsal`을 아직 안 했으면
      (평소 모드로 내린 뒤에만 된다) 11/2 시연 준비(DEMO D-7) 전까지 한다. 운영 전환과는 상관없다.
- [x] **백업 크론** ([DEPLOY.md](DEPLOY.md) §7) — 2026-10-09 files를 매일로 바꿨다(`30 3 * * *` — `crontab -l | grep backup.sh` → 두 줄 모두 `* * *`).
      같은 날 11:46쯤 files를 손으로 한 번 돌렸다(`divisions-2026-10-09.tar.gz`) — 10/06에 등록한 대상 부서 양식이 이제 백업에 있다. 화요일 ①의 「오늘 03:30 files 성공」이 생긴다.
- [x] **fstab** — **2026-10-10 넣었다**(운영자 · sudo): `/mnt/backup` NFS 줄(`defaults,_netdev,nofail,hard,timeo=600` — 주소는 `<NFS-내부-IP>:<경로>`, 비공개) ·
      원본은 `/etc/fstab.bak-20261010` · `findmnt --verify` 오류 0 · `systemctl daemon-reload` 뒤 `mnt-backup.mount`가 생겨 붙어 있다. 이제 재부팅해도 백업이 `[backup] FATAL`로 멈추지 않는다(DEPLOY §7).
- [ ] **브라우저 e2e 스모크 — 두 범위** — 릴리스 커밋에서 `node scripts/e2e-v2.cjs; echo $?` → `0` **그리고** `node scripts/e2e-v2.cjs --scope=launch; echo $?` → `0`
      (각 약 15분 · [REHEARSAL.md](REHEARSAL.md) OPS-50 · 기본: 2026-10-09 `b05207d`에서 32/32 · 「알림」 칸을 더한 `940b4a6`에서 다시 32/32, 16분 ·
      출시 범위(OPS-50h — 10/13의 모양 그대로: 두 부서 · 3단계 끔)는 2026-10-10 출시 준비 끝 `1923c49`에서 35/35, 같은 커밋에서 기본도 32/32 — 각 13분 · REHEARSAL.md 「출시 범위」 실측).
      운영·11112·docker·`/data`를 건드리지 않지만 같은 서버의 CPU를 쓰니 화요일 ⑥의 빌드와 겹치지 않게 **월요일까지** 돌린다. 위 `git diff --stat`이 비어 있으면(문서만 바뀜) 다시 돌릴 필요는 없다.
- [x] **수신 허용 목록 · 링크 주소** — 2026-10-09 확인: `.env.production`에 `MESSENGER_ALLOWLIST="*"` · `MESSENGER_LINK_BASE` 있음 → **⑥ 전에 바꿀 것 없음**.
      누가 받는지는 부서 켜짐 + 부서 알림 스위치(9-5)와 사람마다의 알림 칸이 정한다(범위). ⑦ 기동 로그에서 `(수신 허용: 전원)`만 본다.
- [ ] **사람 — 두 부서만**(명단은 비공개 `docs/private/`) — ⑨-4에서 넣는다. AI홍보전략실은 지금 그대로(담당 · 부서장 있음).
      기획조정실: 담당(lead) 1명 이상, 그리고 **담당에게 묻는다 — 실장이 Tincase에서 병합본을 검토하나?** 예 → 실장을 부서장(head)으로 ·
      아니오 → 첫 몇 주는 부서장 없이(3단계가 꺼져 있어 저절로 위로 가는 것이 없다 — 담당이 확인한 병합본이 최종). 어느 쪽이든 실장은 집계 제외(사유 「부서장」).
      총괄 계정도 본다(「병합 점검」이 총괄이 있는 부서의 담당에게 간다). 기획경영본부의 본부 담당·본부장은 §7 때.
      지금 돌고 있는 v1의 `/ops` 인원 드로어에도 같은 칸(담당·부서장 · 집계 제외 · 사번)이 있어 **주말에 미리 넣어 둘 수 있다** — 그러면 화요일 9-4는
      쿼리 확인만 남는다(사람 칸을 바꾸는 것만으로는 쪽지가 나가지 않는다). 설정 링크만은 v1에서 보내지 않는다 — v1 쪽지에는 URL 필드가 없다(AU-T90 전). ⑪에서.
- [x] **문구** — 전환일에는 그대로 둔다(2026-10-09 결정). 첫 목요일(10/15) 뒤 v2.0.1에서 고친다([NOTIFICATIONS-v2.md](NOTIFICATIONS-v2.md) §5).
- [ ] [ANNOUNCE-v2.md](ANNOUNCE-v2.md)의 자리표시자를 채운다 — 두 부서용 글이다.
- [x] §5 질문 1~4 · 7 · 11 · 12 — 2026-10-09 운영자 권고로 답했다. 기획조정실 담당에게 물을 둘(실장 검토 · 분류 순서 — 9-4 · 9-6)은 남았다.
      6(모델 서버 공유) · 8(CHANGELOG 묶기)은 아직 열려 있다 — 전환을 막지 않는다.
- [ ] (권장 · 주말) **실제 데이터로 미리 한 번** — 이행 리허설은 지어낸 사람의 DB로만 돌았다(운영 사본은 개인정보라 에이전트가 복사하지 않았다).
      화요일의 ⑤-0(사본에 push)과 9-3b(파일 점검)를 주말에 먼저 돌려 두면 화요일 아침에 놀랄 일이 줄어든다. **브랜치 체크아웃 `~/repman-rollup`에서** —
      그때의 `~/repman`은 아직 v1 스키마라 거기서 push하면 아무것도 바뀌지 않는다. 10/07 13:12의 `.bak-20261007-pre-rollup`은 v1.39.0 전
      (main이 `mergeSort`·`MergeReview`를 더하기 전)이라 화요일의 출발점이 아니다 — 쓰지 않는다. 운영 DB·파일은 읽기만 한다.
      (월요일에 v1으로 낸 W42 제출물은 그 뒤에 생긴다 — 화요일 9-3b가 연다.)

```bash
D=~/sunday-check && mkdir -m 700 -p $D && R=$D/rehearse.db
sudo docker exec repman sqlite3 /data/db/worklog.db ".backup '/data/db/worklog.db.sunday-check'"   # 살아 있는 DB는 컨테이너 안에서 .backup으로만 (OPS-07)
cp /data/worklog/db/worklog.db.sunday-check "$R" && rm /data/worklog/db/worklog.db.sunday-check
c() { for t in $(sqlite3 "$R" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY 1"); do
        echo "$t $(sqlite3 "$R" "SELECT COUNT(*) FROM \"$t\"")"; done; }
c > $D/before.txt
cd ~/repman-rollup && DATABASE_URL=file:$R npx prisma db push --skip-generate      # 확인 질문 없이 「in sync」 (물으면 N — 화요일 No-go감)
c > $D/after.txt; sqlite3 "$R" "PRAGMA integrity_check; PRAGMA foreign_key_check;"; diff $D/before.txt $D/after.txt   # ok · `>` 일곱 줄(새 표 0)뿐
cd ~/repman-rollup && DATABASE_URL=file:/data/worklog/db/worklog.db STORAGE_ROOT=/data/worklog npx tsx scripts/check-files.ts --all-templates; echo "exit=$?"
#   --all-templates: 꺼진 부서(기획조정실 포함)의 양식도 웹 작성 길로 채워 본다(종료 코드에 넣지 않는다). 「└ 부서:」에 기획조정실이 있으면
#   새 양식 파일을 담당에게 미리 받아 둔다 — 꺼진 부서는 로그인이 안 되고 운영자는 남의 부서 양식을 못 올리니, 9-3에서 켠 뒤 담당이 「부서 설정」에서 바꾼다(9-3b)
rm -rf $D
```

## 2. 화요일(10/13) 순서

### ① 07:00 준비

```bash
TS=$(date +%Y%m%d-%H%M); mkdir -m 700 ~/deploy-$TS && echo "$TS" > ~/deploy-current
#   새 터미널에서는: TS=$(cat ~/deploy-current)
q() { sudo docker exec repman sqlite3 -header -column /data/db/worklog.db "$@"; }   # 새 터미널마다 다시 정의한다
cd ~/repman
```

- **금지 시간대** — [DEPLOY.md](DEPLOY.md) §2b-0의 쿼리 그대로. W42가 기본(목 14:00)이면 금지는 **10/14(수) 11:30 ~ 10/15(목) 16:30** — 화요일은 밖이다.
  연휴 예외가 있으면 그 값으로 다시 센다. ⑥의 `deploy.sh`도 이번 주·다음 주를 다시 본다(같은 계산 — `[OPS-T19d]`).
  **롤백 창**: ⑥ 뒤 롤백(§3.1)은 수요일 11:30 전이면 그대로, 그 뒤 목 16:30까지는 `--ignore-window`(§3.1 명령에 이미 붙어 있다).
- **디스크** — §2b-1. 루트 여유 5G 이상.
- **야간 백업** — 오늘 03:00 db · 03:30 files 둘 다 성공(files도 2026-10-09부터 매일 — 1절):

```bash
tail -4 ~/kei-backups/worklog-backup.log
df -h / | tail -1
```

- **배포 전 기록** (사람 이름 없음 — 수만):

```bash
q "SELECT COUNT(*) AS 부서, SUM(isActive) AS 켜짐, SUM(notifyEnabled) AS 알림, SUM(boardStatus='confirmed') AS 집계 FROM Division;
   SELECT COUNT(*) AS 사람, SUM(isActive) AS 활성 FROM User;
   SELECT (SELECT COUNT(*) FROM Submission) AS 제출, (SELECT COUNT(*) FROM MergeRun) AS 병합, (SELECT COUNT(*) FROM NotifyLog) AS 알림기록;
   SELECT d.nameKo AS 부서, COUNT(*) AS W42제출, SUM(s.origin = 'upload') AS hwp로
     FROM Submission s JOIN WeekSlot w ON w.id = s.weekSlotId JOIN Division d ON d.id = s.divisionId
    WHERE w.isoKey = '2026-W42' AND s.isLatest = 1 GROUP BY d.id;" \
  | tee ~/deploy-$TS/before.txt
#   마지막 줄 — 월요일에 v1으로 낸 이번 주 제출(파일럿 부서). 없으면 줄이 없다. 있으면 ⑩에서 하나 연다
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

> [Tincase] 오늘(10/13) 07:30~08:30 새 판으로 바꿉니다. 그 사이 몇 분 접속이 끊길 수 있습니다. 끝나면 다시 안내드리겠습니다.

두 부서 안내는 ⑪에서 [ANNOUNCE-v2.md](ANNOUNCE-v2.md)로 — 다른 부서에는 보내지 않는다(범위).

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
git merge --no-ff feat/org-rollup -m "Merge branch 'feat/org-rollup' — v2 운영 전환 (2026-10-13)"
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
실제 데이터로는 아직이다. ④의 스냅샷이 바로 이날의 출발점이니(월요일에 v1으로 낸 것까지 든다), 그 **사본**에 같은 명령을 먼저 돌린다(3초). 사본은 `~/deploy-$TS`(700)에 두고 끝나면 지운다.
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
`MergeJob` · `GuideTourSeen`) · 새 열 7(`Division.rollupOrder`·`rollupNote`·`rollupPageBreak`·`rollupSelf` · `MergeReview.filePath` · `MergeRun.outputSha` · `SetupToken.supersededAt` — 2026-10-10, 밀린 설정 링크 AU-30a).
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
  - `checks.template`만 fail → 배포 탓이 아니다(OPS-41). 롤백하지 않고 ⑨-3(양식 「있음」 확인 — 켠 부서는 지금 AI홍보전략실 하나다)
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
- `[알림] 켜짐 (수신 허용: 전원) · 발송 부서 n/30개: …` — 수신 허용은 `전원`(`.env.production`의 `*` — v1이 그 값을 넣기 전에 떠 있었으면 `notify-before.txt`의 그 칸만 다르다).
  발송 부서(부서 알림은 ⑨-5에서 켠다): v2는 **켜짐 그리고 알림**인 부서만 센다(NT-32 — 2026-10-10). v1 줄(`notify-before.txt`)은 알림 스위치만 셌으니,
  꺼진 부서에 켜 둔 스위치가 있으면 v1보다 수가 적고 줄 끝에 `· 알림만 켠 꺼진 부서 k개: …`가 붙는다 — 그 부서는 9-5의 2에서 끈다. 그 밖이면 같다
- `[merge] 자동 병합 스케줄러 등록 (1분 주기)` — 이 줄이 있으면 환경 검사(OPS-46)와 스키마 검사(OPS-48)를 지났다
- `[merge] 모델 데우기 — 기동 · n초 · keep_alive -1` — 몇 초~수십 초 뒤에 찍힌다

`printenv`에서 하나라도 나오면 테스트 compose 값이 섞였다 — No-go(§3.1 뒤 compose 확인). `SUBMIT_HWP_UPLOAD`가 없는 것이 정상이다:
기본값 `on`은 이제 「전사」의 [올리기](Tincase 밖 섹션의 게시판 hwp를 총괄이 넣는 길, RU-60a)만 연다 — 부서원 hwp 제출은 코드째 없다(WA-39).

### ⑧ 07:50 첫 스케줄러 틱 · 모델 데우기

첫 틱은 기동 20초 뒤, 그다음 1분마다다. 화요일 아침에는 할 일이 없어 조용한 것이 정상이다 — 오류 줄이 없고 이번 주 슬롯이 있으면 돈 것이다.

```bash
sleep 60
sudo docker logs --since 5m repman 2>&1 | grep -E 'FATAL|오류|실패' || echo "틱 오류 없음"
q "SELECT isoKey, label FROM WeekSlot WHERE isoKey IN ('2026-W42', '2026-W43') ORDER BY isoKey;"        # 2026-W42가 있다 (W43은 일정 화면을 연 뒤면 있을 수 있다)
curl -s http://127.0.0.1:11437/api/ps | python3 -m json.tool | grep -E '"name"|"expires_at"'           # 모델이 올라와 있고 expires_at이 아주 먼 미래(상주)
```

- `/ops`의 「병합 줄」 카드: 「이번 주 병합 없음」과 모델 문 한 줄.
- 데우기가 실패해도 No-go는 아니다 — 병합은 모델 없이도 결정론으로 끝난다. 목요일 전에 고친다(`pm2 status tincase-ollama` · DEPLOY §9.4).
  목요일 13:50(마감 10분 전)에 한 번 더 데운다 — 로그 `[merge] 모델 데우기 — 기준 …`.

### ⑨ 08:00 설정 — 두 부서만

켜는 부서는 **기획조정실 · AI홍보전략실** 둘이다(범위). 순서: 범위 확인 → 게시판 값 → 기획조정실 켜기 → 파일 점검 → 사람 → 알림 스위치 → 분류 순서 → 범위 점검.
**3단계는 켜지 않는다** — 「전사」 [일정 바꾸기]의 「3단계 취합」 체크 상자를 누르지 않는다. 기획경영본부도 켜지 않는다. 둘 다 §7.
화면이 있는 것은 화면으로(감사 기록이 남는다). SQL로 바꾼 것은 감사 기록이 없으니 출력을 `~/deploy-$TS/`에 남긴다.

**9-1 범위 확인 — 읽기만**

```bash
q "SELECT nameKo AS 부서, isActive AS 켜짐, notifyEnabled AS 알림, deadlineDow AS 요일, deadlineTime AS 시각 FROM Division
   WHERE isActive = 1 OR notifyEnabled = 1 OR nameKo IN ('기획조정실', 'AI홍보전략실') ORDER BY nameKo;
   SELECT COUNT(*) AS 삼단계 FROM OrgRollupSetting WHERE enabled = 1;" | tee ~/deploy-$TS/scope-before.txt
#   AI홍보전략실 1 1(알림이 0이어도 9-5가 켠다) · 기획조정실 0 0 · 둘 다 4 14:00 — 그 밖의 줄 없음 · 삼단계 0 (설정 줄이 아직 없다 = 꺼짐)
```

- 다른 부서 줄이 있으면 누가 왜 켰는지 먼저 알아본다. 켜짐이면 그 줄 [편집] → 「활성 · 끄기」(9-3과 같은 자리), 알림은 9-5가 끈다.
- 기획조정실이 이미 켜져 있으면 9-3의 켜기만 건너뛴다.

**9-2 취합게시판 값(boardStatus) 3건** — 켜기와 상관없는 기록 바로잡기다(「전사」·감사 문서의 셈이 이 값을 쓴다). `/ops` 부서 표 → 그 줄 [편집] → 「업무일지」 칸에서 고르고 [완료].
표는 이 값으로 나뉘어 보인다 — 줄이 안 보이면 표 위 분류를 바꾼다.

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

**9-3 기획조정실 켜기** — `/ops` 부서 표 → 기획조정실 줄 [편집] (「제출함 (집계)」 분류에 있다)

1. 「양식」 칸이 **「있음」** — 「파일 없음」·「없음」이면 켜지지 않는다(409 `no_template`). 10/06에 이 부서 양식(v2)을 등록했다.
   운영자가 남의 부서 양식을 올리는 화면은 없다(양식 등록은 자기 부서만 — TACP-6).
2. 「마감」 **목 14:00** — 기본값이다. 다르면 요일을 고르고 시각은 칸을 벗어나면 저장된다(그 부서 담당과 맞춘 값이면 그대로).
3. 「상태」 [비활성 · 켜기] → 「활성 · 끄기」로 바뀐다 → [완료].
4. AI홍보전략실 줄은 보기만 한다 — 「활성」 · 목 14:00 · 양식 「있음」.

```bash
curl -sS http://127.0.0.1:11111/api/health | python3 -m json.tool | grep '"template"'     # "template": "ok" (health는 켠 부서의 양식 파일을 본다)
```

끄기(되돌리기)는 같은 자리 [활성 · 끄기] — 「기획조정실은 오늘 끄고 AI홍보전략실만으로 간다」(9-3b · §4)의 길이 이것이다.

**9-3b 파일 점검 — 이 판의 읽기로 운영 파일을 한 번 연다** (OPS-49 · 읽기 전용 · 숫자만)

이행 리허설은 지어낸 파일로만 돌았다 — 8~9월에 한글에서 올린 실제 제출물 · 옛 엔진이 쓴 병합본 · 기획조정실의 실제 양식을 v2로 연 적이 없다.
v2는 지난 제출물·병합본을 부서원 홈에서 열고, 켠 부서의 양식은 웹 작성이 그대로 채운다. 9-3 뒤에(켠 부서가 정해진 뒤) 돌린다 — 몇십 초.

```bash
cd ~/repman && DATABASE_URL=file:/data/worklog/db/worklog.db STORAGE_ROOT=/data/worklog npx tsx scripts/check-files.ts \
  | tee ~/deploy-$TS/files.txt; echo "exit=${PIPESTATUS[0]}"
```

- 기대: `exit=0` · 「끝: 모두 읽혔다」. 「template(꺼진 부서 · 있는지만)」의 「파일 없음」은 문제가 아니다(OPS-41 정리 뒤 남은 기록).
- 「template(켠 부서 · 웹 작성으로 채워 봄)」에 실패가 있으면 **그 부서는 목요일에 아무도 못 낸다** — 바로 아래 「└ 부서: …」 줄이 어느 부서인지 말한다
  (부서 이름만 — 경로·사람 이름은 찍지 않는다). 그 부서 담당이 「부서 설정」에서 양식을 다시 올린다(올릴 때 이 판이 검증한다 — 기획조정실 담당이 아직
  비밀번호가 없으면 그 사람에게만 먼저 설정 링크, 인원 드로어 줄 끝 [링크 보내기]).
  오늘 못 고치면 그 부서는 끈다(9-3) — No-go는 아니다. 기획조정실이면 AI홍보전략실만으로 간다(둘 다 꺼지면 켤 부서가 없다 — 그때는 §3.1).
- 「submission」·「mergeRun」의 실패는 그 주의 지난 문서가 홈에서 열리지 않는다는 뜻이다 — 수를 적어 두고 Go(목요일 전 할 일).

**9-4 사람 — 두 부서** — `/ops` 부서 표 → 그 줄 [열기] → 인원 드로어. 칸: 역할(제출자 · 담당자 (제출) · 부서장 (검토)) · 집계 대상(빼면 사유) · 사번 · 알림.

- **AI홍보전략실** — 지금 그대로(담당 · 부서장 있음). 새로 온 사람이 있으면 사번만 본다.
- **기획조정실**
  - 계정 — 드로어의 사람이 지금 이 부서 인원과 맞는지 본다(빠지거나 떠난 사람이 있으면 `/ops` 「인원 최신화」 — ERP 엑셀 → 미리보기 → [반영]).
    비밀번호는 각자 ⑪-3의 설정 링크로 정한다(아래 쿼리의 「비번없음」이 그 수 — 사번 없는 사람은 링크 목록에서 빠진다).
  - 담당(lead) **1명 이상** — 병합본을 확인해 취합게시판에 올리는 사람. 「병합 점검」 쪽지도 이 부서 담당 전원에게 간다(총괄이 있는 부서 — NOTIFICATIONS-v2 §3.4).
  - 부서장(head) — **담당의 답대로**(1절): 실장이 Tincase에서 검토하면 「부서장 (검토)」, 아니면 두지 않는다.
    3단계가 꺼져 있어 부서장이 없어도 저절로 위로 가는 것은 없다 — 담당이 확인한 병합본이 최종이다(위로 저절로 가는 RU-71은 3단계를 켠 뒤의 일이다).
  - 실장은 어느 쪽이든 **집계 제외**(사유 「부서장」) — 명단 안이면 매주 「미제출」로 잡히고 마감 독촉 세 통을 받는다(DM-16). 아래 쿼리는 부서장 역할만 세니 드로어에서 본다. 휴직자도 뺀다.
  - 사번이 없으면 쪽지가 안 간다 — 사번 칸에 넣는다(NT-22). 설정 링크를 한 번에 보내는 목록도 사번이 있는 사람만이다(⑪-3).
- 총괄(`isCoordinator`)·운영자는 화면으로 못 바꾼다(TACP-2) — 아래로 확인만 하고, 없을 때만 SQL.

```bash
q "SELECT d.nameKo AS 부서, d.isActive AS 켜짐, d.notifyEnabled AS 알림, d.deadlineDow AS 요일, d.deadlineTime AS 시각,
          SUM(u.isActive AND u.onRoster) AS 명단, SUM(u.isActive AND u.divisionRole = 'lead') AS 담당,
          SUM(u.isActive AND u.divisionRole = 'head') AS 부서장, SUM(u.isActive AND u.employeeNo IS NULL) AS 사번없음,
          SUM(u.isActive AND u.passwordHash IS NULL) AS 비번없음, SUM(u.isActive AND u.divisionRole = 'head' AND u.onRoster) AS 부서장명단
   FROM Division d LEFT JOIN User u ON u.divisionId = d.id
   WHERE d.nameKo IN ('기획조정실', 'AI홍보전략실')
   GROUP BY d.id ORDER BY d.nameKo;" | tee ~/deploy-$TS/divisions-after.txt
q "SELECT d.nameKo AS 총괄부서, COUNT(*) AS 총괄, SUM(u.employeeNo IS NOT NULL AND u.notifyEnabled) AS 알림받음
   FROM User u JOIN Division d ON d.id = u.divisionId WHERE u.isActive = 1 AND u.isCoordinator = 1 GROUP BY d.id;
   SELECT COUNT(*) AS 운영자, SUM(employeeNo IS NOT NULL AND notifyEnabled) AS 알림받음 FROM User WHERE isActive = 1 AND isOperator = 1;"
```

- 기대: 두 줄 · 켜짐 1 · 요일 4 · 시각 14:00 · 담당 ≥ 1 · **부서장명단 0** · 부서장은 AI홍보전략실 그대로 · 기획조정실은 담당의 답(1 또는 0) ·
  사번없음 0(아니면 누구인지 안다) · 총괄 ≥ 1(「병합 점검」을 기획조정실 담당이 받는 근거 — 총괄의 알림받음은 §7에서 본다) · 운영자 알림받음 1.
  알림 칸은 9-5 전이라 기획조정실 0이 맞다.
- **부서장명단이 0이 아니면 9-5 전에 고친다** — 집계 대상(onRoster)인 부서장은 매주 「미제출」로 잡히고, 알림을 켜는 순간 **부서장에게 마감 독촉 세 통**이 간다
  (마감 전 알림은 명단 안 미제출자에게 — NOTIFICATIONS-v2 §3.1). 인원 드로어에서 그 줄을 집계 제외(사유 「부서장」). 이행 리허설 보고 6.
- 총괄이 없을 때만: `q "UPDATE User SET isCoordinator = 1 WHERE email = '<총괄-이메일>' AND isActive = 1; SELECT changes();" | tee -a ~/deploy-$TS/sql.txt` → 1.

**9-5 부서 알림 스위치 — 두 부서만** — `/ops` 부서 표의 「알림」 칸(인원 드로어의 「알림」은 사람마다의 칸이다)

1. 기획조정실 · AI홍보전략실 줄 [편집] → 「알림」이 [끔 · 켜기]면 눌러 「켬 · 끄기」로 → [완료]. 이미 「켬」이면 그대로 둔다.
   9-3에서 기획조정실을 껐으면 그 줄의 알림은 켜지 않는다.
2. 두 부서 밖에 「알림」 칩이 「켬」인 줄이 있으면 그 줄 [편집] → [켬 · 끄기] → [완료]. 표 위 분류 둘(제출 확인 · 이력 없음)을 다 본다.
3. 확인 — 읽기만:

```bash
q "SELECT nameKo AS 부서, isActive AS 켜짐, notifyEnabled AS 알림 FROM Division WHERE isActive = 1 OR notifyEnabled = 1 ORDER BY nameKo;" \
  | tee ~/deploy-$TS/notify-after.txt
#   AI홍보전략실 1 1 · 기획조정실 1 1 — 이 두 줄뿐 (기획조정실을 껐으면 AI홍보전략실 한 줄)
```

- 「알림」은 켜짐과 따로 저장된다 — 꺼진 부서의 「켬」은 지금은 아무것도 보내지 않지만 그 부서를 켜는 순간 쪽지가 가기 시작한다. 그래서 2에서 끈다.
- 누른 것은 감사 기록에 남는다 — `/ops/audit` 「설정 변경」 · `{"changed":["notifyEnabled"],"notifyEnabled":true}`. 예전 SQL 길에는 기록이 없었다.
- 켜면: 그 부서 미제출자(명단 안)에게 마감 전 세 통, 부서장·담당에게 마감 뒤 안내 — [NOTIFICATIONS-v2.md](NOTIFICATIONS-v2.md) 머리말 · §2.
  **오늘은 아무것도 나가지 않는다 — 첫 쪽지는 10/14(수) 11:45.** 받는 사람 수는 그 문서 §6의 쿼리로 미리 센다.

**9-6 분류 순서(병합 규칙 초안) — 기획조정실만, 담당이 확인한 뒤에만**

- AI홍보전략실 — 건너뛴다. 부서가 정한 분류 그대로다(스크립트도 이 부서는 다루지 않는다).
- 기획조정실 — 초안(`scripts/apply-merge-rule-drafts.ts`의 기획조정실 줄)을 **담당이 확인한 뒤에만** 넣는다. 고칠 것이 있으면 담당이 수합 관리 → 「부서 설정」 →
  「분류 순서」에 넣는다(감사 기록 `rule_update`). 운영자 화면에는 남의 부서 분류를 쓰는 길이 없다(자기 부서만 — TACP-6).
  담당이 초안 그대로 좋다고 하면 운영자가 스크립트를 **`--only=기획조정실`로** 돌려도 된다(OPS-51 — 같은 감사 기록, `via: apply-merge-rule-drafts`):

```bash
cd ~/repman && DATABASE_URL=file:/data/worklog/db/worklog.db npx tsx scripts/apply-merge-rule-drafts.ts --only=기획조정실
#   미리 보기: 「• 기획조정실: mergeCategories」 · 「- 인사관리실: 건너뜀 (--only 밖)」 (「= 기획조정실: 바꿀 것 없음」이면 담당이 이미 넣었다 — 여기서 멈춘다)
cd ~/repman && DATABASE_URL=file:/data/worklog/db/worklog.db ACTOR=<운영자-이메일> npx tsx scripts/apply-merge-rule-drafts.ts --only=기획조정실 --apply; echo "exit=$?"
#   「반영했습니다.」 · exit=0. 이름이 틀리면 아무것도 쓰지 않고 exit=2
```

  확인 전이면 비워 둔다 — 분류가 없어도 병합은 된다(제출자 순).
- `--only` 없는 `--apply`는 **돌리지 않는다** — 분류가 비어 있는 두 부서(기획조정실 · 인사관리실)를 한꺼번에 쓴다. 인사관리실은 꺼져 있고 담당 확인 전이다(§6).

**9-7 범위 점검 — 마지막 · 읽기만**

```bash
q "SELECT SUM(isActive) AS 켜짐, SUM(notifyEnabled) AS 알림,
          SUM((isActive = 1 OR notifyEnabled = 1) AND nameKo NOT IN ('기획조정실', 'AI홍보전략실')) AS 범위밖
   FROM Division;
   SELECT COUNT(*) AS 삼단계 FROM OrgRollupSetting WHERE enabled = 1;" | tee ~/deploy-$TS/scope-after.txt
#   2 · 2 · 0  그리고  0   (기획조정실을 껐으면 1 · 1 · 0 · 0)
```

- 범위밖이 0이 아니면 9-1의 쿼리로 어느 부서인지 보고 끈다. 삼단계가 1이면 누가 「전사」에서 켰다 — 같은 자리에서 끈다(§3).

### ⑩ 08:40 스모크 — 운영자 계정으로

운영이다 — **제출 · 병합 · 승인 · 마감 바꾸기 · 3단계 스위치는 누르지 않는다.**

| 무엇 | 어디 | 기대 |
|---|---|---|
| 비로그인 | `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:11111/` | 30x → `/login`. `/login`·`/forgot` 열림 · 맨 위 띠 없음 |
| 기존 로그인 | 쓰던 브라우저를 새로 고침 | 다시 로그인하지 않고 열린다(쿠키 이름 그대로) |
| 운영 | `/ops` | 부서 표(양식 · 업무일지 열) — 「활성」은 두 부서뿐 · 「병합 줄」 카드 · 머리에 [알림 수신함] 없음 · `/ops/notify-sink`는 404 |
| 부서원 홈 | 내 부서 `/<부서-slug>` | 이번 주 카드 「마감 목 14:00」과 [작성하기] 하나 · 지난 주차 달별 · 업로드·드롭존·「양식 받기」 없음 · 지난 hwp 제출물이 열린다 · [작성하기] → 양식 표 셋(제출하지 않고 Esc) |
| 월요일 제출 (①의 「W42제출」이 있으면) | `/<AI홍보전략실-slug>/manage` | 제출 현황에 그 사람들이 「제출」(월요일 시각) · 한 사람 [열기] → 표가 그 hwp 내용으로(WA-39d). 본인 화면에서는 이번 주 카드 「제출 완료」 · [열기]가 그 내용으로 채운 작성 화면 — 협조해 줄 사람이 있으면 **열어 보기만** |
| 담당자 | `/<부서-slug>/manage` (내 부서) | 제출 현황 · [이름 복사] · 병합 카드 · 머리 링크 「부서 설정」 → 양식 · 「위로」 카드 **없음**(3단계 꺼짐) |
| 기획조정실 (열람) | `/<기획조정실-slug>/manage` | 타 부서 칩(읽기 전용) · 명단 수 · 양식 상태 |
| 「전사」 | `/org` | 열린다(500 아님) · 「3단계 취합」 **꺼짐 — 누르지 않는다**. 처음 열면 기본 섹션 13개가 저장된다 — 해는 없다(확인은 §7-3) |
| 옛 주소 | `/<부서-slug>/archive` · `/<부서-slug>/history` · `/ops/monitor` | 앞의 둘은 수합 관리·홈으로 보낸다(이미 나간 쪽지 링크, 2026-12-31까지) · `/ops/monitor`는 404 |
| 사용 안내 | 메뉴 「사용 안내」 · 사용자 메뉴 「화면 둘러보기」 | 안내가 열리고 둘러보기가 지금 화면 위에 뜬다 — 운영자에게는 구석 카드가 뜨지 않는 것이 정상 |

운영자 계정으로 볼 수 없는 것 — 실·팀장 [승인], 처음 로그인하는 사람의 구석 카드 — 은 한 주 리허설에서 봤다
([REHEARSAL.md](REHEARSAL.md): 기대 47통 모두 창 안에 한 번 · 뜻밖 0 · 승인 9/9), 그 단추를 화면에서 눌러 끝까지 가는 것은 브라우저 e2e 스모크(같은 문서 OPS-50 —
가짜 사람 · 가짜 모델 · 평문 HTTP)에서 봤다. 운영에서는 첫 사용(목 14:10~)에 ⑫에서 본다. 본부장·총괄의 화면은 §7.
협조해 줄 담당자·부서장이 있으면 [작성하기]·[내용 보기]를 **열어 보기만** 부탁한다.

### ⑪ 08:55 Go/No-go → 안내문 · 설정 링크

§4로 판정한다. Go면:

1. **설정 링크를 자신에게 먼저 한 통** — `/ops` 인원 드로어에서 내 줄의 「링크 보내기」(지금 비밀번호는 그대로 — 링크는 쓸 때만 바꾼다).
   이 판부터 설정 링크도 다른 쪽지처럼 주소를 `URL` 필드에 싣는다(AU-T90 — 본문의 주소는 메신저에서 눌리지 않는다, messenger.md §7 실측).
   메신저에서 **쪽지 제목을 누르면 설정 화면이 열리는지** 본다 — 열리면 그 화면에서 아무것도 저장하지 않고 닫는다(보낸 링크는 3일 뒤 저절로 죽는다).
   안 열리면 안내문의 「주소를 복사해 주소창에 붙여 넣어」 쪽을 쓴다(ANNOUNCE-v2 머리말).
2. **안내문** — [ANNOUNCE-v2.md](ANNOUNCE-v2.md)를 **두 부서에만**(메신저 단체 쪽지). 취합게시판에는 올리지 않는다 — 다른 부서는 꺼져 있어 들어오면 「준비 중」이다. 작업 끝 공지를 겸한다.
3. **설정 링크** — 두 부서 각각 `/ops` 부서 줄 [열기] → 인원 드로어 → 「미발급 n명에게 링크 보내기」(한 번에 60명까지 · 운영자당 1분에 10번 — 「요청이 너무 잦습니다」면 몇 초 뒤 다시).
   AI홍보전략실은 파일럿 때 발급해 대개 몇 명 안 된다 · 기획조정실은 거의 전원이다.
   **3일 만료** — 화요일에 보내면 금요일 아침까지다(목 14:00 마감을 덮는다). 링크는 본인 알림 설정과 상관없이 간다(NT-20).
   사번이 없는 사람은 이 목록에서 빠진다 — 인원 드로어에 사번을 넣거나, 그 사람만 줄 끝 [직접](임시 비밀번호 표시 — 개인별로 전달, 단체 쪽지 금지).
   결과에 「수신 허용 목록 밖」이 있으면 env가 `*`가 아니다 — ⑦ 기동 로그의 `(수신 허용: …)`를 다시 본다.

No-go면 §3.

### ⑫ 09:00~ 지켜보기

```bash
sudo docker logs -f --since 1m repman 2>&1 | grep --line-buffered -E 'FATAL|오류|\[알림\]|\[merge\]|\[자동\]'
q "SELECT chapter AS 장, outcome AS 고른것, COUNT(*) AS 사람 FROM GuideTourSeen GROUP BY 1, 2;"   # 첫 로그인 둘러보기
```

`/ops` 인원의 「미발급」 수가 줄어드는지, `/ops/audit`의 「설정 링크 발송」을 본다.

**이번 주(W42) 시각표 — 화 10/13 전환 · 목 10/15 14:00 마감** — 두 부서 · **3단계 꺼짐**. 쪽지 문구와 받는 사람은 [NOTIFICATIONS-v2.md](NOTIFICATIONS-v2.md) 머리말 · §2 · §3.

| 시각 | 무엇 | 운영자가 볼 것 |
|---|---|---|
| 월 10/12 | v1 그대로(운영자 없음) — 파일럿 부서원은 hwp로도 낼 수 있다 | 아무것도 하지 않는다. 화요일 ①이 그 수를 센다 |
| 화 10/13 07:00~09:00 | 전환 ①~⑪ — 안내문 · 설정 링크(3일 → 금 아침까지) | §4 Go/No-go |
| 화 09:00~ | 첫 로그인 · 첫 작성 · 월요일에 낸 사람은 [열기]로 고쳐 다시 낼 수 있다 | ⑫ — `/ops` 「미발급」 수 · 둘러보기 쿼리 · 「설정 링크 발송」 |
| 수 10/14 ~11:29 | 화요일에 못 끝낸 전환의 마지막 창 · `--ignore-window` 없는 롤백의 끝 | |
| 수 11:30 | 금지 시간대 시작 | 배포·재기동하지 않는다(롤백은 `--ignore-window` — §3.1) |
| 수 11:45 | 마감 하루 전 쪽지 — 두 부서 미제출자 | `[알림] 마감 하루 전 — {부서} 2026-W42: n/m명 발송` · 「허용 목록 밖」 줄 없음 |
| 목 13:00 · 13:50 | 1시간 전 · 10분 전 | 〃 |
| 13:50 | 모델 다시 데우기 | `[merge] 모델 데우기 — 기준 …` |
| 14:01 | 자동 병합 — 줄에 넣고 하나씩 | `[merge] 자동 병합 n건 줄에 넣음`(n ≤ 2) · `[merge] 줄 k/n — …` · `/ops` 「병합 줄」 |
| ~14:15까지 | 「병합 점검」 — 운영자·기획조정실 담당 | 받은 쪽지의 실패·모델 못 씀·보류 · **「예상 끝」이 15:00(마감 +60분)을 넘으면** 그 뒤에 끝나는 부서에는 검토 요청·담당자 안내가 가지 않는다(HM-50) — 그 부서 담당·부서장에게 직접 알린다 |
| 14:10~ · 14:30~ | 부서장 검토 요청(부서장을 둔 부서) · 담당자 안내 「병합본 제출해주세요」 | 부서장이 승인하면 담당에게 「승인 완료」 — 둘 다 끝 줄이 「취합게시판에 올려」(v1.39 그대로) |
| 15:00 | 대외 마감 — 두 부서 담당이 지금처럼 취합게시판에 올린다 | Tincase 밖의 일 |
| 16:30 | 금지 시간대 끝 | |

본부장·총괄 쪽지(3단계)는 이번 주에 하나도 없다 — 나가면 3단계가 켜진 것이다(9-7 · §3). 나간 쪽지 수는 NOTIFICATIONS-v2 §6의 둘째 쿼리.

## 3. 롤백

| 상황 | 할 일 |
|---|---|
| ⑥ 전 어디서든 멈춤 | **앱은 아무것도 안 한다** — 옛 앱이 돈다. ⑤로 더한 표·열은 옛 앱이 모르고 지나간다(2026-10-09 v1.39.0 모양의 DB로 옛 앱의 읽기·쓰기 확인 — 이행 리허설). 수요일 11:29까지 다시 하면 합침·태그를 그대로 쓴다(그 뒤는 금지 시간대 — 이번 주는 v1으로 마친다). **며칠 미루면 `main`을 되돌린다** — 그대로 두면 다음 `deploy.sh prod`(빌드)가 v2를 굽는다: `git -C ~/repman reset --hard "$(cat ~/deploy-$TS/old-commit)" && git -C ~/repman tag -d v2.0.0` (push 전이라 안전 · 추적 안 된 ADR 파일은 그대로) |
| `[boot] FATAL: DB 스키마가 …` | 롤백 아님 — ⑤ 뒤 `bash scripts/deploy.sh prod --no-build` |
| health `checks.template`만 fail | 롤백 아님 — 양식 파일이 빠진 켠 부서(⑨-3) |
| 3단계가 켜져 있다(본부·총괄 쪽지 · 「위로」 카드) | 오늘은 꺼져 있어야 한다 — 「전사」 [일정 바꾸기]에서 끈다. 나머지는 그대로. 끄면 숨을 뿐 데이터는 남는다 |
| 쪽지만 멈춰야 한다 | §3.3 |
| health `ok:false`(template 밖) · 스케줄러 등록 줄 없음 · 띠가 뜬다 · `printenv`에 테스트 값 · 주요 화면 500 · 전원 로그아웃 | **§3.1 이미지만** |
| 데이터가 망가졌다 | §3.1 + §3.2 |

**롤백 창** — ⑥(화 07:30) 뒤 언제든 §3.1로 되돌릴 수 있다. 수요일 11:30 전이면 금지 시간대 밖이고, 그 뒤 목 16:30까지는 `--ignore-window`가 필요하다 — 아래 명령에 이미 붙어 있다.
되돌릴지 정하는 마지막 편한 때는 **수요일 11:30 전** — 첫 v2 쪽지(수 11:45 · 마감 하루 전) 전이라 이번 주 쪽지가 한 판의 문구로 나간다.

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
- DB는 그대로다 — ⑨에서 한 설정(기획조정실 켜기 · 사람 · 알림 스위치)이 남고 옛 앱도 그것을 따른다. 기획조정실에도 **v1 쪽지**가 간다
  (당일 09:00 알림 포함, 끝 줄 「취합게시판에 올리고」).
- 옛 앱에는 **hwp 업로드 제출이 다시 열린다.** 「웹 작성만」이라고 안내했으면 한 줄 정정한다.
- 체크아웃은 그대로 둔다(동작은 이미지가 정한다). 3단계는 오늘 켜지 않으니 남는 스위치 값이 없다 — §7로 켠 뒤에 v1으로 내린다면 그 값이 DB에 남아
  v2를 다시 올릴 때 켜진 채로 뜬다. 옛 앱에는 그 화면이 없으니 다시 올리기 전에 끌 거면 `q "UPDATE OrgRollupSetting SET enabled = 0;"`.

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
| 한 부서의 부서원·담당자·부서장 쪽지 | `/ops` 부서 표 → 그 줄 [편집] → 「알림」 [켬 · 끄기] (화면이 안 열리면 `q "UPDATE Division SET notifyEnabled = 0 WHERE nameKo = '<부서>';"`) | 본부장·총괄의 3단계 쪽지 · 병합 점검 |
| 한 사람 | `/ops` 인원 드로어 → 알림 끄기(NT-22) | |
| 3단계 쪽지 전부 (§7로 켠 뒤) | 「전사」 3단계 끄기(자동 진행도 멈춘다) | |
| 병합 · 병합 안내 · 병합 점검 | `MERGE_PAUSE_UNTIL` — [spec 09 OPS-16a](spec/09-deployment-ops.md) (금지 시간대 안이면 `--ignore-window`) | 마감 전 쪽지 · 3단계 쪽지 |
| 전부 | `.env.production`의 `MESSENGER_URL`을 비우고 `bash scripts/deploy.sh prod --no-build --ignore-window` | 앱은 돈다 — 설정 링크·비밀번호 찾기도 멈춘다 |

## 4. Go / No-go

**Go — 모두 ✓ (⑪에서)**

- [ ] ① `IMAGE-SAME` · `repman:v1.39.0` 태그 있음 (`image-v1.txt`) · 지금이 화요일 07:00 ~ 수요일 11:29(금지 시간대 밖)
- [ ] ⑤-0 사본 push — 확인 질문 없음 · `ok` · diff는 새 표 일곱 줄뿐
- [ ] ⑤ 새 표 7 · `integrity_check` ok · 행 수가 `before.txt`와 같다
- [ ] ⑥ `exit=0` · ⑦ health `ok:true`, checks 전부 ok · FATAL 0
- [ ] 로그 `[merge] 자동 병합 스케줄러 등록 (1분 주기)` · `[알림] 켜짐 (수신 허용: 전원)` — env는 바꾸지 않았다(1절). 전원이 아니면 ⑪-3 결과에 「수신 허용 목록 밖」이 뜬다
- [ ] `printenv`에 테스트 값 없음 · 띠 없음 · `/ops/notify-sink` 404
- [ ] ⑧ 틱 오류 없음 · 모델 상주 (아니면 목요일 전 할 일로 적고 Go)
- [ ] 기존 로그인 유지
- [ ] 9-7 범위 점검 — 켜짐 2 · 알림 2 · 범위밖 0 · 삼단계 0 (기획조정실을 껐으면 1 · 1 · 0 · 0)
- [ ] 9-4 `divisions-after.txt` — 두 부서 모두 담당 ≥ 1 · 목 14:00 · **부서장명단 0** · 사번없음 0(아니면 누구인지 안다) · 기획조정실 부서장은 담당의 답대로 · 실장 집계 제외
- [ ] 9-3b 파일 점검 — 두 부서 양식 실패 0 (기획조정실이 실패면 껐다). 제출·병합본 실패는 수를 적고 Go
- [ ] 총괄 ≥ 1 · 운영자 알림받음 1
- [ ] ⑩ 스모크 통과 — ①의 「W42제출」이 있으면 그 하나가 열렸다(월요일에 v1으로 낸 것 — 안 열리면 No-go는 아니다: 그 사람에게 [작성하기]로 다시 내 달라고 하고 수를 적는다)
- [ ] 11112 스케줄러 꺼짐 (1절)

**No-go — 하나라도면 멈춘다**

- ①의 이미지가 다르다(`IMAGE-SAME` 아님) → 누가 무엇을 구웠는지 알기 전에는 ⑥을 하지 않는다 — 롤백할 이미지가 v1이라는 보장이 없다
- ⑤-0이나 ⑤가 데이터 손실을 묻는다 · 새 표가 7이 아니다 · `integrity_check`가 ok가 아니다 · 행 수가 줄었다 → ⑥을 하지 않는다(옛 앱 그대로)
- 금지 시간대 · 디스크 5G 미만 · 오늘 야간 백업 실패 → ⑥을 하지 않는다
- ⑥ 뒤: health `ok:false`(template 밖) · 스케줄러 등록 줄 없음 · 띠 · `printenv`에 테스트 값 · 전원 로그아웃 → §3.1

**No-go가 아닌 것** — 기획조정실만 준비가 안 됐다(양식 실패 · 담당 없음 · 담당이 오늘 못 받음): 9-3에서 끄고 AI홍보전략실만으로 Go. 기획조정실은 §6 순서로 다른 날 켠다.
그래도 기획조정실 담당은 「병합 점검」을 받는다(총괄이 있는 부서의 담당에게 가고 부서 켜짐을 보지 않는다) — 원치 않으면 그 사람의 「알림」 칸을 끄고, 켜는 날 다시 켠다.

**3단계는 끈 채로 Go** — 9-7의 삼단계 0. 켜는 것은 §7.

## 5. 운영자 질문 — 2026-10-09 답

1. **국가지속가능발전연구센터** — **전환일에 켜지 않는다.** 대상 부서 기록(13곳)에도 없다 — 양식·담당이 생기면 §6 순서로. 그때까지 「Tincase 밖」
   (3단계를 켠 뒤에는 총괄이 게시판으로 받은 hwp를 「전사」 [올리기]로 넣는다). 12 §11a RU-60a의 「2026-10-12부터는 전 섹션이 Tincase」는 이 결정으로 맞지 않게 됐다 — 2026-10-10 고쳤다.
2. **3단계** — **전환일에는 끈다**(범위). §7 — 기획경영본부 산하 다섯 실이 켜진 뒤, 늦어도 10/26 주. 12 §10·§11의 「시연 전 주(10/26 주)에 올린다」와 같은 쪽이다.
3. **수신 허용 목록** — **이미 `*`, 그대로 둔다**(2026-10-09 확인). 받는 사람은 부서 켜짐 + 부서 알림 스위치(9-5 · `/ops` 부서 표 「알림」)와 사람마다의 알림 칸이 정한다.
4. **총괄 = 최종본을 NAMS에 올리는 사람인가** — 3단계를 켤 때만 뜻이 있다(「전사본 준비」가 총괄 각자에게 간다) — **미룬다**(§7 조건).
   전환일에 총괄 계정이 하는 일은 「병합 점검」의 받는 곳(총괄이 있는 부서 = 기획조정실의 담당)을 정하는 것뿐이다.
5. ~~설정 링크 본문 주소가 메신저에서 눌리나~~ — **고쳤다(2026-10-09, AU-T90).** 본문 주소는 눌리지 않는다는 것이 이미 실측(messenger.md §7)이라
   설정 링크·비밀번호 찾기도 주소를 `URL` 필드에 싣는다(제목을 누르면 열린다). 남은 것은 ⑪-1에서 제목을 눌러 열리는지 한 번 보는 것뿐.
6. **모델 서버를 11112와 함께 쓴다** — 「목요일 마감 시간에 11112에서 병합하지 않는다」로 충분한가, 인스턴스를 나누나.
7. **병합 규칙 초안**(분류 순서) — **전환일: AI홍보전략실은 건너뛴다**(자기 분류 그대로) · **기획조정실은 담당이 확인한 뒤에만**, 담당이 「부서 설정」에서(9-6).
   초안 그대로면 스크립트를 `--only=기획조정실`로만 돌려도 된다(2026-10-09 — OPS-51). `--only` 없는 `--apply`는 인사관리실까지 쓰니 전환일에는 돌리지 않는다.
8. **CHANGELOG** — 「미출시」 절들을 `v2.0.0 — 2026-10-13`으로 묶는 일을 ③ 전에 릴리스 커밋에 넣을지, 배포 뒤에 할지.
9. **이행 리허설을 실제 데이터로** — 2026-10-09 리허설은 운영 사본 복사가 막혀(개인정보) 지어낸 사람의 DB로만 돌았다. 이 문서는 그 빈 곳을
   ⑤-0(스냅샷 사본에 push)과 9-3b(파일 점검)로 전환일에 메운다. 더 일찍 알고 싶으면 주말에 같은 둘을 돌린다(1절 끝). 실제 데이터로 화면을
   한 바퀴 도는 것(이행 리허설 3)은 ⑩ 스모크가 대신한다 — 3단계를 켠 흐름은 한 주 리허설(REHEARSAL.md · 지어낸 사람)에서만 봤다(운영에서는 §7).
10. **목요일에 서버가 죽으면** — [DEPLOY.md](DEPLOY.md) 「장애 시」(OPS-18)를 그대로 쓸 수 있는 규모다: 켠 두 부서가 부서 양식 메일 · 취합게시판으로 되돌아간다
   (3단계가 꺼져 있어 본부·전사 취합은 원래 손이다). 남은 것은 누가 두 부서에 공지하나. 켠 부서 양식은 NFS의 `files/divisions-*.tar.gz`에 든다
   (files 백업은 2026-10-09부터 매일 — 1절. 공개 저장소에는 두지 않는다). 부서를 늘리고 3단계를 켜면(§6 · §7) 다시 정한다.
11. **부서장** — **AI홍보전략실은 지금 부서장 그대로.** 기획조정실은 담당에게 「실장이 Tincase에서 검토하나」를 물어 — 예면 부서장(head),
   아니면 첫 몇 주는 담당만(3단계가 꺼져 있어 저절로 위로 가는 것이 없다 — 부서장이 없으면 담당이 확인한 병합본이 최종). 9-4.
12. **쪽지 문구** — **전환일에는 그대로.** 첫 목요일(10/15) 뒤 v2.0.1에서 고친다([NOTIFICATIONS-v2.md](NOTIFICATIONS-v2.md) §5).

## 끝나고

- 스냅샷 `worklog.db.predeploy-$TS`는 **다음** 배포가 무사히 끝난 뒤 지운다.
- `repman:v1.39.0` 태그도 v2로 한 주(첫 목요일 마감)를 무사히 지난 뒤 떼어 낸다 — `sudo docker rmi repman:v1.39.0`(그 이미지에 다른 태그가 없으면 이미지째 지워진다 — 그때는 더 쓸 일이 없다).
- `~/deploy-$TS/sql.txt`가 이날 SQL로 바꾼 것(9-4 총괄 — 없을 때만)의 유일한 기록이다 — 감사 기록이 없다. 9-5 알림 스위치는 화면으로 바꿔 감사 기록(「설정 변경」)에 남는다.
- 다음 날 아침 야간 백업 로그: db·files 둘 다 성공(새 디렉터리 `divisions/*/reports/`·`org/`도 files 묶음에 들어간다).
- push(선택) — 공개 저장소다. `bash scripts/check-secrets.sh >/dev/null 2>&1; echo $?`가 0인지 **종료 코드로** 본 뒤 `git push origin main v2.0.0`.
  이력에 남은 실명 문제(비공개 전환·이력 재작성)는 따로 정한다.
- 첫 목요일(10/15) 뒤: 쪽지 문구 손질(v2.0.1 — NOTIFICATIONS-v2 §5). 다음 부서는 §6, 3단계는 §7.

## 6. 다른 부서 켜기 (부서마다) — 10/19 주부터

코드·배포·env는 그대로다 — `/ops` 화면과 확인용 SQL 몇 줄이다. 배포가 아니라 금지 시간대와 상관없지만 **월요일(늦어도 화요일) 오전**에 한다 —
설정 링크는 3일이면 죽고, 첫 쪽지(수 11:45)의 창을 놓치면 소급하지 않는다(NOTIFICATIONS-v2 §1). §7로 3단계를 켠 뒤에는 **월요일 오전만** —
부서를 켜고 끄는 순간 이번 주를 위에서 아래로 다시 맞춘다(RU-72). 한 번에 한 부서(또는 몇 부서).
**순서 권고**: 기획경영본부 산하 셋(연구관리실 · 인사관리실 · 경영지원실)부터 — §7의 조건이다.

**전날까지**

- [ ] 그 부서와 정한다: 담당(lead) 1명 이상 · 부서장(head)을 둘지 — 실장이 Tincase에서 검토하지 않으면 두지 않는다(3단계가 꺼진 동안은 담당이 확인한 병합본이 최종.
      §7 뒤라면 부서장 없는 부서는 마감 뒤 병합본이 저절로 위로 간다 — RU-71).
- [ ] 양식 — `/ops` 「양식」 「있음」(대상 부서는 10/06에 등록했다). 쓸 만한지는 1절 끝의 `check-files.ts --all-templates`로 미리 —
      「template(꺼진 부서 · 웹 작성으로 채워 봄)」 아래 「└ 부서:」에 그 부서가 없어야 한다. 있으면 새 양식을 담당에게 받아 두고 켠 날 담당이 「부서 설정」에서 바꾼다
      (꺼진 부서는 로그인이 안 되고, 운영자가 남의 부서 양식을 올리는 화면은 없다). 「없음」·「파일 없음」이면 켤 수조차 없다(409) — 화면만으로는 못 푼다
      (대상 13곳은 해당 없음 · 밖의 부서만. OPS-41 — 한 파일을 여러 부서에 등록하지 않는다).
- [ ] 인원 드로어에 미리 — 역할 · 집계 제외(실장 · 휴직 — 사유) · 사번. 사람 칸은 바꿔도 쪽지가 나가지 않는다.

**그날** — `q`는 ①과 같다. 부서 이름을 `S`에 두고, ⑨의 명령을 쓸 때는 기록 자리 `~/deploy-$TS/`를 `$L/`로 바꾼다.

```bash
S='<부서>'; L=~/ops-$(date +%Y%m%d) && mkdir -m 700 -p $L
```

1. `/ops` 부서 표 → 그 줄 [편집] → 「양식」 있음 · 「마감」 목 14:00 · [비활성 · 켜기] → [완료] — 9-3과 같다. health `checks.template` ok(9-3의 `curl` 줄).
2. 파일 점검 — 9-3b의 명령 → `exit=0`. 그 부서 양식이 실패면 담당이 「부서 설정」에서 바꾸거나, 오늘 못 하면 끄고 멈춘다.
3. 사람 — 9-4와 같다(쿼리의 `IN (…)`에 `'$S'`를 넣는다): 담당 ≥ 1 · **부서장명단 0** · 사번없음 0. 이것이 맞기 전에는 4로 가지 않는다 — 알림을 켜면 그 주 독촉이 이 칸대로 나간다(9-4).
4. 부서 알림 켜기 — 같은 줄 [편집] → 「알림」 [끔 · 켜기] → 「켬 · 끄기」 → [완료] (9-5와 같은 자리 · 감사 기록 「설정 변경」). 범위 확인 — 읽기만:

   ```bash
   q "SELECT nameKo AS 부서, isActive AS 켜짐, notifyEnabled AS 알림 FROM Division WHERE isActive = 1 OR notifyEnabled = 1 ORDER BY nameKo;
      SELECT nameKo AS 어긋남 FROM Division WHERE isActive <> notifyEnabled;
      SELECT COUNT(*) AS 삼단계 FROM OrgRollupSetting WHERE enabled = 1;" | tee $L/scope.txt
   #   켠 부서가 하나 늘었다 · 어긋남 없음(§7 뒤에는 기획경영본부 한 줄 — 켜짐 · 알림 꺼짐이 맞다) · 삼단계는 §7 전이면 0
   ```

5. 안내문 — [ANNOUNCE-v2.md](ANNOUNCE-v2.md)의 「공통」·「부서원」·「담당자」(·「실·팀장」 — 부서장을 둔 부서만)를 **그 부서에만**(메신저 단체 쪽지).
   §7 뒤라면 그 문서 「3단계를 켜는 날」의 담당자·실·팀장 줄로.
6. 설정 링크 — 인원 드로어 「미발급 n명에게 링크 보내기」(⑪-3과 같다 · 3일 만료).

**끄기(되돌리기)**: 같은 줄 [편집] → [활성 · 끄기] · 「알림」 [켬 · 끄기] → [완료] — 제출·병합본은 남는다. 그 부서 사람에게는 바로 「준비 중」(403)이 뜬다.
알림까지 끄는 것은 다시 켤 때 사람 칸을 맞추기 전에 쪽지가 나가지 않게다(알림은 켜짐과 따로 저장된다).

**부서마다 덧붙일 것**

| 부서 | 덧붙일 것 |
|---|---|
| 경영지원실 · 글로벌대외협력단 | 담당이 비어 있던 곳(12 §10) — 담당부터 |
| 인사관리실 | 분류 순서 초안이 있다 — 담당이 확인하면 담당이 「부서 설정」에 넣거나, 초안 그대로면 운영자가 `apply-merge-rule-drafts.ts --only=인사관리실`(미리 보기 → `--apply`, 9-6과 같은 꼴). `--only` 없이 돌리면 분류가 비어 있는 초안 부서를 모두 쓴다 |
| 탄소중립에너지연구실 · 순환경제연구실 | 섹션 「기후대기전략연구본부」·「생활환경연구본부」를 채운다 — 그 두 본부는 켜지 않는다 |
| 기획경영본부 | 부서처럼 켜지 않는다 — §7에서만(문서 없음 · 알림 끔 · 자기 문서 뺌) |
| 국가지속가능발전연구센터 | 대상 13곳 밖(§5 질문 1) — 양식·담당이 생기면 이 순서로. 그때까지 「Tincase 밖」 |

## 7. 3단계 켜기 — 나중에 (늦어도 10/26 주 월요일 오전)

10/13 전환에는 끈 채로 간다(범위). 켜는 날은 **월요일 오전** — 켜는 순간 이번 주를 위에서 아래로 맞추므로 그 주 승인이 생기기 전이어야 한다(RU-79).
늦어도 **10/26 주**(11/2 운영회의 시연 준비 주 — 12 §11). 10/26 주는 10월의 월간 주다 — 그 주에 켜면 3단계의 첫 주가 월간이다.
배포가 아니다 — 화면 스위치와 SQL 몇 줄. `q`는 ①과 같다.

```bash
L=~/ops-$(date +%Y%m%d) && mkdir -m 700 -p $L; W=$(TZ=Asia/Seoul date +%G-W%V); echo $W     # 켜는 주 — 10/26이면 2026-W44
```

**조건 — 하나라도 아니면 켜지 않는다**

- [ ] 기획경영본부 산하 다섯(기획조정실 · 연구관리실 · AI홍보전략실 · 인사관리실 · 경영지원실) **모두 켜짐**(§6) — 꺼진 실이 있으면 본부본이 그 실을 기다린다
- [ ] 기획경영본부의 **본부장(head) · 본부 담당(lead)** 지정 — 둘 다 설정 링크로 비밀번호를 정했다(7-2)
- [ ] **총괄 = 실제로 최종본을 NAMS에 올리는 사람** — 기획조정실에 확인했다(§5 질문 4). 「전사본 준비」·「받은 전사본이 바뀌었어요」는 총괄 각자에게 간다
- [ ] 단위 나무 — ERP 「상위부서」(`Division.parentKo`, RU-07 · 인원 최신화가 맞추는 값)가 맞다(7-2의 쿼리). 틀리면 받는 곳·쪽지의 「{받는 곳}」이 틀린다
- [ ] 섹션 13줄 · 부서 칸 빈 줄 없음(7-3)
- [ ] 그 주 승인 0(7-4) — 월요일 오전이면 당연하다

**7-1 기획경영본부 — 켜되 알림은 끄고 자기 문서는 뺀다** (12 §12 Q3 — 산하 실만 모은다)

`/ops` 부서 표 → 기획경영본부 줄 [편집] → 「업무일지」 「안 냄」(9-2) · [비활성 · 켜기] → [완료]. 문서를 쓰지 않지만 본부장·본부 담당이 로그인하려면
켜져 있어야 한다(꺼진 부서는 403).

```bash
q "UPDATE Division SET notifyEnabled = 0, rollupSelf = 0 WHERE nameKo = '기획경영본부';
   SELECT nameKo AS 부서, isActive AS 켜짐, notifyEnabled AS 알림, rollupSelf AS 자기문서, boardStatus AS 게시판 FROM Division WHERE nameKo = '기획경영본부';" \
  | tee -a $L/sql.txt
#   기획경영본부 1 0 0 none
```

- 알림을 켜 두면 문서가 없는 본부 담당에게 마감 독촉·「병합본이 아직 없어요」가 간다. 본부장에게 가는 3단계 쪽지는 이 스위치를 보지 않는다(RU-52).
- 자기 문서를 빼지 않으면 본부 자신이 기여 단위가 되어 본부본이 늘 「아직 1곳」(본부 자신)을 기다린다.

**7-2 본부 사람 · 총괄 · 단위 나무** — 기획경영본부 인원 드로어: 본부 담당(lead) ≥ 1 · 본부장(head) 1 · 본부 담당·본부장 밖의 사람은 집계 대상에서 뺀다(사유 「본부 — 문서 없음」) · 사번 · 설정 링크.

```bash
q "SELECT d.nameKo AS 부서, SUM(u.isActive AND u.divisionRole = 'lead') AS 담당, SUM(u.isActive AND u.divisionRole = 'head') AS 본부장,
          SUM(u.isActive AND u.employeeNo IS NULL) AS 사번없음, SUM(u.isActive AND u.passwordHash IS NULL) AS 비번없음
   FROM Division d LEFT JOIN User u ON u.divisionId = d.id WHERE d.nameKo = '기획경영본부' GROUP BY d.id;
   SELECT COUNT(*) AS 총괄, SUM(employeeNo IS NOT NULL AND notifyEnabled) AS 알림받음 FROM User WHERE isActive = 1 AND isCoordinator = 1;
   SELECT nameKo AS 부서, parentKo AS 상위부서 FROM Division WHERE isActive = 1 ORDER BY parentKo, createdAt;" | tee $L/rollup-before.txt
#   담당 ≥ 1 · 본부장 1 · 사번없음 0 · 총괄 ≥ 1 · 알림받음 ≥ 1
#   산하 다섯의 상위부서 = 기획경영본부 · 탄소중립에너지연구실 = 기후대기전략연구본부 · 순환경제연구실 = 생활환경연구본부 ·
#   나머지 켠 부서 = 한국환경연구원(또는 꺼진 본부). 다르면 켜지 않는다 — 인원 최신화(roster-sync)가 맞출 값이다
```

총괄(`isCoordinator`)은 화면으로 못 바꾼다(TACP-2). NAMS에 올리는 사람에게 없으면: `q "UPDATE User SET isCoordinator = 1 WHERE email = '<총괄-이메일>' AND isActive = 1; SELECT changes();" | tee -a $L/sql.txt` → 1
(지금 총괄을 그대로 둘지는 기획조정실과 정한다 — 「전사본 준비」는 총괄 각자에게 간다).

**7-3 섹션 목록** — 운영자가 「전사」(`/org`)를 연다. 섹션 표가 비어 있으면 **여는 순간** 기본 13개가 부서 이름으로 이어져 저장된다(취합을 여는 사람만 —
3단계가 꺼진 동안은 운영자. 10/13 ⑩ 스모크에서 열었으면 이미 있다). 그 뒤로는 기본값이 바뀌어도 이 목록은 그대로다(RU-61).

```bash
q "SELECT s.sortOrder AS 순서, s.title AS 제목, s.kind AS 꼴, s.isActive AS 켜짐, d.nameKo AS 부서, d.isActive AS 부서켜짐
   FROM OrgSection s LEFT JOIN Division d ON d.id = s.divisionId ORDER BY s.sortOrder;" | tee $L/sections.txt
```

- 13줄, **부서 칸이 빈 줄이 없다**(비면 부서 이름이 안 맞은 것 — 「섹션 구성 편집」에서 부서를 골라 저장). 섹션은 부서 **이름**(`nameKo`)으로 한 번 이어지고
  그 뒤로 다시 맞추지 않는다 — 이행 리허설의 지어낸 DB에서는 13개 중 10개만 이어졌다(이름이 달랐다). 한 줄로: `q "SELECT COUNT(*) AS 섹션, SUM(divisionId IS NULL) AS 부서빈칸 FROM OrgSection;"` → 13 · 0.
- 제목: 「경영지원실」(접두 없음) · 「기획경영본부(기획조정실)」 … 「기획경영본부(AI홍보전략실)」.
- 「Tincase 밖」은 아직 꺼진 부서의 섹션이다(기후대기·생활환경 줄은 본부가 꺼져 있어도 산하 실이 켜졌으면 Tincase다). 그 섹션은 총괄이 게시판으로 받은 hwp를
  그 줄의 [올리기]로 넣는다(RU-60a) — 넣지 않으면 전사본에 「미제출」로 들어간다.

**7-4 켜기**

```bash
q "SELECT w.isoKey AS 주차, COUNT(r.id) AS 승인 FROM WeekSlot w LEFT JOIN MergeReview r ON r.weekSlotId = w.id WHERE w.isoKey = '$W' GROUP BY w.id;"   # 0 (줄이 없어도 0)
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
- 끄면 숨을 뿐 데이터는 남는다 — 쪽지 문구는 v1.39 것으로 돌아간다(NOTIFICATIONS-v2 §1 스위치 표).

**7-5 안내 · 스모크 · 그 주 시각표**

- 안내문: [ANNOUNCE-v2.md](ANNOUNCE-v2.md) 「나중에 — 3단계를 켜는 날」 — 켜진 부서의 담당자·실·팀장에게 바뀐 줄, 기획경영본부(본부장·본부 담당)와 총괄에게 그 절.
- 스모크(운영자 — 승인·올리기는 누르지 않는다):

| 무엇 | 어디 | 기대 |
|---|---|---|
| 담당자 | `/<부서-slug>/manage` (내 부서) | 「위로」 카드에 받는 곳·기한 |
| 본부 (열람) | `/hq?node=<기획경영본부-slug>` | 산하 다섯 · 본부본 없음 · 승인 단추 없음(읽기 전용) |
| 총괄 | 「전사」 — 켠 뒤 총괄이 보는 것과 같은 문 | 13섹션 · 「Tincase 밖」 표시 · 전사본 「아직 없음」 · [일정 바꾸기]는 열어 보기만 |

- 그 주 시각표 — ⑫ 표에 더해진다:

| 시각 | 무엇 | 운영자가 볼 것 |
|---|---|---|
| 14:45 | 기획경영본부 산하 실장 중 승인 안 한 사람에게 15분 전 | 막힌 실이 있으면 담당자의 「승인 없이 올리기」가 열린다 |
| 15:00 | 기획경영본부 본부장 「본부본 준비」(다 모였으면 그 전에) | |
| 15:45 | 본부장 · 바로 총괄로 가는 부서장 중 승인 안 한 사람에게 15분 전 | |
| 16:00 | 총괄 「전사본 준비」(다 들어왔으면 그 전에) | 「전사」 최종본 열 |

## 부록 — 옛 초안(2026-10-08 운영 전환 런북, 저장소 밖)과 다른 점

| 옛 초안 | 지금 | 왜 |
|---|---|---|
| 코드 전환(A)과 3단계 켜기(B)를 다른 날에 | **다른 날 그대로** — 10/13은 끈 채로, 켜기는 §7 | 2026-10-09 범위 결정 — 두 부서 모두 기획경영본부 산하라 켜면 본부장(아직 없음)에서 멈춘다. 자동 진행(auto-flow)은 코드에 들어갔고 한 주 리허설은 통과했다(OPS-47) |
| `main`을 앞으로만 감기 | `--no-ff` 합치기 | `main`에 `711fb76`이 있다(같은 변경이 브랜치에 `4143baf`) |
| compose에 `SUBMIT_HWP_UPLOAD: "off"` 한 줄 | 넣지 않는다 | 부서원 hwp 제출은 코드째 지웠다(WA-39). 스위치는 「전사」 [올리기]만 — 운영은 기본 `on`으로 Tincase 밖 섹션을 받는다 |
| `docker compose build && up -d`를 손으로, 롤백 태그도 손으로 | `bash scripts/deploy.sh prod` | 금지 시간대·디스크·롤백 태그·health·찌꺼기 청소를 한 번에(OPS-43) |
| 새 표 5 · 열 4 | 새 표 7 · 새 열 7 | `MergeJob`(병합 줄) · `GuideTourSeen`(둘러보기) · `MergeReview.filePath` · `MergeRun.outputSha` · `SetupToken.supersededAt`(밀린 설정 링크 — 2026-10-10) |
| push를 빠뜨리면 health는 초록인데 화면이 500 | 뜨지 않고 없는 표·열을 말한다 | 기동 스키마 검사(OPS-48) |
| 스냅샷 사본에서 스키마 리허설(`migrate diff` · push) | **한다** — ⑤-0, 그날 스냅샷의 사본에 같은 push (3초) | 2026-10-09 이행 리허설은 지어낸 사람의 DB(v1.39.0 코드로 만든 모양)로만 돌았다 — 실제 데이터로는 그날 스냅샷이 처음이다. 10/07의 `.bak-20261007-pre-rollup`은 v1.39.0 전이라 출발점이 아니다 |
| 롤백은 `repman:rollback` | `repman:v1.39.0` 고정 태그(①) | ⑥을 빌드째 다시 돌리면 `repman:rollback`이 v2로 옮겨지고 v1 이미지가 청소에 지워진다 |
| 병합 규칙 초안이 지침·정렬까지 넣는다 | 분류 순서 둘만 | HM-51 · ADR-0018 |
| 3단계 쪽지 `ru_hq_collect` · `hq_approved` · 당일 09:00 알림 | 없다 | 막고 있는 사람에게만(ADR-0015) · R13 |
| 섹션 13개는 「섹션 구성 편집」에서 그대로 저장 | 운영자가 「전사」를 열면 생긴다 | 편집기의 [저장]은 바뀐 것이 있어야 눌린다. 여는 순간 기본 13개를 저장한다 |
