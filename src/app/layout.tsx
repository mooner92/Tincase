import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '주간 업무일지',
  description: 'KEI 주간 업무일지 수합',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
