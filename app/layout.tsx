import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import NextApplication from '../frontend/NextApplication';
import '../frontend/styles.css';

export const metadata: Metadata = {
    title: 'Comet',
    applicationName: 'Comet',
    manifest: '/manifest.webmanifest',
    icons: { icon: '/static/img/icons/widget-dark.png', apple: '/static/img/icons/widget-dark.png' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, colorScheme: 'dark light', themeColor: '#171615' };

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
    return <html lang="pt-BR"><body><div id="root"><Suspense fallback={null}><NextApplication /></Suspense>{children}</div><noscript>Ative o JavaScript para usar o Comet.</noscript></body></html>;
}
