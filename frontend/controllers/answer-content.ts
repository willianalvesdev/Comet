import {citationLink} from './citations';
import {csvText,type Sheet} from '../../shared/artifacts';
function renderInline(body: HTMLElement, text: string, sources: ResearchSource[] = []) {
    const fragment = document.createDocumentFragment();
    // Create DOM nodes, never interpret model output as HTML; keep code literal.
    let end = 0;
    for (const match of text.matchAll(/```[\s\S]*?(?:```|(?![\s\S]))|`[^`\n]*`|\\([*\\])|\*\*([^\n]+?)\*\*|(\[\d+(?:[ ,]+\d+)*\](?!\()(?:[ \t]*\[\d+(?:[ ,]+\d+)*\](?!\())*)|^ {0,3}(#{1,6})[ \t]+([^\n]+)$/gm)) {
        fragment.append(document.createTextNode(text.slice(end, match.index)));
        if (match[4]) {
            const heading = document.createElement('h'+match[4].length);
            renderInline(heading, match[5].replace(/[ \t]+#+[ \t]*$/, ''), sources);
            fragment.append(heading);
        } else if (match[1]) fragment.append(document.createTextNode(match[1]));
        else if (match[2]) {
            const strong = document.createElement('strong');
            renderInline(strong, match[2], sources);
            fragment.append(strong);
        } else if (match[3]) {
            const ids = [...match[3].matchAll(/\d+/g)].map(value=>Number(value[0])-1);
            const link = citationLink(ids.map(id=>sources[id]));
            fragment.append(link ?? document.createTextNode(match[0]));
        } else fragment.append(document.createTextNode(match[0]));
        end = match.index + match[0].length;
    }
    fragment.append(document.createTextNode(text.slice(end)));
    body.replaceChildren(fragment);
}

export function tableView(sheet:Sheet,tools=true):HTMLElement {
    const wrapper=document.createElement('div');wrapper.className='answer-table';
    const scroll=document.createElement('div');scroll.className='answer-table__scroll';scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label',sheet.name);
    const table=document.createElement('table'),head=document.createElement('thead'),body=document.createElement('tbody'),header=document.createElement('tr');
    for(const name of sheet.columns){const th=document.createElement('th');th.scope='col';th.textContent=name;header.append(th);}head.append(header);
    for(const row of sheet.rows){const tr=document.createElement('tr');for(const value of row){const td=document.createElement('td');td.textContent=value===null?'':String(value);tr.append(td);}body.append(tr);}
    table.append(head,body);scroll.append(table);wrapper.append(scroll);
    if(tools){
        const actions=document.createElement('div');actions.className='answer-table__actions';actions.setAttribute('role','group');actions.setAttribute('aria-label','Ações da tabela');
        const status=document.createElement('span');status.className='answer-table__status';status.setAttribute('role','status');
        for(const [action,label] of [['copy','Copiar tabela'],['download','Baixar CSV'],['expand','Ampliar tabela']]){
            const button=document.createElement('button');button.type='button';button.dataset.tableAction=action;button.setAttribute('aria-label',label);button.title=label;button.innerHTML='<i aria-hidden="true"></i>';
            button.addEventListener('click',async()=>{
                if(action==='copy'){try{await navigator.clipboard.writeText([sheet.columns,...sheet.rows].map(row=>row.map(v=>v??'').join('\t')).join('\n'));status.textContent='Tabela copiada';}catch{status.textContent='Não foi possível copiar a tabela.';}}
                if(action==='download'){const url=URL.createObjectURL(new Blob(['\ufeff'+csvText(sheet)],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='tabela.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
                if(action==='expand')window.dispatchEvent(new CustomEvent('artifacts:table-preview',{detail:{sheet,trigger:button}}));
            });actions.append(button);
        }
        wrapper.append(actions,status);
    }
    return wrapper;
}
// Horizontal overflow creates a new sticky container; translate the real header within
// its own table so it follows the page/pane scroll and still stops at the last row.
export function positionTableHeaders(root:HTMLElement){
    const top=root.getBoundingClientRect().top;
    for(const table of root.querySelectorAll<HTMLTableElement>('.answer-table table')){
        const head=table.tHead;if(!head)continue;
        const bounds=table.getBoundingClientRect();
        const offset=Math.max(0,Math.min(top-bounds.top,bounds.height-head.offsetHeight));
        head.style.transform=offset?'translateY('+offset+'px)':'';
    }
}
export function renderAnswer(body:HTMLElement,text:string,sources:ResearchSource[]=[]){
    const lines=text.replace(/\r\n?/g,'\n').split('\n'),fragment=document.createDocumentFragment();let pending:string[]=[];
    const flush=()=>{if(pending.length){const span=document.createElement('span');renderInline(span,pending.join('\n'),sources);fragment.append(...span.childNodes);pending=[];}};
    const cells=(line:string)=>line.trim().replace(/^\||\|$/g,'').split(/(?<!\\)\|/).map(v=>v.trim().replace(/\\\|/g,'|'));
    const listItem=(line:string)=>/^([ \t]*)([-+*]|\d{1,9}[.)])[ \t]+(.*)$/.exec(line);
    const lists:{indent:number;contentIndent:number;list:HTMLUListElement|HTMLOListElement;item:HTMLLIElement}[]=[];
    for(let i=0;i<lines.length;i++){
        const line=lines[i],fence=/^ {0,3}(`{3,}|~{3,})/.exec(line);
        if(fence){
            flush();lists.length=0;const code=[line],closing=new RegExp('^ {0,3}'+fence[1][0]+'{'+fence[1].length+',}[ \t]*$');
            while(++i<lines.length){code.push(lines[i]);if(closing.test(lines[i]))break;}
            // Fenced content remains literal, including list markers, dividers and HTML.
            fragment.append(document.createTextNode(code.join('\n')+(i<lines.length-1?'\n':'')));continue;
        }
        if(/^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line)){
            flush();lists.length=0;const rule=document.createElement('hr');rule.className='answer-divider';fragment.append(rule);continue;
        }
        const match=listItem(line);
        if(match){
            flush();const indent=match[1].replace(/\t/g,'    ').length,ordered=/^\d/.test(match[2]),tag=ordered?'OL':'UL';
            while(lists.length&&indent<lists[lists.length-1].indent)lists.pop();
            if(lists.length&&indent===lists[lists.length-1].indent&&lists[lists.length-1].list.tagName!==tag)lists.pop();
            if(!lists.length||indent>lists[lists.length-1].indent){
                const list=document.createElement(ordered?'ol':'ul');list.className='answer-list';
                if(ordered)(list as HTMLOListElement).start=parseInt(match[2],10);
                (lists.length?lists[lists.length-1].item:fragment).append(list);
                lists.push({indent,contentIndent:0,list,item:document.createElement('li')});
            }
            const level=lists[lists.length-1],item=document.createElement('li');renderInline(item,match[3],sources);level.list.append(item);level.item=item;
            level.contentIndent=indent+line.slice(match[1].length,line.length-match[3].length).replace(/\t/g,'    ').length;continue;
        }
        if(lists.length){
            if(!line.trim()){
                let next=i+1;while(next<lines.length&&!lines[next].trim())next++;
                if(next<lines.length&&listItem(lines[next]))continue;
            }else{
                const level=lists[lists.length-1],expanded=line.replace(/^\t+/g,t=>'    '.repeat(t.length));
                if(expanded.length-expanded.trimStart().length>=level.contentIndent){const continuation=document.createElement('span');renderInline(continuation,'\n'+expanded.slice(level.contentIndent),sources);level.item.append(continuation);continue;}
            }
            lists.length=0;
        }
        if(line.includes('|')&&i+1<lines.length&&/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i+1])){
            flush();const columns=cells(line),rows:string[][]=[];i+=2;
            while(i<lines.length&&lines[i].trim()&&lines[i].includes('|')){const row=cells(lines[i++]);rows.push(columns.map((_,index)=>row[index]||''));}i--;
            fragment.append(tableView({name:'Tabela da resposta',columns,rows}));
        }else pending.push(line);
    }
    flush();body.replaceChildren(fragment);
}
