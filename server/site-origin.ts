export function siteOrigin(): string {
    const url = new URL(process.env.SITE_URL || process.env.AUTH_ORIGIN || 'http://127.0.0.1:5001');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('Configure SITE_URL com a origem pública do Comet.');
    }
    return url.origin;
}
