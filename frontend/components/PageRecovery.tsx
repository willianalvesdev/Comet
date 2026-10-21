import { Component, type ReactNode, type ErrorInfo } from 'react';

type Props = { children: ReactNode; revision: number; onRetry: () => void; onFailure: () => void };
export default class PageRecovery extends Component<Props, {failed: boolean; revision: number}> {
    state = {failed: false, revision: this.props.revision};
    static getDerivedStateFromProps(props: Props, state: {revision: number}) {
        return props.revision !== state.revision ? {failed: false, revision: props.revision} : null;
    }
    static getDerivedStateFromError() { return {failed: true}; }
    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('Falha ao inicializar página', error, info.componentStack);
        this.props.onFailure();
    }
    render() {
        if (!this.state.failed) return this.props.children;
        return <main role="alert" className="tw:fixed tw:inset-0 tw:z-[200] tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-4 tw:bg-surface tw:p-8">
            <p>Não foi possível abrir esta página.</p>
            <button type="button" onClick={this.props.onRetry}>Tentar novamente</button>
            <a href="/new">Voltar ao chat</a>
        </main>;
    }
}
