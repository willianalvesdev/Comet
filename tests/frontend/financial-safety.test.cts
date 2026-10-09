import {readFileSync, readdirSync} from 'node:fs';
import {resolve, join, relative} from 'node:path';
import assert = require('node:assert/strict');
import {test} from 'node:test';
import ts = require('typescript');

const root=resolve(__dirname,'../..');
function files(directory:string):string[] {
    return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(directory,entry.name)):[join(directory,entry.name)]);
}
const sources=files(join(root,'frontend')).filter(file=>/\.tsx?$/.test(file));
const financial=sources.filter(file=>/financial-|graph-composer|[/\\]types[/\\]finance\.d\.ts$/.test(file));

test('código financeiro não executa strings nem usa any ou supressões TypeScript',()=>{
    assert(financial.length>=8);
    for(const file of financial) {
        const source=readFileSync(file,'utf8'), name=relative(root,file);
        assert(!/@ts-(?:ignore|nocheck)/.test(source),name+': supressão de tipos');
        const ast=ts.createSourceFile(file,source,ts.ScriptTarget.ES2022,true);
        function inspect(node:ts.Node):void {
            assert.notEqual(node.kind,ts.SyntaxKind.AnyKeyword,name+': tipo any');
            if(ts.isCallExpression(node)||ts.isNewExpression(node)) {
                const expression=node.expression;
                const called=ts.isIdentifier(expression)?expression.text:ts.isPropertyAccessExpression(expression)?expression.name.text:'';
                assert(!['eval','Function'].includes(called),name+': execução dinâmica');
                if(['setTimeout','setInterval'].includes(called)) assert(!node.arguments?.[0]||!ts.isStringLiteralLike(node.arguments[0]),name+': timer executando texto');
            }
            ts.forEachChild(node,inspect);
        }
        inspect(ast);
    }
});

test('fontes e páginas do frontend não contêm chave nem configuração privada de provedor',()=>{
    const frontend=[...sources,...files(join(root,'app')),...files(join(root,'artifacts/test-runtime')).filter(file=>!file.includes(join('js','vendor')))];
    const privateKey=/GEMINI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|x-goog-api-key|AIza[0-9A-Za-z_-]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,}/;
    for(const file of frontend) assert.equal(privateKey.test(readFileSync(file,'utf8')),false,relative(root,file)+': configuração privada no frontend');
});

test('compilação mantém strict e não emite código quando há erro de tipos',()=>{
    const config:unknown=JSON.parse(readFileSync(join(root,'tsconfig.json'),'utf8'));
    assert(config!==null&&typeof config==='object');
    const compiler:unknown=Reflect.get(config,'compilerOptions');
    assert(compiler!==null&&typeof compiler==='object');
    assert.equal(Reflect.get(compiler,'strict'),true);
    assert.equal(Reflect.get(compiler,'noEmitOnError'),true);
});
