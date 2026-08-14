'use client';
// AU-08 — 로그아웃. 사내망 세션이면 앱에서, Cloudflare 경유면 CF 로그아웃으로.
import { useRouter } from 'next/navigation';

export function LogoutButton({ viaCloudflare }: { viaCloudflare: boolean }) {
  const router = useRouter();
  const onClick = () => {
    if (viaCloudflare) {
      // Next 라우트가 아니라 Cloudflare 엣지 엔드포인트다 — 라우터로 갈 수 없다 (AU-08)
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/cdn-cgi/access/logout';
      return;
    }
    fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
      router.replace('/login');
      router.refresh();
    });
  };
  return (
    <button onClick={onClick} className="text-slate-400 hover:text-slate-600 hover:underline">
      로그아웃
    </button>
  );
}
