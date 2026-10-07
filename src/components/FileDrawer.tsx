'use client';
// CP-70~77 — 제출물 열람 드로어. 읽기 전용, 파싱된 표 렌더, ←→ 제출자 이동, 버전 전환.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SubmissionEditor, type EditRow } from './SubmissionEditor';

export interface DrawerMember {
  userId: string;
  name: string;
  latestId: string | null; // null = 미제출 (←→ 이동 시 건너뜀 — CP-74)
}

interface PreviewData {
  submission: {
    id: string;
    version: number;
    uploadedAt: string;
    userName: string;
    userId: string;
    editedBy?: string | null;
    /** TACP-22 — 고친 시각 (KST ISO). `uploadedAt`은 부서원이 낸 시각 그대로다 */
    editedAt?: string | null;
  };
  tables: { title: string; columns: string[]; rows: string[][] }[];
  warnings: string[];
  /** WA-20 — 이 사람이 이 판을 고칠 수 있나 (내 부서 lead·head, 최신 판) */
  canRevise?: boolean;
  rowsByTable?: Record<'achievements' | 'plans' | 'notes', EditRow[]>;
}
interface VersionRow {
  id: string;
  version: number;
  isLatest: boolean;
  uploadedAt: string;
  byteSize: number;
  /** TACP-22 — 담당자가 고친 판이면 고친 사람 */
  editedBy?: string | null;
  editedAt?: string | null;
}

/** TACP-22 — 「○○ 고침 · 14:30」. 제출 시각과 고친 시각을 섞지 않는다 */
const editedLabel = (by: string, at?: string | null) => `${by} 고침${at ? ` · ${at.slice(11, 16)}` : ''}`;

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
  // WA-20 — 고치는 중인 판의 id. 다른 판·다른 사람으로 옮기면 저절로 풀린다
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = !!openId && editingId === openId;
  // 저장하지 않은 수정이 있나 — 고치는 중일 때만 뜻이 있다
  const [dirty, setDirty] = useState(false);
  const unsaved = editing && dirty;
  /*
   * 저장 안내는 **저장한 판에 붙인다.** 문자열만 두면 드로어를 닫고 다른 사람을 열어도
   * 「v3로 저장했습니다」가 그 사람 위에 남는다 (2026-10-07 리뷰)
   */
  const [savedNote, setSavedNote] = useState<{ id: string; text: string } | null>(null);
  const router = useRouter();
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

  /**
   * 닫기 — 배경·×·Esc가 모두 여기로. 고치던 내용이 있으면 먼저 묻는다(MergedDrawer와 같은 방식).
   * 닫으면 고치기 상태도 푼다 — 같은 판을 다시 열었을 때 편집기가 빈손으로 뜨지 않게.
   */
  const requestClose = useCallback(() => {
    if (unsaved && !confirm('저장하지 않은 수정이 있습니다. 닫을까요?')) return;
    setEditingId(null);
    setDirty(false);
    onClose();
  }, [unsaved, onClose]);

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
      if (e.key === 'Tab' && panelRef.current) {
        // 포커스 트랩은 고치는 중에도 건다 — 편집 칸을 Tab으로 돌다 드로어 밖(뒤 화면)으로 새면 안 된다
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], select, input, textarea, [tabindex]:not([tabindex="-1"])',
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
        return;
      }
      // 고치는 중에는 화살표가 글자 사이를 오가야 한다 — 사람 이동·닫기로 쓰지 않는다
      if (editing) return;
      if (e.key === 'Escape') requestClose();
      else if (e.key === 'ArrowRight') navigate(1);
      else if (e.key === 'ArrowLeft') navigate(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openId, requestClose, navigate, editing]);

  if (!openId) return null;

  return (
    <div className="fixed inset-0 z-40 h-screen">
      {/* 배경 클릭 → 닫기 */}
      <div className="absolute inset-0 bg-ink/30" onClick={requestClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="제출물 열람"
        className="absolute inset-y-0 right-0 flex h-full w-full max-w-2xl flex-col border-l border-hairline bg-canvas shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
      >
        {/* 헤더 (CP-73) */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-3 sm:px-5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h2 ref={titleRef} tabIndex={-1} className="text-base font-semibold text-ink outline-none">
              {data ? (
                <>
                  {data.submission.userName}{' '}
                  <span className="font-normal text-muted">
                    · v{data.submission.version} · {data.submission.uploadedAt.slice(5, 16).replace('T', ' ')}
                    {data.submission.editedBy && ` · ${editedLabel(data.submission.editedBy, data.submission.editedAt)}`}
                  </span>
                </>
              ) : (
                '불러오는 중…'
              )}
            </h2>
            {/* 고치는 중에는 판을 바꾸지 않는다 — 바꾸는 순간 고치던 내용이 사라진다 */}
            {versions.length > 1 && data && !editing && (
              <select
                aria-label="버전 선택"
                value={data.submission.id}
                onChange={(e) => onNavigate(e.target.value)}
                className="select h-8"
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.version}
                    {v.isLatest ? ' (현재본)' : ''} · {v.uploadedAt.slice(5, 16).replace('T', ' ')}
                    {v.editedBy ? ` · ${editedLabel(v.editedBy, v.editedAt)}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* ←→ 는 **제출자 사이** 이동이다. 혼자 볼 때는 갈 곳이 없으므로 숨긴다 —
                눌러도 아무 일이 없는 버튼은 고장으로 읽힌다 */}
            {members.length > 1 && !editing && (
              <>
                <button onClick={() => navigate(-1)} className="btn-ghost w-9 px-0" aria-label="이전 제출자">
                  ←
                </button>
                <button onClick={() => navigate(1)} className="btn-ghost w-9 px-0" aria-label="다음 제출자">
                  →
                </button>
              </>
            )}
            {data?.canRevise && !editing && (
              <button
                onClick={() => {
                  setSavedNote(null);
                  setDirty(false);
                  setEditingId(data.submission.id);
                }}
                className="btn-secondary btn-sm"
              >
                고치기
              </button>
            )}
            {data && (
              <a href={`/api/submissions/${data.submission.id}/download`} className="btn-ghost">
                원본 다운로드
              </a>
            )}
            <button onClick={requestClose} className="btn-ghost w-9 px-0 text-xl leading-none text-muted" aria-label="닫기">
              ×
            </button>
          </div>
        </div>

        {/* 본문 — 읽기 전용 (CP-76) */}
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {loading && (
            <div className="animate-pulse space-y-4">
              <div className="h-6 w-40 rounded bg-surface-strong" />
              <div className="h-40 rounded bg-surface-strong" />
              <div className="h-40 rounded bg-surface-strong" />
            </div>
          )}
          {error && (
            <div className="callout callout-error">
              {error}
              {/* CP-77 — 열람 실패해도 원본 경로는 살아있게 */}
              <p className="mt-1 text-xs text-error">원본 다운로드로 내용을 확인해 주세요.</p>
            </div>
          )}
          {savedNote && savedNote.id === openId && !editing && (
            <p className="callout mb-4 bg-success-soft text-ink">{savedNote.text}</p>
          )}
          {data && !loading && editing && data.rowsByTable && (
            <SubmissionEditor
              submissionId={data.submission.id}
              ownerName={data.submission.userName}
              version={data.submission.version}
              initial={data.rowsByTable}
              onCancel={() => {
                setEditingId(null);
                setDirty(false);
              }}
              onDirtyChange={setDirty}
              onSaved={(newId, v) => {
                setEditingId(null);
                setDirty(false);
                setSavedNote({
                  id: newId,
                  text: `v${v}로 저장했습니다 — 원래 판은 그대로 있습니다. 병합본에 넣으려면 [다시 병합]을 누르세요.`,
                });
                onNavigate(newId);
                router.refresh();
              }}
            />
          )}
          {data && !loading && !editing && (
            <div className="space-y-6">
              {data.warnings.length > 0 && (
                <p className="callout callout-warn">{data.warnings.join(' · ')}</p>
              )}
              {data.tables.map((t) => (
                <section key={t.title}>
                  <h3 className="mb-2 text-[15px] font-semibold text-ink">{t.title}</h3>
                  {t.rows.length <= 1 ? (
                    <p className="text-sm text-muted">내용 없음{t.title.startsWith('3') && ' (표 삭제됨 — 관례상 정상)'}</p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-hairline">
                      <table className="w-full min-w-[520px] text-[13px]">
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
                  <h3 className="mb-1 text-[15px] font-semibold text-ink">3. 기타 특이사항</h3>
                  <p className="text-sm text-muted">없음 (표 삭제됨 — 관례상 정상)</p>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
