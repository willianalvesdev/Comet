import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { ApiError } from '../http';
import { getConversationExport } from './conversations';
import { publicURL } from './web-reader';
import { isObject } from './types';

export type ExportFormat = 'pdf' | 'markdown' | 'docx';
export type ExportSource = { url: string; title: string };
export type ExportConversation = { title: string; turns: { message: string; answer: string; sources: unknown[] }[] };
type Block = { kind: 'paragraph' | 'heading' | 'list' | 'code'; text: string; level?: number } | { kind: 'table'; rows: string[][] };
type Run = { text: string; bold?: boolean; italic?: boolean; code?: boolean; link?: string };
const asset = (...parts: string[]) => path.join(process.cwd(), 'static', ...parts);
const text = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '');
const xml = (value: string) => text(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]!));
let logo: Promise<Buffer> | undefined;
function fullLogo() {
    return logo ??= readFile(asset('img', 'logos', 'textlogo.svg')).then(svg => sharp(Buffer.from(svg.toString().replace(/fill="white"/g, 'fill="#161616"'))).resize({ width: 832 }).png().toBuffer()).catch(error => { logo = undefined; throw error; });
}
export function prepareExport(conversation: ExportConversation) {
    const sources: ExportSource[] = [], seen = new Map<string, number>();
    const turns = conversation.turns.map(turn => {
        const indexes = turn.sources.map(raw => {
            if (!isObject(raw)) return null;
            const url = publicURL(raw.url);
            if (!url) return null;
            let index = seen.get(url);
            if (!index) {
                sources.push({ url, title: typeof raw.title === 'string' && raw.title.trim() ? text(raw.title).slice(0, 300) : new URL(url).hostname });
                index = sources.length;
                seen.set(url, index);
            }
            return index;
        });
        const answer = text(turn.answer).split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/).map((part, index) => index % 2 ? part : part.replace(/\[(\d{1,4})\](?!\()/g, (citation, number) => indexes[Number(number) - 1] ? '[' + indexes[Number(number) - 1] + ']' : citation)).join('');
        return { message: text(turn.message), answer };
    });
    return { title: text(conversation.title), turns, sources };
}
type Prepared = ReturnType<typeof prepareExport>;
export function exportFilename(title: string, format: ExportFormat) {
    const name = title.normalize('NFKC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, 100).trim() || 'Conversa';
    return name + (format === 'markdown' ? '.md' : '.' + format);
}
function inline(value: string): Run[] {
    const runs: Run[] = [];
    let end = 0;
    const tokens = /(\*\*([^*\n]+)\*\*|__([^_\n]+)__|`([^`\n]+)`|\*([^*\n]+)\*|_([^_\n]+)_|\[([^\]\n]+)\]\(([^)\s]+)\))/g;
    for (const match of value.matchAll(tokens)) {
        if (match.index > end) runs.push({ text: value.slice(end, match.index) });
        if (match[2] || match[3]) runs.push({ text: match[2] || match[3], bold: true });
        else if (match[4]) runs.push({ text: match[4], code: true });
        else if (match[5] || match[6]) runs.push({ text: match[5] || match[6], italic: true });
        else runs.push({ text: match[7], link: publicURL(match[8]) ?? undefined });
        end = match.index + match[0].length;
    }
    if (end < value.length) runs.push({ text: value.slice(end) });
    return runs.length ? runs : [{ text: value }];
}
function blocks(value: string): Block[] {
    const lines = value.replace(/\r\n?/g, '\n').split('\n'), result: Block[] = [];
    let paragraph: string[] = [];
    const flush = () => { if (paragraph.length) result.push({ kind: 'paragraph', text: paragraph.join('\n') }); paragraph = []; };
    const cells = (line: string) => line.replace(/^\s*\||\|\s*$/g, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (!line.trim()) { flush(); continue; }
        if (/^\s*```/.test(line)) {
            flush();
            const code: string[] = [];
            while (++index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index]);
            result.push({ kind: 'code', text: code.join('\n') }); continue;
        }
        if (line.includes('|') && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])) {
            flush();
            const rows = [cells(line)];
            index += 2;
            while (index < lines.length && lines[index].trim() && lines[index].includes('|')) rows.push(cells(lines[index++]));
            index--;
            result.push({ kind: 'table', rows }); continue;
        }
        const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
        if (heading) { flush(); result.push({ kind: 'heading', level: heading[1].length, text: heading[2] }); continue; }
        if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) { flush(); result.push({ kind: 'list', text: line.replace(/^\s*[-*+]\s+/, '• ') }); continue; }
        if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); continue; }
        paragraph.push(line.replace(/^>\s?/, ''));
    }
    flush();
    return result;
}
async function markdown(data: Prepared) {
    const image = await fullLogo();
    const parts = ['![Comet](data:image/png;base64,' + image.toString('base64') + ')', '# ' + data.title];
    for (const turn of data.turns) parts.push('## ' + turn.message, turn.answer || '_Sem resposta salva._');
    if (data.sources.length) parts.push('---', '## Fontes', ...data.sources.map((source, index) => `${index + 1}. ${source.title.replace(/[\r\n]/g, ' ')} — <${source.url}>`));
    return Buffer.from(parts.join('\n\n') + '\n', 'utf8');
}
async function pdf(data: Prepared): Promise<Buffer> {
    const image = await fullLogo();
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'LETTER', margins: { top: 68, bottom: 68, left: 68, right: 68 }, info: { Title: data.title, Creator: 'Comet', Author: 'Comet' }, bufferPages: false });
        const buffers: Buffer[] = [];
        doc.on('data', buffer => buffers.push(buffer));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);
        try {
            doc.registerFont('body', 'Times-Roman');
            doc.registerFont('bold', 'Times-Bold');
            doc.registerFont('heading', asset('fonts', 'kalice', 'kalicetrial-bold.otf'));
            doc.registerFont('italic', 'Times-Italic');
            doc.registerFont('sans', 'Helvetica');
            doc.registerFont('sans-bold', 'Helvetica-Bold');
            doc.image(image, 68, 68, { width: 180 });
            doc.y = 132;
            const width = 476;
            const reserve = (height: number) => { if (doc.y + height > doc.page.height - 68) doc.addPage(); };
            const rich = (value: string, size = 10.5, bold = false, sans = false, x = 68, available = width) => {
                const runs = inline(value);
                doc.font(sans ? 'sans' : 'body').fontSize(size).fillColor('#161616');
                runs.forEach((run, index) => {
                    doc.font(run.bold || bold ? sans ? 'sans-bold' : 'bold' : run.italic ? 'italic' : sans ? 'sans' : 'body');
                    const options={ width: available, lineGap: 3, continued: index < runs.length - 1, ...(run.link ? { link: run.link, underline: true } : {}) };
                    if(index)doc.text(run.text,options);else doc.text(run.text,x,doc.y,options);
                });
            };
            const table = (rows: string[][]) => {
                const columns = Math.max(...rows.map(row => row.length)), cellWidth = width / columns;
                for (const [index, row] of rows.entries()) {
                    doc.font(index ? 'sans' : 'sans-bold').fontSize(8.2);
                    const height = Math.max(...row.map(cell => doc.heightOfString(inline(cell).map(run => run.text).join(''), { width: cellWidth - 12, lineGap: 2 }))) + 16;
                    // shortcut: very tall table rows become paragraphs so no content is clipped across pages.
                    if (height > doc.page.height - 136) { rich(row.join(' | '), 8.2, !index, true); doc.moveDown(0.5); continue; }
                    reserve(height);
                    const y = doc.y;
                    row.forEach((cell, column) => {
                        const x = 68 + column * cellWidth;
                        doc.rect(x, y, cellWidth, height).fillAndStroke(index ? '#ffffff' : '#f1f1f1', '#d9d9d9');
                        doc.fillColor('#161616').font(index ? 'sans' : 'sans-bold').fontSize(8.2).text(inline(cell).map(run => run.text).join(''), x + 6, y + 8, { width: cellWidth - 12, height: height - 12, lineGap: 2 });
                    });
                    doc.y = y + height;
                    doc.x = 68;
                }
                doc.moveDown(0.8);
            };
            for (const [index, turn] of data.turns.entries()) {
                if (index) { doc.moveDown(1.5); reserve(75); }
                doc.font('heading').fontSize(19.7).fillColor('#161616').text(turn.message, 68, doc.y, { width, lineGap: 3 });
                doc.moveDown(0.65);
                for (const block of blocks(turn.answer || 'Sem resposta salva.')) {
                    if (block.kind === 'table') { table(block.rows); continue; }
                    const size = block.kind === 'heading' ? 11.8 : block.kind === 'code' ? 9 : 10.5;
                    reserve(block.kind === 'heading' ? 45 : 24);
                    if (block.kind === 'code') doc.font('sans').fontSize(size).text(block.text, 68, doc.y, { width, lineGap: 3 });
                    else rich(block.text, size, block.kind === 'heading');
                    doc.moveDown(block.kind === 'list' ? 0.35 : 0.65);
                }
            }
            if (data.sources.length) {
                reserve(80);
                doc.moveDown(1);
                const y = doc.y;
                doc.moveTo(248, y).lineTo(364, y).strokeColor('#c9c9c9').stroke();
                doc.y += 22;
                rich('Fontes', 11.8, true);
                doc.moveDown(0.65);
                for (const [index, source] of data.sources.entries()) {
                    reserve(34);
                    doc.font('sans').fontSize(9.2).fillColor('#161616').text(`${index + 1}. ${source.title}`, 68, doc.y, { width });
                    doc.text(source.url, 80, doc.y + 3, { width: width - 12, link: source.url, underline: true, lineGap: 2 });
                    doc.x = 68; doc.moveDown(0.7);
                }
            }
            doc.end();
        } catch (error) { doc.destroy(); reject(error); }
    });
}
async function docx(data: Prepared) {
    const image = await fullLogo(), relationships: string[] = [];
    const run = (item: Run, bold = false) => {
        const content = `<w:r><w:rPr>${item.bold || bold ? '<w:b/>' : ''}${item.italic ? '<w:i/>' : ''}${item.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : ''}${item.link ? '<w:u w:val="single"/>' : ''}</w:rPr>${item.text.split('\n').map((line, index) => (index ? '<w:br/>' : '') + '<w:t xml:space="preserve">' + xml(line) + '</w:t>').join('')}</w:r>`;
        if (!item.link) return content;
        const relationship = 'link' + (relationships.length + 1);
        relationships.push(`<Relationship Id="${relationship}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(item.link)}" TargetMode="External"/>`);
        return `<w:hyperlink r:id="${relationship}">${content}</w:hyperlink>`;
    };
    const paragraph = (value: string, style = 'Normal', bold = false, keepNext = false) => `<w:p><w:pPr><w:pStyle w:val="${style}"/>${keepNext ? '<w:keepNext/>' : ''}</w:pPr>${inline(value).map(item => run(item, bold)).join('')}</w:p>`;
    const contents = [`<w:p><w:pPr><w:spacing w:after="360"/></w:pPr><w:r><w:drawing><wp:inline><wp:extent cx="2286000" cy="659423"/><wp:docPr id="1" name="Comet" descr="Logo completa do Comet"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Comet.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="logo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2286000" cy="659423"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`];
    for (const turn of data.turns) {
        contents.push(paragraph(turn.message, 'Title', false, true));
        for (const block of blocks(turn.answer || 'Sem resposta salva.')) {
            if (block.kind === 'table') {
                const columns = Math.max(...block.rows.map(row => row.length)), width = Math.floor(9520 / columns);
                contents.push(`<w:tbl><w:tblPr><w:tblW w:w="9520" w:type="dxa"/><w:tblBorders>${['top','left','bottom','right','insideH','insideV'].map(side => `<w:${side} w:val="single" w:sz="4" w:color="D9D9D9"/>`).join('')}</w:tblBorders><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${Array.from({ length: columns }, () => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${block.rows.map((row, index) => `<w:tr>${index ? '' : '<w:trPr><w:tblHeader/></w:trPr>'}${Array.from({ length: columns }, (_, column) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="center"/>${index ? '' : '<w:shd w:fill="F1F1F1"/>'}</w:tcPr>${paragraph(row[column] ?? '', 'Table', !index)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`);
            } else if (block.kind === 'code') {
                contents.push(`<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr>${run({ text: block.text, code: true })}</w:p>`);
            } else contents.push(paragraph(block.text, block.kind === 'heading' ? 'Heading1' : 'Normal', block.kind === 'heading', block.kind === 'heading'));
        }
    }
    if (data.sources.length) {
        contents.push('<w:p><w:pPr><w:spacing w:before="240"/><w:pBdr><w:bottom w:val="single" w:sz="4" w:color="D9D9D9"/></w:pBdr></w:pPr></w:p>', paragraph('Fontes', 'Heading1', false, true));
        for (const [index, source] of data.sources.entries()) contents.push(paragraph(`${index + 1}. ${source.title}`, 'Source'), `<w:p><w:pPr><w:pStyle w:val="Source"/></w:pPr>${run({ text: source.url, link: source.url })}</w:p>`);
    }
    const packageFiles: Record<string, Uint8Array> = {
        '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`),
        '_rels/.rels': strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
        'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="logo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>${relationships.join('')}</Relationships>`),
        'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${contents.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1360" w:right="1360" w:bottom="1360" w:left="1360"/></w:sectPr></w:body></w:document>`),
        'word/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="22"/><w:color w:val="161616"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="200"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="140"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Source"><w:name w:val="Source"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Table"><w:name w:val="Table"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/></w:rPr></w:style></w:styles>`),
        'word/media/logo.png': image,
    };
    return Buffer.from(zipSync(packageFiles));
}
export async function renderConversationExport(conversation: ExportConversation, format: ExportFormat) {
    const data = prepareExport(conversation);
    return format === 'pdf' ? pdf(data) : format === 'docx' ? docx(data) : markdown(data);
}
export async function exportConversation(userId: number, cid: string, format: string | null): Promise<Response> {
    if (format !== 'pdf' && format !== 'markdown' && format !== 'docx') throw new ApiError(400, 'Escolha PDF, Markdown ou DOCX para exportar.');
    const conversation = await getConversationExport(userId, cid);
    const buffer = await renderConversationExport(conversation, format);
    const filename = exportFilename(conversation.title, format);
    const fallback = filename.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\x20-\x7e]|["\\]/g, '_');
    const utf8 = encodeURIComponent(filename).replace(/['()*]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase());
    const contentType = format === 'pdf' ? 'application/pdf' : format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/markdown; charset=utf-8';
    return new Response(new Uint8Array(buffer), { headers: { 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${utf8}`, 'Content-Length': String(buffer.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}

