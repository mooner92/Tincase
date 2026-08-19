// 클립보드 — **사내망 평문 HTTP에서도 동작해야 한다.**
//
// `navigator.clipboard`는 보안 컨텍스트(HTTPS 또는 localhost)에서만 존재한다.
// 우리 앱은 `http://<사내IP>:11111`로 접속하므로 **그 객체가 아예 없다**.
// 실측:
//   http://127.0.0.1:11111   → isSecureContext=true,  clipboard=object
//   http://192.168.1.104:11111 → isSecureContext=false, clipboard=undefined
//
// 그래서 구형 `document.execCommand('copy')`를 대체 경로로 둔다. 이 방식은
// **선택 영역을 복사**하므로, 서식 있는 표를 넣으려면 contenteditable에 HTML을
// 그려 놓고 그것을 선택해야 한다 — 그러면 브라우저가 text/html과 text/plain을 함께 올린다.
//
// (AU-26 — 사내망 평문 HTTP는 이미 감수한 잔여 위험이다. HTTPS로 바뀌면
//  최신 경로가 자동으로 쓰이고 이 대체 경로는 그냥 안 타게 된다.)

/** 선택 영역을 만들고 execCommand로 복사 — 보안 컨텍스트가 아닐 때의 유일한 길 */
function copyViaSelection(node: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel) return false;
  const saved = sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;

  const range = document.createRange();
  range.selectNodeContents(node);
  sel.removeAllRanges();
  sel.addRange(range);

  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }

  sel.removeAllRanges();
  if (saved) sel.addRange(saved); // 사용자가 잡아 둔 선택을 되돌린다
  return ok;
}

/** 화면 밖에 잠깐 두는 그릇. `display:none`이면 선택이 안 되므로 위치로만 숨긴다 */
function withScratch<T extends HTMLElement>(el: T, fn: (el: T) => boolean): boolean {
  el.style.position = 'fixed';
  el.style.top = '0';
  el.style.left = '-9999px';
  el.style.opacity = '0';
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  try {
    return fn(el);
  } finally {
    el.remove();
  }
}

/** 글자만 복사 (제목 등) */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* 아래 대체 경로로 */
    }
  }
  return withScratch(document.createElement('textarea'), (ta) => {
    ta.value = text;
    ta.readOnly = true;
    ta.select();
    ta.setSelectionRange(0, text.length);
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  });
}

/**
 * 서식 있는 내용 복사 — 표를 **표째로** 넣을 때.
 *
 * `html`은 붙여넣는 쪽이 표로 인식할 HTML, `plain`은 서식을 못 받는 곳을 위한 대체본.
 */
export async function copyRich(html: string, plain: string): Promise<boolean> {
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ]);
      return true;
    } catch {
      /* 아래 대체 경로로 */
    }
  }
  const ok = withScratch(document.createElement('div'), (div) => {
    div.contentEditable = 'true';
    div.innerHTML = html;
    return copyViaSelection(div);
  });
  return ok || copyText(plain); // 그것마저 막히면 글자만이라도
}
