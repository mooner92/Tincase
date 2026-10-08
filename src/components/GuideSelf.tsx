'use client';
// CP-103 · PG-61 · PG-83 — 사용 안내, **체험하기**(혼자 보기). 각자 모니터에서 자기 속도로 넘겨 본다.
//
// 발표 모드와 같은 단계·같은 무대(게임 튜토리얼식 코치 마크)를 쓴다. 다른 것은:
//   - **가진 역할 장만, 이야기 순서로 쌓는다**(PG-83 — 부서원 → + 부서담당자 → + 실·팀장 → + 본부 → + 총괄). 거르기는 서버가 준
//     `caps`로 `selfChapters`가 정한다(TACP-9). 예전의 「내 역할 장 맨 앞」은 없앴다
//   - 말풍선을 1.2배로(`SELF_K`) — 모니터 안의 800px 남짓 무대에서 발표와 같은 cqw면 문장이 13px이다
//   - ← → 만 받는다. Space·PageDown은 문서를 스크롤하는 키로 남긴다
//   - [크게 보기]로 발표 무대 그대로
// 2026-10-08 v2(PG-80) — **넘기기 단추는 언제나 같은 자리.** 사용자: 「이전, 다음 버튼이 내용 양에 따라 위아래로 이동 — 같은 위치에
// 있어야 연속적으로 누를 때 피로가 덜하다」. 그래서 무대 **바로 밑** 높이 고정 줄에 도크(칸 폭 고정)를 두고, 단계에 따라 크기가
// 바뀌는 것(「자세히」)은 도크 **아래**에 둔다. 말풍선 속 [다음]·진행 막대·「다음: {이름} →」는 지웠다 — 도크의 「부서원 3/7」이 자리를 말한다.
// 640px 미만과 인쇄에서는 무대 대신 단계를 세로로 늘어놓는다 — 휴대폰에서 줌·팬은 손가락과 싸운다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { isCoachStep, selfChapters, type GuideCap, type GuideStep, type Slide } from '@/lib/guide/deck';
import { stageClick, type StageTarget } from '@/lib/guide/nav';
import { SELF_K } from '@/lib/guide/coach';
import { fillWeek } from '@/lib/guide/manifest';
import { tourPath, type TourChapterId } from '@/lib/guide/tour';
import { GuideStage, StaticSlide } from './GuideStage';
import { PresentFrame } from './GuidePresent';
import { CoachDock } from './CoachParts';

export function GuideSelf({ caps, tour }: { caps: GuideCap[]; tour?: { slug: string; chapters: TourChapterId[] } | null }) {
  const chapters = useMemo(() => selfChapters(caps), [caps]);
  const slides = useMemo(() => chapters.flatMap((c) => c.slides), [chapters]);
  const [index, setIndex] = useState(0);
  const [big, setBig] = useState(false);
  const [hint, setHint] = useState(0);
  // 목차는 지금 장만 펼친다 — 장이 짧아(3~8단계) 다 펼쳐도 되지만, 목차가 길면 지금 자리가 안 보인다
  const [open, setOpen] = useState<Set<string>>(() => new Set(chapters.slice(0, 1).map((c) => c.chapter.id)));
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

  // PG-T90 — 밝은 곳은 다음 단계, 어두운 곳은 「여기를 누르세요」를 다시
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

  // 크게 보기가 열린 동안 문서 스크롤을 잠근다(PG-81 · B6) — 스크롤바가 보이는 채로 무대를 재면 그 폭만큼 잘렸다.
  // 거터(scrollbar-gutter: stable)가 있어 뒤 페이지는 흔들리지 않는다
  useEffect(() => {
    if (!big) return;
    const html = document.documentElement;
    const before = html.style.overflow;
    const beforeBg = html.style.backgroundColor;
    html.style.overflow = 'hidden';
    // 덮개는 스크롤바 자리를 덮지 못한다 — 그 띠(html 배경)도 무대색으로, 오른쪽 끝에 회색 줄이 서지 않게
    html.style.backgroundColor = 'var(--color-stage)';
    return () => {
      html.style.overflow = before;
      html.style.backgroundColor = beforeBg;
    };
  }, [big]);

  if (!slide) return null;
  const more = slide.step?.more;
  const count = `${slide.chapter.title} ${slide.n}/${slide.of}`;
  const dock = (float: boolean) => (
    <CoachDock
      count={count}
      onPrev={() => go(index - 1)}
      onNext={() => go(index + 1)}
      canPrev={index > 0}
      canNext={index < slides.length - 1}
      float={float}
    />
  );

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
              const ch = c.chapter.id as TourChapterId;
              const onTour = tour && tour.chapters.includes(ch);
              return (
                <li key={c.chapter.id}>
                  <div className="flex items-center gap-1">
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
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[15px] font-semibold text-ink hover:bg-canvas"
                    >
                      <span
                        aria-hidden
                        className={`inline-block h-1.5 w-1.5 shrink-0 border-r-[1.5px] border-b-[1.5px] border-current text-muted transition-transform ${
                          expanded ? 'rotate-45' : '-rotate-45'
                        }`}
                      />
                      <span className="min-w-0 flex-1 truncate">{c.chapter.title}</span>
                      <span className="text-xs font-normal text-muted tabular-nums">{c.slides.length}</span>
                    </button>
                    {/* PG-84 — 그 장의 실제 화면 둘러보기. 기록과 상관없이 시작한다 */}
                    {onTour && (
                      <Link
                        href={`${tourPath(ch, tour.slug)}?tour=${ch}`}
                        className="shrink-0 rounded-md px-1.5 py-1 text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
                        aria-label={`${c.chapter.title} — 실제 화면에서 둘러보기`}
                      >
                        화면에서
                      </Link>
                    )}
                  </div>
                  {expanded && (
                    <ol className="mt-0.5 mb-2 ml-3.5 space-y-0.5 border-l border-hairline pl-2">
                      {c.slides.map((s) => {
                        const on = s.key === slide.key;
                        return (
                          <li key={s.key}>
                            {/* 목차는 화면 속 이름 — 「제출」·「업무 내용」. 화면에서 찾을 그 낱말이다 */}
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
            k={SELF_K}
            hint={hint}
            pill={false}
            // PG-80 — 꼬리말 「버튼을 눌러 계속」은 첫 코치 단계에만
            foot={index === 0 && !!slide.step && isCoachStep(slide.step)}
            onClick={onStage}
            className="relative aspect-video w-full"
          />
          {/* PG-80 — 도크 줄. 높이 고정, 무대 바로 밑 — 위에 단계마다 크기가 바뀌는 것이 없다 */}
          <div className="flex h-16 items-center gap-3 border-t border-hairline px-5 sm:px-7">
            {dock(false)}
            <button onClick={() => setBig(true)} className="btn-ghost ml-auto w-24 shrink-0" title="크게 (Esc로 닫기)">
              크게 보기
            </button>
          </div>
          {more && (
            <details key={slide.key} className="disclosure border-t border-hairline-soft px-5 py-3 sm:px-7">
              <summary className="text-sm">자세히</summary>
              <p className="mt-1.5 text-[15px] leading-6 text-body">{more}</p>
            </details>
          )}
        </section>
      </div>

      {big && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="크게 보기"
          className="fixed top-0 left-0 z-50 h-dvh w-screen bg-stage print:hidden"
          onClick={() => setBig(false)}
        >
          {/* 무대는 덮개 기준 — 도크 자리(5.5rem)를 비우고 가운데. 100vw가 아니라 100%(스크롤바 폭이 들어가 양끝이 잘렸다 — PG-81 B6) */}
          <div className="absolute inset-x-0 top-0 bottom-[5.5rem] flex items-center justify-center px-4">
            <div className="w-[min(100%,calc((100dvh-5.5rem)*16/9))]" onClick={(e) => e.stopPropagation()}>
              <PresentFrame slides={slides} index={index} hint={hint} onStageClick={onStage} />
            </div>
          </div>
          {dock(true)}
          <button
            autoFocus
            onClick={() => setBig(false)}
            className="btn-secondary btn-sm fixed top-4 right-4"
          >
            닫기
          </button>
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
      {/* 장 머리 — 휴대폰에서 「부서원 · 7단계」. 인쇄는 쪽마다 머리가 있어 따로 두지 않는다 */}
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

/** 글자 슬라이드의 내용을 글로 — 휴대폰·인쇄용 (무대의 큰 글자 대신). 체험하기에는 알림 카드만 남았다(PG-83) */
function StepExtras({ step }: { step: Exclude<GuideStep, { kind: 'shot' }> }) {
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
  return null;
}
