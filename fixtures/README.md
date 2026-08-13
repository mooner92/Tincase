# fixtures — 테스트 기준 파일

> ⚠ **이 디렉터리의 `.hwp` 파일들은 공개 저장소에서 제외되어 있다** (`.gitignore`).
> 실제 제출된 KEI 내부 업무보고서라 공개할 수 없다. 로컬에는 그대로 있다.

## 파일 목록

| 파일 | 구조 | 용도 |
|---|---|---|
| `master-template.hwp` | 표1 9행 · 표2 9행 · 표3 5행 | 빈 마스터 양식. 배포·병합의 기준 |
| `sample-filled-w1.hwp` | 표1 14행 · 표2 14행 · **표3 없음** | 실제 취합본. 다행(多行) 케이스 |
| `sample-filled-w2.hwp` | 표1 10행 · 표2 9행 · **표3 없음** | 실제 취합본. **표3 삭제 "정답" 파일** |
| `verify-write-test.hwp` | — | 조사 중 셀을 수정해 재생성한 파일. [Q-01](../OPEN-QUESTIONS.md) 확인용 |

`sample-filled-w2.hwp`는 사람이 한글에서 3번 표를 삭제한 결과물이라,
병합 엔진의 표 삭제 로직을 추측 없이 **정답 대조**로 맞출 수 있다 ([HM-24](../docs/spec/08-hwp-merge-engine.md)).

## 확보 방법

원본 위치: `~/MWreports/`

```bash
cp ~/MWreports/_draft_M월_W주차_업무실적_및_계획_AI홍보전략실.hwp  fixtures/master-template.hwp
cp ~/MWreports/8월_1주차_업무실적_및_계획_AI홍보전략실.hwp        fixtures/sample-filled-w1.hwp
cp ~/MWreports/8월_2주차_업무실적_및_계획_AI홍보전략실.hwp        fixtures/sample-filled-w2.hwp
node tools/writetest.js && cp out.hwp fixtures/verify-write-test.hwp
```

## 공개 저장소에서 테스트를 돌리려면

내용을 지운 **익명화 픽스처**를 만들어 커밋하는 방법이 있다.
표 구조(행·열 수, 레코드 배치)만 유지하면 대부분의 테스트는 그대로 통과한다.
실제 업무 내용에 의존하는 테스트는 `HM-T04`(읽기 결과 단언) 정도뿐이다.
