import type { ComponentType } from 'react';
import type { BootstrapData, PageName } from '../types';
export interface PageModule { default: ComponentType<{bootstrap:BootstrapData}>; controllers: PageFactory[]; }
const loaders: Record<PageName, () => Promise<PageModule>> = {
    index: () => import('../components/LandingPage'),
    privacidade: () => import('../pages/PrivacyPage'),
    computer: () => import('../pages/ComputerPage'),
    recentes: () => import('../pages/RecentChatsPage'),
    aprender: () => import('../pages/LearnPage'),
    descobrir: () => import('../pages/DiscoverPage'),
    graficos: () => import('../pages/FinancePage'),
    cripto: () => import('../pages/CryptoPage'),
};
const loaded = new Map<PageName, Promise<PageModule>>();
export function loadPage(page: PageName): Promise<PageModule> {
    let result = loaded.get(page);
    if (!result) {
        result = loaders[page]().catch(error => { loaded.delete(page); throw error; });
        loaded.set(page, result);
    }
    return result;
}
