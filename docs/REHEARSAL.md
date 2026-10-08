# 한 주 리허설 — 알림이 맞는 사람에게, 한 번, 제 시각에 (OPS-47)

> 스펙: [09 OPS-47](spec/09-deployment-ops.md) · 가짜 알림 수신함 [01 NT-56](spec/01-domain-model.md) · [messenger.md §9](integrations/messenger.md)
> 각본·판정: `scripts/rehearsal-plan.ts` · 실행: `scripts/rehearsal.ts` · 가짜 모델: `scripts/fake-model.ts`
> ⚠ 공개 저장소다. 서버 주소는 `<서버-내부-IP>`, 비밀번호는 적지 않는다.

## 무엇을 하나

가짜 13개 단위(전사 최종본 섹션 하나씩)로 **마감 → 자동 병합 → 부서장 승인 → 위로 → 본부본 → 본부장 승인 → 전사본**을
**진짜 스케줄러**로 한 번 돌린다. 알림은 밖으로 나가지 않고 같은 앱의 가짜 수신함에 쌓인다. 끝나면 수신함을 읽어
**각 알림이 맞는 사람에게, 정확히 한 번, 제 창 안에** 갔는지 판정하고 보고서를 찍는다. 종료 코드 0 = 통과.

사람이 하는 일은 HTTP로 흉내 낸다 — 총괄이 [일정 바꾸기]로 마감을 **지금 + N분**으로 당기고, 부서장·본부장은 **받은 알림을 보고** [승인]한다.

## 각본 — 13개 단위

| 단위 | 위로 | 부서장 | 부서장이 하는 일 | 확인하는 것 |
|---|---|---|---|---|
| 기획조정실 · 연구관리실 · AI홍보전략실 | 본부 | 있음 | 검토 요청을 받고 승인 (마감 +11·13·15분 이후) | 검토 요청(NT-40) · 승인 순간 담당자에게(NT-46′) · +30분 안내 없음(NT-47′) |
| 인사관리실 | 본부 | 있음 | 「15분 남았어요」를 받고 승인 | 임박 알림(RU-56a) · 산하가 다 모인 순간 본부장에게(RU-54) |
| 경영지원실 | 본부 | **없음** | — | 마감 뒤 최종본이 저절로 위로(RU-71) · +30분 「올라갔어요」 |
| 기후대기 · 글로벌대외협력단 · 생활환경 | 총괄 | 있음 | 검토 요청을 받고 승인 | 본부 단계 없이 바로 총괄로(RU-07) |
| 임원실 · 국토환경 | 총괄 | **없음** | — | 저절로 총괄로 |
| 환경평가본부 | 총괄 | 있음 | **승인 안 함** | 임박 알림 · +30분 「승인 전」 · 전사본은 일부로 |
| 국가기후위기적응센터 | 총괄 | 있음 | 「15분 남았어요」를 받고 승인 | 「본부 → 총괄」 기한 기준 임박(RU-56a) |
| 국가지속가능발전연구센터 | 총괄 | 있음 | — | **아무도 안 냄** — 10분 전 알림 전원 · 「병합본이 아직 없어요」(merge_missing) |
| 기획경영본부(본부장) | 총괄 | — | 「본부 → 총괄 15분 전」을 받고 승인 | 본부 임박(RU-56) · 승인 = 총괄로 · 기한에 총괄 「전사본 준비」 일부로(RU-57) |

단위마다 한두 명이 안 낸다 → 10분 전 알림(NT-42). 사람은 사용 안내·시연과 같은 가짜 사람 + 새 단위는 **역할 이름**(「인사담당」·「인사부서장」·「인사부원1」 — 지어낸 이름도 쓰지 않는다).
사번은 `RH001`~ — 사번 꼴이 아니라 실제 메신저로 새어도 아무도 못 찾는다. 본부(기획경영본부) 자신은 부서 알림을 끈다 — 문서가 없는 본부에 마감 독촉이 가지 않게.

## 판정

| | |
|---|---|
| 통과 | 기대 알림마다 창 안(시작 5초 전 ~ 끝 90초 뒤)에 **한 번** |
| 실패 | 안 옴 · 두 번 · 창 밖 · **기대하지 않은 알림**(다른 사람에게 · 다른 종류) · 알림이 안 와 기다리다 그냥 승인함 |
| 와도 되는 | 리허설 도중 열린 창, 받는 사람이 그 알림을 보고 움직이는 경우 — 오면 한 번, 창 안이어야 한다 |

창은 messenger.md의 표 그대로다: 마감 전(전날 11:45 · 1시간 전 · 10분 전) · 마감 +10분(병합이 늦으면 그때부터, HM-50) · +30분 ·
단위 기한 15분 전 · 「실·팀 → 본부」 기한 · 「본부 → 총괄」 15분 전 · 「본부 → 총괄」 기한 · 사건(승인 순간 · 다 모인 순간 — 2분 안) ·
「병합 점검」(NT-60 — 운영자와 기획조정실 담당에게 마감 +1~17분에 한 통, +15분에 남은 곳이 있었으면 다 끝난 순간 「완료」 한 통. 병합 줄을 합친 2026-10-09부터).
판정은 앱 코드를 불러 쓰지 않고 이 표를 옮겨 적었다 — 같은 함수로 기대값을 만들면 틀린 것도 맞다고 나온다.

## 걸리는 시간

`마감까지(--deadline-in, 기본 12분) + 「본부 → 총괄」 기한(기본 120분) + 14분`. 운영과 같은 간격(60·120)이면 **약 2시간 30분**.
빨리 보려면 `--stages=40,50`(약 1시간 20분) — 간격만 줄고 규칙은 같다. 월요일 00:00을 넘기면 시작하지 않는다(주차가 바뀌면 스케줄러가 새 주를 본다).

## 로컬 — 개발 서버 · 가짜 모델 (명령 하나)

```bash
cd ~/repman-rollup        # .env 없는 체크아웃
ls fixtures/master-template.hwp    # 없으면 DEMO_TEMPLATE=<빈 양식.hwp>
npx tsx scripts/rehearsal.ts local --stages=40,50        # 임시 저장소 · 가짜 병합 모델 · next dev(:3417) · run
```

**실측 (2026-10-08 22:46~10-09 00:04, 이 브랜치 · 가짜 모델 · `--stages=40,50`)**: 기대 46통(반드시 42) 모두 창 안에 한 번 · 뜻밖 0 · 승인 9/9 → 통과(종료 코드 0).
낸 사람이 있는 12개 단위의 병합은 마감 +1분에 시작해 35초 안에 끝났다(가짜 모델 호출 29번). 진짜 모델이면 병합이 길어지고 검토 요청 창도 그만큼 뒤로 간다(HM-50) — 판정은 병합이 끝난 시각을 따라간다.
판정이 실제로 잡는지도 같은 때 따로 봤다 — 앱을 복사해 알림 둘을 일부러 망가뜨리고(연구관리실 승인 알림을 보내지 않음 · 「병합본이 아직 없어요」를 두 번 보냄)
같은 명령으로 돌리면 그 두 줄만 ✗(「안 왔다」·「두 번 이상 왔다」), 나머지 44통 ✓ → 실패(종료 코드 1).

**실측 — 세 갈래를 합친 판 (2026-10-09 01:42~02:59, 병합 줄 · 가짜 알림 수신함 · 사용 안내 v2 · 가짜 모델 · `--stages=40,50`)**: 기대 47통(반드시 43) 모두 창 안에 한 번 ·
뜻밖 0 · 승인 9/9 → 통과(종료 코드 0). 늘어난 한 통이 「병합 점검」(NT-60) — 12개 단위 병합이 줄에서 마감 +3분 안에 끝나 줄이 빈 순간(01:57:15)
기획조정실 담당에게 「12/12 끝」 한 통, 다 끝났으니 「완료」는 없다. 종류 머리 `merge_batch:…`가 실려 수신함이 종류로 가렸다(합치기 전에는 빠져 있었다 — NT-T80).

`--real-model`이면 이 서버의 tincase-ollama(:11437)를 부른다. 저장소(`/tmp/tincase-rehearsal-*`)는 남겨 둔다 — 보고서 `rehearsal/report-*.txt`,
수신함 `dev/messenger-sink.jsonl`, 서버 로그 `next-dev.log`.

나눠서 돌릴 때(다른 서버로):

```bash
npx tsx scripts/rehearsal.ts prepare --root=/tmp/tincase-rehearsal-x       # 끝에 수신함 화면용 운영자 비밀번호가 한 번 나온다
npx tsx scripts/rehearsal.ts fake-model --port=11499 &                     # 가짜 병합 모델
DATABASE_URL=file:/tmp/tincase-rehearsal-x/db/worklog.db STORAGE_ROOT=/tmp/tincase-rehearsal-x CF_ACCESS_TEAM=x \
  TINCASE_ENV=demo MESSENGER_SINK=on MESSENGER_URL=http://127.0.0.1:3417/api/dev/messenger-sink MESSENGER_ALLOWLIST='*' \
  MERGE_MODEL=fake MERGE_MODEL_URL=http://127.0.0.1:11499 SUBMIT_HWP_UPLOAD=off npx next dev -p 3417
npx tsx scripts/rehearsal.ts run --root=/tmp/tincase-rehearsal-x --base=http://127.0.0.1:3417 --stages=40,50
```

## 테스트 서버 11112 — 진짜 모델 (운영자 세션)

시연 저장소(`/data/worklog-demo`, 가짜 사람만)를 **잠시 리허설 저장소로 바꿔** 쓴다. 시연 데이터(회의용 상태·역할별 로그인)는 스냅숏으로 되돌린다.
평소 모드(운영 사본, 실명)에서는 스케줄러를 켜지 않는다 — `deploy.sh`가 멈춘다.

**언제**: 운영 마감(목 14:00 전후)과 겹치지 않을 때 — 같은 모델 서버를 쓴다. 테스트 서버를 쓰는 사람에게 시간을 알린다.

```bash
cd ~/repman-rollup                                   # 이 기능이 든 체크아웃(테스트 서버 이미지도 이 커밋 뒤로 구운 것)

# 0) 시연 저장소 저장 — 리허설이 지운다
sudo bash scripts/demo-snapshot.sh save before-rehearsal

# 1) 리허설 저장소 만들기 — 11112는 **평소 모드**여야 한다(시연 모드면 지금 띄우는 DB를 지운다)
sudo bash scripts/demo-snapshot.sh status            # 「테스트 데이터」인지 먼저. 시연 데이터면 TINCASE_TEST_MODE=test bash scripts/deploy.sh test --no-build
sudo bash scripts/demo-snapshot.sh perms            # 컨테이너가 만든 디렉터리(750)를 호스트가 지울 수 있게 — 시드 전후 한 번씩(DEMO.md와 같다)
export DATABASE_URL=file:/data/worklog-demo/db/worklog.db STORAGE_ROOT=/data/worklog-demo CF_ACCESS_TEAM=tincase-demo-disabled
npx tsx scripts/rehearsal.ts prepare --root=/data/worklog-demo --wipe    # 끝에 수신함 화면용 운영자(rh-ops@example.invalid) 비밀번호
sudo bash scripts/demo-snapshot.sh perms

# 2) 시연 모드 + 스케줄러 켬 (덧붙이는 compose docker-compose.rehearsal.yml — 스크립트가 붙인다)
TINCASE_TEST_MODE=demo TINCASE_REHEARSAL=on bash scripts/deploy.sh test --no-build
sudo bash scripts/demo-snapshot.sh status            # 「시연 데이터」 · 로그에 「[merge] 자동 병합 스케줄러 등록」

# 3) 돌리기 — 끝날 때까지 터미널을 둔다(tmux). 보고서는 /data/worklog-demo/rehearsal/report-*.txt
npx tsx scripts/rehearsal.ts run --root=/data/worklog-demo --base=http://127.0.0.1:11112
#    도중에 보기: 브라우저 http://<서버-내부-IP>:11112/ops/notify-sink (rh-ops@example.invalid) · sudo docker logs -f repman-test

# 4) 끝 — 스케줄러 끄고 시연 저장소 되돌리기
TINCASE_TEST_MODE=test bash scripts/deploy.sh test --no-build      # 평소 모드로(시연 저장소를 놓는다)
sudo bash scripts/demo-snapshot.sh restore before-rehearsal
sudo bash scripts/demo-snapshot.sh perms
```

시연 모드로 되돌려 둘 거면 4)의 첫 줄 대신 `TINCASE_TEST_MODE=demo bash scripts/deploy.sh test --no-build`(스케줄러 꺼짐) — 단 `restore`는
11112가 그 저장소를 띄우는 동안 하지 않는다(demo-snapshot.sh가 막는다). 평소 모드로 내린 뒤 되돌리고 다시 시연 모드로 올린다.

## 보고서 읽기

```
리허설 2026-W41 — 마감 10-10 14:12 · 실·팀 → 본부 10-10 15:12 · 본부 → 총괄 10-10 16:12
알림 기대 63 (반드시 52) · 맞음 63 · 틀림 0 · 뜻밖 0 · 승인 9/9
결과: 통과

알림
  ✓ 14:02:20 deadline_10m      pc-05          창 14:02:00~14:05:00 · 기획조정실 미제출
  ✓ 14:22:41 merge_review      pc-head        창 14:22:00~14:34:00 (와도 되는) · 기획조정실 병합본 검토
  ✗ —        ru_hq_due_soon    hq-head        창 15:57:00~16:09:00 · 「본부 → 총괄」 기한 임박  ← 안 왔다
뜻밖의 알림 (기대하지 않은 것)
  ✗ 14:41:03 merge_missing → hq-lead · …
흐름
  14:13:05 병합 끝 — 기획조정실
  14:13:06 위로 올라감 — 경영지원실 (no_head · merge_final:…)
  …
```

틀린 줄은 그 알림의 규칙(messenger.md §4-2·4-3, 12 §8)과 흐름(병합·넘김·본부본·전사본 시각)을 같이 본다. 서버 쪽 이유는
로컬이면 `next-dev.log`, 11112면 `sudo docker logs repman-test`의 `[알림]`·`[merge]`·`[자동]` 줄.
