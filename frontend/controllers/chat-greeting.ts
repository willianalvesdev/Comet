import { workspaceGet } from './workspace-cache';
import { optionalElement, isRecord, present } from './dom';
export default function mount({scope, setTimeout, setInterval, requestAnimationFrame, fetch, ResizeObserver, MutationObserver}: PageContext) {
 const label=optionalElement(document, '[data-chat-greeting]', HTMLElement);if(!label)return;
 const key='ascenda-greeting-visit-'+label.dataset.accountId;
 let returning=false;try{returning=!!sessionStorage.getItem(key);sessionStorage.setItem(key,'1');}catch{}
 const now=new Date(),hour=now.getHours(),day=now.getDay();
 const choices=['Olá','Olá, {name}','Oi, {name}, como você está?','Oi, como você está?','Como vão as coisas, {name}?','Como vão as coisas?','Boas-vindas','Boas-vindas, {name}','O que há de novo, {name}?','O que há de novo?','No que você está pensando, {name}?','No que você está pensando?'];
 const period=hour>=5&&hour<12?'Bom dia':hour>=12&&hour<18?'Boa tarde':'Boa noite';choices.push(period,period+', {name}');
 const days=[['Bom domingo','Bom domingo, {name}','Sessão de domingo?','Sessão de domingo, {name}?'],['Boa segunda-feira','Boa segunda-feira, {name}'],['Boa terça-feira','Boa terça-feira, {name}'],['Boa quarta-feira','Boa quarta-feira, {name}'],['Boa quinta-feira','Boa quinta-feira, {name}'],['Boa sexta-feira','Boa sexta-feira, {name}','Aquele clima de sexta-feira'],['Bom sábado!','Bom sábado, {name}']];choices.push(...days[day]);
 if(day===0||day===6)choices.push('Bem-vindo ao fim de semana','Como vai o fim de semana, {name}?');
 if(hour>=18||hour<5)choices.push('Pensamentos da noite?','Pensamentos da noite, {name}?');
 if(hour>=22||hour<5)choices.push('Olá, coruja da noite');
 if(hour>=17)choices.push('Como foi seu dia?','Como foi seu dia, {name}?');
 if(hour>=6&&hour<11||hour>=14&&hour<17)choices.push('Hora do café e do Computer?');
 if(returning)choices.push('{name} está de volta!','De volta à ativa, {name}','De volta à ativa!');
 const greetingKey='ascenda-greeting-'+label.dataset.accountId;
 const interval=[now.getFullYear(),now.getMonth(),now.getDate(),period].join('-');
 let greeting=choices[Math.floor(Math.random()*choices.length)];
 try {
  const saved:unknown=JSON.parse(localStorage.getItem(greetingKey)||'null');
  if(isRecord(saved)&&saved.interval===interval && typeof saved.text==='string')greeting=saved.text;
  else localStorage.setItem(greetingKey,JSON.stringify({interval,text:greeting}));
 } catch {}
 function fit(){
  const heading=present(label).parentElement;const width=present(heading).clientWidth-(getComputedStyle(present(heading)).flexDirection==='column' ? 0 : (optionalElement(present(heading), 'img, svg, i, .computer-logo', Element)?.getBoundingClientRect().width||44)+(parseFloat(getComputedStyle(present(heading)).columnGap)||0));
  const base=parseFloat(getComputedStyle(present(heading)).fontSize);present(label).style.fontSize=base+'px';
  if(present(label).scrollWidth>width)present(label).style.fontSize=Math.max(12,base*width/present(label).scrollWidth)+'px';
 }
 const eyes=optionalElement(present(label.parentElement), '.computer-eyes', HTMLElement);
 if(eyes)eyes.style.animationDelay=-(Date.now()%10000)+'ms';
 const nameKey='ascenda-greeting-name-'+label.dataset.accountId;
 let anonymous=document.body.classList.contains('is-anonymous'),currentName=label.dataset.accountName || '';
 try { currentName=localStorage.getItem(nameKey)||currentName; } catch {}
 const render=(name:string)=>{currentName=name||currentName;label.textContent=anonymous?'Você está Anônimo':greeting.replaceAll('{name}',currentName);fit();};
 scope.listen(window, 'chat:anonymous',event=>{anonymous=event.detail;render(currentName);});
 new ResizeObserver(fit).observe(present(label.parentElement));document.fonts.ready.then(fit);
 render(currentName);
 if (!anonymous) workspaceGet('/api/ai/personalization', 60000).then((profile:unknown)=>{if(scope.active && isRecord(profile)){const name=profile.name||profile.account_name;if(typeof name==='string'&&name){try{localStorage.setItem(nameKey,name);}catch{}if(name!==currentName)render(name);}}}).catch(()=>{});
}
