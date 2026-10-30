import { Inter } from 'next/font/google';

/** Company pages share Inter; client-facing routes keep their own fonts. */
export const companyFont = Inter({ subsets: ['latin'], weight: 'variable', variable: '--font-ui', display: 'swap' });
