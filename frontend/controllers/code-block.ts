import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import markdown from 'highlight.js/lib/languages/markdown';
for (const [name, language] of Object.entries({javascript, typescript, python, css, xml, json, bash, sql, markdown})) hljs.registerLanguage(name, language);

export function codeBlock(source: string, info: string): HTMLElement {
    const language = /^[a-z0-9_+-]{1,32}$/i.test(info) ? info.toLowerCase() : '';
    const figure = document.createElement('figure'); figure.className = 'answer-code';
    const header = document.createElement('figcaption');
    const label = document.createElement('span'); label.textContent = language || 'Código';
    const copy = document.createElement('button'); copy.type = 'button'; copy.setAttribute('aria-label', 'Copiar código');
    const icon = document.createElement('i'); icon.setAttribute('aria-hidden', 'true');
    const status = document.createElement('span'); status.textContent = 'Copiar'; status.setAttribute('role', 'status');
    copy.append(icon, status);
    let timer: ReturnType<typeof setTimeout> | undefined;
    copy.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(source);
            copy.dataset.copied = 'true'; status.textContent = 'Copiado';
            clearTimeout(timer);
            timer = setTimeout(() => { delete copy.dataset.copied; status.textContent = 'Copiar'; }, 2000);
        } catch { status.textContent = 'Falha ao copiar'; }
    });
    header.append(label, copy);
    const pre = document.createElement('pre'); pre.tabIndex = 0; pre.setAttribute('aria-label', 'Código em ' + (language || 'texto'));
    const code = document.createElement('code'); code.textContent = source;
    // highlight.js escapes source text; only its generated span markup is inserted.
    if (language && hljs.getLanguage(language)) {
        try { code.innerHTML = hljs.highlight(source, {language, ignoreIllegals: true}).value; } catch { code.textContent = source; }
    }
    pre.append(code); figure.append(header, pre); return figure;
}
