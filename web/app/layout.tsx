import type { Metadata } from 'next';
import { Inter, Space_Grotesk, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const fontBody = Inter({ subsets: ['latin'], variable: '--font-body' });
const fontHeading = Space_Grotesk({ subsets: ['latin'], variable: '--font-heading' });
const fontMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'managemyteam.io',
  description: 'Staff task accountability for small businesses',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={fontBody.variable + ' ' + fontHeading.variable + ' ' + fontMono.variable}
    >
      <body>{children}</body>
    </html>
  );
}
