(() => {
 const picker=document.querySelector('#attachment-input'),menu=document.querySelector('#attachment-menu'),toggle=document.querySelector('.attachment-toggle');if(!picker)return;
 const list=document.querySelector('.home__composer .attachment-list'),status=document.querySelector('.attachment-status');
 let files=[],uploading=false,locked=false,version=0,controller=null;
 function render(){list.replaceChildren();list.hidden=!files.length;for(const file of files){const chip=document.createElement('div');chip.className='attachment-chip';const name=document.createElement('span');name.textContent=file.name;name.title=file.name;const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Remover '+file.name);remove.disabled=locked||uploading;remove.addEventListener('click',()=>{files=files.filter(item=>item.id!==file.id);render();});chip.append(name,remove);list.append(chip);}toggle.disabled=locked||uploading;window.dispatchEvent(new Event('attachments:changed'));}
 function position(){const r=toggle.getBoundingClientRect();menu.style.left=Math.max(12,Math.min(r.left,innerWidth-menu.offsetWidth-12))+'px';menu.style.top=Math.max(12,r.top-menu.offsetHeight-8)+'px';}
 menu.addEventListener('toggle',()=>{if(menu.matches(':popover-open'))position();});window.addEventListener('resize',position);
 menu.querySelector('[data-upload-files]').addEventListener('click',()=>{menu.hidePopover();picker.click();});
 picker.addEventListener('change',async()=>{
  if(locked||uploading)return;
  const selected=[...picker.files];picker.value='';if(files.length+selected.length>4){status.textContent='Anexe até 4 arquivos por mensagem.';return;}
  if(selected.some(file=>file.size>8*1024*1024)){status.textContent='Cada arquivo pode ter até 8 MB.';return;}
  const expected=version;controller=new AbortController();uploading=true;status.textContent='Preparando anexos…';render();
  try{for(const file of selected){const body=new FormData();body.append('file',file);const response=await fetch('/api/ai/attachments',{method:'POST',credentials:'same-origin',signal:controller.signal,headers:{'X-CSRFToken':document.querySelector('meta[name="csrf-token"]').content},body});const data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível anexar o arquivo.');if(expected!==version)return;files.push(data);window.ComputerModels.select('gemini');render();}status.textContent='';}
  catch(error){if(expected===version&&error.name!=='AbortError')status.textContent=error.message;}
  finally{if(expected===version){uploading=false;controller=null;render();}}
 });
 window.ComputerAttachments={
  files:()=>files.map(file=>({...file})),busy:()=>uploading,
  clear:()=>{version++;controller?.abort();controller=null;files=[];uploading=false;status.textContent='';render();},
  restore:items=>{files=items.map(file=>({...file}));if(files.length)window.ComputerModels.select('gemini');render();},
  setBusy:value=>{locked=value;toggle.disabled=locked||uploading;list.querySelectorAll('button').forEach(button=>button.disabled=locked||uploading);}
 };
 render();
})();
