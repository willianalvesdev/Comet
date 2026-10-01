(() => {
 const panel=optionalElement(document, '#notifications-panel', HTMLElement),trigger=optionalElement(document, '.sidebar__notification', HTMLButtonElement);if(!panel||!trigger)return;
 const more=requiredElement(panel, '.notifications-more', HTMLElement),options=optionalElement(panel, '.notifications-options', HTMLElement);
 trigger.setAttribute('popovertarget',panel.id);trigger.setAttribute('aria-expanded','false');
 function position(){const r=requiredElement(document, ".sidebar", HTMLElement).getBoundingClientRect();present(panel).style.left=Math.max(12,Math.min(r.right+12,innerWidth-present(panel).offsetWidth-12))+'px';present(panel).style.top=Math.max(12,Math.min(r.top+14,innerHeight-present(panel).offsetHeight-12))+'px';}
 trigger.addEventListener('click',event=>{event.preventDefault();if(panel.togglePopover())position();});
 panel.addEventListener('toggle',()=>{const open=panel.matches(':popover-open');trigger.setAttribute('aria-expanded',String(open));present(options).hidden=true;more.setAttribute('aria-expanded','false');if(open)position();});
 window.addEventListener('resize',()=>{if(panel.matches(':popover-open'))position();});
 more.addEventListener('click',()=>{present(options).hidden=!present(options).hidden;more.setAttribute('aria-expanded',String(!present(options).hidden));});
 requiredElement(panel, '[data-notification-settings]', HTMLElement).addEventListener('click',()=>{panel.hidePopover();requiredElement(document, '[data-open-settings]', HTMLElement).click();requiredElement(document, '[data-settings-tab="notifications"]', HTMLButtonElement).click();});
 requiredElement(panel, '[data-notification-clear]', HTMLElement).addEventListener('click',()=>{present(options).hidden=true;more.setAttribute('aria-expanded','false');requiredElement(panel, '.notifications-status', HTMLElement).textContent='Nenhuma notificação lida para excluir.';});
 panel.addEventListener('keydown',event=>{if(event.key==='Escape'&&!present(options).hidden){event.preventDefault();event.stopPropagation();present(options).hidden=true;more.setAttribute('aria-expanded','false');more.focus();}});
})();
