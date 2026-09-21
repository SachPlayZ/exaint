import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';
import { Geist, Geist_Mono } from 'next/font/google';
import { cn } from '@/lib/utils';

const geistSans = Geist({ subsets: ['latin'], variable: '--font-sans' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Adaptive Crypto Trading Terminal',
  description: 'Five deterministic markets, delivered at a per-connection frequency tier.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={cn(
        'dark h-full overflow-hidden select-none',
        geistSans.variable,
        geistMono.variable,
      )}
    >
      <body className="h-full overflow-hidden bg-ink text-paper font-mono antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
