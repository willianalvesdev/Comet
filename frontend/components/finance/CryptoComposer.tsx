import FinanceComposer from './FinanceComposer';
export default function CryptoComposer() {
    return <FinanceComposer className="crypto-composer" label="Pesquisar sobre criptomoedas">
        <p className="crypto-composer-error" role="alert" hidden />
    </FinanceComposer>;
}
