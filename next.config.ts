import type { NextConfig } from 'next';

const config: NextConfig = {
    reactStrictMode: false,
    poweredByHeader: false,
    serverExternalPackages: ['pdf-parse', 'pdfkit'],
    agentRules: false,
    experimental: { agentUpgrade: 'security' },
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
            {source:'/discover', headers:[{key:'X-Frame-Options', value:'SAMEORIGIN'}]},
        ];
    },
    async redirects() {
        return [
            {source:'/novo.html', has:[{type:'query', key:'conversation', value:'(?<conversationId>[^/]+)'}], missing:[{type:'query', key:'new'}], destination:'/chat/:conversationId', permanent:false},
            {source:'/new', has:[{type:'query', key:'conversation', value:'(?<conversationId>[^/]+)'}], missing:[{type:'query', key:'new'}], destination:'/chat/:conversationId', permanent:false},
            {source:'/novo.html', destination:'/new', permanent:false},
            {source:'/recentes.html', destination:'/recent', permanent:false},
            {source:'/descobrir.html', destination:'/discover', permanent:false},
            {source:'/academico.html', destination:'/academic', permanent:false},
            {source:'/financas.html', destination:'/finance', permanent:false},
            {source:'/privacidade.html', destination:'/privacy', permanent:false},
            {source:'/index.html', destination:'/', permanent:false},
            {source:'/privacidade', destination:'/privacy', permanent:false},
            {source:'/computer.html', destination:'/new', permanent:false},
            {source:'/graficos.html', destination:'/finance', permanent:false},
            {source:'/aprender.html', destination:'/academic', permanent:false},
            {source:'/principal.html', destination:'/new?new=1', permanent:false},
            {source:'/personalizar.html', destination:'/new?new=1&settings=personalization', permanent:false},
        ];
    },
};

export default config;
