'use client';
// 미제출자 안내문 복사 — 모니터를 **관찰 도구에서 행동 도구로**.
//
// 미제출자 명단을 보고 나면 다음 동작은 언제나 "알려주기"다. 그런데 이름을 옮겨 적고
// 문구를 새로 쓰는 일이 매주 반복된다. 화면이 이미 아는 것(누가·언제까지·어디로)을
// 사람이 다시 입력할 이유가 없다.
//
// 보내는 것까지 하지 않는 이유: 사내 메신저·메일 경로가 없고(SMTP 불통 실측),
// 무엇보다 **누구에게 무엇을 보낼지는 사람이 정해야 한다.**
import { useState } from 'react';
import { copyText } from '@/lib/clipboard';

export function NudgeButton({
  names,
  deadlineText,
  weekLabel,
  baseUrlHint,
}: {
  names: string[];
  deadlineText: string;
  weekLabel: string;
  /** 없으면 브라우저 주소를 쓴다 — 운영자가 접속한 주소가 곧 안내할 주소다 */
  baseUrlHint?: string;
}) {
  const [copied, setCopied] = useState<{ key: 'names' | 'message'; ok: boolean } | null>(null);

  /*
   * CP-109 — 사내망은 평문 http라 `navigator.clipboard`가 아예 없다. 그걸 바로 부르면 TypeError로 멈춰
   * 버튼이 눌러도 아무 반응이 없었다(localhost에서 찍은 화면으로는 안 보인다). 대체 경로가 있는 copyText를 쓰고,
   * 된 것만 「복사됨」이라고 한다 — 안 됐는데 됐다고 하면 빈 메시지를 붙여넣고 나서야 안다
   */
  const copy = async (text: string, key: 'names' | 'message') => {
    const ok = await copyText(text);
    setCopied({ key, ok });
    setTimeout(() => setCopied(null), ok ? 2000 : 4000);
  };
  const label = (key: 'names' | 'message', idle: string) =>
    copied?.key === key ? (copied.ok ? '복사됨 ✓' : '복사하지 못했습니다') : idle;

  const message = [
    `[주간 업무일지 제출 안내]`,
    `${weekLabel} 업무일지 마감이 ${deadlineText}입니다.`,
    `아직 제출하지 않으셨다면 아래 주소에서 제출해 주세요.`,
    baseUrlHint ?? (typeof window !== 'undefined' ? window.location.origin : ''),
    ``,
    `대상: ${names.join(', ')}`,
  ].join('\n');

  if (names.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* 글자처럼 보이면 누를 수 있는 줄 모른다 — 테두리 있는 작은 버튼 (CP-99) */}
      <button onClick={() => copy(names.join(', '), 'names')} className="btn-secondary btn-sm">
        {label('names', `이름 ${names.length}명 복사`)}
      </button>
      <button onClick={() => copy(message, 'message')} className="btn-secondary btn-sm">
        {label('message', '안내문 복사')}
      </button>
    </div>
  );
}
