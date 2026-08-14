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
- [ ] 로컬 검증: `npm test` 62개 통과, `npx next build` 성공

## 1. 호스트 준비 (1회, sudo 필요)

```bash
sudo mkdir -p /data/worklog/db
sudo chown -R mhchoi:mhchoi /data/worklog       # 컨테이너 uid 10001과 공유 시 chmod 조정
chmod 750 /data/worklog
mkdir -p /mnt/backup/worklog                     # NFS 쓰기 확인
touch /mnt/backup/worklog/.probe && rm /mnt/backup/worklog/.probe
```

컨테이너는 uid 10001(app)로 돈다. 바인드 볼륨 권한:

```bash
sudo chown -R 10001:10001 /data/worklog
```

## 2. 스키마 + 시드 (호스트에서, 컨테이너 기동 전) ⚠ 순서 중요

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

# ④ 컨테이너 uid로 넘긴다
sudo chown -R 10001:10001 /data/worklog
```

스키마 변경이 있는 재배포 때도 같은 절차 (①→②→④, 시드는 불필요).

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
# docker는 sudo 필요 (mhchoi가 docker 그룹 아님). compose 플러그인은
# /usr/local/lib/docker/cli-plugins에 설치되어 있음 (2026-08-13)
sudo docker compose build                        # 루트 디스크 주의 — 완료 후 5단계에서 prune
sudo docker compose up -d
sleep 15
curl -fsS http://127.0.0.1:11111/api/health | python3 -m json.tool
# 기대: ok:true, checks 전부 ok  (이미 8/13에 스모크 컨테이너로 검증됨)
```

## 5. 검증 (AU-12) ⚠

```bash
# 1) 바인딩 확인 — v1.1부터 0.0.0.0이 정상 (사내망 접속 허용, ADR-0006)
ss -tlnp | grep 11111

# 2) 미인증 접근 → /login 리다이렉트여야 정상 (200으로 내용이 보이면 즉시 중단)
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://<서버IP>:11111/

# 3) 루트 디스크 보호 (OPS-19) — 실측: 이 서버는 97~99%를 오간다
sudo docker builder prune -f && sudo docker image prune -f
df -h / | tail -1
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

## 7. 백업 크론

```bash
chmod +x ~/repman/scripts/backup.sh
crontab -e
# 추가:
# 0 3 * * *   /home/mhchoi/repman/scripts/backup.sh db    >> /data/worklog/backup.log 2>&1
# 30 3 * * 0  /home/mhchoi/repman/scripts/backup.sh files >> /data/worklog/backup.log 2>&1
# 수동 1회 실행으로 확인:
~/repman/scripts/backup.sh db && ~/repman/scripts/backup.sh verify
```

## 8. 월요일 아침 안내문 (붙여넣기용 초안)

> [주간업무 제출 안내]
> 이번 주부터 주간 업무일지를 웹으로 제출합니다. **사내망에서만 접속됩니다.**
> ① http://<서버-내부-IP>:11111 접속
> ② KEI 이메일 + 개별 전달드린 임시 비밀번호로 로그인 → 비밀번호 변경
> ③ [빈 양식 다운로드] → 작성 → 끌어다 놓기로 제출
> 마감: 화요일 14:00 (이후 자동 잠김)
> ※ 한 번 로그인하면 한 달간 유지됩니다.
> ※ 이번 주는 기존 이메일 제출도 병행합니다. 문제 있으면 저에게 바로 연락 주세요.

비밀번호는 **개인별로 따로** 전달하세요 (단체 메시지 금지).

## 장애 시 (OPS-18)

시스템이 죽고 마감이 임박하면 **그 주는 이메일로 되돌린다**:
`/data/worklog/divisions/AI_and_Public_Relations_Division/template/active.hwp`를 메일로 배포.

## 배포 금지 시간대 (OPS-16)

**월 00:00 ~ 화 14:00 (제출 창) 동안 재배포 금지.** 배포는 화 14:00 이후~일요일.


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
