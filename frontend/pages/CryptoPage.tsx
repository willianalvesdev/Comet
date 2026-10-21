import {useEffect,useState} from 'react';
import type {CryptoAsset} from '../../shared/crypto';
import type { BootstrapData } from '../types';
import { MobileMenu } from '../components/WorkspaceParts';
import FinanceTabs from '../components/finance/FinanceTabs';
import CryptoDashboard from '../components/finance/CryptoDashboard';
import CryptoSearch from '../components/finance/CryptoSearch';

export default function CryptoPage({ bootstrap }: { bootstrap: BootstrapData }) {
    const assetId = typeof window !== 'undefined' ? window.location.pathname.split('/')[3] : undefined;
    const [asset,setAsset]=useState<CryptoAsset|null>(null);
    useEffect(()=>setAsset(null),[assetId]);
    return <div id="workspace-page">
        <main className="workspace__content" aria-label="Área de trabalho">
            <header className="workspace__header crypto-header">
                <div className="crypto-header-title"><MobileMenu />{assetId?<nav className="crypto-header-breadcrumb" aria-label="Localização"><a href="/finance">Finanças</a><i className="market-icon market-icon--right" aria-hidden="true"/><span>{asset?`${asset.symbol}/USD`:"…"}</span></nav>:<span className="workspace__title">Finanças</span>}</div>
                <CryptoSearch key={assetId || 'home'} />
            </header>
            <section className="crypto-page" aria-label="Cripto">
                <FinanceTabs active="crypto" />
                <CryptoDashboard key={`${bootstrap.user?.id ?? 0}:${assetId || 'home'}`} userId={bootstrap.user?.id ?? 0} assetId={assetId} onAsset={setAsset} />
            </section>
        </main>
    </div>;
}

import service from '../controllers/computer-service';
import models from '../controllers/model-menu';
import composer from '../controllers/crypto-composer';
import dictation from '../controllers/dictation';
import discovery from '../controllers/discovery-panel';
export const controllers: PageFactory[] = [service, models, composer, dictation, discovery];
