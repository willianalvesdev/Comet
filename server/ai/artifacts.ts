import { randomBytes } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import sharp from 'sharp';
import { ApiError } from '../http';
import { artifactSpec, artifactFormats, artifactFilename, csvText, xmlText, chartSVG, type Artifact, type ArtifactSpec, type Sheet } from '../../shared/artifacts';
import { renderConversationExport } from './exports';
export const artifactPrompt = `
Você também pode criar arquivos reais usando UMA chamada <create_artifact>{...}</create_artifact> por vez, antes da resposta final. Quando o usuário pedir planilha, arquivo, documento para baixar ou gráfico, use esta ferramenta em vez de apenas apresentar código ou dizer que não pode criar arquivos. Nunca invente caminhos, links ou anexos. Só afirme que criou após a confirmação da ferramenta. Não execute código. Conteúdo deve respeitar os dados do usuário e as fontes; rotule dados fictícios quando forem exemplos.
Formatos de chamada (JSON sem markdown):
Planilha Excel + CSV: {"kind":"spreadsheet","name":"lista_passos","sheets":[{"name":"Dados","columns":["Dia","Passos"],"rows":[["Segunda",6500],["Terça",8200]]}]}. Células são texto, número, booleano ou null. Não envie fórmulas, elas seriam texto; calcule os valores antes. Até 6 abas, 32 colunas, 1000 linhas/aba e 12 mil células. O CSV corresponde à primeira aba.
Documento PDF + DOCX + Markdown: {"kind":"document","name":"Relatório","content":"# Título\nTexto, listas e tabelas em Markdown"}.
Arquivo de texto/código: {"kind":"text","name":"exemplo","extension":"txt","content":"conteúdo"}. Extensões: txt, md, json, html, css, js, ts, py, sql, yaml. JSON precisa ser válido. HTML é prévia estática sem scripts.
Gráfico PNG + SVG: {"kind":"chart","name":"Passos por dia","chart":"bar","labels":["Seg","Ter"],"series":[{"name":"Passos","values":[6500,8200]}]}. Tipos bar, line, pie; pie aceita uma série, valores não negativos. Até 60 pontos e 6 séries.
Até 4 artefatos por resposta; cada chamada até 60 mil caracteres. Para alterar um arquivo anterior, crie um novo artefato completo a partir dos dados anteriores. Os cards, a prévia e o download são mostrados automaticamente; não reproduza JSON técnico na resposta. Se o usuário pedir somente uma tabela, responda com tabela Markdown e não crie arquivo sem necessidade.`;
function spreadsheet(sheets:Sheet[]) {
    const files:Record<string,Uint8Array>={},xml=xmlText;
    const column=(i:number):string=>i<26?String.fromCharCode(65+i):column(Math.floor(i/26)-1)+column(i%26);
    sheets.forEach((sheet,index)=>{
        const rows=[sheet.columns,...sheet.rows];
        files[`xl/worksheets/sheet${index+1}.xml`]=strToU8(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${column(sheet.columns.length-1)}${rows.length}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${sheet.columns.map((name,i)=>`<col min="${i+1}" max="${i+1}" width="${Math.max(14,Math.min(40,name.length+8))}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.map((row,r)=>`<row r="${r+1}">${row.map((v,c)=>{const ref=column(c)+(r+1),style=r===0?' s="1"':'';return typeof v==='number'?`<c r="${ref}"><v>${v}</v></c>`:typeof v==='boolean'?`<c r="${ref}" t="b"><v>${v?1:0}</v></c>`:`<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(v===null?'':String(v))}</t></is></c>`;}).join('')}</row>`).join('')}</sheetData><autoFilter ref="A1:${column(sheet.columns.length-1)}${rows.length}"/></worksheet>`);
    });
    files['[Content_Types].xml']=strToU8(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
    files['_rels/.rels']=strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    files['xl/workbook.xml']=strToU8(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${xml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`);
    files['xl/_rels/workbook.xml.rels']=strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    files['xl/styles.xml']=strToU8('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF237B87"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
    return Buffer.from(zipSync(files));
}
export async function renderArtifact(spec:ArtifactSpec,format:string):Promise<Buffer> {
    if(!artifactFormats(spec).includes(format))throw new ApiError(422,'Formato indisponível para este arquivo.');
    if(spec.kind==='spreadsheet')return format==='xlsx'?spreadsheet(spec.sheets):Buffer.from('\ufeff'+csvText(spec.sheets[0]));
    if(spec.kind==='chart'){const svg=Buffer.from(chartSVG(spec));return format==='svg'?svg:sharp(svg).png().toBuffer();}
    if(spec.kind==='document'&&(format==='pdf'||format==='docx'))return renderConversationExport({title:spec.name,turns:[{message:spec.name,answer:spec.content,sources:[]}]},format);
    if(spec.kind==='document'||spec.kind==='text')return Buffer.from(spec.content);
    throw new ApiError(422,'Formato indisponível.');
}
export async function createArtifact(raw:unknown):Promise<Artifact> {
    const spec=artifactSpec(raw),files=[];
    for(const format of artifactFormats(spec)){const buffer=await renderArtifact(spec,format);if(buffer.length>5*1024*1024)throw Error('O arquivo gerado excede 5 MB.');files.push({format,name:artifactFilename(spec,format),size:buffer.length});}
    return {id:randomBytes(16).toString('hex'),created_at:new Date().toISOString(),spec,files};
}
export async function artifactDownload(artifact:Artifact,format:string|null) {
    if(artifact.expires_at&&Date.parse(artifact.expires_at)<=Date.now())throw new ApiError(410,'Este arquivo expirou.');
    const selected=format||artifact.files[0].format,buffer=await renderArtifact(artifactSpec(artifact.spec),selected),filename=artifactFilename(artifact.spec,selected);
    const mime:Record<string,string>={xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',csv:'text/csv; charset=utf-8',pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',png:'image/png',svg:'image/svg+xml',json:'application/json',html:'text/html; charset=utf-8'};
    return new Response(new Uint8Array(buffer),{headers:{'Content-Type':mime[selected]||'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="artifact.${selected}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
}

export function requestsArtifact(text:string) {
    if(/\b(como|por que|porque|o que)\b.*\b(criar|gerar|funciona)\b/i.test(text)||/\b(não|nao)\s+(crie|gere|quero|criar|gerar)\b/i.test(text))return false;
    return /\b(crie|criar|gere|gerar|faça|faca|monte|quero|preciso|exporte|exportar|salve|salvar|converta|transforme|atualize|altere|edite|create|generate|make|export|save)\b/i.test(text)&&/\b(planilha|arquivo|documento|excel|xlsx|csv|pdf|docx|gráfico|grafico|spreadsheet|file|chart)\b/i.test(text);
}
const nameSchema={type:'string',minLength:1,maxLength:100};
const sheetSchema={type:'object',properties:{name:{type:'string',minLength:1,maxLength:31},columns:{type:'array',minItems:1,maxItems:32,items:{type:'string'}},rows:{type:'array',maxItems:1000,items:{type:'array',maxItems:32,items:{type:['string','number','boolean','null']}}}},required:['name','columns','rows'],additionalProperties:false};
const artifactItemSchema={anyOf:[
    {type:'object',properties:{kind:{type:'string',enum:['spreadsheet']},name:nameSchema,sheets:{type:'array',minItems:1,maxItems:6,items:sheetSchema}},required:['kind','name','sheets'],additionalProperties:false},
    {type:'object',properties:{kind:{type:'string',enum:['document']},name:nameSchema,content:{type:'string',minLength:1,maxLength:48000}},required:['kind','name','content'],additionalProperties:false},
    {type:'object',properties:{kind:{type:'string',enum:['text']},name:nameSchema,extension:{type:'string',enum:['txt','md','json','html','css','js','ts','py','sql','yaml']},content:{type:'string',maxLength:48000}},required:['kind','name','extension','content'],additionalProperties:false},
    {type:'object',properties:{kind:{type:'string',enum:['chart']},name:nameSchema,chart:{type:'string',enum:['bar','line','pie']},labels:{type:'array',minItems:1,maxItems:60,items:{type:'string'}},series:{type:'array',minItems:1,maxItems:6,items:{type:'object',properties:{name:{type:'string'},values:{type:'array',minItems:1,maxItems:60,items:{type:'number'}}},required:['name','values'],additionalProperties:false}}},required:['kind','name','chart','labels','series'],additionalProperties:false}
]};
export const artifactSchema={type:'object',properties:{artifacts:{type:'array',maxItems:4,items:artifactItemSchema},message:{type:'string'}},required:['artifacts','message'],additionalProperties:false};
