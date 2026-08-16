'use client';
// CP-70~77 — 제출물 열람 드로어. 읽기 전용, 파싱된 표 렌더, ←→ 제출자 이동, 버전 전환.
import { useCallback, useEffect, useRef, useState } from 'react';

export interface DrawerMember {
  userId: string;
  name: string;
  latestId: string | null; // null = 미제출 (←→ 이동 시 건너뜀 — CP-74)
}

interface PreviewData {
  submission: { id: string; version: number; uploadedAt: string; userName: string; userId: string };
  tables: { title: string; columns: string[]; rows: string[][] }[];
  warnings: string[];
}
interface VersionRow {
  id: string;
  version: number;
  isLatest: boolean;
  uploadedAt: string;
  byteSize: number;
}

export function FileDrawer({
  openId,
  members,
  onClose,
  onNavigate,
}: {
  openId: string | null;
  members: DrawerMember[];
  onClose: () => void;
  onNavigate: (submissionId: string) => void;
}) {
  const [data, setData] = useState<PreviewData | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // 로딩은 파생값 — 열려 있는데 그 id의 데이터가 아직 없으면 로딩 (effect 내 동기 setState 회피)
  const loading = !!openId && data?.submission.id !== openId && !error;

  // 데이터 로드 (CP-70)
  useEffect(() => {
    if (!openId) return;
    let alive = true;
    Promise.all([
      fetch(`/api/submissions/${openId}/preview`).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.message ?? '열람에 실패했습니다.');
        return r.json() as Promise<PreviewData>;
      }),
      fetch(`/api/submissions/${openId}/versions`)
        .then((r) => (r.ok ? r.json() : { versions: [] }))
        .then((b) => b.versions as VersionRow[]),
    ])
      .then(([p, v]) => {
        if (!alive) return;
        setData(p);
        setVersions(v);
        setError(null);
        titleRef.current?.focus(); // 접근성: 열릴 때 제목 포커스
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e)); // CP-77
      });
    return () => {
      alive = false;
    };
  }, [openId]);

  // ←→ 제출자 이동 (CP-74) — 미제출자 건너뜀
  const navigate = useCallback(
    (dir: 1 | -1) => {
      if (!data) return;
      const idx = members.findIndex((m) => m.userId === data.submission.userId);
      if (idx < 0) return;
      for (let i = idx + dir; i >= 0 && i < members.length; i += dir) {
        if (members[i].latestId) {
          onNavigate(members[i].latestId!);
          return;
        }
      }
    },
    [data, members, onNavigate],
  );

  // 키보드 (Esc·←→) + 포커스 트랩 (CP-75)
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') navigate(1);
      else if (e.key === 'ArrowLeft') navigate(-1);
      else if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, a[href], select, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openId, onClose, navigate]);

  if (!openId) return null;

  return (
    <div className="fixed inset-0 z-40">
      {/* 배경 클릭 → 닫기 */}
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="제출물 열람"
        className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col bg-canvas shadow-[-8px_0_32px_rgba(10,10,10,0.08)]"
      >
        {/* 헤더 (CP-73) */}
        <div className="flex items-center justify-between gap-2 border-b border-hairline px-5 py-3">
          <div className="flex items-center gap-3">
            <h2 ref={titleRef} tabIndex={-1} className="text-base font-bold text-ink outline-none">
              {data ? (
                <>
                  {data.submission.userName}{' '}
                  <span className="font-normal text-muted">
                    · v{data.submission.version} · {data.submission.uploadedAt.slice(5, 16).replace('T', ' ')}
                  </span>
                </>
              ) : (
                '불러오는 중…'
              )}
            </h2>
            {versions.length > 1 && data && (
              <select
                aria-label="버전 선택"
                value={data.submission.id}
                onChange={(e) => onNavigate(e.target.value)}
                className="rounded border border-hairline px-2 py-1 text-xs"
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.version}
                    {v.isLatest ? ' (현재본)' : ''} · {v.uploadedAt.slice(5, 16).replace('T', ' ')}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* ←→ 는 **제출자 사이** 이동이다. 혼자 볼 때는 갈 곳이 없으므로 숨긴다 —
                눌러도 아무 일이 없는 버튼은 고장으로 읽힌다 */}
            {members.length > 1 && (
              <>
                <button
                  onClick={() => navigate(-1)}
                  className="rounded border border-hairline px-2 py-1 text-xs text-body hover:bg-surface-soft"
                  aria-label="이전 제출자"
                >
                  ←
                </button>
                <button
                  onClick={() => navigate(1)}
                  className="rounded border border-hairline px-2 py-1 text-xs text-body hover:bg-surface-soft"
                  aria-label="다음 제출자"
                >
                  →
                </button>
              </>
            )}
            {data && (
              <a
                href={`/api/submissions/${data.submission.id}/download`}
                className="rounded border border-hairline px-2.5 py-1 text-xs font-medium text-body hover:bg-surface-soft"
              >
                원본 다운로드
              </a>
            )}
            <button
              onClick={onClose}
              className="rounded px-2 py-1 text-lg leading-none text-muted-soft hover:text-body"
              aria-label="닫기"
            >
              ×
            </button>
          </div>
        </div>

        {/* 본문 — 읽기 전용 (CP-76) */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="animate-pulse space-y-4">
              <div className="h-6 w-40 rounded bg-surface-card" />
              <div className="h-40 rounded bg-surface-card" />
              <div className="h-40 rounded bg-surface-card" />
            </div>
          )}
          {error && (
            <div className="rounded-xl bg-error/10 px-4 py-3 text-sm text-error">
              {error}
              {/* CP-77 — 열람 실패해도 원본 경로는 살아있게 */}
              <p className="mt-1 text-xs text-error">원본 다운로드로 내용을 확인해 주세요.</p>
            </div>
          )}
          {data && !loading && (
            <div className="space-y-6">
              {data.warnings.length > 0 && (
                <p className="rounded bg-brand-ochre/15 px-3 py-2 text-xs text-body-strong">{data.warnings.join(' · ')}</p>
              )}
              {data.tables.map((t) => (
                <section key={t.title}>
                  <h3 className="mb-2 text-sm font-semibold text-body">{t.title}</h3>
                  {t.rows.length <= 1 ? (
                    <p className="text-xs text-muted-soft">내용 없음{t.title.startsWith('3') && ' (표 삭제됨 — 관례상 정상)'}</p>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-hairline">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-surface-soft text-left text-muted">
                            {t.rows[0].map((h, i) => (
                              <th key={i} scope="col" className="border-b border-hairline px-2.5 py-1.5 font-medium">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {t.rows.slice(1).map((row, ri) => (
                            <tr key={ri} className="border-b border-hairline-soft last:border-0">
                              {row.map((cell, ci) => (
                                <td key={ci} className="whitespace-pre-line px-2.5 py-1.5 align-top text-ink">
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              ))}
              {/* 3번 표가 아예 없는 경우 (CP-72) */}
              {data.tables.length === 2 && (
                <section>
                  <h3 className="mb-1 text-sm font-semibold text-body">3. 기타 특이사항</h3>
                  <p className="text-xs text-muted-soft">없음 (표 삭제됨 — 관례상 정상)</p>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
