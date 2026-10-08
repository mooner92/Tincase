// CP-119 — 칸 높이를 내용에 맞춘다. 병합본 드로어(CP-70~)와 담당자 [고치기](WA-20)가 같이 쓴다.
//
// `field-sizing: content`가 같은 일을 하지만 사내 PC 브라우저 버전을 장담할 수 없어 scrollHeight로 직접 맞춘다.
// 한 칸에 두 줄을 적는 것은 정상이라(HM-39) `rows={1}`로 두면 둘째 줄이 잘려 칸마다 눌러 봐야 한다.

/**
 * 한 칸 — 지금 입력하는 그 칸. ref 콜백으로도 쓴다.
 *
 * 모듈에 두는 이유: 컴포넌트 안에서 만들면 그릴 때마다 새 함수라, React가 ref를 바꾼 것으로 보고
 * **모든 칸에** 다시 부른다. 병합본 112칸이면 한 글자마다 레이아웃을 112번 새로 계산했다(2026-10-08 실측).
 */
export function fitTextarea(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  // border-box이므로 테두리 두께를 더해야 한다 — scrollHeight는 테두리를 뺀 값이다
  const border = el.offsetHeight - el.clientHeight;
  el.style.height = `${el.scrollHeight + border}px`;
}

/**
 * 여러 칸을 한꺼번에 — 불러온 뒤·줄을 지우거나 옮긴 뒤(값이 다른 칸으로 옮겨 앉는다).
 *
 * 쓰기를 몰아서, 읽기를 몰아서, 다시 쓰기를 몰아서 한다. 칸마다 「auto로 쓰고 → 높이 읽기」를 번갈아 하면
 * 읽을 때마다 브라우저가 레이아웃을 처음부터 다시 계산한다 — 병합본 112칸에서 0.75초, 몰아서 하면 0.03초
 * (운영 빌드 실측, 2026-10-08). 부서장의 「고쳐 저장 = 승인」이 한 글자에 1초씩 걸리던 원인이다.
 */
export function fitTextareas(els: Iterable<HTMLTextAreaElement>) {
  const list = [...els];
  for (const el of list) el.style.height = 'auto';
  const heights = list.map((el) => el.scrollHeight + (el.offsetHeight - el.clientHeight));
  list.forEach((el, i) => {
    el.style.height = `${heights[i]}px`;
  });
}
