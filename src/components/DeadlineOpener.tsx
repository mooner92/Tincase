'use client';
// DM-20 — 마감 **잠시 열기·닫기** (TACP-18).
//
// 늦게 낸 사람을 담당자가 받아 주는 길이다. 「대신 올려 주기」가 아니라 「문을 잠깐 여는 것」인
// 이유: 대신 올리면 «누구 것인가»와 «누가 올렸나»가 갈리고, 화면 어디 한 곳에서 그 표시를
// 빠뜨리는 순간 기록이 거짓말을 한다. 열면 **낸 사람이 자기 이름으로** 낸다.
//
// **열려 있는 동안은 눈에 거슬려야 한다.** 마감이 풀린 상태는 예외이지 평상이 아니고,
// 조용하면 열어 둔 것을 잊는다. 그래서 배지가 아니라 **경고 띠**로 그린다.
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function DeadlineOpener({
  open,
  openUntilKo,
  openedBy,
  minutes,
}: {
  open: boolean;
  /** 「15:12」 — 열려 있을 때만 */
  openUntilKo: string | null;
  openedBy: string | null;
  minutes: number;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const call = (method: 'POST' | 'DELETE') => {
    setBusy(true);
    setErr(null);
    fetch('/api/division/deadline', { method })
      .then(async (r) => {
        if (!r.ok) setErr(((await r.json()) as { message?: string }).message ?? '실패했습니다.');
        else router.refresh();
      })
      .catch(() => setErr('네트워크 오류로 처리하지 못했습니다.'))
      .finally(() => setBusy(false));
  };

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button onClick={() => call('POST')} disabled={busy} className="btn-oncolor">
          {busy ? '여는 중…' : `마감 ${minutes}분 열기`}
        </button>
        {err && <span className="text-xs text-white/80">{err}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={() => call('DELETE')} disabled={busy} className="btn-oncolor">
        {busy ? '닫는 중…' : '지금 닫기'}
      </button>
      <span className="text-xs text-white/80">
        {openedBy && `${openedBy} `}
        {openUntilKo}까지
      </span>
      {err && <span className="text-xs text-white/80">{err}</span>}
    </div>
  );
}
