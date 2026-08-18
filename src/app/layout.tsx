import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

/**
 * 페이퍼로지 — 한글·영문 모두 이 글꼴로 간다.
 *
 * `next/font/local`을 쓰는 이유 (globals.css의 `@font-face`가 아니라):
 * 파일을 빌드에 실어 **자체 호스팅**하고, 링크를 preload로 걸며, 대체 글꼴에
 * `size-adjust`를 계산해 넣어 글꼴이 바뀌는 순간의 **글자 밀림(CLS)을 없앤다**.
 *
 * 굵기는 앱이 실제로 쓰는 넷만 싣는다 (400·500·600·700).
 * 원본은 9종 6MB인데, 안 쓰는 굵기는 한 번도 내려가지 않으면서 저장소만 불린다.
 * TTF → woff2 변환으로 2.59MB → 640KB (24%).
 *
 * 한글 음절 11,172자를 **전부** 담고 있어 사용자가 뭘 적든 대체 글꼴로 새지 않는다.
 * 다만 `✓`·`▾` 같은 일부 기호는 없어서 그 글자만 시스템 글꼴로 그려진다.
 */
const paperlogy = localFont({
  src: [
    { path: '../fonts/Paperlogy-400.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/Paperlogy-500.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/Paperlogy-600.woff2', weight: '600', style: 'normal' },
    { path: '../fonts/Paperlogy-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-paperlogy',
  display: 'swap',
  // 글꼴이 뜨기 전 잠깐 보이는 글자 — 한글이 있는 것으로 골라야 네모가 안 뜬다
  fallback: ['Pretendard', 'Malgun Gothic', 'Apple SD Gothic Neo', 'sans-serif'],
});

export const metadata: Metadata = {
  title: { default: 'Tincase', template: '%s · Tincase' },
  description: '한국환경연구원 부서 주간 업무일지 수합',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={paperlogy.variable}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
