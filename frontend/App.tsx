import type { PageModule } from './runtime/pages';
import { mountWorkspaceCache } from './controllers/workspace-cache';
import { memo, useLayoutEffect, useState } from 'react';
import type { BootstrapData } from './types';
import { Sidebar, SidebarBackdrop, Settings } from './components/WorkspaceParts';
import { mountControllers } from './runtime/lifecycle';
import { sharedControllers, workspaceControllers } from './runtime/controllers';
import { routes, isPublicPage } from './routes';

const WorkspaceShell = memo(function WorkspaceShell({data}: {data: BootstrapData}) {
    return <><Sidebar data={data} /><SidebarBackdrop /><Settings data={data} /></>;
});

export default function App({bootstrap, revision, onReady, pageModule}: {bootstrap:BootstrapData; revision:number; onReady:()=>void; pageModule:PageModule}) {
    const [shell] = useState(bootstrap);
    const workspace = !isPublicPage(bootstrap.page);
    useLayoutEffect(() => mountWorkspaceCache(workspace ? bootstrap.user?.id : undefined), [bootstrap.user?.id, workspace]);
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
            if ((page === bootstrap.page || page === 'graficos' && bootstrap.page === 'cripto') && !(page === 'computer' && bootstrap.conversationId)) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
        });
        const dispose = mountControllers(pageModule.controllers);
        onReady();
        return dispose;
    }, [revision, bootstrap.page, onReady, pageModule]);
    const Page = pageModule.default;
    return <>{workspace && <WorkspaceShell data={shell} />}<Page key={revision} bootstrap={bootstrap} /></>;
}
