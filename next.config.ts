import type { NextConfig } from 'next';

const config: NextConfig = {
    reactStrictMode: false,
    poweredByHeader: false,
    serverExternalPackages: ['pdf-parse', 'pdfkit'],
    agentRules: false,
    images: { unoptimized: true },
    turbopack: { root: process.cwd() },
    async headers() {
        return [
            {source:'/:path*', headers:[
                {key:'X-Content-Type-Options', value:'nosniff'},
                {key:'X-Frame-Options', value:'DENY'},
                {key:'Referrer-Policy', value:'strict-origin-when-cross-origin'},
                {key:'Permissions-Policy', value:'camera=(), microphone=(self), geolocation=(self)'},
            ]},
            {source:'/descobrir.html', headers:[{key:'X-Frame-Options', value:'SAMEORIGIN'}]},
        ];
    },
    async redirects() {
        return [
            {source:'/index.html', destination:'/', permanent:false},
            {source:'/privacidade', destination:'/privacidade.html', permanent:false},
            {source:'/computer.html', destination:'/novo.html', permanent:false},
            {source:'/graficos.html', destination:'/financas.html', permanent:false},
            {source:'/aprender.html', destination:'/academico.html', permanent:false},
            {source:'/principal.html', destination:'/novo.html?new=1', permanent:false},
            {source:'/personalizar.html', destination:'/novo.html?new=1&settings=personalization', permanent:false},
        ];
    },
};

export default config;
