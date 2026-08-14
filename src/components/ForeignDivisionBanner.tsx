// AU-15·16 — 타 부서 열람 중임을 항상 명시한다.
// 헤더만 바뀌고 본문은 내 부서였던 v1.3.0 버그가, 지금 어느 부서를 보는지 불분명해서 생겼다.
import Link from 'next/link';

export function ForeignDivisionBanner({
  divisionName,
  ownSlug,
}: {
  divisionName: string;
  ownSlug: string;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-ochre/60 bg-brand-ochre/15 px-5 py-3">
      <p className="text-sm text-body-strong">
        <span className="font-semibold">{divisionName}</span> 페이지를 열람 중입니다 — 내 부서가 아닙니다.
        <span className="ml-1.5 text-muted">제출은 내 부서에서만 가능하며, 이 열람은 기록됩니다.</span>
      </p>
      <Link href={`/${ownSlug}`} className="btn-secondary btn-sm shrink-0">
        내 부서로
      </Link>
    </div>
  );
}
