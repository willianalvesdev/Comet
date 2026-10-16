export function renderAnswer(body: HTMLElement, text: string, sources: ResearchSource[] = []) {
    const fragment = document.createDocumentFragment();
    // Create DOM nodes, never interpret model output as HTML; keep code literal.
    let end = 0;
    for (const match of text.matchAll(/```[\s\S]*?(?:```|(?![\s\S]))|`[^`\n]*`|\\([*\\])|\*\*([^\n]+?)\*\*|\[(\d{1,2})\](?!\()|^ {0,3}(#{1,6})[ \t]+([^\n]+)$/gm)) {
        fragment.append(document.createTextNode(text.slice(end, match.index)));
        if (match[4]) {
            const heading = document.createElement('h'+match[4].length);
            renderAnswer(heading, match[5].replace(/[ \t]+#+[ \t]*$/, ''), sources);
            fragment.append(heading);
        } else if (match[1]) fragment.append(document.createTextNode(match[1]));
        else if (match[2]) {
            const strong = document.createElement('strong');
            renderAnswer(strong, match[2], sources);
            fragment.append(strong);
        } else if (match[3]) {
            const source = sources[Number(match[3]) - 1];
            let safe = false;
            try { const url = new URL(source?.url); safe = url.protocol === 'https:' && !url.username && !url.password; } catch {}
            if (source && safe) {
                const link = document.createElement('a'); link.className = 'computer-citation'; link.textContent = match[0];
                link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
                link.title = source.title; link.setAttribute('aria-label', 'Fonte '+match[3]+': '+source.title);
                fragment.append(link);
            } else fragment.append(document.createTextNode(match[0]));
        } else fragment.append(document.createTextNode(match[0]));
        end = match.index + match[0].length;
    }
    fragment.append(document.createTextNode(text.slice(end)));
    body.replaceChildren(fragment);
}
