'use client';
// CP-62~65 — 미제출자 이름 복사. 구형 브라우저 폴백 포함.
import { useState } from 'react';
import { copyText } from '@/lib/clipboard';

export function CopyMissingButton({ names }: { names: string[] }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  if (names.length === 0) return null; // CP-64

  // CP-65 · CP-109 — 대체 경로는 copyText 한 곳에 있다. 된 것만 「복사됨」 — 실패를 성공처럼 보이지 않는다
  const copy = async () => {
    const ok = await copyText(names.join(', '));
    setCopied(ok);
    setTimeout(() => setCopied(null), ok ? 2000 : 4000); // CP-63
  };

  return (
    <button onClick={copy} className="btn-secondary btn-sm">
      {copied === true ? '복사됨 ✓' : copied === false ? '복사하지 못했습니다' : `미제출 ${names.length}명 이름 복사`}
    </button>
  );
}
