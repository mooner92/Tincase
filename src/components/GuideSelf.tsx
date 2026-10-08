'use client';
// CP-103 · PG-61 — 사용 안내, 혼자 보기. 발표가 끝난 뒤 각자 모니터에서 자기 속도로 넘겨 본다.
//
// 발표 모드와 같은 단계·같은 무대(게임 튜토리얼식 코치 마크)를 쓴다. 다른 것은 넷이다:
//   - 이 사람이 쓰는 단계만, 내 역할의 장이 맨 앞 — 거르기와 순서는 서버가 준 `caps`로 `selfChapters`가 정한다(TACP-9)
//   - 말풍선을 1.2배로(`SELF_K`) — 모니터 안의 800px 남짓 무대에서 발표와 같은 cqw면 문장이 13px이다
//   - ← → 만 받는다. Space·PageDown은 문서를 스크롤하는 키로 남긴다
//   - [크게 보기]로 검은 바탕의 발표 무대 그대로 — 무대를 누르는 것은 이제 「누를 곳을 눌러 보기」다
// 2026-10-08 — 무대 밑의 본문 2–3줄을 걷었다. 글은 무대 안의 말풍선 「이름: 한 문장」이 맡고, 더 알 것이 있으면
// 「자세히」 밑에 한 줄(`more`)만 둔다 — 글이 길면 화면을 보지 않고 글을 읽는다(사용자: 「거창한 설명보다 직관적으로」).
// 무대 구석의 알약(「부서원 3/8」)은 혼자 보기에서는 그리지 않는다 — 목차·진행 막대가 이미 자리를 말하고, 알약이 앱 머리를
// 덮었다. 「밝게 뚫린 곳을 누르면…」 도움말은 첫 단계에만(2026-10-08 검토 — 매 단계 같은 줄이면 읽히지 않는다).
// 640px 미만과 인쇄에서는 무대 대신 단계를 세로로 늘어놓는다 — 휴대폰에서 줌·팬은 손가락과 싸운다.
// 둘 다 그림을 누를 곳 둘레만 잘라(4:3, 구멍은 가장자리에서 12% 넘게 안쪽) 누를 곳만 밝게 보인다. 인쇄는 A4 가로 한 쪽에
// 잘라 낸 그림을 쪽 폭의 2/3로 크게, 그 밑에 「이름: 한 문장」을 20pt로 — 전체 그림을 쪽의 1/3로 넣었더니 「공유」·「제출」
// 버튼이 10px 남짓이었다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { selfChapters, type GuideCap, type GuideStep, type Slide } from '@/lib/guide/deck';
import { stageClick, type StageTarget } from '@/lib/guide/nav';
import { SELF_K } from '@/lib/guide/coach';
import { fillWeek } from '@/lib/guide/manifest';
import { GuideStage, StaticSlide } from './GuideStage';
import { PresentFrame } from './GuidePresent';

export function GuideSelf({ caps }: { caps: GuideCap[] }) {
  const chapters = useMemo(() => selfChapters(caps), [caps]);
  const slides = useMemo(() => chapters.flatMap((c) => c.slides), [chapters]);
  const [index, setIndex] = useState(0);
  const [big, setBig] = useState(false);
  const [hint, setHint] = useState(0);
  const [open, setOpen] = useState<Set<string>>(() => new Set(chapters.filter((c) => c.mine).map((c) => c.chapter.id)));
  const slide = slides[index];

  // #lead-3 — 주소로 바로 그 단계. 이 사람에게 없는 단계(다른 역할의 것)면 처음으로
  useEffect(() => {
    const fromHash = () => {
      const key = decodeURIComponent(window.location.hash.slice(1));
      const i = slides.findIndex((s) => s.key === key);
      if (i < 0) return;
      setIndex(i);
      const ch = slides[i].chapter.id; // 주소로 들어온 단계의 장은 목차에서 펼쳐 둔다
      setOpen((o) => (o.has(ch) ? o : new Set(o).add(ch)));
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [slides]);

  const go = useCallback(
    (i: number) => {
      const n = Math.max(0, Math.min(slides.length - 1, i));
      setIndex(n);
      const s = slides[n];
      if (s) {
        window.history.replaceState(null, '', `#${s.key}`);
        setOpen((o) => (o.has(s.chapter.id) ? o : new Set(o).add(s.chapter.id)));
      }
    },
    [slides],
  );

  // PG-T90 — 밝은 곳·[다음]은 다음 단계, 어두운 곳은 「여기를 누르세요」를 다시
  const onStage = useCallback(
    (target: StageTarget) => {
      if (stageClick(target) === 'next') go(index + 1);
      else setHint((h) => h + 1);
    },
    [go, index],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'ArrowRight') go(index + 1);
      else if (e.key === 'ArrowLeft') go(index - 1);
      else if (e.key === 'Escape' && big) setBig(false);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, index, big]);

  if (!slide) return null;
  const next = slides[index + 1];
  const more = slide.step?.more;

  return (
    <>
      {/* 640px 이상 — 목차 + 무대 */}
      <div className="mt-6 hidden gap-6 sm:block lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] print:hidden">
        <nav aria-label="안내 목차" className="lg:sticky lg:top-24 lg:self-start">
          {/* lg 미만에서는 장을 한 줄로 — 목차가 무대를 밀어내지 않게 */}
          <ul className="flex flex-wrap gap-1.5 lg:hidden">
            {chapters.map((c) => (
              <li key={c.chapter.id}>
                <button
                  onClick={() => go(slides.indexOf(c.slides[0]))}
                  aria-current={c.chapter.id === slide.chapter.id ? 'true' : undefined}
                  className={`tab-pill ${c.chapter.id === slide.chapter.id ? 'tab-pill-active' : 'bg-canvas'}`}
                >
                  {c.chapter.title}
                </button>
              </li>
            ))}
          </ul>
          <ol className="hidden space-y-1 lg:block">
            {chapters.map((c) => {
              const expanded = open.has(c.chapter.id);
              return (
                <li key={c.chapter.id}>
                  <button
                    onClick={() =>
                      setOpen((o) => {
                        const n = new Set(o);
                        if (n.has(c.chapter.id)) n.delete(c.chapter.id);
                        else n.add(c.chapter.id);
                        return n;
                      })
                    }
                    aria-expanded={expanded}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[15px] font-semibold text-ink hover:bg-canvas"
                  >
                    <span
                      aria-hidden
                      className={`inline-block h-1.5 w-1.5 shrink-0 border-r-[1.5px] border-b-[1.5px] border-current text-muted transition-transform ${
                        expanded ? 'rotate-45' : '-rotate-45'
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate">{c.chapter.title}</span>
                    {c.mine && <span className="chip chip-ok px-2 text-xs">내 역할</span>}
                    <span className="text-xs font-normal text-muted tabular-nums">{c.slides.length}</span>
                  </button>
                  {expanded && (
                    <ol className="mt-0.5 mb-2 ml-3.5 space-y-0.5 border-l border-hairline pl-2">
                      {c.slides.map((s) => {
                        const on = s.key === slide.key;
                        return (
                          <li key={s.key}>
                            {/* 목차는 화면 속 이름 — 「제출」·「주요 업무실적」. 화면에서 찾을 그 낱말이다 */}
                            <a
                              href={`#${s.key}`}
                              onClick={(e) => {
                                e.preventDefault();
                                go(slides.indexOf(s));
                              }}
                              aria-current={on ? 'step' : undefined}
                              className={`block truncate rounded-md px-2 py-1 text-sm leading-5 ${
                                on ? 'bg-canvas font-medium text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06)]' : 'text-muted hover:text-ink'
                              }`}
                            >
                              {s.step?.label}
                            </a>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <section aria-label="안내 단계" className="card card-flush mt-4 overflow-hidden lg:mt-0">
          <GuideStage
            slide={slide}
            index={index}
            theme="light"
            k={SELF_K}
            hint={hint}
            pill={false}
            onClick={onStage}
            className="relative aspect-video w-full"
          />
          <div className="border-t border-hairline px-5 pt-4 pb-5 sm:px-7">
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={() => go(index - 1)} disabled={index === 0} className="btn-secondary btn-sm">
                ← 이전
              </button>
              <button onClick={() => go(index + 1)} disabled={!next} className="btn-primary btn-sm">
                다음 →
              </button>
              <button onClick={() => setBig(true)} className="btn-ghost btn-sm" title="검은 바탕에 크게 (Esc로 닫기)">
                크게 보기
              </button>
              {/* 「1 / 17」 대신 다음 단계의 이름 — 몇 번째인지는 목차와 이 막대가 말한다 */}
              <div className="ml-auto flex min-w-[12rem] flex-1 flex-col gap-1.5 sm:max-w-sm">
                <span className="relative block h-1.5 overflow-hidden rounded-full bg-surface-strong" aria-hidden>
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-brand transition-[width] duration-300"
                    style={{ width: `${((index + 1) / slides.length) * 100}%` }}
                  />
                </span>
                {next ? (
                  <button onClick={() => go(index + 1)} className="truncate text-left text-sm text-muted hover:text-ink">
                    다음: {next.step?.label} →
                  </button>
                ) : (
                  <span className="text-sm text-muted">마지막 단계입니다</span>
                )}
              </div>
            </div>
            {more && (
              <details key={slide.key} className="disclosure mt-4">
                <summary className="text-sm">자세히</summary>
                <p className="mt-1.5 text-[15px] leading-6 text-body">{more}</p>
              </details>
            )}
            {index === 0 && (
              <p className="mt-3 text-xs text-muted">밝게 뚫린 곳을 누르면 다음으로 넘어가요 · 어두운 곳을 누르면 다시 알려 줘요 · ← → 키도 돼요</p>
            )}
          </div>
        </section>
      </div>

      {big && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="크게 보기"
          className="fixed inset-0 z-50 flex items-center justify-center bg-stage print:hidden"
          onClick={() => setBig(false)}
        >
          <div className="w-[min(100vw,calc(100dvh*16/9))]" onClick={(e) => e.stopPropagation()}>
            <PresentFrame slides={slides} index={index} hint={hint} onStageClick={onStage} />
          </div>
          <div className="fixed top-4 right-4 flex items-center gap-2 text-sm">
            <span className="hidden text-stage-muted md:inline">← → 넘기기 · Esc 닫기</span>
            <button
              autoFocus
              onClick={() => setBig(false)}
              className="rounded-lg border border-stage-line bg-stage-soft px-3 py-1.5 text-canvas hover:border-stage-muted"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* 640px 미만·인쇄 — 단계를 세로로. 인쇄하면 한 단계가 한 쪽 */}
      <ol className="mt-6 space-y-4 sm:hidden print:mt-0 print:block print:space-y-0">
        {chapters.flatMap((c) => c.slides.map((s, k) => <ListStep key={s.key} slide={s} first={k === 0} />))}
      </ol>
    </>
  );
}

/**
 * 휴대폰·인쇄의 한 단계. 그림 단계는 누를 곳만 밝은 잘라 낸 그림 + 말풍선의 글 「이름: 한 문장」.
 * 글자 단계는 **그림 없이 글로만** — 글자 슬라이드를 그림처럼 넣으면 바로 아래 글을 한 번 더 읽게 된다.
 */
function ListStep({ slide, first }: { slide: Slide; first: boolean }) {
  const step = slide.step;
  const shot = step?.kind === 'shot';
  return (
    <li id={`step-${slide.key}`} className="break-inside-avoid print:break-after-page print:last:break-after-auto">
      {/* 장 머리 — 휴대폰에서 「부서원 · 8단계」. 인쇄는 쪽마다 머리가 있어 따로 두지 않는다 */}
      {first && (
        <h2 className="mt-4 mb-2 text-[15px] font-semibold text-ink print:hidden">
          {slide.chapter.title} <span className="font-normal text-muted">· {slide.of}단계</span>
        </h2>
      )}
      <div className="card card-flush overflow-hidden print:rounded-none print:border-0 print:shadow-none">
        {/* 인쇄 쪽 머리 — 어느 장의 몇 번째인지 */}
        <p className="hidden border-b border-hairline pb-[3mm] text-xs font-semibold text-muted print:mb-[5mm] print:block">
          Tincase 사용 안내 · {slide.chapter.title} {slide.n}/{slide.of}
        </p>
        {shot && (
          // 인쇄는 쪽 폭의 2/3(4:3이라 A4 가로 한 쪽에 글 두 줄과 함께 들어간다)
          <div className="print:mx-auto print:w-[66%]">
            <StaticSlide slide={slide} />
          </div>
        )}
        <div className={`px-4 pt-3.5 pb-4 print:px-0 ${shot ? 'print:mx-auto print:w-[66%] print:pt-[5mm]' : 'print:pt-0'}`}>
          <p className="text-xs font-semibold text-brand tabular-nums print:hidden">
            {slide.chapter.title} {slide.n}/{slide.of}
          </p>
          {step && (
            <p className="mt-1 text-[16px] leading-snug text-ink [word-break:keep-all] print:mt-0 print:text-[20pt]">
              {shot || step.kind === 'message' ? (
                <>
                  <strong className="font-bold">{step.label}:</strong> {step.say}
                </>
              ) : (
                <>
                  <strong className="font-bold">{step.label}</strong>
                  <span className="mt-0.5 block text-sm text-body print:text-[16px]">{step.say}</span>
                </>
              )}
            </p>
          )}
          {step && step.kind !== 'shot' && <StepExtras step={step} />}
          {/* 더 알 것 한 줄 — 휴대폰은 「자세히」를 눌러야 펼치고(글이 먼저 보이면 그림을 안 본다), 인쇄는 펼친 채 */}
          {step?.more && (
            <>
              <details className="disclosure mt-2 print:hidden">
                <summary className="text-sm">자세히</summary>
                <p className="mt-1 text-sm leading-6 text-body">{step.more}</p>
              </details>
              <p className="hidden text-[14px] leading-6 text-muted print:mt-3 print:block">{step.more}</p>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

/** 글자 슬라이드의 내용을 글로 — 휴대폰·인쇄용 (무대의 큰 글자 대신) */
function StepExtras({ step }: { step: Exclude<GuideStep, { kind: 'shot' }> }) {
  if (step.kind === 'flow') {
    // 다섯 칸 가로 흐름은 휴대폰 폭에 안 들어간다 — 위에서 아래로 다섯 줄
    return (
      <ol className="mt-2.5 divide-y divide-hairline-soft rounded-lg border border-hairline text-sm">
        {step.flow.map((f, i) => (
          <li key={f.who} className="flex items-baseline gap-3 px-3 py-2">
            <span className="w-4 shrink-0 text-xs text-muted tabular-nums">{i + 1}</span>
            <span className="w-20 shrink-0 font-semibold text-ink">{f.who}</span>
            <span className="text-body">{f.what}</span>
          </li>
        ))}
      </ol>
    );
  }
  if (step.kind === 'message') {
    return (
      <div className="mt-2.5 rounded-lg border border-hairline bg-surface-soft px-3 py-2.5 text-sm">
        <p className="text-xs text-muted">사내 메신저 · {step.message.from}</p>
        <p className="mt-1 font-semibold text-ink">{fillWeek(step.message.subject)}</p>
        {step.message.lines.map((l) => (
          <p key={l} className="text-body">
            {fillWeek(l)}
          </p>
        ))}
      </div>
    );
  }
  if (step.kind === 'buttons') {
    return (
      <dl className="mt-2.5 space-y-2 text-sm">
        {step.rows.map((r) => (
          <div key={r.who} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <dt className="w-20 shrink-0 font-semibold text-muted">{r.who}</dt>
            <dd className="flex flex-wrap items-center gap-1.5">
              {r.buttons.map((b, i) => (
                <span key={b} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-xs text-muted">{r.or ? '또는' : '→'}</span>}
                  <span className="rounded-md border border-border-strong px-2 py-0.5 text-ink">{b}</span>
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return null;
}
