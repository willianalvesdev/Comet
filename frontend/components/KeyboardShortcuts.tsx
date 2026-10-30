import {keyboardShortcuts} from '../keyboard-shortcuts';

export default function KeyboardShortcuts() {
    return <dialog className="keyboard-shortcuts" aria-labelledby="keyboard-shortcuts-title">
        <header><h2 id="keyboard-shortcuts-title">Atalhos do teclado</h2><button type="button" data-shortcuts-close aria-label="Fechar atalhos do teclado"><i className="ui-icon-x" aria-hidden="true" /></button></header>
        <div className="keyboard-shortcuts__body">{['Geral','Navegação','Interface'].map(group => <section key={group}><h3>{group}</h3><dl>{keyboardShortcuts.filter(item=>item.group===group).map(item=><div key={item.action}><dt>{item.label}</dt><dd>{item.keys.map((key,i)=><kbd key={i}>{key}</kbd>)}</dd></div>)}</dl></section>)}</div>
        <footer><kbd>Ctrl</kbd> Control <kbd>Alt</kbd> Alt <kbd>Shift</kbd> Shift</footer>
    </dialog>;
}
