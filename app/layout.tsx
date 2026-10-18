import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Iconoclast.ai — Icons that belong together',
  description: 'Create, refine, and harmonize SVG icons. Set your visual standards, compare directions, and build a consistent icon family.',
  icons: { icon: '/favicon.svg', shortcut: '/favicon.svg' },
};
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" href="/fonts/figtree/figtree-latin-variable.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
