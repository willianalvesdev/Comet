import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import ts from 'typescript';
const output = 'artifacts/test-runtime';
fs.mkdirSync(output, {recursive:true});
let declarations = '';
for (const name of fs.readdirSync('frontend/controllers').filter(name => name.endsWith('.ts'))) {
    const source = fs.readFileSync('frontend/controllers/' + name, 'utf8');
    const module = './frontend/controllers/' + name;
    const controller = source.includes('export default function mount');
    const contents = controller
        ? `import mount from '${module}';import {mountController} from './frontend/runtime/lifecycle';mountController(mount);`
        : `export * from '${module}';`;
    const result = await build({stdin:{contents,resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'iife',globalName:'testModule',write:false,target:'es2022'});
    fs.writeFileSync(path.join(output, name.replace('.ts','.js')), result.outputFiles[0].text + (controller ? '' : '\nObject.assign(globalThis,testModule);'));
    if (!controller) {
        const ast=ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true);
        for (const node of ast.statements) {
            if (!node.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)) continue;
            const names=ts.isVariableStatement(node)?node.declarationList.declarations.map(d=>d.name.text):node.name?[node.name.text]:[];
            for(const symbol of names) {
                const isType=ts.isInterfaceDeclaration(node)||ts.isTypeAliasDeclaration(node);
                declarations += isType ? `type ${symbol} = import('./controllers/${name.slice(0,-3)}').${symbol};\n` : `declare const ${symbol}: typeof import('./controllers/${name.slice(0,-3)}').${symbol};\n`;
            }
        }
    }
}
fs.writeFileSync('artifacts/types/test-globals.d.ts',declarations);
