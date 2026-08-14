# Tincase 로고 (C안 — Collect)

컬러: amber `#D08A2C` · ink `#17181A` · light `#F4F1EC`
모든 파일은 `viewBox`만 지정되어 있으므로 CSS로 크기를 조절합니다. 폰트 의존성 없음(모두 패스).

## 파일

| 파일 | 용도 |
|---|---|
| `tincase-lockup.svg` | 기본. 가로형 (심볼 + 워드마크). 헤더·문서 |
| `tincase-lockup-mono.svg` | 단색 잉크 (팩스·흑백 인쇄) |
| `tincase-lockup-inverse.svg` | 어두운 배경 (심볼 amber + 글자 light) |
| `tincase-lockup-white.svg` | 어두운 배경 · 단색 흰색 |
| `tincase-stacked.svg` | 세로형. 로그인 화면·좁은 폭 |
| `tincase-stacked-inverse.svg` / `-white.svg` | 어두운 배경용 세로형 |
| `tincase-mark.svg` | 심볼 단독 (40px 이상) |
| `tincase-mark-mono.svg` / `-white.svg` | 심볼 단색 |
| `tincase-icon-sm.svg` | **24px 이하 전용** 단순화 버전 (파비콘·탭·앱 아이콘) |
| `tincase-icon-sm-mono.svg` / `-white.svg` | 소형 아이콘 단색 |
| `tincase-wordmark.svg` | 글자만 |
| `tincase-wordmark-white.svg` | 글자만 · 어두운 배경 |

## 크기 가이드

- 가로형 lockup: 높이 24–56px (최소 20px)
- 심볼: 40px 이상은 `mark`, 24px 이하는 `icon-sm`
- 여백: 심볼 높이의 25% 이상을 로고 사방에 확보

## 사용 예

```html
<img src="/brand/tincase-lockup.svg" alt="Tincase" style="height:32px">
<link rel="icon" href="/brand/tincase-icon-sm.svg" type="image/svg+xml">
```

## 하지 말 것

- 세로/가로 비율 변경, 회전, 그림자·그라디언트 추가
- 심볼과 워드마크의 간격·크기 비율 재조정 (lockup 파일을 그대로 사용)
- amber 이외의 색으로 심볼 채우기 (단색이 필요하면 `-mono` / `-white` 사용)
