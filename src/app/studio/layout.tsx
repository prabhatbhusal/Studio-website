import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { NOINDEX } from '../../lib/shareMeta';
import './studio-fonts.css';

const studioFont = Inter({ subsets: ['latin'], weight: 'variable', variable: '--font-studio', display: 'swap' });

/** The studio is for signed-in teams: keep every page of it out of search. */
export const metadata: Metadata = { robots: NOINDEX };

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <div className={`studio-fonts ${studioFont.variable}`}>{children}</div>;
}
