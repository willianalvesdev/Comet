import type { MetadataRoute } from 'next';
import { siteOrigin } from '../server/site-origin';

export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
    return {
        rules: {userAgent: '*', allow: '/', disallow: [
            '/api/', '/c/', '/chat/', '/principal.html', '/finance', '/discover',
            '/logout', '/?login=', '/new', '/personalizar.html',
            '/recent', '/academic',
        ]},
        sitemap: siteOrigin() + '/sitemap.xml',
    };
}
