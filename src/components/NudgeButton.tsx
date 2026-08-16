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
  const [copied, setCopied] = useState<'names' | 'message' | null>(null);

  const copy = (text: string, key: 'names' | 'message') => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const message = [
    `[주간 업무일지 제출 안내]`,
    `${weekLabel} 업무일지 마감이 ${deadlineText}입니다.`,
    `아직 제출하지 않으셨다면 아래에서 올려 주세요.`,
    baseUrlHint ?? (typeof window !== 'undefined' ? window.location.origin : ''),
    ``,
    `대상: ${names.join(', ')}`,
  ].join('\n');

  if (names.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={() => copy(names.join(', '), 'names')} className="tab-pill">
        {copied === 'names' ? '복사됨 ✓' : `이름 ${names.length}명 복사`}
      </button>
      <button onClick={() => copy(message, 'message')} className="tab-pill">
        {copied === 'message' ? '복사됨 ✓' : '안내문 복사'}
      </button>
    </div>
  );
}
