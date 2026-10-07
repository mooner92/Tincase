# 운영회의 시연 — 11/2(월) 강당 (시연 서버 11113)

> 스펙: [12 org-rollup §9a](spec/12-org-rollup.md#9a-시연-서버--11113-ru-4547) (RU-45~47) · 슬라이드: `/guide/present` (PG-59)
> ⚠ 이 문서는 공개 저장소에 있다. 서버 주소는 `<서버-내부-IP>`로 적고, 시연 비밀번호는 `docs/private/demo-accounts.md`(git 제외)에만 둔다.

## 왜 서버가 하나 더 있나

강당 프로젝터는 회사 전체가 본다. **실명이나 실제 제출 현황이 한 번이라도 뜨면 안 된다.**

| | 운영 11111 | 테스트 11112 | **시연 11113** |
|---|---|---|---|
| DB | 실제 | 운영 **사본 — 실명 있음** | **가짜 사람만** (`@example.invalid`) |
| 알림 | 실제로 나감 | 꺼짐 | 꺼짐 |
| 자동 병합(14:01) | 켜짐 | 꺼짐 | 꺼짐 — 버튼으로만 |
| 데이터 | `/data/worklog` | `/data/worklog-test` | `/data/worklog-demo` |
| 세션 쿠키 | `repman_session` | `repman_test_session` | `repman_demo_session` |
| 맨 위 띠 | 없음 | 「테스트 서버입니다」 | 「시연 서버 — 사람과 업무는 모두 지어낸 것입니다」 |

시연 서버의 사람은 **사용 안내 슬라이드와 같은 가짜 사람들**이다(`scripts/fake-org.ts`) — 슬라이드에서 본 한서린·남시우가
시연 화면에도 그대로 나온다.

| 파일 | 하는 일 |
|---|---|
| `docker-compose.demo.yml` | 컨테이너 `repman-demo` · 이미지 `repman:test`(굽지 않는다) · `0.0.0.0:11113` |
| `scripts/demo-seed.ts` | 가짜 DB 만들기·되돌리기. 주차와 **단계**를 고른다. 실제 DB면 거절 |
| `scripts/demo-snapshot.sh` | 상태 저장·되돌리기(sqlite `.backup` + 저장소 tar) · 권한 맞추기 |

### 단계 — 화면에서 누를 것을 남겨 둔다

| `--stage` | 그 주의 상태 | 남은 것 (화면에서 누른다) |
|---|---|---|
| `open` | 비어 있다 | 전부 |
| `ready` (기본) | 25명 중 21명 제출 — **남시우**·채온유 등 실·팀마다 한두 명 남음 · 기획조정실·연구관리실·기후대기 병합·제출 · AI홍보전략실 **병합 전** · 기획경영본부 **본부 대기** · 게시판 섹션 5곳 올림 | 부서원 제출 → 병합 → 본부에 제출 → 이어 붙이기 → 승인 → 총괄에 제출 → 전사 취합본 |
| `hq` | `ready` + AI홍보전략실 병합·실장 승인·본부에 제출 + 본부 이어 붙이기·본부장 승인·**총괄에 제출** | 부서원 제출 → 병합 / **전사 취합본 만들기** → 받기 |
| `done` | `hq` + 전사 취합본 | 받기만 |

그 앞 주는 언제나 **끝까지 간 한 주**(24명 제출 · 14:01 자동 병합 · 3단계 기한 안 제출 · 전사 취합본)다 — 부서원의
「지난번에 낸 것」, 주차 고르기, 「전사본 받기」 연습에 쓴다.

**이야기 시각 `--until`**: 시드가 만든 일은 모두 이 시각 **앞 두어 시간**에 일어난 것으로 찍힌다(기본은 지금).
아침 7시에 시드하면 「05:12 제출」이 강당에 뜨므로 **회의 시작 20분 전쯤**을 준다. 화면에서 누르는 일은 이 시각 **뒤**여야
순서가 맞는다(「가장 최근」을 시각으로 고르는 곳이 있다).

### 시연 계정

| 역할 | 이름 | 이메일 | 처음 열어 둘 화면 |
|---|---|---|---|
| 부서원 — **아직 안 냄** | 남시우 | `member2@example.invalid` | `/AI_and_Public_Relations_Division` |
| 부서원 — 이미 냄 | 유단비 | `member@example.invalid` | 〃 |
| 부서담당자 | 한서린 | `lead@example.invalid` | `/AI_and_Public_Relations_Division/manage` |
| 실장 | 도윤재 | `head@example.invalid` | 〃 |
| 본부 담당 | 어진솔 | `hq-lead@example.invalid` | `/hq` |
| 본부장 | 편무진 | `hq-head@example.invalid` | `/hq` |
| 총괄 | 봉하늘 | `coord@example.invalid` | `/org` |

비밀번호는 위 일곱 계정 공통이다. **처음 시드할 때 한 번 출력**된다 → `docs/private/demo-accounts.md`에 적는다.
다시 시드해도 비밀번호와 **로그인해 둔 세션은 그대로**다(바꾸려면 `DEMO_PASSWORD=… npx tsx scripts/demo-seed.ts …`).

## 이미지 — 굽기 전에 읽는다

기본은 **이미 있는 `repman:test`를 그대로** 쓴다. 루트 디스크 여유가 4GB 남짓이라 굽다가 서버 전체가 멈출 수 있다.
아래 셋 중 **필요한 것이 있을 때만** 다시 굽는다.

1. **이미지가 2026-10-08 03:06(KST) 이전에 구운 것** — 그 뒤의 커밋(`67dfc43`, 전사 결과 형식 RU-68)이 없으면 시드가 만든
   전사 취합본 기록을 화면이 읽지 못한다.
   `sudo docker image inspect repman:test --format '{{.Created}}'` 가 `2026-10-07T18:06Z` 이후면 된다.
2. **슬라이드를 시연 서버에서 띄워야 하는데** `/guide/present`가 없다 — `curl -s -o /dev/null -w '%{http_code}\n' 127.0.0.1:11113/guide/present`
   가 `404`면 없다(로그인으로 보내는 `307`이면 있다). 슬라이드를 운영에서 띄울 수 있으면(아래 「슬라이드는 어디서」) 굽지 않는다.
3. 「시연 서버」 띠(RU-47)는 이 브랜치 이미지에만 있다. 옛 이미지면 **띠가 없을 뿐**이다 — 이것만으로는 굽지 않는다.

굽는다면 (디스크 여유 6GB 이상일 때만):

```bash
df -h /                                         # 6G 미만이면 굽지 않는다
cd ~/repman-c                                   # 시연 브랜치(feat/guide-deck) 체크아웃
sudo docker build -t repman:test .
sudo docker builder prune -f                    # 빌드 캐시 정리
sudo docker compose -f docker-compose.demo.yml -p repman-demo up -d
```

`repman:test`는 테스트 서버와 같은 태그다. 시연 브랜치는 `feat/org-rollup`을 포함하므로 테스트 서버가 이 이미지로 다시 떠도
기능은 같거나 많다. 테스트 서버는 다음 `up -d --build` 때 제 브랜치로 다시 굽는다.

### 슬라이드는 어디서

마지막 장 「이 주소에서 다시 보실 수 있습니다」는 **지금 연 서버의 주소**를 크게 띄운다. 시연 서버에서 띄우면 회의 뒤 없어질
`:11113`이 보인다. 그래서:

- 운영(11111)에 사용 안내 슬라이드가 배포돼 있으면 → **슬라이드는 운영에서**(운영자 계정 — 무대 화면에는 이름이 없다), 실제 화면은 시연 서버에서.
- 아니면 → 시연 서버에서 띄우고, 마지막 장 직전에 `B`(검은 화면)를 누른 뒤 운영 주소를 말로 알린다.

## D-7 (10/26 월) — 준비 · 서버에서

```bash
# 0) 디스크 · 이미지 (위 「이미지」)
df -h / /data
sudo docker image inspect repman:test --format '{{.Created}}'

# 1) 데이터 디렉터리 — 스키마·시드는 mhchoi가 만들고, 컨테이너(10001)에 넘긴다 (운영 DEPLOY §1과 같은 규칙)
sudo mkdir -p /data/worklog-demo/db
sudo chown -R mhchoi:mhchoi /data/worklog-demo

# 2) 스키마 + 시드 — 시연 브랜치 체크아웃에서(.env를 두지 않은 곳. 지금은 ~/repman-c)
cd ~/repman-c
ls fixtures/master-template.hwp                 # 없으면 DEMO_TEMPLATE=~/repman/fixtures/master-template.hwp
export DATABASE_URL=file:/data/worklog-demo/db/worklog.db STORAGE_ROOT=/data/worklog-demo CF_ACCESS_TEAM=tincase-demo-disabled
npx prisma db push --skip-generate
npx tsx scripts/demo-seed.ts --stage=ready      # 이번 주(W44). 끝에 비밀번호가 한 번 나온다 → docs/private/demo-accounts.md

# 3) 권한 → 기동 → 확인
sudo bash scripts/demo-snapshot.sh perms        # 10001:mhchoi · g+rwX · setgid
sudo docker compose -f docker-compose.demo.yml -p repman-demo up -d
curl -s 127.0.0.1:11113/api/health              # "ok":true
sudo docker logs repman-demo --tail 5           # [boot] 4/4 서버 시작 (Division 14개)
sqlite3 /data/worklog-demo/db/worklog.db "SELECT COUNT(*) FROM User WHERE email NOT LIKE '%@example.invalid';"   # 0
```

브라우저로 `http://<서버-내부-IP>:11113` → `coord@example.invalid`로 로그인 → `/org`에 이번 주 상태(본부 대기 3 · 올린 파일 5 · 미제출 4)가 보이면 된다.

시드가 거절하면(종료 코드 2) 이유를 그대로 읽는다 — 경로가 시연 디렉터리 밖이거나, `@example.invalid`가 아닌 계정이 있거나,
컨테이너가 만든 디렉터리라 쓸 수 없다(→ `sudo bash scripts/demo-snapshot.sh perms` 뒤 다시).

## D-3 (10/30 금) — 강당 리허설

W44는 목 14:00에 마감됐다. 리허설에서 부서원 [제출]을 눌러 보려면 **그 주 마감을 일요일 20:00으로 미뤄** 다시 시드한다
(`--keep-open` — 주차 마감 예외라 화면 머리에 「시연 리허설」 이유가 보인다. 회의 날에는 쓰지 않는다).

```bash
sudo docker compose -f docker-compose.demo.yml -p repman-demo stop
sudo bash scripts/demo-snapshot.sh perms        # 컨테이너가 만든 디렉터리에 다시 쓸 수 있게
cd ~/repman-c && export DATABASE_URL=file:/data/worklog-demo/db/worklog.db STORAGE_ROOT=/data/worklog-demo CF_ACCESS_TEAM=tincase-demo-disabled
npx tsx scripts/demo-seed.ts --stage=hq --keep-open --until=<리허설 시작 10분 전, 예: 13:50>
sudo bash scripts/demo-snapshot.sh perms        # 시드한 파일을 컨테이너가 읽게
sudo docker compose -f docker-compose.demo.yml -p repman-demo start
```

**강당 PC에서** (전부 확인하고 체크):

- [ ] **네트워크** — 강당 PC 브라우저에서 `http://<서버-내부-IP>:11113/api/health`가 열린다. 유선으로. 안 열리면 그 자리의 망이 서버 대역에 닿는지부터(전산 담당)
- [ ] **Chrome 프로필 — 역할마다 하나** (`발표` · `① 부서원 남시우` · `② 담당 한서린` · `③ 실장 도윤재` · `④ 본부 어진솔` · `⑤ 본부장 편무진` · `⑥ 총괄 봉하늘`). 프로필마다 테마 색을 다르게, 위 「시연 계정」 표의 화면을 열어 둔 채 로그인
- [ ] 프로필 바로가기를 작업 표시줄에 **순서대로** 고정 — `Win+1`(발표) … `Win+7`(총괄)로 바로 넘어간다
- [ ] **확대** — `/org`·`/hq`·수합 관리는 **125~150%**에서 뒤쪽 자리에서도 읽히는지, 표가 가로로 잘리지 않는지(프로필마다 따로 맞춘다)
- [ ] **알림·자동 완성 끄기** — Chrome: 비밀번호 저장 제안·자동 완성·사이트 알림 끔. Windows: 방해 금지(집중 지원), 업데이트 일시 중지, 화면 보호기·절전 끔. 사내 메신저는 로그아웃
- [ ] **한글 뷰어** — 한컴오피스 한글이나 무료 한글 뷰어 설치. 총괄 프로필에서 지난주 [전사본 받기] → 다운로드에서 바로 열리는지(「항상 이 유형의 파일 열기」)
- [ ] **리모컨** — 발표 프로필에서 `/guide/present` → [발표 시작] → `PageDown`/`PageUp`이 넘어가는지, `B` 검은 화면, `숫자+Enter` 이동. 노트북 화면에 발표자 창(`?view=notes`, **같은 프로필**)
- [ ] **오프라인 대비** — 발표 프로필에서 `/guide`를 인쇄 → PDF로 저장(한 장에 한 단계). 바탕 화면과 USB에
- [ ] **시연 순서대로 한 번** (아래 「11/2 진행」) — 시간을 잰다. 병합 버튼에서 몇 초 걸리는지 본다

리허설 중 처음 상태로 돌리려면:

```bash
sudo bash scripts/demo-snapshot.sh save d3-start            # 리허설 시작 전에 한 번
sudo docker compose -f docker-compose.demo.yml -p repman-demo stop
sudo bash scripts/demo-snapshot.sh restore d3-start
sudo docker compose -f docker-compose.demo.yml -p repman-demo start
```

스냅숏은 프로필 로그인 **뒤에** 뜬다 — 앞에 뜬 것으로 되돌리면 그 뒤 로그인(세션)이 사라진다.

## D-0 (11/2 월) 07:00 — 다시 시드 · 모델 데우기 · 스냅숏

이번 주는 W45(11월 1주차)다. 시드하지 않으면 **비어 있다**.

```bash
sudo docker compose -f docker-compose.demo.yml -p repman-demo stop
sudo bash scripts/demo-snapshot.sh perms
cd ~/repman-c && export DATABASE_URL=file:/data/worklog-demo/db/worklog.db STORAGE_ROOT=/data/worklog-demo CF_ACCESS_TEAM=tincase-demo-disabled
npx tsx scripts/demo-seed.ts --stage=hq --week=2026-W45 --until=09:40   # 회의 시작 20분 전쯤 (회의가 10:00일 때)
sudo bash scripts/demo-snapshot.sh perms
sudo docker compose -f docker-compose.demo.yml -p repman-demo start
curl -s 127.0.0.1:11113/api/health

# 병합 보조 모델 데우기 — 식은 모델은 첫 병합이 수십 초 걸린다(시간 초과 60초면 모델 없이 끝나지만 강당에서는 길다)
# num_ctx는 앱과 같게(바꾸면 다시 올린다). 앱의 요청이 오면 보관 시간은 기본(5분)으로 돌아가니 회의 직전에 한 번 더
curl -s 127.0.0.1:11437/api/generate -d '{"model":"hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M","prompt":"ok","stream":false,"keep_alive":"4h","options":{"num_ctx":8192,"num_predict":1}}' >/dev/null
curl -s 127.0.0.1:11437/api/ps                  # 모델이 올라와 있다
sudo docker exec repman-demo node -e "fetch(process.env.MERGE_MODEL_URL+'/api/ps').then(r=>r.json()).then(d=>console.log(d.models.map(m=>m.name)))"

sudo bash scripts/demo-snapshot.sh save d0-0700
```

- 강당 PC에서 프로필마다 한 번씩 연다(세션은 D-3 것이 살아 있다). `/org` 머리가 「11월 1주차」, 기획경영본부 섹션이 「Tincase 제출」, 미제출 4곳
- 누가 미리 눌러 봤으면: `stop` → `restore d0-0700` → `start`
- **회의 10분 전** 모델을 한 번 더 데운다(위 `curl … generate`)

## 11/2 진행 — 슬라이드 → 실제 화면 두 번

기본은 **시나리오 A**(`--stage=hq`) — 실제 화면에서 누르는 곳이 적다.

1. `Win+1` 발표 — `/guide/present`, [발표 시작]. 표지 → 「왜 바꾸나」 → 「부서원」 장
2. **실제 화면 ①** — 부서원 장 끝(`member-done`)에서
   - `Win+2` 남시우: [작성하기] → 「지난번에 낸 것」에서 계획 가져오기 → [제출]
   - `Win+3` 한서린: 수합 관리 → 9/10 제출 → [다시 병합] → 병합본 [내용 보기]
   - 말할 것: 「본부에 낸 것은 보낸 사본이라 그대로입니다 — 새로 낸 것을 올리려면 다시 [기획경영본부에 제출]」(카드의 「제출 뒤 바뀜」 칩). 그래서 ②의 전사본에는 방금 낸 남시우 것이 아직 없다
3. `Win+1` 슬라이드 — 실·팀장 → 본부(이어 붙이기·승인·총괄에 제출)는 슬라이드로
4. **실제 화면 ②** — 총괄 장의 `org-run`에서
   - `Win+7` 봉하늘: `/org` — 13개 섹션의 출처(Tincase 제출 · 올린 파일 · 미제출)를 위에서 아래로 → [전사 취합본 만들기] → [전사본 받기] → **한글로 연다**
5. `Win+1` 슬라이드 — 일정 바꾸기 → 마무리. 마지막 주소 장은 위 「슬라이드는 어디서」대로

**시나리오 B**(시간이 넉넉할 때, `--stage=ready`) — 한 주 전체를 실제 화면으로: 남시우 [제출] → 한서린 [지금 병합] →
(도윤재 [고칠 것 없음 · 승인]) → 한서린 [기획경영본부에 제출] → 어진솔 [이어 붙이기] → 편무진 [검토 완료 · 승인] →
어진솔 [총괄(기획조정실)에 제출] → 봉하늘 [전사 취합본 만들기] → [전사본 받기] → 한글. 7~10분.

## 안 될 때

| 무엇이 | 이렇게 |
|---|---|
| 실제 화면에서 오류·멈춤 | 「화면은 슬라이드로 보겠습니다」 → `Win+1`. 슬라이드에 모든 단계가 있다 |
| 병합이 오래 걸린다 | 모델이 식었다 — 60초 안에 모델 없이 끝난다. 그동안 슬라이드 「병합본이 저절로 생깁니다」를 말로 |
| 시연 서버가 안 열린다 | 슬라이드만으로 진행. 슬라이드도 안 열리면 바탕 화면의 PDF |
| 화면 상태가 꼬였다(회의 전) | `stop` → `restore d0-0700` → `start` (2분) |

## 끝나고 — 내리기

```bash
sudo docker compose -f docker-compose.demo.yml -p repman-demo down
curl -s 127.0.0.1:11437/api/generate -d '{"model":"hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M","keep_alive":0}' >/dev/null   # 모델 내리기
sudo rm -rf /data/worklog-demo                  # 가짜 데이터뿐이다 — 다시 쓸 일이 없으면
rm -f docs/private/demo-accounts.md
```

강당 PC의 Chrome 프로필(시연 세션)과 다운로드한 전사본도 지운다. 시연용으로 이미지를 따로 구웠으면 `sudo docker image prune`.
