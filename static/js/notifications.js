(() => {
 const panel=document.querySelector('#notifications-panel'),trigger=document.querySelector('.sidebar__notification');if(!panel||!trigger)return;
 const more=panel.querySelector('.notifications-more'),options=panel.querySelector('.notifications-options');
 trigger.setAttribute('popovertarget',panel.id);trigger.setAttribute('aria-expanded','false');
 function position(){const r=trigger.getBoundingClientRect();panel.style.left=Math.max(12,Math.min(r.right+12,innerWidth-panel.offsetWidth-12))+'px';panel.style.top=Math.max(12,Math.min(r.bottom-panel.offsetHeight,innerHeight-panel.offsetHeight-12))+'px';}
 panel.addEventListener('toggle',()=>{const open=panel.matches(':popover-open');trigger.setAttribute('aria-expanded',String(open));options.hidden=true;more.setAttribute('aria-expanded','false');if(open)position();});
 window.addEventListener('resize',()=>{if(panel.matches(':popover-open'))position();});
 more.addEventListener('click',()=>{options.hidden=!options.hidden;more.setAttribute('aria-expanded',String(!options.hidden));});
 panel.querySelector('[data-notification-settings]').addEventListener('click',()=>{panel.hidePopover();document.querySelector('[data-open-settings]').click();document.querySelector('[data-settings-tab="notifications"]').click();});
 panel.querySelector('[data-notification-clear]').addEventListener('click',()=>{options.hidden=true;more.setAttribute('aria-expanded','false');panel.querySelector('.notifications-status').textContent='Nenhuma notificação lida para excluir.';});
 panel.addEventListener('keydown',event=>{if(event.key==='Escape'&&!options.hidden){event.preventDefault();event.stopPropagation();options.hidden=true;more.setAttribute('aria-expanded','false');more.focus();}});
})();
