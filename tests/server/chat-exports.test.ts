import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFile, mkdir } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLValidator } from 'fast-xml-parser';
import { PDFParse } from 'pdf-parse';
import { prepareExport, renderConversationExport, exportFilename, exportConversation } from '../../server/ai/exports';

const sample = {
    title:'Organização financeira & planejamento',
    turns:[
        {message:'Como organizar o orçamento do mês?',answer:'## Comece pelas receitas\n\nRegistre **todas as receitas** e compare os gastos. O orçamento deve respeitar a sua realidade, incluindo dívidas e reserva. [1]\n\n- Moradia e alimentação\n- Transporte\n- Meta de economia\n\n| Categoria | Valor |\n| --- | --- |\n| Essenciais | R$ 1.500 |\n| Pessoais | R$ 400 |\n\nUse <valores> & cálculos sem perder os acentos.',sources:[{url:'https://www.bcb.gov.br/cidadaniafinanceira',title:'Educação financeira — Banco Central'},{url:'javascript:alert(1)',title:'Insegura'}]},
        {message:'E para o próximo mês?',answer:'Revise o planejamento. [1]\n\n```text\nSaldo = receita - despesas [1]\n```',sources:[{url:'https://www.bcb.gov.br/cidadaniafinanceira#resumo',title:'A mesma fonte'}]}
    ]
};

test('export: fontes válidas, deduplicadas e citações preservadas no código',()=>{
    const data=prepareExport(sample);
    assert.equal(data.sources.length,1);assert.equal(data.sources[0].url,'https://www.bcb.gov.br/cidadaniafinanceira');
    assert.match(data.turns[1].answer,/Revise o planejamento. \[1\]/);
    assert.match(data.turns[1].answer,/despesas \[1\]/);
    assert.equal(exportFilename('../Minha sessão\r\n*.txt','pdf'),'Minha sessão .txt.pdf');
});

test('export: PDF, DOCX e Markdown mantêm pergunta, resposta e fontes',async()=>{
    const markdown=await renderConversationExport(sample,'markdown');
    assert.match(markdown.toString(),/^!\[Comet\]\(data:image\/png;base64,/);assert.match(markdown.toString(),/## Como organizar o orçamento do mês/);assert.match(markdown.toString(),/## Fontes/);
    const docx=await renderConversationExport(sample,'docx'),zip=unzipSync(docx);
    for(const [name,contents] of Object.entries(zip)) if(name.endsWith('.xml') || name.endsWith('.rels')) assert.equal(XMLValidator.validate(strFromU8(contents)),true,name);
    const xml=strFromU8(zip['word/document.xml']);assert.match(xml,/&lt;valores&gt; &amp; cálculos/);assert.match(xml,/E para o próximo mês/);assert(zip['word/media/logo.png'].byteLength>100);assert.match(xml,/<w:tbl>/);
    const pdf=await renderConversationExport(sample,'pdf');assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
    const parser=new PDFParse({data:new Uint8Array(pdf)});
    try {const result=await parser.getText();assert.match(result.text,/Como organizar o orçamento do mês/);assert.match(result.text,/Fontes/);assert.match(result.text,/cidadaniafinanceira/);assert.match(result.text,/próximo mês/);} finally {await parser.destroy();}
    const long=await renderConversationExport({...sample,turns:Array.from({length:35},(_,index)=>({message:'Pergunta '+(index+1),answer:'Resposta salva '+(index+1),sources:[]}))},'pdf');
    const longParser=new PDFParse({data:new Uint8Array(long)});try{assert.match((await longParser.getText()).text,/Pergunta 35/);}finally{await longParser.destroy();}
    if(process.env.EXPORT_QA){await mkdir('artifacts/export-qa',{recursive:true});await Promise.all([writeFile('artifacts/export-qa/conversa.pdf',pdf),writeFile('artifacts/export-qa/conversa.docx',docx),writeFile('artifacts/export-qa/conversa.md',markdown),writeFile('artifacts/export-qa/conversa-longa.pdf',long)]);}
});

test('export: formato inválido é rejeitado antes de gerar arquivo',async()=>{
    await assert.rejects(exportConversation(1,'1','html'),error=>error instanceof Error && /Escolha PDF/.test(error.message));
});
