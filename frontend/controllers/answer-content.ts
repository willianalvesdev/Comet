export function renderAnswer(body: HTMLElement, text: string, sources: ResearchSource[] = []) {
    const fragment = document.createDocumentFragment();
    // Keep code literal; citation links are built from validated source metadata, never model HTML.
    for (const [index, part] of text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/).entries()) {
        if (index % 2) { fragment.append(document.createTextNode(part)); continue; }
        let end = 0;
        for (const match of part.matchAll(/\[(\d{1,2})\](?!\()/g)) {
            fragment.append(document.createTextNode(part.slice(end, match.index)));
            const source = sources[Number(match[1]) - 1];
            let safe = false;
            try { const url = new URL(source?.url); safe = url.protocol === 'https:' && !url.username && !url.password; } catch {}
            if (source && safe) {
                const link = document.createElement('a'); link.className = 'computer-citation'; link.textContent = match[0];
                link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
                link.title = source.title; link.setAttribute('aria-label', `Fonte ${match[1]}: ${source.title}`);
                fragment.append(link);
            } else fragment.append(document.createTextNode(match[0]));
            end = match.index + match[0].length;
        }
        fragment.append(document.createTextNode(part.slice(end)));
    }
    body.replaceChildren(fragment);
}
