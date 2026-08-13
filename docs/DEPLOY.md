# 배포 절차 — 일요일(8/16) 체크리스트

> 목표: 월요일 8/17 00:00 주차 오픈 전에 `https://worklog.excusa.uk` 가동.
> 예상 소요 40~60분. ⚠ 표시는 실수하면 보안 사고인 지점.

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
| Policy | Allow · Include: `Emails ending in @kei.re.kr` (Q-13 확정) |

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
# 1) 바인딩 확인 — 127.0.0.1이어야 한다. 0.0.0.0이면 즉시 중단
ss -tlnp | grep 11111

# 2) 사내망 다른 기기(또는 폰 LTE)에서 직접 접근 → 실패해야 정상
curl -m 5 http://<서버IP>:11111/ ; echo "exit=$? (0이 아니어야 정상)"

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
> 이번 주부터 주간 업무일지를 웹으로 제출합니다.
> ① https://worklog.excusa.uk/aiprd 접속 (KEI 이메일로 로그인)
> ② [빈 양식 다운로드] → 작성 → 끌어다 놓기로 제출
> 마감: 화요일 14:00 (이후 자동 잠김)
> ※ 이번 주는 기존 이메일 제출도 병행합니다. 문제 있으면 저에게 바로 연락 주세요.

## 장애 시 (OPS-18)

시스템이 죽고 마감이 임박하면 **그 주는 이메일로 되돌린다**:
`/data/worklog/divisions/AI_and_Public_Relations_Division/template/active.hwp`를 메일로 배포.

## 배포 금지 시간대 (OPS-16)

**월 00:00 ~ 화 14:00 (제출 창) 동안 재배포 금지.** 배포는 화 14:00 이후~일요일.
