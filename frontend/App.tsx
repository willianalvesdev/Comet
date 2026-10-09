import { memo, useLayoutEffect, useState } from 'react';
import type { BootstrapData } from './types';
import { Sidebar, SidebarBackdrop, Settings } from './components/WorkspaceParts';
import LandingPage from './components/LandingPage';
import ComputerPage from './pages/ComputerPage';
import RecentChatsPage from './pages/RecentChatsPage';
import DiscoverPage from './pages/DiscoverPage';
import LearnPage from './pages/LearnPage';
import FinancePage from './pages/FinancePage';
import { mountControllers } from './runtime/lifecycle';
import { sharedControllers, workspaceControllers, pageControllers } from './runtime/controllers';
import { routes } from './routes';

const pages = {index:LandingPage, computer:ComputerPage, recentes:RecentChatsPage, descobrir:DiscoverPage, aprender:LearnPage, graficos:FinancePage};
const WorkspaceShell = memo(function WorkspaceShell({data}: {data: BootstrapData}) {
    return <><Sidebar data={data} /><SidebarBackdrop /><Settings data={data} /></>;
});

export default function App({bootstrap, revision, onReady}: {bootstrap:BootstrapData; revision:number; onReady:()=>void}) {
    const [shell] = useState(bootstrap);
    const workspace = bootstrap.page !== 'index';
    useLayoutEffect(() => {
        const collapsed = document.body.classList.contains('is-sidebar-collapsed');
        document.body.className = workspace ? 'workspace sidebar-ready' : '';
        document.body.classList.toggle('is-sidebar-collapsed', workspace && collapsed);
        document.body.classList.toggle('recent-chats-page', bootstrap.page === 'recentes');
    }, [workspace, bootstrap.page]);
    useLayoutEffect(() => mountControllers([...sharedControllers, ...(workspace ? workspaceControllers : [])]), [workspace]);
    useLayoutEffect(() => {
        document.querySelectorAll<HTMLAnchorElement>('.sidebar__link').forEach(link => {
            const page = routes[new URL(link.href).pathname];
            if (page === bootstrap.page) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
        });
        const dispose = mountControllers(pageControllers[bootstrap.page]);
        onReady();
        return dispose;
    }, [revision, bootstrap.page, onReady]);
    const Page = pages[bootstrap.page];
    return <>{workspace && <WorkspaceShell data={shell} />}<Page key={revision} bootstrap={bootstrap} /></>;
}
