import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

export default function config(phase: string): NextConfig {
    const development = phase === PHASE_DEVELOPMENT_SERVER;
    const backend = (process.env.COMET_API_ORIGIN || 'http://127.0.0.1:5001').replace(/\/$/, '');
    return {
        output: development ? undefined : 'export',
        reactStrictMode: false,
        poweredByHeader: false,
        agentRules: false,
        images: { unoptimized: true },
        turbopack: { root: process.cwd() },
        ...(development ? {
            async rewrites() {
                return [{source:'/index.html', destination:'/'}, ...['/api/:path*', '/auth/:path*', '/static/:path*', '/manifest.webmanifest', '/logout', '/personalizar.html', '/principal.html'].map(source => ({source, destination: backend + source}))];
            },
        } : {}),
    };
}
