'use client';
// CP-62~65 — 미제출자 이름 복사. 구형 브라우저 폴백 포함.
import { useState } from 'react';

export function CopyMissingButton({ names }: { names: string[] }) {
  const [copied, setCopied] = useState(false);
  if (names.length === 0) return null; // CP-64

  const copy = async () => {
    const text = names.join(', ');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // CP-65 — execCommand 폴백 (사내 구형 브라우저)
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000); // CP-63
  };

  return (
    <button
      onClick={copy}
      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
    >
      {copied ? '복사됨 ✓' : `미제출 ${names.length}명 복사`}
    </button>
  );
}
