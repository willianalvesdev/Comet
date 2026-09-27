(() => {
 const label=document.querySelector('[data-chat-greeting]');if(!label)return;
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
 // The anonymous greeting is reserved for a real anonymous mode; this chat saves history.
 const greeting=choices[Math.floor(Math.random()*choices.length)];
 function fit(){
  const heading=label.parentElement;const width=heading.clientWidth-(heading.querySelector('svg')?.getBoundingClientRect().width||42)-14;
  const base=Math.min(44,Math.max(22,innerWidth*.032));label.style.fontSize=base+'px';
  if(label.scrollWidth>width)label.style.fontSize=Math.max(12,base*width/label.scrollWidth)+'px';
 }
 const render=name=>{label.textContent=greeting.replaceAll('{name}',name||label.dataset.accountName);fit();};
 new ResizeObserver(fit).observe(label.parentElement);document.fonts.ready.then(fit);
 render(label.dataset.accountName);
 fetch('/api/ai/personalization',{credentials:'same-origin',cache:'no-store'}).then(response=>response.ok?response.json():null).then(profile=>{if(profile)render(profile.name||profile.account_name);}).catch(()=>{});
})();
