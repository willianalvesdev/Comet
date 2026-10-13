import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { query, closeDatabase } from '../../server/db';
import { readAttachment, attachmentPath } from '../../server/ai/attachments';
import { startNextServer } from '../frontend/next-server.cts';

function pdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let result = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(result)); result += `${i+1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(result);
  result += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result);
}
test('production uploads extract PDF and DOCX text through the Next.js build', { timeout: 60000 }, async () => {
  const email = `attachments-${randomUUID()}@example.com`;
  const session = randomBytes(32).toString('hex');
  let userId: number | undefined;
  let server: Awaited<ReturnType<typeof startNextServer>> | undefined;
  try {
    const [user] = await query<{ id: string }>('INSERT INTO usuarios (nome,email,senha,idade) VALUES ($1,$2,$3,30) RETURNING id', ['Attachment test',email,'unusable-test-password']);
    userId = Number(user.id);
    await query("INSERT INTO sessoes(token_hash,usuario_id,expira_em) VALUES($1,$2,CURRENT_TIMESTAMP+INTERVAL '10 minutes')",[createHash('sha256').update(session).digest('hex'),user.id]);
    server = await startNextServer(process.cwd());
    const initial = await fetch(server.origin + '/api/bootstrap?page=computer', { headers: { cookie: `comet_session=${session}` } });
    assert.equal(initial.status, 200);
    const { csrfToken } = await initial.json();
    const cookie = `comet_session=${session}; comet_csrf=${csrfToken}`;
    const text = 'PDF attachment migration verified';
    const documentText = 'DOCX attachment migration verified';
    const docx = zipSync({
      '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
      '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
      'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${documentText}</w:t></w:r></w:p></w:body></w:document>`),
    });
    const results: unknown[] = [];
    let failed = false;
    for (const [name, data, expected] of [['migration.pdf',pdf(text),text], ['migration.docx',Buffer.from(docx),documentText]] as const) {
      const form = new FormData();
      form.append('file',new Blob([new Uint8Array(data)]),name);
      const response: Response = await fetch(server.origin + '/api/ai/attachments', { method:'POST', headers:{cookie,Origin:server.origin,'X-CSRFToken':csrfToken},body:form });
      const metadata = await response.json();
      if (response.status !== 200) { failed = true; results.push({name,status:response.status,error:metadata}); continue; }
      assert.equal(metadata.name,name);
      assert.equal(metadata.kind,'file');
      assert.equal(metadata.size,data.length);
      assert.equal('text' in metadata,false);
      const attachment = await readAttachment(userId,metadata.id);
      assert.ok(attachment.text?.includes(expected),JSON.stringify(attachment));
      results.push({name,status:response.status,kind:metadata.kind,bytes:metadata.size,text:attachment.text});
    }
    console.log(JSON.stringify({results},null,2));
    assert.equal(failed,false,'At least one production document upload failed');
  } finally {
    if (server) await server.stop();
    if (userId !== undefined) {
      await query('DELETE FROM usuarios WHERE id=$1 AND email=$2',[userId,email]);
      const target = path.dirname(attachmentPath(userId,'0'.repeat(32)));
      const base = path.resolve(process.env.ATTACHMENTS_DIR || path.join(process.cwd(),'instance','attachments'));
      assert.equal(path.dirname(path.resolve(target)),base);
      await rm(target,{recursive:true,force:true});
    }
    await closeDatabase();
  }
});
