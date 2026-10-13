import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { AIError, type Message } from './types';

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export type Attachment = { id: string; name: string; size: number; kind: 'file' | 'image'; text?: string; image?: string };
export function attachmentPath(userId: number, token: string) {
  if (!Number.isSafeInteger(userId) || userId < 1 || !/^[a-f0-9]{32}$/.test(token)) throw new AIError('attachment_missing', 404);
  return path.join(process.env.ATTACHMENTS_DIR || path.join(process.cwd(), 'instance', 'attachments'), String(userId), `${token}.json`);
}
export const publicAttachment = ({ id, name, size, kind }: Attachment) => ({ id, name, size, kind });
export async function readAttachment(userId: number, token: string): Promise<Attachment> {
  const target = attachmentPath(userId, token);
  try { return JSON.parse(await readFile(target, 'utf8')) as Attachment; }
  catch { throw new AIError('attachment_missing', 404); }
}
export async function removeAttachment(userId: number, token: string) { await rm(attachmentPath(userId, token), { force: true }); }
function docxText(raw: Buffer) {
  const files = unzipSync(raw, { filter: file => {
    if (file.name !== 'word/document.xml') return false;
    if (file.originalSize > 2 * 1024 * 1024) throw new AIError('attachment_content', 422);
    return true;
  }});
  if (!files['word/document.xml']) throw new AIError('attachment_content', 422);
  const xml = strFromU8(files['word/document.xml']);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new AIError('attachment_content', 422);
  const parsed: unknown = new XMLParser({ preserveOrder: true, removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false }).parse(xml);
  const text: string[] = [];
  function visit(node: unknown, isText = false) {
    if (Array.isArray(node)) for (const child of node) visit(child, isText);
    else if (node && typeof node === 'object') for (const [key, value] of Object.entries(node)) {
      if (key === '#text' && isText) text.push(String(value));
      else visit(value, key === 't');
    }
  }
  visit(parsed);
  return text.join(' ');
}
export async function extractAttachment(raw: Buffer, filename: string): Promise<Attachment> {
  if (!raw.length || raw.length > MAX_ATTACHMENT_BYTES) throw new AIError('attachment_size', 422);
  const name = filename.replaceAll('\\', '/').split('/').at(-1)?.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 150) || 'arquivo';
  const extension = path.extname(name).toLowerCase();
  const data: Attachment = { id: randomBytes(16).toString('hex'), name, size: raw.length, kind: 'file' };
  try {
    if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
      const image = sharp(raw, { limitInputPixels: 25_000_000, failOn: 'warning' });
      const metadata = await image.metadata();
      if (!['png', 'jpeg', 'webp'].includes(metadata.format || '') || (metadata.pages || 1) > 1) throw new AIError('attachment_content', 422);
      data.image = (await image.rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer()).toString('base64');
      data.kind = 'image';
    } else {
      let text: string;
      if (extension === '.pdf') {
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: new Uint8Array(raw) });
        try {
          const info = await parser.getInfo();
          if (info.total > 40) throw new AIError('attachment_content', 422);
          text = (await parser.getText()).text;
        } finally { await parser.destroy(); }
      } else if (extension === '.docx') text = docxText(raw);
      else if (['.txt', '.md', '.csv', '.json', '.py', '.js', '.html', '.css', '.log'].includes(extension)) text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
      else throw new AIError('attachment_type', 422);
      if (!text.trim() || text.length > 20000 || text.includes('\0')) throw new AIError('attachment_content', 422);
      data.text = text;
    }
    return data;
  } catch (error) {
    if (error instanceof AIError) throw error;
    throw new AIError('attachment_content', 422);
  }
}
export async function uploadAttachment(userId: number, file: File) {
  if (file.size > MAX_ATTACHMENT_BYTES || !file.size) throw new AIError('attachment_size', 422);
  const data = await extractAttachment(Buffer.from(await file.arrayBuffer()), file.name);
  const target = attachmentPath(userId, data.id);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, JSON.stringify(data), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return publicAttachment(data);
}
export async function attachmentMessage(userId: number, text: string, tokens: string[]): Promise<{ message: Message; files: ReturnType<typeof publicAttachment>[] }> {
  const files = await Promise.all(tokens.map(token => readAttachment(userId, token)));
  const message: Message = { role: 'user', content: text };
  if (files.reduce((n, file) => n + (file.text?.length || 0), 0) > 30000) throw new AIError('attachment_total', 422);
  for (const file of files) {
    if (file.kind === 'image') {
      (message.images ??= []).push(file.image!);
      message.content += '\nImagem anexada: ' + file.name;
    } else message.content += `\n<arquivo nome=${JSON.stringify(file.name)}>\n${file.text}\n</arquivo>`;
  }
  if (message.content.length > 38000) throw new AIError('attachment_total', 422);
  return { message, files: files.map(publicAttachment) };
}
