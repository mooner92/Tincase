# Tincase 로고 (C안 — Collect)

컬러: green `#0A3711` · ink `#17181A` · light `#F4F1EC` · tint `#7FB98C` (어두운 배경 전용)
모든 파일은 `viewBox`만 지정되어 있으므로 CSS로 크기를 조절합니다. 폰트 의존성 없음(모두 패스).

**`viewBox`는 획까지 포함한 내용 경계에 사방 6단위 여백을 둔 값입니다.**
획(`stroke`)은 패스 바깥으로 절반이 튀어나오므로, 패스 좌표만 보고 `viewBox`를 잡으면
테두리가 잘립니다 — 실제로 lockup 5개가 아래로 6단위 잘려 있었습니다(v1.7.2에서 수정).
`getBBox()`는 기본적으로 획을 빼고 재므로 검증에 쓰면 안 됩니다. 확인은
**큰 캔버스에 그려서 칠해진 픽셀의 경계를 재는 방법**이 유일하게 정확합니다.

## 파일

| 파일 | 용도 |
|---|---|
| `tincase-lockup.svg` | 기본. 가로형 (녹색 심볼 + 잉크 글자). 헤더·문서 |
| `tincase-lockup-green.svg` | 가로형 전체 녹색 |
| `tincase-lockup-mono.svg` | 단색 잉크 (흑백 인쇄) |
| `tincase-lockup-inverse.svg` | 어두운 배경 (tint 심볼 + light 글자) |
| `tincase-lockup-white.svg` | 어두운 배경 · 단색 흰색 |
| `tincase-stacked.svg` | 세로형. 로그인 화면·좁은 폭 |
| `tincase-stacked-green.svg` / `-inverse.svg` / `-white.svg` | 세로형 변형 |
| `tincase-mark.svg` | 심볼 단독 (40px 이상) |
| `tincase-mark-mono.svg` / `-white.svg` / `-tint.svg` | 심볼 단색 변형 |
| `tincase-icon-sm.svg` | **24px 이하 전용** 단순화 버전 (파비콘·탭·앱 아이콘) |
| `tincase-icon-sm-mono.svg` / `-white.svg` / `-tint.svg` | 소형 아이콘 변형 |
| `tincase-wordmark.svg` | 글자만 (잉크) |
| `tincase-wordmark-green.svg` / `-white.svg` | 글자만 변형 |

## 크기 가이드

- 가로형 lockup: 높이 28–64px (최소 24px) — viewBox 96 기준
- 심볼: 40px 이상은 `mark`, 24px 이하는 `icon-sm`
- 여백: 심볼 높이의 25% 이상을 로고 사방에 확보

## 배경별 사용

- 밝은 배경 → `tincase-lockup.svg`
- `#0A3711` 녹색 배경 → `tincase-lockup-white.svg`
- 검정/사진 위 → `tincase-lockup-inverse.svg` 또는 `-white.svg`
- 녹색 심볼(`#0A3711`)은 어두운 배경에 올리지 않습니다 (`-tint` 또는 `-white` 사용)

## 사용 예

```html
<img src="/brand/tincase-lockup.svg" alt="Tincase" style="height:32px">
<link rel="icon" href="/brand/tincase-icon-sm.svg" type="image/svg+xml">
```

## 하지 말 것

- 세로/가로 비율 변경, 회전, 그림자·그라디언트 추가
- 심볼과 워드마크의 간격·크기 비율 재조정 (lockup 파일을 그대로 사용)
- `#0A3711` 이외의 녹색으로 심볼 채우기
