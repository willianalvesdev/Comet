import type { MetadataRoute } from 'next';
import { siteOrigin } from '../server/site-origin';

export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
    const origin = siteOrigin();
    return [{url: origin + '/'}, {url: origin + '/privacy'}];
}
