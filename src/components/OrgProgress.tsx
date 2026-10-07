// PG-50 — 전사 현황 본판. **팀 하나 = 한 줄**, 본부별로 묶는다.
//
// 원형 조직도는 337명을 점으로 찍어 예쁘지만 「어느 팀이 몇 명 남았나」를 읽기 어려웠다(2026-10-07 피드백).
// 총괄이 실제로 묻는 것은 사람이 아니라 팀이다 — 「기획조정실 7/8」. 그래서 팀을 막대 하나로 그리고,
// 남은 사람 이름은 펼쳐야 보이게 접어 둔다. 새 탭으로 열던 원형 그래프는 걷어 냈다(2026-10-07, PG-50e) —
// 이 판과 같은 숫자를 다른 그림으로 보여 줄 뿐이었다. 원형 그림은 인쇄용 감사 문서(OPS-30)에만 남는다.
import Link from 'next/link';
import type { HqGroup, TeamProgress } from '@/lib/org-groups';
import { NudgeButton } from './NudgeButton';

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const color = pct === 100 ? 'bg-success' : pct > 0 ? 'bg-[#5b82e0]' : 'bg-transparent';
  return (
    <span className="relative block h-2 w-full overflow-hidden rounded-full bg-surface-strong" aria-hidden>
      <span className={`absolute inset-y-0 left-0 rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </span>
  );
}

function TeamRow({ t }: { t: TeamProgress }) {
  if (!t.isActive) {
    return (
      <li className="grid grid-cols-[minmax(0,8.5rem)_1fr] items-center gap-3 py-2 text-sm">
        <span className="truncate text-muted">{t.name}</span>
        <span className="text-xs text-muted-soft">Tincase 미사용 · 취합게시판으로 제출</span>
      </li>
    );
  }
  const done = t.roster > 0 && t.submitted === t.roster;
  return (
    <li className="py-2 text-sm">
      <div className="grid grid-cols-[minmax(0,8.5rem)_1fr_3.25rem] items-center gap-3">
        <Link href={`/${t.slug}/manage`} className="truncate font-medium text-ink hover:underline" title="수합 관리 열기">
          {t.name}
        </Link>
        <Bar value={t.submitted} max={t.roster} />
        <span className={`text-right tabular-nums ${done ? 'font-semibold text-success' : 'text-body'}`}>
          {t.submitted}
          <span className="text-muted">/{t.roster}</span>
        </span>
      </div>
      {t.missing.length > 0 && (
        <details className="mt-0.5 pl-[9.25rem] text-xs">
          <summary className="cursor-pointer text-muted hover:text-ink">미제출 {t.missing.length}명</summary>
          <p className="mt-1 leading-5 text-body">{t.missing.join(' · ')}</p>
        </details>
      )}
    </li>
  );
}

export function OrgProgress({
  groups,
  weekLabel,
  deadlineText,
  capturedAtKst,
  excludedNote,
}: {
  groups: HqGroup[];
  weekLabel: string;
  deadlineText: string;
  capturedAtKst: string;
  excludedNote: { divisions: number; people: number };
}) {
  const teams = groups.flatMap((g) => g.teams).filter((t) => t.isActive);
  const roster = teams.reduce((n, t) => n + t.roster, 0);
  const sent = teams.reduce((n, t) => n + t.submitted, 0);
  // 「다 낸 팀 n / m곳」의 m은 **낼 사람이 있는 팀**만 — 명단 0명인 팀은 다 낼 수도 못 낼 수도 없다
  const expected = teams.filter((t) => t.roster > 0);
  const full = expected.filter((t) => t.submitted === t.roster).length;
  const pct = roster > 0 ? Math.round((sent / roster) * 100) : 0;
  // 전사 미제출 명단 — 본 다음 동작은 언제나 「알려주기」다. 옮겨 적게 하지 않는다
  const missingTeams = teams.filter((t) => t.missing.length > 0);
  const allMissing = missingTeams.flatMap((t) => t.missing);

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-end gap-x-10 gap-y-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">전사 제출 현황 · {weekLabel}</p>
          <p className="display mt-1 text-[40px] leading-none">
            {sent}
            <span className="text-[24px] text-muted"> / {roster}명</span>
            <span className="ml-3 text-[20px] text-muted-soft">{pct}%</span>
          </p>
        </div>
        <div className="text-sm text-body">
          <p>
            다 낸 팀 <strong className="text-ink">{full}</strong>
            <span className="text-muted"> / {expected.length}곳</span>
          </p>
          <p className="text-muted">
            마감 {deadlineText} · {capturedAtKst}
          </p>
        </div>
        {excludedNote.divisions > 0 && (
          <p className="text-xs text-muted-soft">
            업무일지를 내지 않는 부서 {excludedNote.divisions}곳({excludedNote.people}명)은 세지 않습니다
          </p>
        )}
      </section>

      {allMissing.length > 0 && (
        <section className="card px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-body">
              <span className="font-semibold text-ink">{allMissing.length}명</span>이 아직 내지 않았습니다 · 마감{' '}
              {deadlineText}
            </p>
            <NudgeButton names={allMissing} deadlineText={deadlineText} weekLabel={weekLabel} />
          </div>
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-xs text-muted hover:text-ink">팀별 미제출 명단</summary>
            <ul className="mt-2 space-y-1.5">
              {missingTeams.map((t) => (
                <li key={t.id} className="flex flex-wrap gap-x-3 gap-y-1">
                  <span className="min-w-36 font-medium text-ink">{t.name}</span>
                  <span className="text-body">{t.missing.join(', ')}</span>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}

      {/* 세로로 쌓는 단 — 팀 수가 다른 본부 카드가 서로 높이를 맞추느라 빈칸을 만들지 않게 */}
      <div className="gap-4 md:columns-2 xl:columns-3">
        {groups.map((g) => (
          <section key={g.name} className="card mb-4 break-inside-avoid px-5 py-4">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-semibold text-ink">{g.name}</h3>
              {g.roster > 0 && (
                <span className="tabular-nums text-sm text-muted">
                  {g.submitted}/{g.roster}
                </span>
              )}
            </div>
            <ul className="mt-2 divide-y divide-hairline-soft">
              {g.teams.map((t) => (
                <TeamRow key={t.id} t={t} />
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="text-xs text-muted-soft">
        본부 묶음은 ERP 상위부서 기준입니다 · 팀 이름을 누르면 수합 관리로 갑니다(읽기 전용, 기록이 남습니다)
      </p>
    </div>
  );
}
