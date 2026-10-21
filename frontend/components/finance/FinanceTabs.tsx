export default function FinanceTabs({active}:{active:'personal'|'crypto'}) {
    return <nav className="finance-section-tabs" aria-label="Seções de finanças">
        <a href="/finance" aria-current={active==='personal'?'page':undefined}>Minhas finanças</a>
        <a href="/finance/crypto" aria-current={active==='crypto'?'page':undefined}>Cripto</a>
    </nav>;
}
